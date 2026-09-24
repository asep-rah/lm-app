import { execFileSync } from 'node:child_process';

/**
 * Error from a failed probe. `message` is safe to print: psql's stderr with
 * the password, connection strings and key-like values removed, plus a hint.
 */
export class ProbeError extends Error {
  constructor(
    message: string,
    readonly cause_: string,
    readonly hint: string
  ) {
    super(message);
  }
}

/** Remove secrets from psql output: the password itself, URIs with credentials, JWT/sb_ keys. */
export function redactPsqlText(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets.filter((x) => x && x.length >= 4)) out = out.split(s).join('[REDACTED]');
  return out
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, 'postgresql://[REDACTED]')
    .replace(/password\s*=\s*\S+/gi, 'password=[REDACTED]')
    .replace(/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{4,}/g, '[REDACTED]')
    .replace(/sb_(?:secret|publishable)_[\w-]+/g, '[REDACTED]');
}

const HINTS: Array<[RegExp, string]> = [
  [/tenant or user not found/i, 'Session pooler host/region or user is wrong: copy the host exactly from Dashboard staging → Connect → Session pooler (aws-0-… vs aws-1-…, region); the user must be postgres.<STAGING_REF>.'],
  [/password authentication failed|SASL authentication|authentication failed/i, 'Database password rejected: use the STAGING database password (Dashboard staging → Project Settings → Database; reset it there if unknown). If stored in Keychain item lm-staging-db-password, update that item.'],
  [/could not translate host name|nodename nor servname|Name or service not known|unknown host/i, 'Host name does not resolve: check STAGING_DB_HOST for typos (…pooler.supabase.com).'],
  [/timeout expired|timed out|Connection refused|Network is unreachable|No route to host/i, 'Network: port 5432 to the pooler is not reachable (firewall/VPN/hotspot) or the host is wrong.'],
  [/SSL|certificate/i, 'TLS problem between psql and the pooler: check the psql/libpq version (psql --version).'],
  [/max client|too many (clients|connections)|remaining connection slots/i, 'Connection limit reached on the staging pooler: wait a minute and retry.'],
  [/unsupported startup parameter|unrecognized configuration parameter|invalid command-line argument/i, 'Pooler rejected a startup parameter (PGOPTIONS): unset PGOPTIONS in your shell and retry.'],
  [/permission denied/i, 'Connected, but the role lacks permission for this probe.'],
  [/does not exist/i, 'Connected, but an object the probe reads does not exist yet.'],
  [/read-only transaction/i, 'The probe attempted a write and the read-only transaction refused it (expected guard behaviour).']
];

export function explainPsqlFailure(stderr: string, status: number | null, secrets: string[]): { cause: string; hint: string } {
  const lines = redactPsqlText(stderr, secrets)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const important = lines.filter((l) => /\b(FATAL|ERROR|failed|could not|timeout|refused)\b/i.test(l));
  const cause = (important.length ? important : lines).slice(0, 3).join(' | ').slice(0, 400) || `psql exited with status ${status ?? 'unknown'} and no message`;
  const hint =
    HINTS.find(([re]) => re.test(cause))?.[1] ??
    (status === 2 ? 'psql could not connect (exit 2).' : status === 3 ? 'A probe statement failed after connecting (exit 3).' : 'See the cause above.');
  return { cause, hint };
}

export function readOnlyProbe(env: NodeJS.ProcessEnv, probes: string[]): string[] {
  let raw: string;
  try {
    raw = execFileSync(
      'psql',
      ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', 'begin transaction read only', '-c', 'show transaction_read_only', ...probes.flatMap((p) => ['-c', p]), '-c', 'rollback'],
      { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string; status?: number | null };
    if (err.code === 'ENOENT') throw new ProbeError('psql not found on PATH', 'psql not found', 'Install libpq (brew install libpq) and add it to PATH.');
    const { cause, hint } = explainPsqlFailure(String(err.stderr || ''), err.status ?? null, [String(env.PGPASSWORD || '')]);
    throw new ProbeError(`${cause} — hint: ${hint}`, cause, hint);
  }
  const out = raw.replace(/\n$/, '').split('\n');
  if (out[0] !== 'BEGIN' || out[out.length - 1] !== 'ROLLBACK') throw new Error('unexpected psql output');
  if (out[1] !== 'on') throw new Error(`probe transaction is not read-only (transaction_read_only=${out[1]})`);
  return out.slice(2, -1);
}
