/**
 * Offline: describe tables as the staging copy (sanitised production schema
 * dump + PR migrations) defines them. No database.
 *
 *   npx tsx scripts/staging/describe-tables.ts ~/lm-staging/staging-schema.dump.sql pickup_orders system_tasks error_logs audit_logs
 *   npx tsx scripts/staging/describe-tables.ts ~/lm-staging/staging-schema.dump.sql --service-role-gaps
 *
 * Per table: columns (type, NOT NULL, kind of DEFAULT — never its value),
 * RLS on/off, policies (name, command, roles — no expressions), table grants,
 * and grants on sequences used by column defaults. Schema metadata only, safe
 * to share.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { qualify, unquote } from './columnNotNull';
import { PR_MIGRATION_FILES } from './prMigrations';
import { APPLY_ROLE } from './privileges';
import { splitSqlStatements } from './sqlLexer';
import { describeColumns, modelFromSql } from './tableColumns';

export type Acl = Map<string, Map<string, Set<string>>>; // object → role → privileges

const roleNames = (s: string) =>
  s
    .split(',')
    .map((r) => r.trim().replace(/\s+WITH\s+GRANT\s+OPTION$/i, '').replace(/^GROUP\s+/i, ''))
    .filter(Boolean)
    .map((r) => (r.startsWith('"') ? r.slice(1, -1) : r.toLowerCase()));
const privList = (s: string) =>
  s
    .toUpperCase()
    .replace(/\s+PRIVILEGES$/, '')
    .split(',')
    .map((p) => p.trim().replace(/\s*\(.*\)$/, ''))
    .filter(Boolean);

export type TableMeta = { acl: Acl; rls: Set<string>; policies: Map<string, string[]> };

export function tableMeta(sqls: string[]): TableMeta {
  const acl: Acl = new Map();
  const rls = new Set<string>();
  const policies = new Map<string, string[]>();
  const grant = (obj: string, roles: string[], privs: string[], add: boolean) => {
    if (!acl.has(obj)) acl.set(obj, new Map());
    const byRole = acl.get(obj)!;
    for (const r of roles) {
      const cur = byRole.get(r) ?? new Set<string>();
      const all = privs.includes('ALL');
      if (add) (all ? ['ALL'] : privs).forEach((p) => cur.add(p));
      else if (all) cur.clear();
      else privs.forEach((p) => cur.delete(p));
      if (cur.size) byRole.set(r, cur);
      else byRole.delete(r);
    }
  };
  for (const sql of sqls) {
    for (const s of splitSqlStatements(sql)) {
      if (s.kind !== 'sql') continue;
      const t = s.text;
      let m: RegExpExecArray | null;
      // Default privileges of the apply role (postgres) reach tables/sequences created AFTER them,
      // e.g. tables added by the PR migrations on top of the dump.
      if ((m = /^ALTER\s+DEFAULT\s+PRIVILEGES\s+(?:FOR\s+(?:ROLE|USER)\s+("?[\w$]+"?)\s+)?(?:IN\s+SCHEMA\s+"?public"?\s+)?(GRANT|REVOKE)\s+([\s\S]+?)\s+ON\s+(TABLES|SEQUENCES)\s+(?:TO|FROM)\s+([\s\S]+?)\s*;?$/i.exec(t))) {
        if (!m[1] || unquote(m[1]) === APPLY_ROLE) {
          const kind = m[4].toUpperCase() === 'TABLES' ? 'TABLE' : 'SEQUENCE';
          const key = `DEFAULT ${kind}`;
          grant(key, roleNames(m[5]), privList(m[3]), m[2].toUpperCase() === 'GRANT');
        }
        continue;
      }
      const created = /^CREATE\s+(?:UNLOGGED\s+)?(TABLE|SEQUENCE)\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."$]+)/i.exec(t);
      if (created) {
        const kind = created[1].toUpperCase();
        for (const [role, privs] of acl.get(`DEFAULT ${kind}`) || []) grant(`${kind} ${qualify(created[2])}`, [role], [...privs], true);
        continue;
      }
      if ((m = /^GRANT\s+([\s\S]+?)\s+ON\s+(?:(TABLE|SEQUENCE)\s+)?([\w."$]+)\s+TO\s+([\s\S]+?)\s*;?$/i.exec(t)) && !/^(FUNCTION|SCHEMA|ALL)\b/i.test(m[3])) {
        grant(`${(m[2] || 'TABLE').toUpperCase()} ${qualify(m[3])}`, roleNames(m[4]), privList(m[1]), true);
      } else if ((m = /^REVOKE\s+([\s\S]+?)\s+ON\s+(?:(TABLE|SEQUENCE)\s+)?([\w."$]+)\s+FROM\s+([\s\S]+?)\s*(?:CASCADE|RESTRICT)?\s*;?$/i.exec(t)) && !/^(FUNCTION|SCHEMA|ALL)\b/i.test(m[3])) {
        grant(`${(m[2] || 'TABLE').toUpperCase()} ${qualify(m[3])}`, roleNames(m[4]), privList(m[1]), false);
      } else if ((m = /^ALTER\s+TABLE\s+(?:ONLY\s+)?([\w."$]+)\s+(ENABLE|DISABLE)\s+ROW\s+LEVEL\s+SECURITY/i.exec(t))) {
        if (m[2].toUpperCase() === 'ENABLE') rls.add(qualify(m[1]));
        else rls.delete(qualify(m[1]));
      } else if ((m = /^CREATE\s+POLICY\s+("(?:[^"]|"")+"|[\w$]+)\s+ON\s+([\w."$]+)([\s\S]*)$/i.exec(t))) {
        const rest = m[3];
        const cmd = /\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i.exec(rest)?.[1].toUpperCase() ?? 'ALL';
        const to = /\bTO\s+([\s\S]+?)(?=\s+USING\b|\s+WITH\s+CHECK\b|\s*;?$)/i.exec(rest)?.[1];
        const table = qualify(m[2]);
        const label = `${unquote(m[1])} [${cmd}${/\bAS\s+RESTRICTIVE\b/i.test(rest) ? ', RESTRICTIVE' : ''}] → ${to ? roleNames(to).join(', ') : 'public'}`;
        policies.set(table, [...(policies.get(table) || []), label]);
      } else if ((m = /^DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?("(?:[^"]|"")+"|[\w$]+)\s+ON\s+([\w."$]+)/i.exec(t))) {
        const table = qualify(m[2]);
        policies.set(table, (policies.get(table) || []).filter((p) => !p.startsWith(`${unquote(m![1])} [`)));
      }
    }
  }
  return { acl, rls, policies };
}

/** Tables where service_role has no privilege; shows anon's privileges and RLS (names only). */
export function serviceRoleGaps(model: Map<string, unknown>, meta: TableMeta): string[] {
  return [...model.keys()]
    .sort()
    .filter((t) => !meta.acl.get(`TABLE ${t}`)?.get('service_role')?.size)
    .map((t) => {
      const anon = meta.acl.get(`TABLE ${t}`)?.get('anon');
      return `${t} — anon: ${anon?.size ? [...anon].join(',') : 'none'}; RLS ${meta.rls.has(t) ? 'on' : 'off'}`;
    });
}

