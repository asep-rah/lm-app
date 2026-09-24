/**
 * Privilege statements in a pg_dump schema file and whether the staging
 * apply role can execute them.
 *
 * prepare.ts applies the copy as "postgres" (pooler user postgres.<ref>),
 * which on Supabase is NOT a superuser. Two kinds of statement need more
 * than ownership of the objects:
 *  - ALTER DEFAULT PRIVILEGES FOR ROLE r … — only r, a member of r or a
 *    superuser may run it. pg_dump emits it for every role with default ACLs
 *    in the schema, including the platform role supabase_admin, which fails
 *    with "permission denied to change default privileges". Those statements
 *    are removed from the staging copy: the staging project already has its
 *    own platform defaults for supabase_admin, set by Supabase.
 *  - ALTER … OWNER TO r — needs membership in r.
 * GRANT/REVOKE/CREATE POLICY … TO r need r to exist.
 * Role checks run on staging in a READ ONLY transaction before anything is
 * written (rolePreflight).
 */
import { readOnlyProbe } from './readOnlyProbe';
import type { SqlStatement } from './sqlLexer';

/** The role prepare.ts connects as on staging. */
export const APPLY_ROLE = 'postgres';

const PSEUDO_ROLES = new Set(['public', 'current_user', 'session_user', 'current_role']);
const ROLE = String.raw`(?:"(?:[^"]|"")+"|[\w$]+)`;
const roleList = (s: string) =>
  s
    .split(',')
    .map((r) => r.trim().replace(/\s+WITH\s+GRANT\s+OPTION$/i, '').replace(/^GROUP\s+/i, ''))
    .filter(Boolean)
    .map((r) => (r.startsWith('"') ? r.slice(1, -1).replace(/""/g, '"') : r.toLowerCase()));

/** Roles named by FOR ROLE/USER; [] = the current user (always allowed). */
export const defaultPrivilegesForRoles = (text: string): string[] | null => {
  const m = new RegExp(String.raw`^ALTER\s+DEFAULT\s+PRIVILEGES\s+(?:FOR\s+(?:ROLE|USER)\s+(${ROLE}(?:\s*,\s*${ROLE})*)\s+)?(?:IN\s+SCHEMA\b|GRANT\b|REVOKE\b)`, 'i').exec(text);
  if (!m) return null;
  return m[1] ? roleList(m[1]) : [];
};

/** ALTER DEFAULT PRIVILEGES the apply role cannot run (FOR ROLE someone else). */
export const foreignDefaultPrivileges = (stmt: SqlStatement, applyRole = APPLY_ROLE): string[] => {
  if (stmt.kind !== 'sql') return [];
  const roles = defaultPrivilegesForRoles(stmt.text);
  return roles ? roles.filter((r) => r !== applyRole) : [];
};

export type RoleUse = { owners: Map<string, number[]>; grantees: Map<string, number[]> };

/** Roles the copy needs: owners (membership required) and grantees (must exist). */
export function rolesUsed(stmts: SqlStatement[]): RoleUse {
  const owners = new Map<string, number[]>();
  const grantees = new Map<string, number[]>();
  const add = (map: Map<string, number[]>, roles: string[], line: number) =>
    roles.filter((r) => !PSEUDO_ROLES.has(r.toLowerCase())).forEach((r) => map.set(r, [...(map.get(r) || []), line]));
  for (const s of stmts) {
    if (s.kind !== 'sql') continue;
    const owner = new RegExp(String.raw`\sOWNER\s+TO\s+(${ROLE})\s*;?$`, 'i').exec(s.text);
    if (/^ALTER\s/i.test(s.text) && owner) add(owners, roleList(owner[1]), s.line);
    const dp = defaultPrivilegesForRoles(s.text);
    if (dp) add(owners, dp, s.line);
    const grant = new RegExp(String.raw`^(?:ALTER\s+DEFAULT\s+PRIVILEGES[\s\S]*?\s)?GRANT\s[\s\S]*?\sTO\s+([\s\S]+?)\s*;?$`, 'i').exec(s.text);
    if (grant) add(grantees, roleList(grant[1].replace(/\s+GRANTED\s+BY[\s\S]*$/i, '')), s.line);
    const revoke = new RegExp(String.raw`^(?:ALTER\s+DEFAULT\s+PRIVILEGES[\s\S]*?\s)?REVOKE\s[\s\S]*?\sFROM\s+([\s\S]+?)\s*(?:CASCADE|RESTRICT)?\s*;?$`, 'i').exec(s.text);
    if (revoke) add(grantees, roleList(revoke[1].replace(/\s+GRANTED\s+BY[\s\S]*$/i, '')), s.line);
    const policy = /^CREATE\s+POLICY\s[\s\S]*?\sTO\s+([\s\S]+?)(?:\s+USING\b|\s+WITH\s+CHECK\b|\s*;?$)/i.exec(s.text);
    if (policy) add(grantees, roleList(policy[1]), s.line);
  }
  return { owners, grantees };
}

const sqlText = (v: string) => `'${v.replace(/'/g, "''")}'`;

export type PreflightResult = { missing: string[]; notMember: string[] };

/**
 * READ ONLY check on the target: every role exists, and the apply role is a
 * member (or superuser) of every owner / FOR ROLE role. Prints nothing secret.
 */
export function rolePreflight(env: NodeJS.ProcessEnv, use: RoleUse): PreflightResult {
  const roles = [...new Set([...use.owners.keys(), ...use.grantees.keys()])].sort();
  if (!roles.length) return { missing: [], notMember: [] };
  // One row per role: name|exists|member (psql -At). Read-only transaction.
  const rows = readOnlyProbe(env, [
    `select v.r, p.oid is not null, case when p.oid is null then false else pg_has_role(current_user, p.oid, 'MEMBER') end from unnest(array[${roles.map(sqlText).join(',')}]::text[]) v(r) left join pg_roles p on p.rolname = v.r order by v.r`
  ]).map((row) => row.split('|'));
  const status = new Map(rows.map(([r, exists, member]) => [r, { exists: exists === 't', member: member === 't' }]));
  return {
    missing: roles.filter((r) => !status.get(r)?.exists),
    notMember: [...use.owners.keys()].filter((r) => status.get(r)?.exists && !status.get(r)?.member)
  };
}
