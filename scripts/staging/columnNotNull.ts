/**
 * Does a dump declare <table>.<column> NOT NULL? Structural, not a regex on
 * one line: pg_dump writes "col type [DEFAULT expr] [COLLATE …] NOT NULL", so
 * "pickup_date date DEFAULT CURRENT_DATE NOT NULL" must count. Recognised:
 *  - column definition with NOT NULL (optionally "CONSTRAINT name NOT NULL")
 *  - table-level "[CONSTRAINT name] NOT NULL col" (PostgreSQL 18)
 *  - PRIMARY KEY on the column (implies NOT NULL)
 *  - ALTER TABLE … ALTER COLUMN col SET NOT NULL
 *  - ALTER TABLE … ADD [CONSTRAINT name] NOT NULL col / PRIMARY KEY (col)
 * A CHECK (col IS NOT NULL) is reported separately and does NOT count: the
 * production column is attnotnull (information_schema is_nullable = NO).
 * String literals, comments and parenthesised expressions are ignored, so a
 * DEFAULT or CHECK text mentioning "NOT NULL" cannot fool it.
 */
import { splitSqlStatements, type SqlStatement } from './sqlLexer';

export type NotNullFinding = {
  table: string;
  column: string;
  tableFound: boolean;
  columnFound: boolean;
  notNull: boolean;
  how: string[];
  type: string | null;
  hasDefault: boolean;
  checkOnly: boolean;
  line: number | null;
};

export const unquote = (s: string) => s.replace(/"/g, '').toLowerCase();

/** Blank out string literals, dollar bodies and comments (length preserved). */
export const maskLiterals = (s: string) =>
  s
    .replace(/'(?:[^']|'')*'/g, (m) => ' '.repeat(m.length))
    .replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1\$/g, (m) => ' '.repeat(m.length))
    .replace(/--[^\n]*/g, (m) => ' '.repeat(m.length));

/** Replace everything inside nested parentheses with spaces. */
export const maskParens = (s: string) => {
  let depth = 0;
  let out = '';
  for (const c of s) {
    if (c === '(') {
      depth++;
      out += depth === 1 ? '(' : ' ';
    } else if (c === ')') {
      out += depth === 1 ? ')' : ' ';
      depth = Math.max(0, depth - 1);
    } else out += depth > 0 ? ' ' : c;
  }
  return out;
};

/** Split the parenthesised body of CREATE TABLE into top-level elements. */
export const tableElements = (text: string): string[] | null => {
  const masked = maskLiterals(text);
  const open = masked.indexOf('(');
  if (open < 0) return null;
  const parts: string[] = [];
  let depth = 0;
  let from = open + 1;
  for (let i = open; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) {
        parts.push(text.slice(from, i));
        return parts.map((p) => p.trim()).filter(Boolean);
      }
    } else if (c === ',' && depth === 1) {
      parts.push(text.slice(from, i));
      from = i + 1;
    }
  }
  return null;
};

export const TABLE_NAME = /^CREATE\s+(?:(?:GLOBAL|LOCAL)\s+)?(?:TEMP(?:ORARY)?\s+|UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:"[^"]+"|[\w$]+)\.(?:"[^"]+"|[\w$]+)|"[^"]+"|[\w$]+)/i;
export const ALTER_TABLE = /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?((?:"[^"]+"|[\w$]+)\.(?:"[^"]+"|[\w$]+)|"[^"]+"|[\w$]+)\s+([\s\S]*)$/i;
export const IDENT = /^("(?:[^"]|"")+"|[\w$]+)/;

export const qualify = (name: string) => {
  const n = unquote(name);
  return n.includes('.') ? n : `public.${n}`;
};

