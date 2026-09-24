/**
 * Column model of tables built from SQL text (sanitised pg_dump + migrations),
 * and a check that a seed's INSERT statements fit that model:
 *  - the table exists,
 *  - every inserted column exists,
 *  - every NOT NULL column without DEFAULT / identity / generated value is supplied,
 *  - no value is inserted into a GENERATED ALWAYS column.
 * Reports only table/column names and types (schema metadata, no data, no
 * default expressions), so the output is safe to share.
 */
import { ALTER_TABLE, IDENT, maskLiterals, maskParens, qualify, TABLE_NAME, tableElements, unquote } from './columnNotNull';
import { splitSqlStatements, type SqlStatement } from './sqlLexer';

export type Column = { name: string; type: string; notNull: boolean; hasDefault: boolean; generatedAlways: boolean; identity: boolean };
export type TableModel = Map<string, Map<string, Column>>;

const CONSTRAINT_START = /^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|EXCLUDE|NOT\s+NULL|LIKE)\b/i;
const TYPE_END = /\s+(?=DEFAULT|NOT|NULL|CONSTRAINT|CHECK|REFERENCES|UNIQUE|PRIMARY|GENERATED|COLLATE)\b/i;

const identName = (s: string) => {
  const m = IDENT.exec(s.trim());
  return m ? (m[1].startsWith('"') ? m[1].slice(1, -1).replace(/""/g, '"') : m[1].toLowerCase()) : '';
};

/** "name type [DEFAULT …] [NOT NULL] …" → Column. */
export function parseColumnDef(def: string): Column | null {
  const name = identName(def);
  if (!name) return null;
  const masked = maskLiterals(def).replace(/\s+/g, ' ').trim();
  const rest = masked.slice(IDENT.exec(def.trim())![1].length).trim();
  const flat = maskParens(rest);
  return {
    name,
    type: rest.split(TYPE_END)[0].trim() || '?',
    notNull: /\bNOT\s+NULL\b/i.test(flat) || /\bPRIMARY\s+KEY\b/i.test(flat),
    hasDefault: /\bDEFAULT\b/i.test(flat),
    identity: /\bGENERATED\s+(ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY\b/i.test(flat),
    generatedAlways: /\bGENERATED\s+ALWAYS\s+AS\b/i.test(flat)
  };
}

/** Split an ALTER TABLE action list on top-level commas. */
const splitActions = (body: string): string[] => {
  const masked = maskLiterals(body);
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      out.push(body.slice(from, i));
      from = i + 1;
    }
  }
  out.push(body.slice(from));
  return out.map((a) => a.trim().replace(/;\s*$/, '')).filter(Boolean);
};

const pkCols = (s: string) => {
  const m = /PRIMARY\s+KEY\s*\(([^)]*)\)/i.exec(s);
  return m ? m[1].split(',').map((c) => unquote(c.trim())) : [];
};

