/**
 * Hak akses per role yang diatur owner (tabel role_permissions). Pure: dipakai
 * server (penegakan) dan browser (menu / tampilan). Owner selalu punya semua hak
 * dan satu-satunya yang boleh mengatur hak akses.
 *
 * Default = perilaku aplikasi sebelum fitur ini (Supervisor membuka halaman
 * owner; tim keuangan mengelola COA & revisi pengeluaran), ditambah keputusan
 * owner: Supervisor boleh mengubah harga layanan, voucher, struk, dan memutuskan
 * kasbon.
 */
import { STAFF_ROLES } from '@/lib/staffRoles';

export type PermissionGroup = 'view' | 'action';
export type PermissionDef = { key: string; group: PermissionGroup; label: string; hint?: string };

export const PERMISSIONS: readonly PermissionDef[] = [
  // Memantau (halaman yang boleh dibuka)
  { key: 'view.owner_dashboard', group: 'view', label: 'Dashboard owner & pengaturan', hint: '/owner (ringkasan, karyawan, persetujuan, pengaturan)' },
  { key: 'view.finance_reports', group: 'view', label: 'Laporan keuangan', hint: 'Laba rugi, neraca, buku besar, arus kas' },
  { key: 'view.crm', group: 'view', label: 'CRM pelanggan' },
  { key: 'view.performance', group: 'view', label: 'Performa & KPI karyawan' },
  { key: 'view.machines', group: 'view', label: 'Mesin & inventaris' },
  { key: 'view.delegation', group: 'view', label: 'Delegasi tugas' },
  { key: 'view.vouchers', group: 'view', label: 'Voucher & promo' },
  // Menyetujui / mengubah (ditegakkan server)
  { key: 'settings.services', group: 'action', label: 'Ubah harga & komisi layanan', hint: 'Layanan global dan harga per outlet' },
  { key: 'settings.vouchers', group: 'action', label: 'Buat / aktifkan voucher & promo' },
  { key: 'settings.receipt', group: 'action', label: 'Ubah format struk' },
  { key: 'settings.general', group: 'action', label: 'Ubah gaji pokok & mapping supervisor' },
  { key: 'settings.coa', group: 'action', label: 'Kelola daftar COA' },
  { key: 'settings.profit_share', group: 'action', label: 'Ubah persen bagi hasil' },
  { key: 'settings.outlet_books', group: 'action', label: 'Ubah saldo awal & aset buku outlet' },
  { key: 'kasbon.decide', group: 'action', label: 'Setujui / tolak / lunasi kasbon staf' },
  { key: 'expense.revise', group: 'action', label: 'Revisi nominal pengeluaran' },
  { key: 'transaction.void', group: 'action', label: 'Setujui void transaksi' },
  { key: 'period.lock', group: 'action', label: 'Tutup buku / buka kembali periode' },
  { key: 'finance.settlement', group: 'action', label: 'Catat pembayaran bagi hasil, THR, pencairan Mayar' }
];

export const PERMISSION_KEYS = new Set(PERMISSIONS.map((p) => p.key));

/** Role yang bisa diatur (owner tidak: selalu penuh). */
export const CONFIGURABLE_ROLES = STAFF_ROLES.filter((r) => r.value !== 'owner');

const ALL_VIEWS = PERMISSIONS.filter((p) => p.group === 'view').map((p) => p.key);
const FINANCE_TEAM = ['settings.coa', 'expense.revise'];

export const DEFAULT_ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  supervisor: [
    ...ALL_VIEWS,
    'settings.services',
    'settings.vouchers',
    'settings.receipt',
    'settings.general',
    'kasbon.decide',
    ...FINANCE_TEAM
  ],
  finance: FINANCE_TEAM,
  head_management: FINANCE_TEAM
};

/** Nama role lama / alias → role di daftar. */
const ROLE_ALIASES: Record<string, string> = {
  admin: 'admin_ops',
  head: 'head_management',
  head_finance: 'finance',
  head_cs: 'cs',
  pos: 'kasir',
  cashier: 'kasir',
  courier: 'driver',
  kurir: 'driver'
};

export const canonicalRole = (role: unknown) => {
  const r = String(role || '').toLowerCase().trim();
  return ROLE_ALIASES[r] || r;
};

export const isOwnerAccessRole = (role: unknown) => canonicalRole(role) === 'owner';

/** Bersihkan daftar hak (hanya kunci yang dikenal, tanpa duplikat). */
export const cleanPermissions = (raw: unknown): string[] => {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? safeArray(raw) : [];
  return [...new Set(list.map((k) => String(k)).filter((k) => PERMISSION_KEYS.has(k)))];
};

