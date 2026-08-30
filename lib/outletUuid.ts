/** User-specified UUID check for cash-deposit / FK columns. */
export const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const isUuidString = (value: unknown) => UUID_RE.test(String(value || '').trim());

export const uuidOrNull = (value: unknown): string | null => {
  const s = String(value || '').trim();
  return isUuidString(s) ? s : null;
};

const LEGACY_KEYS = ['id', 'code', 'slug', 'legacy_id', 'outlet_code', 'outlet_no', 'old_id', 'pos_id'];

const matchesLegacyOutlet = (outlet: any, raw: string) =>
  LEGACY_KEYS.some((k) => outlet?.[k] != null && String(outlet[k]).trim() === raw);

/** Map integer / slug / code ("18") to outlets.id UUID from an in-memory list. */
export function matchOutletUuid(outlets: any[] | null | undefined, raw: unknown): string | null {
  const s = String(raw || '').trim();
  if (!s || s.toUpperCase() === 'ALL') return null;
  const list = outlets || [];
  if (isUuidString(s)) {
    const exact = list.find((o) => String(o?.id) === s);
    return exact?.id ? String(exact.id) : s;
  }
  const hit = list.find((o) => matchesLegacyOutlet(o, s) && isUuidString(o?.id));
  return hit ? String(hit.id) : null;
}

type Db = { from: (table: string) => any };

/**
 * Resolve a POS / profile outlet ref to `outlets.id` (UUID).
 * Integer strings like "18" are looked up via code / slug / legacy_id, not inserted as-is.
 */
export async function resolveOutletUuid(
  db: Db,
  raw: unknown,
  cache?: any[]
): Promise<string | null> {
  const cached = matchOutletUuid(cache, raw);
  if (cached) return cached;

  const s = String(raw || '').trim();
  if (!s || s.toUpperCase() === 'ALL') return null;

  if (isUuidString(s)) {
    const { data } = await db.from('outlets').select('id').eq('id', s).maybeSingle();
    if (data?.id && isUuidString(data.id)) return String(data.id);
    return s;
  }

  const { data: all } = await db.from('outlets').select('*');
  const fromAll = matchOutletUuid(all, s);
  if (fromAll) return fromAll;

  if (Array.isArray(all) && all.length === 1 && isUuidString(all[0]?.id)) {
    return String(all[0].id);
  }
  return null;
}

export const CASHIER_SESSION_MISSING =
  'Sesi login kasir tidak ditemukan. Silakan refresh halaman atau login ulang.';

const staffIdOf = (u: Record<string, unknown> | null | undefined) =>
  String(
    u?.id ||
      u?.user_id ||
      (u?.profile as any)?.id ||
      (u?.user as any)?.id ||
      ''
  ).trim();

export const persistLocalUserId = (id: unknown) => {
  if (typeof window === 'undefined') return;
  const s = String(id || '').trim();
  if (!s) return;
  try {
    localStorage.setItem('user_id', s);
  } catch {
    /* ignore quota */
  }
};

/** Local POS session id (employees.id) — not username. */
export const readLocalCashierId = () => {
  if (typeof window === 'undefined') return '';
  try {
    const stored = String(localStorage.getItem('user_id') || '').trim();
    if (stored) return stored;
    const raw = localStorage.getItem('laundry_user') || localStorage.getItem('laundry_owner_user');
    return staffIdOf(raw ? JSON.parse(raw) : null);
  } catch {
    return '';
  }
};

type AuthLike = {
  auth: { getUser: () => Promise<{ data?: { user?: { id?: string } | null } }> };
};

/**
 * Auth first (supabase.auth.getUser), then POS profile, then localStorage user_id.
 * Never returns empty string — null means abort the deposit insert.
 */
export async function resolveCashierSessionId(
  explicit?: string | null,
  authClient?: AuthLike,
  currentProfile?: Record<string, unknown> | null
): Promise<string | null> {
  let authId = '';
  if (authClient?.auth?.getUser) {
    try {
      const { data } = await authClient.auth.getUser();
      authId = String(data?.user?.id || '').trim();
    } catch {
      authId = '';
    }
  }

  let profile = currentProfile || null;
  if (!profile && typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('laundry_user') || localStorage.getItem('laundry_owner_user');
      profile = raw ? JSON.parse(raw) : null;
    } catch {
      profile = null;
    }
  }

  const activeCashierId =
    authId ||
    String(explicit || '').trim() ||
    staffIdOf(profile) ||
    (typeof window !== 'undefined' ? String(localStorage.getItem('user_id') || '').trim() : '');

  if (!activeCashierId) return null;
  persistLocalUserId(activeCashierId);
  return activeCashierId;
}

const legacyToHex12 = (raw: string) => {
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0 && String(Math.trunc(n)) === raw) {
    return Math.trunc(n).toString(16).padStart(12, '0').slice(-12);
  }
  let h = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(12, '0').slice(-12);
};

/**
 * Value for cash_deposits.cashier_id (NOT NULL, often uuid).
 * Legacy integer ids like "18" become a stable UUID — never null, never raw "18".
 */
export const cashierIdForColumn = (raw: unknown): string | null => {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (isUuidString(s)) return s;
  return `00000000-0000-4000-a000-${legacyToHex12(s)}`;
};

/** Staff id for uuid columns — never send "18" / username. */
export const resolveActorUuid = (raw: unknown, extras?: Record<string, unknown> | null) =>
  uuidOrNull(raw) ||
  uuidOrNull(extras?.user_id) ||
  uuidOrNull(extras?.auth_id) ||
  uuidOrNull(extras?.profile_id) ||
  uuidOrNull(extras?.employee_uuid) ||
  cashierIdForColumn(raw) ||
  cashierIdForColumn(extras?.id) ||
  null;