export function applyToModel(model: TableModel, stmts: SqlStatement[]): TableModel {
  for (const s of stmts) {
    if (s.kind !== 'sql') continue;
    const create = TABLE_NAME.exec(s.text);
    if (create && !/\bPARTITION\s+OF\b/i.test(s.text.slice(0, 300))) {
      const t = qualify(create[1]);
      if (model.has(t) && /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i.test(s.text)) continue;
      const cols = new Map<string, Column>();
      for (const el of tableElements(s.text) || []) {
        const flat = maskParens(maskLiterals(el)).replace(/\s+/g, ' ').trim();
        if (CONSTRAINT_START.test(flat)) {
          const nn = /^(?:CONSTRAINT\s+\S+\s+)?NOT\s+NULL\s+("?[\w$]+"?)/i.exec(el.trim());
          const nnCol = nn && cols.get(unquote(nn[1]));
          if (nnCol) nnCol.notNull = true;
          for (const c of pkCols(el)) if (cols.has(c)) cols.get(c)!.notNull = true;
          continue;
        }
        const col = parseColumnDef(el);
        if (col) cols.set(col.name, col);
      }
      model.set(t, cols);
      continue;
    }
    const drop = /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\s\S]+?)\s*(?:CASCADE|RESTRICT)?\s*;?$/i.exec(s.text);
    if (drop) {
      drop[1].split(',').forEach((n) => model.delete(qualify(n.trim())));
      continue;
    }
    const rename = /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([\w."$]+)\s+RENAME\s+(?:COLUMN\s+)?("?[\w$]+"?)\s+TO\s+("?[\w$]+"?)/i.exec(s.text);
    if (rename) {
      const cols = model.get(qualify(rename[1]));
      const col = cols?.get(unquote(rename[2]));
      if (cols && col) {
        cols.delete(col.name);
        col.name = unquote(rename[3]);
        cols.set(col.name, col);
      }
      continue;
    }
    const alter = ALTER_TABLE.exec(s.text);
    if (!alter) continue;
    const cols = model.get(qualify(alter[1]));
    if (!cols) continue;
    for (const action of splitActions(alter[2])) {
      const flat = maskParens(maskLiterals(action)).replace(/\s+/g, ' ').trim();
      let m: RegExpExecArray | null;
      if ((m = /^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([\s\S]+)$/i.exec(action)) && !/^ADD\s+(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|EXCLUDE|NOT\s+NULL)\b/i.test(flat)) {
        const col = parseColumnDef(m[1]);
        if (col && !cols.has(col.name)) cols.set(col.name, col);
      } else if (/^ADD\b/i.test(flat)) {
        for (const c of pkCols(action)) if (cols.has(c)) cols.get(c)!.notNull = true;
        const nn = /^ADD\s+(?:CONSTRAINT\s+\S+\s+)?NOT\s+NULL\s+("?[\w$]+"?)/i.exec(action);
        if (nn && cols.has(unquote(nn[1]))) cols.get(unquote(nn[1]))!.notNull = true;
      } else if ((m = /^DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?("?[\w$]+"?)/i.exec(action)) && !/^DROP\s+(CONSTRAINT|DEFAULT|NOT)\b/i.test(flat)) {
        cols.delete(unquote(m[1]));
      } else if ((m = /^ALTER\s+(?:COLUMN\s+)?("?[\w$]+"?)\s+([\s\S]+)$/i.exec(action))) {
        const col = cols.get(unquote(m[1]));
        if (!col) continue;
        const what = maskLiterals(m[2]).trim();
        if (/^SET\s+DEFAULT\b/i.test(what)) col.hasDefault = true;
        else if (/^DROP\s+DEFAULT\b/i.test(what)) col.hasDefault = false;
        else if (/^SET\s+NOT\s+NULL\b/i.test(what)) col.notNull = true;
        else if (/^DROP\s+NOT\s+NULL\b/i.test(what)) col.notNull = false;
        else if (/^ADD\s+GENERATED\s+(ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY\b/i.test(what)) col.identity = true;
        else if (/^DROP\s+IDENTITY\b/i.test(what)) col.identity = false;
        else if (/^(SET\s+DATA\s+)?TYPE\s+/i.test(what)) col.type = what.replace(/^(SET\s+DATA\s+)?TYPE\s+/i, '').split(/\s+USING\b/i)[0].trim();
      }
    }
  }
  return model;
}

export const modelFromSql = (...sqls: string[]): TableModel => {
  const model: TableModel = new Map();
  for (const sql of sqls) applyToModel(model, splitSqlStatements(sql));
  return model;
};

/** Rows "schema.table|column|type|is_nullable|has_default|is_identity|is_generated" from information_schema. */
export const modelFromCatalog = (rows: string[]): TableModel => {
  const model: TableModel = new Map();
  for (const row of rows) {
    const [t, name, type, nullable, def, ident, gen] = row.split('|');
    if (!model.has(t)) model.set(t, new Map());
    model.get(t)!.set(name, { name, type, notNull: nullable === 'NO', hasDefault: def === 't', identity: ident === 'YES', generatedAlways: gen === 'ALWAYS' });
  }
  return model;
};

export const CATALOG_QUERY = (tables: string[]) =>
  `select table_schema || '.' || table_name, column_name, data_type, is_nullable, (column_default is not null)::text::char, is_identity, is_generated from information_schema.columns where table_schema || '.' || table_name in (${tables.map((t) => `'${t.replace(/'/g, "''")}'`).join(',')}) order by 1, ordinal_position`;

/** casts[i] = explicit ::type of the i-th SELECT value (INSERT … SELECT), or null. */
export type SeedInsert = { line: number; table: string; columns: string[] | null; casts: Array<string | null> };