export function findNotNull(input: string | SqlStatement[], table = 'public.pickup_orders', column = 'pickup_date'): NotNullFinding {
  const stmts = typeof input === 'string' ? splitSqlStatements(input) : input;
  const t = qualify(table);
  const col = column.toLowerCase();
  const f: NotNullFinding = { table: t, column: col, tableFound: false, columnFound: false, notNull: false, how: [], type: null, hasDefault: false, checkOnly: false, line: null };

  for (const s of stmts) {
    if (s.kind !== 'sql') continue;
    const create = TABLE_NAME.exec(s.text);
    if (create && qualify(create[1]) === t) {
      f.tableFound = true;
      f.line = s.line;
      for (const el of tableElements(s.text) || []) {
        const flat = maskParens(maskLiterals(el)).replace(/\s+/g, ' ').trim();
        const name = IDENT.exec(el.trim())?.[1];
        const isConstraint = /^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|EXCLUDE|NOT\s+NULL|LIKE)\b/i.test(flat);
        if (!isConstraint && name && unquote(name) === col) {
          f.columnFound = true;
          const rest = flat.slice(flat.search(/\s/) + 1);
          const restText = maskLiterals(el).replace(/\s+/g, ' ').trim();
          f.type = restText.slice(restText.search(/\s/) + 1).split(/\s+(?=DEFAULT|NOT|NULL|CONSTRAINT|CHECK|REFERENCES|UNIQUE|PRIMARY|GENERATED|COLLATE)\b/i)[0].trim() || null;
          f.hasDefault = /\bDEFAULT\b/i.test(rest);
          if (/\bNOT\s+NULL\b/i.test(rest)) {
            f.notNull = true;
            f.how.push(`column definition NOT NULL${f.hasDefault ? ' (with DEFAULT)' : ''}`);
          }
          if (/\bPRIMARY\s+KEY\b/i.test(rest)) {
            f.notNull = true;
            f.how.push('column PRIMARY KEY');
          }
          if (/\bCHECK\b/i.test(rest) && new RegExp(`\\b${col}\\s+IS\\s+NOT\\s+NULL\\b`, 'i').test(maskLiterals(el))) f.checkOnly = true;
        } else if (isConstraint) {
          const tl = /^(?:CONSTRAINT\s+\S+\s+)?NOT\s+NULL\s+("?[\w$]+"?)/i.exec(el.trim());
          if (tl && unquote(tl[1]) === col) {
            f.notNull = true;
            f.how.push('table-level NOT NULL constraint');
          }
          const pk = /^(?:CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY\s*\(([^)]*)\)/i.exec(el.trim());
          if (pk && pk[1].split(',').map(unquote).map((x) => x.trim()).includes(col)) {
            f.notNull = true;
            f.how.push('table PRIMARY KEY');
          }
          if (/^(?:CONSTRAINT\s+\S+\s+)?CHECK\b/i.test(el.trim()) && new RegExp(`\\b"?${col}"?\\s+IS\\s+NOT\\s+NULL\\b`, 'i').test(maskLiterals(el))) f.checkOnly = true;
        }
      }
      continue;
    }
    const alter = ALTER_TABLE.exec(s.text);
    if (alter && qualify(alter[1]) === t) {
      const body = maskLiterals(alter[2]);
      for (const m of body.matchAll(/ALTER\s+(?:COLUMN\s+)?("?[\w$]+"?)\s+SET\s+NOT\s+NULL/gi)) {
        if (unquote(m[1]) === col) {
          f.notNull = true;
          f.how.push(`ALTER TABLE … SET NOT NULL (line ${s.line})`);
        }
      }
      for (const m of body.matchAll(/ADD\s+(?:CONSTRAINT\s+\S+\s+)?NOT\s+NULL\s+("?[\w$]+"?)/gi)) {
        if (unquote(m[1]) === col) {
          f.notNull = true;
          f.how.push(`ALTER TABLE … ADD NOT NULL constraint (line ${s.line})`);
        }
      }
      for (const m of body.matchAll(/ADD\s+(?:CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY\s*\(([^)]*)\)/gi)) {
        if (m[1].split(',').map(unquote).map((x) => x.trim()).includes(col)) {
          f.notNull = true;
          f.how.push(`ALTER TABLE … ADD PRIMARY KEY (line ${s.line})`);
        }
      }
    }
  }
  return f;
}

export const describeNotNull = (f: NotNullFinding): string => {
  if (!f.tableFound) return `NOT FOUND (table ${f.table} is not in the dump)`;
  if (!f.columnFound) return `NOT FOUND (column ${f.column} is not in ${f.table})`;
  if (f.notNull) return `yes — ${f.how.join('; ')}; type ${f.type ?? '?'}`;
  return `NO — column exists (type ${f.type ?? '?'}${f.hasDefault ? ', has DEFAULT' : ''}) but is nullable${f.checkOnly ? '; only a CHECK (… IS NOT NULL) exists' : ''}`;
};
