export type ActivitySubTab = 'berlangsung' | 'terjadwal' | 'riwayat';

export const ACTIVITY_TABS: { id: ActivitySubTab; label: string }[] = [
  { id: 'berlangsung', label: 'Berlangsung' },
  { id: 'terjadwal', label: 'Terjadwal' },
  { id: 'riwayat', label: 'Riwayat' }
];

export const parseActivityTab = (raw: string | null | undefined): ActivitySubTab | null => {
  const t = String(raw || '').toLowerCase().trim();
  if (t === 'berlangsung' || t === 'active' || t === 'ongoing') return 'berlangsung';
  if (t === 'terjadwal' || t === 'scheduled' || t === 'jadwal') return 'terjadwal';
  if (t === 'riwayat' || t === 'history' || t === 'selesai') return 'riwayat';
  return null;
};

/** Selesai / batal / terkirim — sama dengan filter yang dipakai dashboard. */
export const isOrderFinished = (order: any) => {
  const st = String(order?.status || '').toLowerCase().trim();
  if (!st) return false;
  if (st.includes('batal') || st.includes('cancel')) return true;
  if (st.includes('siap')) return false;
  if (st.includes('selesai jemput')) return false;
  if (
    st.includes('packing') ||
    st.includes('cuci') ||
    st.includes('setrika') ||
    st.includes('sortir') ||
    st.includes('jemput') ||
    st.includes('tiba') ||
    st.includes('diterima') ||
    st.includes('kasir') ||
    st.includes('proses') ||
    st.includes('ering') ||
    st.includes('emas') ||
    st.includes('menunggu') ||
    st.includes('baru') ||
    st.includes('request')
  ) {
    return false;
  }
  return (
    st === 'selesai' ||
    st.includes('delivered') ||
    st.includes('terkirim') ||
    st === 'diambil' ||
    st.includes('sudah diambil') ||
    st.includes('telah diambil')
  );
};

export const withScheduleNote = (notes: string, date: string, time: string) => {
  const line = `Jadwal jemput: ${date} ${time}`;
  const cleaned = String(notes || '')
    .replace(/\s*\|\s*Jadwal jemput:\s*\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?)?/gi, '')
    .trim();
  return cleaned ? `${cleaned} | ${line}` : line;
};

export const scheduleAtOf = (order: any): Date | null => {
  const raw =
    order?.pickup_at ||
    order?.scheduled_at ||
    order?.scheduled_for ||
    (order?.pickup_date
      ? `${String(order.pickup_date).slice(0, 10)}T${String(order.pickup_time || '23:59:00').slice(0, 8)}`
      : '');
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const notes = String(order?.notes || '');
  const m = notes.match(/Jadwal jemput:\s*(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}:\d{2}(?::\d{2})?))?/i);
  if (m) {
    const d = new Date(`${m[1]}T${(m[2] || '23:59').slice(0, 8)}`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
};

export const isScheduledStatus = (order: any) => {
  const st = String(order?.status || '').toLowerCase();
  return st.includes('jadwal') || st.includes('scheduled') || st.includes('terjadwal') || st.includes('recurring');
};

/** Booking masa depan / berulang — belum masuk produksi. */
export const isScheduledOrder = (order: any) => {
  if (isOrderFinished(order)) return false;
  if (isScheduledStatus(order)) return true;
  const when = scheduleAtOf(order);
  if (!when) return false;
  return when.getTime() > Date.now() + 30 * 60 * 1000;
};

export const isOngoingOrder = (order: any) => !isOrderFinished(order) && !isScheduledOrder(order);

export const formatScheduleLabel = (order: any) => {
  const when = scheduleAtOf(order);
  if (!when) return String(order?.pickup_date || 'Jadwal belum diisi');
  return when.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
};
