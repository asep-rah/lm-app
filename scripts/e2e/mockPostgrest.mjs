// Minimal in-memory PostgREST mock for local E2E of the customer auth routes.
// Supports: select (all columns), eq/neq/gte/lte/is/not.is/in/ilike filters,
// order, limit, count=exact (HEAD/GET), insert, update (PATCH), upsert on_conflict,
// Accept object (single), unique constraints mirroring the migration.
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const db = { customer_login_challenges: [], customer_auth_identities: [], customers: [], audit_logs: [], error_logs: [] };
const UNIQUE = {
  customer_login_challenges: [(r) => r.code_hash, (r) => r.provider_message_id || null],
  customer_auth_identities: [(r) => r.customer_phone, (r) => String(r.email || '').toLowerCase()]
};
export const state = db;

const parseVal = (v) => (v === 'null' ? null : v === 'true' ? true : v === 'false' ? false : v);
const match = (row, key, expr) => {
  let neg = false;
  if (expr.startsWith('not.')) { neg = true; expr = expr.slice(4); }
  const dot = expr.indexOf('.');
  const op = expr.slice(0, dot);
  const raw = decodeURIComponent(expr.slice(dot + 1));
  const val = row[key];
  let ok;
  switch (op) {
    case 'eq': ok = String(val) === String(parseVal(raw)); break;
    case 'neq': ok = String(val) !== String(parseVal(raw)); break;
    case 'gte': ok = val != null && String(val) >= raw; break;
    case 'lte': ok = val != null && String(val) <= raw; break;
    case 'is': ok = raw === 'null' ? val == null : val === parseVal(raw); break;
    case 'in': ok = raw.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')).includes(String(val)); break;
    case 'ilike': ok = String(val ?? '').toLowerCase() === raw.toLowerCase(); break;
    default: throw new Error('op ' + op);
  }
  return neg ? !ok : ok;
};

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
const filterRows = (rows, params) =>
  rows.filter((r) => [...params.entries()].every(([k, v]) => RESERVED.has(k) || match(r, k, v)));

const uniqueViolation = (table, row, ignore) =>
  (UNIQUE[table] || []).some((fn) => {
    const v = fn(row);
    return v != null && v !== '' && db[table].some((o) => o !== ignore && fn(o) === v);
  });

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
};

export function startMock(port) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const m = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (!m) return send(res, 404, { message: 'not found' });
    const table = m[1];
    db[table] = db[table] || [];
    const params = url.searchParams;
    const prefer = String(req.headers.prefer || '');
    const wantObject = String(req.headers.accept || '').includes('vnd.pgrst.object');
    let body = '';
    for await (const c of req) body += c;
    const payload = body ? JSON.parse(body) : null;

    const out = (rows, status = 200) => {
      if (params.get('order')) {
        const [col, dir] = params.get('order').split('.');
        rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (dir === 'desc' ? -1 : 1));
      }
      if (params.get('limit')) rows = rows.slice(0, Number(params.get('limit')));
      const headers = prefer.includes('count=exact') ? { 'Content-Range': `0-${Math.max(0, rows.length - 1)}/${rows.length}` } : {};
      if (req.method === 'HEAD') return send(res, 200, undefined, headers);
      if (wantObject) {
        if (rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
        return send(res, status, rows[0], headers);
      }
      return send(res, status, rows, headers);
    };

    if (req.method === 'GET' || req.method === 'HEAD') {
      const rows = filterRows(db[table], params);
      if (req.method === 'HEAD' || prefer.includes('count=exact')) {
        const headers = { 'Content-Range': `0-0/${rows.length}` };
        return req.method === 'HEAD' ? send(res, 200, undefined, headers) : out(rows);
      }
      return out(rows);
    }
    if (req.method === 'POST') {
      const list = Array.isArray(payload) ? payload : [payload];
      const created = [];
      for (const r of list) {
        const conflictCol = params.get('on_conflict');
        const existing = conflictCol && prefer.includes('merge-duplicates') ? db[table].find((o) => o[conflictCol] === r[conflictCol]) : null;
        if (existing) {
          const next = { ...existing, ...r };
          if (uniqueViolation(table, next, existing)) return send(res, 409, { code: '23505', message: 'duplicate key value violates unique constraint' });
          Object.assign(existing, r);
          created.push(existing);
          continue;
        }
        const row = { id: randomUUID(), created_at: new Date().toISOString(), status: table === 'customer_login_challenges' ? 'pending' : undefined, attempts: 0, ...r };
        if (uniqueViolation(table, row)) return send(res, 409, { code: '23505', message: 'duplicate key value violates unique constraint' });
        db[table].push(row);
        created.push(row);
      }
      return prefer.includes('return=representation') ? out(created, 201) : send(res, 201, undefined);
    }
    if (req.method === 'PATCH') {
      const rows = filterRows(db[table], params);
      for (const r of rows) {
        const next = { ...r, ...payload };
        if (uniqueViolation(table, next, r)) return send(res, 409, { code: '23505', message: 'duplicate key value violates unique constraint' });
      }
      rows.forEach((r) => Object.assign(r, payload));
      return prefer.includes('return=representation') ? out(rows) : send(res, 204, undefined);
    }
    return send(res, 405, { message: 'method' });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
