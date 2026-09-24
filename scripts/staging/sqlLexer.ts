/**
 * Minimal PostgreSQL lexer for pg_dump files: splits into TOP-LEVEL
 * statements while respecting '…' / E'…' strings, "identifiers",
 * $tag$ … $tag$ bodies, -- and nested /* *\/ comments, psql meta-commands
 * (lines starting with a backslash) and COPY … FROM stdin data blocks.
 *
 * A semicolon inside a function body or string never ends a statement, so a
 * DML statement inside CREATE FUNCTION … AS $$ … $$ stays part of that
 * definition instead of looking like top-level data.
 */
export type SqlStatement = {
  kind: 'sql' | 'meta' | 'copydata';
  /** Statement text starting at its first significant character. */
  text: string;
  /** 1-based line of the first significant character. */
  line: number;
};

const isIdentChar = (c: string) => /[A-Za-z0-9_$]/.test(c);

/** Strip leading whitespace and comments. */
export const significantStart = (s: string): number => {
  let i = 0;
  for (;;) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s.startsWith('--', i)) {
      const nl = s.indexOf('\n', i);
      i = nl < 0 ? s.length : nl + 1;
      continue;
    }
    if (s.startsWith('/*', i)) {
      let depth = 1;
      i += 2;
      while (i < s.length && depth > 0) {
        if (s.startsWith('/*', i)) {
          depth++;
          i += 2;
        } else if (s.startsWith('*/', i)) {
          depth--;
          i += 2;
        } else i++;
      }
      continue;
    }
    return i;
  }
};

export function splitSqlStatements(sql: string): SqlStatement[] {
  const out: SqlStatement[] = [];
  const n = sql.length;
  let i = 0;
  let start = 0;
  // Line number of each offset, computed lazily.
  const lineStarts: number[] = [0];
  for (let k = 0; k < n; k++) if (sql[k] === '\n') lineStarts.push(k + 1);
  const lineOf = (off: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= off) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const push = (from: number, to: number, kind: SqlStatement['kind']) => {
    const raw = sql.slice(from, to);
    const s = kind === 'sql' ? significantStart(raw) : 0;
    const text = raw.slice(s).replace(/\s+$/, '');
    if (text) out.push({ kind, text, line: lineOf(from + s) });
  };
  const atStatementStart = () => significantStart(sql.slice(start, i)) >= i - start;

  while (i < n) {
    const c = sql[i];
    // psql meta-command: a backslash starting a line where no statement is open.
    if (c === '\\' && (i === 0 || sql[i - 1] === '\n') && atStatementStart()) {
      const nl = sql.indexOf('\n', i);
      const end = nl < 0 ? n : nl;
      push(i, end, 'meta');
      i = start = end;
      continue;
    }
    if (sql.startsWith('--', i)) {
      const nl = sql.indexOf('\n', i);
      i = nl < 0 ? n : nl + 1;
      continue;
    }
    if (sql.startsWith('/*', i)) {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql.startsWith('/*', i)) {
          depth++;
          i += 2;
        } else if (sql.startsWith('*/', i)) {
          depth--;
          i += 2;
        } else i++;
      }
      continue;
    }
    if (c === "'") {
      const escaped = i > 0 && /[eE]/.test(sql[i - 1]) && !(i > 1 && isIdentChar(sql[i - 2]));
      i++;
      while (i < n) {
        if (escaped && sql[i] === '\\') {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
      i++;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
      i++;
      continue;
    }
    if (c === '$' && !(i > 0 && isIdentChar(sql[i - 1]))) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64));
      if (m) {
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        i = close < 0 ? n : close + tag.length;
        continue;
      }
    }
    if (c === ';') {
      // SQL-standard bodies (CREATE FUNCTION … BEGIN ATOMIC … END;) are not
      // quoted and contain semicolons: the statement ends only at "END;".
      const sofar = sql.slice(start, i);
      if (
        /^\s*CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE)\b/i.test(sql.slice(start + significantStart(sofar), i)) &&
        /\bBEGIN\s+ATOMIC\b/i.test(sofar) &&
        !/\bEND\s*$/i.test(sofar)
      ) {
        i++;
        continue;
      }
      push(start, i + 1, 'sql');
      i++;
      start = i;
      const last = out[out.length - 1];
      if (last && /^COPY\b[\s\S]*\bFROM\s+stdin\b/i.test(last.text)) {
        // Data rows follow until a line that is exactly "\.".
        const nl = sql.indexOf('\n', i);
        const dataStart = nl < 0 ? n : nl + 1;
        const endMark = sql.indexOf('\n\\.', dataStart - 1);
        const dataEnd = endMark < 0 ? n : endMark + 3;
        push(dataStart, dataEnd, 'copydata');
        i = start = dataEnd;
      }
      continue;
    }
    i++;
  }
  push(start, n, 'sql');
  return out;
}

/** Upper-cased leading words of a statement, e.g. "CREATE OR REPLACE FUNCTION". */
export const leadingWords = (text: string, count = 4): string =>
  text
    .split(/[\s(]+/)
    .slice(0, count)
    .join(' ')
    .toUpperCase();
