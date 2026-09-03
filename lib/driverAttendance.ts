import { insertWithFallback, updateWithFallback } from '@/lib/safeWrite';
import { supabase } from '@/lib/supabaseClient';

export type DutyStatus = 'ON_DUTY' | 'OFF_DUTY';

export type DriverAttendance = {
  id?: string;
  driver_id: string;
  driver_name?: string | null;
  active_outlet_id: string;
  clock_in_at?: string | null;
  clock_out_at?: string | null;
  status: DutyStatus;
};

const schemaMisses = (err: { message?: string } | null | undefined, token: string) => {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes(token.toLowerCase()) && (msg.includes('schema cache') || msg.includes('does not exist') || msg.includes('column') || msg.includes('relation'));
};

const pushIds = (into: Set<string>, raw: unknown) => {
  if (raw == null || raw === '') return;
  if (Array.isArray(raw)) {
    raw.forEach((v) => pushIds(into, v));
    return;
  }
  const s = String(raw).trim();
  if (!s || s === 'ALL') return;
  if (s.startsWith('[')) {
    try {
      JSON.parse(s).forEach((v: unknown) => pushIds(into, v));
      return;
    } catch {
      /* fall through */
    }
  }
  s.split(/[,{}]/).forEach((part) => {
    const id = part.replace(/["']/g, '').trim();
    if (id && id !== 'ALL') into.add(id);
  });
};

export const parseAssignedOutletIds = (emp: any): string[] => {
  const ids = new Set<string>();
  pushIds(ids, emp?.assigned_outlet_ids);
  pushIds(ids, emp?.access_outlets);
  if (emp?.outlet_id) pushIds(ids, emp.outlet_id);
  return [...ids];
};

const mapShift = (row: any): DriverAttendance | null => {
  if (!row) return null;
  const outlet = String(row.active_outlet_id || row.outlet_id || '');
  const status = String(row.status || '').toUpperCase() === 'OFF_DUTY' ? 'OFF_DUTY' : 'ON_DUTY';
  return {
    id: row.id != null ? String(row.id) : undefined,
    driver_id: String(row.driver_id || ''),
    driver_name: row.driver_name ?? null,
    active_outlet_id: outlet,
    clock_in_at: row.clock_in_at ?? null,
    clock_out_at: row.clock_out_at ?? null,
    status
  };
};

export async function fetchOpenShift(driverId: string): Promise<DriverAttendance | null> {
  if (!driverId) return null;
  const { data, error } = await supabase
    .from('driver_attendance')
    .select('id, driver_id, driver_name, active_outlet_id, clock_in_at, clock_out_at, status')
    .eq('driver_id', driverId)
    .eq('status', 'ON_DUTY')
    .order('clock_in_at', { ascending: false })
    .limit(8);
  if (error) {
    if (schemaMisses(error, 'driver_attendance') || schemaMisses(error, 'active_outlet_id')) return null;
    console.warn('fetchOpenShift:', error.message);
    return null;
  }
  const open = (data || []).map(mapShift).find((s) => s && !s.clock_out_at && s.status === 'ON_DUTY');
  return open || null;
}

export async function listAllOnDuty(): Promise<DriverAttendance[]> {
  const { data, error } = await supabase
    .from('driver_attendance')
    .select('id, driver_id, driver_name, active_outlet_id, clock_in_at, clock_out_at, status')
    .eq('status', 'ON_DUTY')
    .limit(200);
  if (error) {
    if (schemaMisses(error, 'driver_attendance') || schemaMisses(error, 'active_outlet_id')) return [];
    console.warn('listAllOnDuty:', error.message);
    return [];
  }
  return (data || [])
    .map(mapShift)
    .filter((s): s is DriverAttendance => !!s && s.status === 'ON_DUTY' && !s.clock_out_at);
}

export async function listOnDutyAtOutlet(outletId: string): Promise<DriverAttendance[]> {
  if (!outletId) return [];
  const { data, error } = await supabase
    .from('driver_attendance')
    .select('id, driver_id, driver_name, active_outlet_id, clock_in_at, clock_out_at, status')
    .eq('status', 'ON_DUTY')
    .eq('active_outlet_id', outletId)
    .limit(80);
  if (error) {
    if (schemaMisses(error, 'driver_attendance') || schemaMisses(error, 'active_outlet_id')) return [];
    console.warn('listOnDutyAtOutlet:', error.message);
    return [];
  }
  return (data || [])
    .map(mapShift)
    .filter((s): s is DriverAttendance => !!s && s.status === 'ON_DUTY' && !s.clock_out_at);
}

export async function countOnDutyAtOutlet(outletId: string): Promise<number> {
  const rows = await listOnDutyAtOutlet(outletId);
  return rows.length;
}

export async function hasOnDutyDriverAtOutlet(outletId: string): Promise<boolean | 'unknown'> {
  if (!outletId) return 'unknown';
  const { error } = await supabase
    .from('driver_attendance')
    .select('id')
    .eq('status', 'ON_DUTY')
    .eq('active_outlet_id', outletId)
    .limit(1);
  if (error && (schemaMisses(error, 'driver_attendance') || schemaMisses(error, 'active_outlet_id'))) {
    return 'unknown';
  }
  const rows = await listOnDutyAtOutlet(outletId);
  return rows.length > 0;
}

const persistActiveOutlet = (outletId: string) => {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem('laundry_user');
    const u = raw ? JSON.parse(raw) : {};
    u.outlet_id = outletId;
    u.active_outlet_id = outletId;
    localStorage.setItem('laundry_user', JSON.stringify(u));
    localStorage.setItem('laundry_owner_user', JSON.stringify(u));
    localStorage.setItem('user_outlet_id', outletId);
  } catch {
    /* ignore */
  }
};

export async function clockInDriver(opts: {
  driverId: string;
  driverName?: string;
  outletId: string;
}): Promise<{ data: DriverAttendance | null; error: { message: string } | null }> {
  const driverId = String(opts.driverId || '');
  const outletId = String(opts.outletId || '');
  if (!driverId || !outletId) return { data: null, error: { message: 'Driver dan outlet wajib.' } };
  await clockOutDriver(driverId);
  const now = new Date().toISOString();
  const row = {
    driver_id: driverId,
    driver_name: opts.driverName || null,
    active_outlet_id: outletId,
    clock_in_at: now,
    clock_out_at: null,
    status: 'ON_DUTY'
  };
  const result = await insertWithFallback<DriverAttendance>('driver_attendance', [
    row,
    { driver_id: driverId, driver_name: opts.driverName || null, active_outlet_id: outletId, clock_in_at: now, status: 'ON_DUTY' },
    { driver_id: driverId, active_outlet_id: outletId, status: 'ON_DUTY' }
  ]);
  if (result.error) return { data: null, error: result.error };
  persistActiveOutlet(outletId);
  return { data: mapShift(result.data?.[0] || row), error: null };
}

export async function clockOutDriver(driverId: string): Promise<{ error: { message: string } | null }> {
  if (!driverId) return { error: null };
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('driver_attendance')
    .update({ clock_out_at: now, status: 'OFF_DUTY' })
    .eq('driver_id', driverId)
    .eq('status', 'ON_DUTY');
  if (error && schemaMisses(error, 'clock_out_at')) {
    return updateWithFallback('driver_attendance', [{ status: 'OFF_DUTY' }], { column: 'driver_id', value: driverId });
  }
  if (error && (schemaMisses(error, 'driver_attendance') || schemaMisses(error, 'status'))) {
    return { error: null };
  }
  return { error: error ? { message: error.message } : null };
}
