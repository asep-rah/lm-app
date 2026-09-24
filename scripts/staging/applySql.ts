/**
 * Helpers for applying SQL files to staging (prepare.ts):
 *  - transactionControl: top-level BEGIN/COMMIT/… that would break
 *    --single-transaction or end a rehearsal early.
 *  - describeApplyError: psql "file:line: ERROR" → file, line, message and the
 *    statement's leading keywords (string literals masked) — safe to share.
 *  - rehearsalScript: one transaction over every planned file, ending in
 *    ROLLBACK, so the full apply can be tried on staging without keeping it.
 */
import { basename } from 'node:path';
import { splitSqlStatements } from './sqlLexer';

const TX_CONTROL = /^(BEGIN|COMMIT|ROLLBACK|END|ABORT|START\s+TRANSACTION|SAVEPOINT|RELEASE|PREPARE\s+TRANSACTION|COMMIT\s+PREPARED|ROLLBACK\s+PREPARED)\b/i;
/** Meta-commands allowed inside applied files (pg_dump 17.6+/18 emit \restrict/\unrestrict). */
const ALLOWED_META = /^\\(restrict|unrestrict)\s+[A-Za-z0-9]+\s*$/;

export function transactionControl(sql: string): string[] {
  return splitSqlStatements(sql)
    .filter((s) => (s.kind === 'sql' && TX_CONTROL.test(s.text)) || (s.kind === 'meta' && !ALLOWED_META.test(s.text)))
    .map((s) => `line ${s.line}: ${s.kind === 'meta' ? `psql meta-command ${s.text.split(/\s+/)[0]}` : s.text.split(/[\s;]+/)[0].toUpperCase()}`);
}

/** First words of a statement with string literals and dollar bodies masked. */
export const statementLabel = (text: string, words = 8): string =>
  text
    .replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1\$/g, '$…$')
    .replace(/'(?:[^']|'')*'/g, "'…'")
    .split(/\s+/)
    .slice(0, words)
    .join(' ');

export function describeApplyError(stderr: string, readFile: (path: string) => string, label = (p: string) => basename(p)): string {
  const lines = stderr.split('\n').filter(Boolean);
  const at = lines.map((l) => /^psql:(.+?):(\d+): (ERROR|FATAL):\s+(.*)$/.exec(l)).find(Boolean);
  if (!at) return lines.slice(0, 3).join(' | ') || 'psql failed without a message';
  const [, file, lineStr, level, msg] = at;
  const line = Number(lineStr);
  let stmt = '';
  try {
    const found = splitSqlStatements(readFile(file))
      .filter((s) => s.kind === 'sql' && s.line <= line)
      .pop();
    if (found) stmt = ` — statement at line ${found.line}: ${statementLabel(found.text)}`;
  } catch {
    /* file gone (temp copy): message only */
  }
  return `${label(file)}:${line}: ${level}: ${msg}${stmt}`;
}

/** psql script: BEGIN; \i each file (session settings reset between files); ROLLBACK. */
export function rehearsalScript(files: string[]): string {
  const q = (p: string) => `'${p.replace(/'/g, "''")}'`;
  return ['\\set ON_ERROR_STOP 1', 'BEGIN;', ...files.flatMap((f) => [`\\i ${q(f)}`, 'RESET ALL;']), 'ROLLBACK;', ''].join('\n');
}