/** Top-level SELECT list of "INSERT INTO t (…) SELECT a, b::uuid, … FROM …". */
const selectList = (text: string): string[] => {
  const masked = maskLiterals(text);
  const sel = /\)\s*SELECT\s/i.exec(masked);
  if (!sel) return [];
  const out: string[] = [];
  let depth = 0;
  let from = sel.index + sel[0].length;
  for (let i = from; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && (c === ',' || /^\s(FROM|WHERE)\s/i.test(masked.slice(i, i + 7)) || c === ';')) {
      out.push(masked.slice(from, i).trim());
      if (c !== ',') return out;
      from = i + 1;
    }
  }
  out.push(masked.slice(from).trim());
  return out;
};

const TYPE_FAMILY: Array<[RegExp, string]> = [
  [/^uuid$/, 'uuid'],
  [/^(smallint|integer|int|int[248]|bigint|serial|bigserial|smallserial)$/, 'integer'],
  [/^(numeric|decimal|real|double precision|float[48]?)(\(.*\))?$/, 'number'],
  [/^(boolean|bool)$/, 'boolean'],
  [/^(jsonb?)$/, 'json'],
  [/^(date)$/, 'date'],
  [/^(timestamp|timestamptz|timestamp with(out)? time zone)(\(.*\))?$/, 'timestamp'],
  [/^(text|varchar|character varying|char|character|bpchar|name|citext)(\(.*\))?$/, 'text']
];
export const typeFamily = (t: string): string | null => {
  const n = t.toLowerCase().replace(/^(public|pg_catalog)\./, '').replace(/"/g, '').trim();
  return TYPE_FAMILY.find(([re]) => re.test(n))?.[1] ?? null;
};

export const seedInserts = (sql: string): SeedInsert[] =>
  splitSqlStatements(sql)
    .filter((s) => s.kind === 'sql' && /^INSERT\s+INTO\b/i.test(s.text))
    .map((s) => {
      const m = /^INSERT\s+INTO\s+([\w."$]+)(?:\s+AS\s+\w+)?\s*(\(([^)]*)\))?/i.exec(s.text)!;
      const casts = selectList(s.text).map((e) => /::\s*([\w. ]+?)(\[\])?\s*$/.exec(e)?.[1] ?? null);
      return { line: s.line, table: qualify(m[1]), columns: m[2] ? m[3].split(',').map((c) => identName(c)) : null, casts };
    });

export type SeedIssue = { line: number; table: string; problem: string };

export function checkSeed(model: TableModel, inserts: SeedInsert[]): SeedIssue[] {
  const issues: SeedIssue[] = [];
  for (const ins of inserts) {
    const cols = model.get(ins.table);
    const add = (problem: string) => issues.push({ line: ins.line, table: ins.table, problem });
    if (!cols) {
      add('table does not exist in the staging schema');
      continue;
    }
    if (!ins.columns) {
      add('INSERT without a column list (cannot be verified)');
      continue;
    }
    ins.columns.forEach((c, i) => {
      const col = cols.get(c);
      if (!col) return add(`column "${c}" does not exist`);
      if (col.generatedAlways) return add(`column "${c}" is GENERATED ALWAYS (cannot be inserted)`);
      // An explicit cast must land in the same type family (text columns accept any value).
      const cast = ins.casts[i];
      const from = cast ? typeFamily(cast) : null;
      const to = typeFamily(col.type);
      if (from && to && from !== to && to !== 'text') add(`column "${c}" is ${col.type} but the seed value is cast to ${cast}`);
    });
    for (const col of cols.values()) {
      if (col.notNull && !col.hasDefault && !col.identity && !col.generatedAlways && !ins.columns.includes(col.name)) {
        add(`required column "${col.name}" (${col.type}, NOT NULL, no default) is not supplied`);
      }
    }
  }
  return issues;
}

export const describeColumns = (cols: Map<string, Column>) =>
  [...cols.values()].map((c) => `${c.name} ${c.type}${c.notNull ? ' NOT NULL' : ''}${c.hasDefault ? ' DEFAULT' : ''}${c.identity ? ' IDENTITY' : ''}${c.generatedAlways && !c.identity ? ' GENERATED' : ''}`);
