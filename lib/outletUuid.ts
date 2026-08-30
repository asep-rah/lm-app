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

/** Staff id for uuid columns — never send "18" / username. */
export const resolveActorUuid = (raw: unknown, extras?: Record<string, unknown> | null) =>
  uuidOrNull(raw) ||
  uuidOrNull(extras?.user_id) ||
  uuidOrNull(extras?.auth_id) ||
  uuidOrNull(extras?.profile_id) ||
  uuidOrNull(extras?.employee_uuid) ||
  null;
