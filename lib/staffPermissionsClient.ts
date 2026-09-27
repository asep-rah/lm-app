/**
 * Hak akses staf di browser (menu, tombol, halaman). Server tetap memeriksa
 * ulang setiap aksi; ini hanya agar tampilan mengikuti pengaturan owner.
 */
import { permissionsForRole } from '@/lib/accessControl';
import { homePathForRole, isWorkspaceRole } from '@/lib/staffSession';

const CACHE_KEY = 'ldrv_staff_permissions';
const CACHE_MS = 60_000;

type Cached = { at: number; role: string; permissions: string[] };

const localRole = () => {
  try {
    const raw = localStorage.getItem('laundry_owner_user') || localStorage.getItem('laundry_user');
    return raw ? String(JSON.parse(raw).role || '').toLowerCase().trim() : '';
  } catch {
    return '';
  }
};

/** Hak staf yang login. Bila server tidak bisa dihubungi / sesi habis → default role. */
export async function loadMyPermissions(opts: { fresh?: boolean } = {}): Promise<Set<string>> {
  const role = localRole();
  if (!opts.fresh) {
    try {
      const c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null') as Cached | null;
      if (c && c.role === role && Date.now() - c.at < CACHE_MS) return new Set(c.permissions);
    } catch {
      /* ignore */
    }
  }
  const res = await fetch('/api/staff/permissions', { cache: 'no-store', credentials: 'same-origin' }).catch(() => null);
  const data = res?.ok ? ((await res.json().catch(() => null)) as { permissions?: string[] } | null) : null;
  if (!data || !Array.isArray(data.permissions)) return permissionsForRole(role, null);
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), role, permissions: data.permissions }));
  } catch {
    /* ignore */
  }
  return new Set(data.permissions);
}

export const clearPermissionsCache = () => {
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
};

/**
 * Penjaga halaman area owner: true bila boleh dibuka; kalau tidak, pindah ke
 * halaman awal role tersebut (workspace / POS / login).
 */
export async function allowOwnerAreaPage(permission: string): Promise<boolean> {
  const role = localRole();
  if (!role) {
    window.location.href = '/login';
    return false;
  }
  if (role === 'owner') return true;
  const perms = await loadMyPermissions();
  if (perms.has(permission)) return true;
  window.location.href = isWorkspaceRole(role) ? '/workspace' : homePathForRole(role);
  return false;
}
