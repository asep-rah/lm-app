/**
 * Run SQL probes inside ONE explicit read-only transaction. Works through the
 * Supabase Session pooler, where startup options (PGOPTIONS) never reach
 * Postgres. Returns the probe results; throws if the transaction is not
 * read-only or psql fails.
 */
import { execFileSync } from 'node:child_process';

export function readOnlyProbe(env: NodeJS.ProcessEnv, probes: string[]): string[] {
  const out = execFileSync(
    'psql',
    ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', 'begin transaction read only', '-c', 'show transaction_read_only', ...probes.flatMap((p) => ['-c', p]), '-c', 'rollback'],
    { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  )
    .replace(/\n$/, '')
    .split('\n');
  // out = [BEGIN, <transaction_read_only>, ...probe results, ROLLBACK]
  if (out[0] !== 'BEGIN' || out[out.length - 1] !== 'ROLLBACK') throw new Error('unexpected psql output');
  if (out[1] !== 'on') throw new Error(`probe transaction is not read-only (transaction_read_only=${out[1]})`);
  return out.slice(2, -1);
}
