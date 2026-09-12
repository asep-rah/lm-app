/** Label periode filter dashboard/laporan owner (Bahasa Indonesia). */

export type OwnerPeriodKey = 'THIS_MONTH' | 'LAST_MONTH' | 'THIS_YEAR' | 'ALL' | string;

export function ownerPeriodLabel(period: OwnerPeriodKey): string {
  switch (period) {
    case 'THIS_MONTH':
      return 'Bulan ini';
    case 'LAST_MONTH':
      return 'Bulan lalu';
    case 'THIS_YEAR':
      return '1 tahun terakhir';
    case 'ALL':
      return 'Semua waktu';
    default:
      return String(period || '').replace(/_/g, ' ') || 'Periode';
  }
}

/** Rentang tanggal kalender untuk label banding bulan (WIB-ish local). */
export function monthDateRangeLabel(year: number, month: number): string {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  const fmt = (d: Date) =>
    d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${fmt(start)} – ${fmt(end)}`;
}
