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
    .replace(/\s*\|\s*Jadwal jemput:\s*[^\|]+/gi, '')
    .trim();
  return cleaned ? `${cleaned} | ${line}` : line;
};

/** Terima `YYYY-MM-DD` / `03/09/2026` dan `09:00` / `09.00` → ISO 8601 + pecahan date/time Postgres. */
export const parsePickupSchedule = (dateRaw?: string | null, timeRaw?: string | null) => {
  const date = normalizeScheduleDate(dateRaw);
  const time = normalizeScheduleTime(timeRaw);
  if (!date || !time) return null;
  const at = new Date(`${date}T${time}`);
  if (Number.isNaN(at.getTime())) return null;
  return {
    date,
    time,
    iso: at.toISOString(),
    at
  };
};

const normalizeScheduleDate = (raw?: string | null) => {
  const s = String(raw || '').trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[/.+-](\d{1,2})[/.+-](\d{4})$/);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    return `${dmy[3]}-${mm}-${dd}`;
  }
  return '';
};

const normalizeScheduleTime = (raw?: string | null) => {
  const s = String(raw || '')
    .trim()
    .replace('.', ':')
    .replace('：', ':');
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return '';
  const hh = String(Math.min(23, Number(m[1]) || 0)).padStart(2, '0');
  const mm = String(Math.min(59, Number(m[2]) || 0)).padStart(2, '0');
  const ss = String(Math.min(59, Number(m[3]) || 0)).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
};

export const scheduleAtOf = (order: any): Date | null => {
  const parsedCols = parsePickupSchedule(order?.pickup_date, order?.pickup_time || (order?.pickup_date ? '23:59' : ''));
  if (parsedCols) return parsedCols.at;
  const raw = order?.pickup_at || order?.scheduled_at || order?.scheduled_for || '';
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const notes = String(order?.notes || '');
  const m = notes.match(/Jadwal jemput:\s*([^\s]+)(?:\s+(\d{1,2}[:.]\d{2}(?::\d{2})?))?/i);
  if (m) {
    const parsed = parsePickupSchedule(m[1], m[2] || '23:59');
    if (parsed) return parsed.at;
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
