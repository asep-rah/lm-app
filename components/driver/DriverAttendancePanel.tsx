'use client';

import { useEffect, useState } from 'react';
import { LogIn, LogOut, MapPin } from 'lucide-react';
import {
  clockInDriver,
  clockOutDriver,
  fetchOpenShift,
  parseAssignedOutletIds,
  type DriverAttendance
} from '@/lib/driverAttendance';
import { supabase } from '@/lib/supabaseClient';
import { toast } from '@/lib/toast';

export default function DriverAttendancePanel({
  driverId,
  driverName,
  employee,
  onDutyChange
}: {
  driverId: string;
  driverName: string;
  employee?: any;
  onDutyChange?: (shift: DriverAttendance | null) => void;
}) {
  const [outlets, setOutlets] = useState<any[]>([]);
  const [outletId, setOutletId] = useState('');
  const [shift, setShift] = useState<DriverAttendance | null>(null);
  const [busy, setBusy] = useState(false);

  const assigned = parseAssignedOutletIds(employee);
  const choices = assigned.length
    ? outlets.filter((o) => assigned.includes(String(o.id)))
    : outlets;

  const applyShift = (next: DriverAttendance | null) => {
    setShift(next);
    if (next?.active_outlet_id) setOutletId(next.active_outlet_id);
    onDutyChange?.(next);
  };

  const load = async () => {
    const [{ data: outletRows }, open] = await Promise.all([
      supabase.from('outlets').select('id, name').order('name'),
      fetchOpenShift(driverId)
    ]);
    setOutlets(outletRows || []);
    applyShift(open);
    if (!open) {
      const first = parseAssignedOutletIds(employee)[0] || String(employee?.outlet_id || '');
      if (first) setOutletId(first);
    }
  };

  useEffect(() => {
    if (!driverId) return;
    void load();
    const channel = supabase
      .channel('drv_att_' + driverId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_attendance' }, () => {
        void fetchOpenShift(driverId).then(applyShift);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverId]);

  const onDuty = shift?.status === 'ON_DUTY' && !shift.clock_out_at;
  const activeName = outlets.find((o) => String(o.id) === String(shift?.active_outlet_id || outletId))?.name;

  const handleIn = async () => {
    if (!outletId) return toast('Pilih cabang bertugas dulu.', 'warn');
    setBusy(true);
    const { data, error } = await clockInDriver({ driverId, driverName, outletId });
    setBusy(false);
    if (error) return toast(error.message || 'Gagal clock-in.', 'err');
    applyShift(data);
    toast('Clock-in berhasil. Siap menerima tugas cabang ini.', 'ok');
  };

  const handleOut = async () => {
    setBusy(true);
    const { error } = await clockOutDriver(driverId);
    setBusy(false);
    if (error) return toast(error.message || 'Gagal clock-out.', 'err');
    applyShift(null);
    toast('Clock-out. Status OFF DUTY.', 'ok');
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-sky-600">Absensi driver</p>
          <p className="text-sm font-black text-slate-900">{onDuty ? 'ON DUTY' : 'OFF DUTY'}</p>
          {onDuty && (
            <p className="text-[10px] text-slate-500 font-semibold mt-0.5 inline-flex items-center gap-1">
              <MapPin className="w-3 h-3" /> {activeName || 'Cabang aktif'}
            </p>
          )}
        </div>
        <span
          className={`text-[9px] font-black px-2 py-0.5 rounded-full ${
            onDuty ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
          }`}
        >
          {onDuty ? 'Bertugas' : 'Tidak bertugas'}
        </span>
      </div>

      {!onDuty && (
        <label className="block">
          <span className="text-[10px] font-extrabold text-slate-500 uppercase">Cabang hari ini</span>
          <select
            value={outletId}
            onChange={(e) => setOutletId(e.target.value)}
            className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-800 bg-slate-50"
          >
            <option value="">Pilih outlet bertugas</option>
            {choices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {onDuty ? (
        <button
          type="button"
          disabled={busy}
          onClick={handleOut}
          className="w-full bg-slate-800 hover:bg-slate-900 text-white font-black text-xs py-3 rounded-xl inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          <LogOut className="w-3.5 h-3.5" /> Clock-Out
        </button>
      ) : (
        <button
          type="button"
          disabled={busy || !outletId}
          onClick={handleIn}
          className="w-full bg-sky-600 hover:bg-sky-700 text-white font-black text-xs py-3 rounded-xl inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          <LogIn className="w-3.5 h-3.5" /> Clock-In
        </button>
      )}
    </div>
  );
}
