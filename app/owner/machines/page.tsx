'use client';

import { useEffect, useState } from 'react';
import OwnerShowcaseNav from '@/components/OwnerShowcaseNav';
import { supabase } from '@/lib/supabaseClient';
import { canAccessSettings, homePathForRole, isOwnerRole } from '@/lib/staffSession';
import {
  defaultPayloadKg,
  listOutletMachines,
  saveOutletMachine,
  setOutletMachineActive,
  type CapacityType,
  type OutletMachineRow
} from '@/lib/outletMachines';

const emptyForm = () => ({
  id: '' as string,
  machine_name: '',
  capacity_type: '15kg' as CapacityType,
  max_payload_kg: String(defaultPayloadKg('15kg')),
  thinq_device_id: '',
  is_active: true
});

export default function OwnerMachinesPage() {
  const [ready, setReady] = useState(false);
  const [outlets, setOutlets] = useState<Array<{ id: string; name: string }>>([]);
  const [outletId, setOutletId] = useState('');
  const [machines, setMachines] = useState<OutletMachineRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [payloadTouched, setPayloadTouched] = useState(false);

  const loadMachines = async (oid: string) => {
    if (!oid) {
      setMachines([]);
      return;
    }
    const rows = await listOutletMachines(supabase as any, oid);
    setMachines(rows);
  };

  useEffect(() => {
    const raw = localStorage.getItem('laundry_owner_user') || localStorage.getItem('laundry_user');
    if (!raw) {
      window.location.href = '/login';
      return;
    }
    const role = String(JSON.parse(raw).role || '').toLowerCase();
    if (!canAccessSettings(role) && !isOwnerRole(role)) {
      window.location.href = homePathForRole(role);
      return;
    }
    setReady(true);
    (async () => {
      const { data } = await supabase.from('outlets').select('id, name').order('name');
      const rows = data || [];
      setOutlets(rows);
      const first = rows[0]?.id || '';
      setOutletId(first);
      if (first) await loadMachines(first);
    })();
  }, []);

  useEffect(() => {
    if (outletId) loadMachines(outletId);
  }, [outletId]);

  const startEdit = (row: OutletMachineRow) => {
    setPayloadTouched(true);
    setForm({
      id: row.id,
      machine_name: String(row.machine_name || ''),
      capacity_type: (row.capacity_type as CapacityType) || '15kg',
      max_payload_kg: String(row.max_payload_kg ?? defaultPayloadKg(row.capacity_type || '15kg')),
      thinq_device_id: String(row.thinq_device_id || ''),
      is_active: row.is_active !== false
    });
  };

  const resetForm = () => {
    setPayloadTouched(false);
    setForm(emptyForm());
  };

  const onTypeChange = (next: CapacityType) => {
    setForm((prev) => ({
      ...prev,
      capacity_type: next,
      max_payload_kg: next === 'custom' ? prev.max_payload_kg : String(defaultPayloadKg(next))
    }));
    if (next !== 'custom') setPayloadTouched(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!outletId) return alert('Pilih outlet dulu.');
    if (!form.machine_name.trim()) return alert('Isi nama mesin.');
    setSaving(true);
    const { error } = await saveOutletMachine({
      id: form.id || undefined,
      outlet_id: outletId,
      machine_name: form.machine_name,
      capacity_type: form.capacity_type,
      max_payload_kg: Number(form.max_payload_kg) || defaultPayloadKg(form.capacity_type),
      thinq_device_id: form.thinq_device_id,
      is_active: form.is_active
    });
    setSaving(false);
    if (error) return alert('❌ Gagal simpan: ' + error.message);
    resetForm();
    await loadMachines(outletId);
  };

  const handleToggle = async (row: OutletMachineRow) => {
    const next = row.is_active === false;
    const { error } = await setOutletMachineActive(row.id, next);
    if (error) return alert('❌ Gagal: ' + error.message);
    await loadMachines(outletId);
  };

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-lg font-black text-slate-900">Manajemen Mesin Cuci</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Mesin aktif tampil di POS assignment. Nonaktif disembunyikan dari kasir.
          </p>
        </div>
        <OwnerShowcaseNav active="machines" />
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 md:p-6 shadow-sm space-y-4 max-w-3xl">
        <div>
          <label className="text-[10px] font-bold text-slate-600 block mb-1">Outlet</label>
          <select
            value={outletId}
            onChange={(e) => {
              resetForm();
              setOutletId(e.target.value);
            }}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-800 bg-slate-50"
          >
            {outlets.length === 0 && <option value="">Belum ada outlet</option>}
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          {machines.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-4 border border-dashed border-slate-200 rounded-xl">
              Belum ada mesin. Tambah di form bawah — POS memakai daftar ini.
            </p>
          )}
          {machines.map((m) => {
            const on = m.is_active !== false;
            return (
              <div
                key={m.id}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5 ${
                  on ? 'bg-slate-50 border-slate-200' : 'bg-slate-100 border-slate-200 opacity-70'
                }`}
              >
                <div>
                  <p className="text-sm font-black text-slate-800">{m.machine_name}</p>
                  <p className="text-[10px] text-slate-500 font-bold">
                    {m.capacity_type || '15kg'} · maks {Number(m.max_payload_kg) || 0}kg
                    {m.thinq_device_id ? ` · ThinQ ${m.thinq_device_id}` : ''}
                    {on ? '' : ' · nonaktif'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => startEdit(m)}
                    className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggle(m)}
                    className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg ${
                      on ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {on ? 'Aktif' : 'Nonaktif'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <form onSubmit={handleSave} className="border-t border-slate-100 pt-4 space-y-3">
          <p className="text-xs font-black text-slate-800">{form.id ? 'Edit mesin' : 'Tambah mesin baru'}</p>
          <div>
            <label className="text-[10px] font-bold text-slate-600 block mb-1">Nama mesin</label>
            <input
              value={form.machine_name}
              onChange={(e) => setForm((p) => ({ ...p, machine_name: e.target.value }))}
              placeholder='LG 24kg #1'
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold bg-slate-50"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold text-slate-600 block mb-1">Tipe kapasitas</label>
              <select
                value={form.capacity_type}
                onChange={(e) => onTypeChange(e.target.value as CapacityType)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold bg-slate-50"
              >
                <option value="15kg">15kg</option>
                <option value="24kg">24kg</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-600 block mb-1">Maks payload (kg)</label>
              <input
                type="number"
                step="0.1"
                min="0.5"
                value={form.max_payload_kg}
                onChange={(e) => {
                  setPayloadTouched(true);
                  setForm((p) => ({ ...p, max_payload_kg: e.target.value }));
                }}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold bg-slate-50"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-600 block mb-1">ThinQ Device ID (opsional)</label>
            <input
              value={form.thinq_device_id}
              onChange={(e) => setForm((p) => ({ ...p, thinq_device_id: e.target.value }))}
              placeholder="lg-thinq-device-id"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono bg-slate-50"
            />
          </div>
          <label className="flex items-center justify-between gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
            <span className="text-xs font-bold text-emerald-900">Aktif di POS</span>
            <button
              type="button"
              role="switch"
              aria-checked={form.is_active}
              onClick={() => setForm((p) => ({ ...p, is_active: !p.is_active }))}
              className={`relative h-6 w-11 rounded-full transition ${form.is_active ? 'bg-emerald-600' : 'bg-slate-300'}`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
                  form.is_active ? 'left-5' : 'left-0.5'
                }`}
              />
            </button>
          </label>
          <div className="flex gap-2">
            {form.id && (
              <button
                type="button"
                onClick={resetForm}
                className="flex-1 bg-slate-100 text-slate-700 font-bold py-3 rounded-xl text-sm"
              >
                Batal
              </button>
            )}
            <button
              type="submit"
              disabled={saving || !outletId}
              className="flex-1 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm"
            >
              {saving ? 'Menyimpan…' : form.id ? 'Simpan perubahan' : 'Tambah mesin'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