const aclLine = (byRole: Map<string, Set<string>> | undefined) =>
  byRole && byRole.size ? [...byRole].map(([r, p]) => `${r}: ${[...p].join(',')}`).join('; ') : 'none (owner only)';

function main() {
  const [dump, ...names] = process.argv.slice(2);
  if (!dump || !names.length) {
    console.error('usage: npx tsx scripts/staging/describe-tables.ts <staging-schema.dump.sql> <table> [table…]');
    process.exit(2);
  }
  const root = join(__dirname, '..', '..');
  const sqls = [readFileSync(dump, 'utf8'), ...PR_MIGRATION_FILES.map((m) => readFileSync(join(root, 'supabase/migrations', m), 'utf8'))];
  const model = modelFromSql(...sqls);
  const meta = tableMeta(sqls);
  if (names[0] === '--service-role-gaps') {
    const gaps = serviceRoleGaps(model, meta);
    console.log(`tables without any service_role privilege: ${gaps.length} of ${model.size}`);
    gaps.forEach((g) => console.log(`   · ${g}`));
    return;
  }
  for (const name of names) {
    const t = qualify(name);
    const cols = model.get(t);
    console.log(`\n== ${t}${cols ? '' : ' — NOT FOUND in the staging schema'}`);
    if (!cols) continue;
    describeColumns(cols).forEach((c) => console.log(`   · ${c}`));
    console.log(`   RLS: ${meta.rls.has(t) ? 'enabled' : 'disabled'}`);
    const pols = meta.policies.get(t) || [];
    console.log(`   policies (${pols.length}): ${pols.join(' | ') || 'none'}`);
    console.log(`   table grants: ${aclLine(meta.acl.get(`TABLE ${t}`))}`);
    for (const c of cols.values()) {
      const seq = /^nextval\((.+)\)$/.exec(c.defaultKind || '')?.[1];
      if (seq) console.log(`   sequence ${seq} (default of ${c.name}) grants: ${aclLine(meta.acl.get(`SEQUENCE ${qualify(seq)}`))}`);
    }
  }
}

if (require.main === module) main();
