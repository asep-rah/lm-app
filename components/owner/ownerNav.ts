export type SettingsPanel = 'services' | 'outlets' | 'supervisor' | 'receipt' | 'payroll';

const SETTINGS_PANELS: SettingsPanel[] = ['services', 'outlets', 'supervisor', 'receipt', 'payroll'];

export const REMOTE_OWNER_TABS = new Set([
  'kpi',
  'kpi-settings',
  'delegasi',
  'crm',
  'promos',
  'promos-voucher',
  'promos-poin',
  'laba-rugi',
  'jurnal',
  'buku-besar',
  'perubahan-modal',
  'neraca',
  'performa-outlet',
  'performa-layanan',
  'performa-karyawan',
  'grafik-pendapatan',
  'grafik-biaya',
  'grafik-promosi'
]);

export const isRemoteOwnerTab = (tab: string) => REMOTE_OWNER_TABS.has(tab);

export function ownerHref(tab: string, panel?: SettingsPanel): string {
  if (tab === 'kpi') return '/owner/kpi';
  if (tab === 'kpi-settings') return '/owner/kpi-settings';
  if (tab === 'delegasi') return '/owner/delegasi';
  if (tab === 'crm' || tab === 'promos-poin') return '/owner/crm';
  if (tab === 'promos') return '/owner/promos';
  if (tab === 'promos-voucher') return '/owner/vouchers';
  if (tab === 'laba-rugi') return '/owner/reports/laba-rugi';
  if (tab === 'jurnal') return '/owner/reports/jurnal';
  if (tab === 'buku-besar') return '/owner/reports/buku-besar';
  if (tab === 'perubahan-modal') return '/owner/reports/perubahan-modal';
  if (tab === 'neraca') return '/owner/reports/neraca';
  if (tab === 'performa-outlet') return '/owner/performance?view=outlet';
  if (tab === 'performa-layanan') return '/owner/performance?view=layanan';
  if (tab === 'performa-karyawan') return '/owner/performance?view=karyawan';
  if (tab === 'grafik-pendapatan') return '/owner/performance?view=pendapatan';
  if (tab === 'grafik-biaya') return '/owner/performance?view=biaya';
  if (tab === 'grafik-promosi') return '/owner/performance?view=promosi';
  const params = new URLSearchParams();
  if (tab && tab !== 'pnl') params.set('tab', tab);
  if (tab === 'settings' && panel) params.set('panel', panel);
  const q = params.toString();
  return q ? `/owner?${q}` : '/owner';
}

export function readOwnerSearch(): { tab: string | null; panel: SettingsPanel | null } {
  if (typeof window === 'undefined') return { tab: null, panel: null };
  const q = new URLSearchParams(window.location.search);
  const tab = q.get('tab');
  const rawPanel = q.get('panel');
  const panel = SETTINGS_PANELS.includes(rawPanel as SettingsPanel) ? (rawPanel as SettingsPanel) : null;
  return { tab, panel };
}