function safeArray(s: string): unknown[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Hak efektif role. `stored`: isi tabel role_permissions (role → daftar);
 * role yang belum pernah diatur owner memakai default.
 */
export function permissionsForRole(role: unknown, stored: Record<string, unknown> | null | undefined): Set<string> {
  const r = canonicalRole(role);
  if (r === 'owner') return new Set(PERMISSION_KEYS);
  if (stored && Object.prototype.hasOwnProperty.call(stored, r)) return new Set(cleanPermissions(stored[r]));
  return new Set(DEFAULT_ROLE_PERMISSIONS[r] || []);
}

export const permissionLabel = (key: string) => PERMISSIONS.find((p) => p.key === key)?.label || key;

// ---------------------------------------------------------------------------
// app_settings: kolom → hak yang dibutuhkan untuk MENGUBAH nilainya.

export const APP_SETTINGS_KEY_PERMISSION: Record<string, string> = {
  dynamic_services: 'settings.services',
  outlet_overrides: 'settings.services',
  voucher_programs: 'settings.vouchers',
  promos_data: 'settings.vouchers',
  receipt_terms: 'settings.receipt',
  receipt_layout: 'settings.receipt',
  basic_salary: 'settings.general',
  supervisor_mapping: 'settings.general',
  coa_categories: 'settings.coa',
  profit_share_by_outlet: 'settings.profit_share',
  outlet_books: 'settings.outlet_books'
};

/** Kunci khusus di dalam outlet_overrides yang milik fitur lain. */
export const OVERRIDE_SPECIAL_PERMISSION: Record<string, string> = {
  __voucher_programs: 'settings.vouchers',
  __profit_share: 'settings.profit_share',
  __outlet_books: 'settings.outlet_books'
};

const parseMaybe = (v: unknown): unknown => {
  if (typeof v !== 'string') return v ?? null;
  const t = v.trim();
  if (!t) return null;
  if (t[0] === '{' || t[0] === '[' || t === 'null') {
    try {
      return JSON.parse(t);
    } catch {
      return v;
    }
  }
  return v;
};

const stable = (v: unknown): string => {
  if (v === undefined || v === null) return 'null';
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return JSON.stringify(v);
  const n = Number(v);
  return typeof v === 'string' && v.trim() !== '' && Number.isFinite(n) ? JSON.stringify(n) : JSON.stringify(v);
};

/** Sama isinya (string JSON vs objek, "1000" vs 1000 dianggap sama). */
export const sameSettingValue = (a: unknown, b: unknown) => stable(parseMaybe(a)) === stable(parseMaybe(b));

const asObject = (v: unknown): Record<string, unknown> => {
  const p = parseMaybe(v);
  return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
};

/**
 * Siapkan satu percobaan update app_settings untuk pemanggil dengan hak `perms`:
 *  - kunci khusus outlet_overrides (__voucher_programs dst.) yang tidak boleh
 *    ia ubah dikembalikan ke nilai di DB (halaman lain sering mengirim salinan lama);
 *  - kembalikan juga daftar hak yang dibutuhkan untuk perubahan yang tersisa.
 */
export function planAppSettingsWrite(
  attempt: Record<string, unknown>,
  current: Record<string, unknown> | null | undefined,
  perms: Set<string>
): { row: Record<string, unknown>; needed: string[] } {
  const row: Record<string, unknown> = { ...attempt };
  const needed = new Set<string>();
  const cur = current || {};

  if ('outlet_overrides' in row) {
    const next = asObject(row.outlet_overrides);
    const before = asObject(cur.outlet_overrides);
    for (const [special, perm] of Object.entries(OVERRIDE_SPECIAL_PERMISSION)) {
      if (sameSettingValue(next[special], before[special])) continue;
      if (perms.has(perm)) needed.add(perm);
      else if (special in before) next[special] = before[special];
      else delete next[special];
    }
    const plain = (o: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(o).filter(([k]) => !(k in OVERRIDE_SPECIAL_PERMISSION)));
    if (!sameSettingValue(plain(next), plain(before))) needed.add('settings.services');
    row.outlet_overrides = typeof row.outlet_overrides === 'string' ? JSON.stringify(next) : next;
  }

  for (const [key, value] of Object.entries(row)) {
    if (key === 'outlet_overrides') continue;
    const perm = APP_SETTINGS_KEY_PERMISSION[key];
    if (perm && !sameSettingValue(value, cur[key])) needed.add(perm);
  }
  return { row, needed: [...needed] };
}
