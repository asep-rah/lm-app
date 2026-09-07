'use client';

import { useEffect, useState, type ReactNode } from 'react';
import OwnerChrome from '@/components/owner/OwnerChrome';
import { supabase } from '@/lib/supabaseClient';
import { canAccessSettings, homePathForRole, isOwnerRole } from '@/lib/staffSession';
import {
  benefitLabel,
  loadVoucherCodes,
  loadVoucherPrograms,
  printVoucherPdf,
  saveVoucherProgram,
  setVoucherProgramActive,
  type VoucherBenefitType,
  type VoucherCode,
  type VoucherDistribution,
  type VoucherProgram
} from '@/lib/voucherPrograms';

type OutletOpt = { id: string; name: string };

const inputCls =
  'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold bg-slate-50';

const emptyForm = () => ({
  name: '',
  program_start: '',
  program_end: '',
  outlet_id: '',
  benefit_type: 'nominal' as VoucherBenefitType,
  benefit_value: 0,
  distribution: 'manual' as VoucherDistribution,
  quantity: 1,
  redeem_start: '',
  redeem_end: ''
});

export default function OwnerVouchersPage() {
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [creating, setCreating] = useState(false);
  const [benefitOpen, setBenefitOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [outlets, setOutlets] = useState<OutletOpt[]>([]);
  const [programs, setPrograms] = useState<VoucherProgram[]>([]);
  const [codes, setCodes] = useState<Record<string, VoucherCode[]>>({});
  const [form, setForm] = useState(emptyForm);

  const load = async () => {
    const [{ data: outletRows }, rows] = await Promise.all([
      supabase.from('outlets').select('id, name').order('name'),
      loadVoucherPrograms()
    ]);
    setOutlets((outletRows || []) as OutletOpt[]);
    setPrograms(rows);
    const next: Record<string, VoucherCode[]> = {};
    await Promise.all(
      rows.map(async (p) => {
        next[p.id] = await loadVoucherCodes(p.id);
      })
    );
    setCodes((prev) => ({ ...next, ...prev }));
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
    load();
  }, []);

  const resetCreate = () => {
    setCreating(false);
    setStep(1);
    setBenefitOpen(false);
    setForm(emptyForm());
  };

  const goNext = () => {
    if (!form.name.trim()) return alert('Isi nama voucher.');
    if (!form.program_start || !form.program_end) return alert('Pilih tanggal mulai dan selesai program.');
    if (!form.outlet_id) return alert('Pilih lokasi program.');
    if (!form.benefit_value) return alert('Atur benefit voucher terlebih dahulu.');
    if (!form.redeem_start || !form.redeem_end) return alert('Pilih tanggal mulai dan selesai redeem.');
    if (form.quantity < 1) return alert('Jumlah voucher minimal 1.');
    setStep(2);
  };

  const handleSave = async () => {
    setSaving(true);
    const { error, program, codes: savedCodes } = await saveVoucherProgram({
      ...form,
      outlet_id: form.outlet_id === 'ALL' ? null : form.outlet_id
    });
    setSaving(false);
    if (error) return alert(error.message);
    if (program) {
      setCodes((prev) => ({ ...prev, [program.id]: savedCodes }));
    }
    alert(`${savedCodes.length} kode voucher tersimpan dan siap diklaim pelanggan.`);
    resetCreate();
    await load();
    if (program) setCodes((prev) => ({ ...prev, [program.id]: savedCodes.length ? savedCodes : prev[program.id] || [] }));
  };

  if (!ready) return <div className="min-h-screen bg-slate-50" />;

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="max-w-xl mx-auto space-y-4">
        <OwnerChrome
          activeTab="promos-voucher"
          eyebrow="Promosi"
          title="Program Voucher"
          subtitle="Voucher terpisah dari banner. Atur masa program, benefit, distribusi, dan periode redeem."
          extra={
            !creating ? (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="text-xs font-bold px-3 py-1.5 rounded-lg bg-sky-600 text-white"
              >
                Tambah voucher
              </button>
            ) : null
          }
        />

        {creating ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
              <button type="button" onClick={resetCreate} className="text-slate-500 text-lg leading-none" aria-label="Kembali">
                ←
              </button>
              <h2 className="flex-1 text-center text-sm font-black text-slate-900">Tambah Program Voucher</h2>
              <span className="w-6" />
            </div>

            <div className="px-4 py-3 bg-sky-50 border-b border-sky-100 text-[11px] font-semibold text-sky-800">
              Voucher ini dibuat oleh Laundrivery Support System
            </div>

            {step === 1 ? (
              <div className="p-4 space-y-4">
                <Field label="Nama voucher">
                  <input
                    value={form.name}
                    onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                    placeholder="cth: Promo Kartini 2022"
                    className={inputCls}
                  />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Tanggal Mulai" required>
                    <input
                      type="date"
                      value={form.program_start}
                      onChange={(e) => setForm((s) => ({ ...s, program_start: e.target.value }))}
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Tanggal Selesai" required>
                    <input
                      type="date"
                      value={form.program_end}
                      onChange={(e) => setForm((s) => ({ ...s, program_end: e.target.value }))}
                      className={inputCls}
                    />
                  </Field>
                </div>

                <Field label="Lokasi Program" required>
                  <select
                    value={form.outlet_id}
                    onChange={(e) => setForm((s) => ({ ...s, outlet_id: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="">Pilih Lokasi</option>
                    <option value="ALL">Semua outlet</option>
                    {outlets.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </Field>

                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">
                    Benefit Program Voucher <span className="text-rose-500">*</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => setBenefitOpen(true)}
                    className="w-full flex items-center justify-between border border-slate-200 rounded-xl px-3 py-3 text-sm font-bold bg-slate-50"
                  >
                    <span>{form.benefit_value ? benefitLabel(form) : 'Atur Benefit Voucher'}</span>
                    <span className="text-slate-400">›</span>
                  </button>
                </div>

                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase mb-2">
                    Distribusi Voucher <span className="text-rose-500">*</span>
                  </p>
                  <div className="flex gap-6">
                    {(['manual', 'sistem'] as const).map((id) => (
                      <label key={id} className="flex items-center gap-2 text-sm font-bold text-slate-700">
                        <input
                          type="radio"
                          checked={form.distribution === id}
                          onChange={() => setForm((s) => ({ ...s, distribution: id }))}
                        />
                        {id === 'manual' ? 'Manual' : 'Sistem'}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 space-y-3">
                  <p className="text-xs font-black text-slate-800">Pengaturan Voucher</p>
                  <Field label="Jumlah Voucher" required>
                    <input
                      type="number"
                      min={1}
                      value={form.quantity}
                      onChange={(e) => setForm((s) => ({ ...s, quantity: Math.max(1, Number(e.target.value) || 1) }))}
                      className={inputCls}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Tanggal mulai redeem" required>
                      <input
                        type="date"
                        value={form.redeem_start}
                        onChange={(e) => setForm((s) => ({ ...s, redeem_start: e.target.value }))}
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Tanggal selesai redeem" required>
                      <input
                        type="date"
                        value={form.redeem_end}
                        onChange={(e) => setForm((s) => ({ ...s, redeem_end: e.target.value }))}
                        className={inputCls}
                      />
                    </Field>
                  </div>
                </div>

                <button type="button" onClick={goNext} className="w-full bg-sky-600 text-white font-bold py-3 rounded-xl text-sm">
                  Berikutnya
                </button>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                <p className="text-xs font-black text-slate-900">Ringkasan program</p>
                <ul className="text-xs text-slate-600 space-y-1 bg-slate-50 rounded-xl p-3">
                  <li><b>Nama:</b> {form.name}</li>
                  <li><b>Program:</b> {form.program_start} — {form.program_end}</li>
                  <li><b>Lokasi:</b> {form.outlet_id === 'ALL' ? 'Semua outlet' : outlets.find((o) => o.id === form.outlet_id)?.name || form.outlet_id}</li>
                  <li><b>Benefit:</b> {benefitLabel(form)}</li>
                  <li><b>Distribusi:</b> {form.distribution === 'sistem' ? 'Sistem' : 'Manual'}</li>
                  <li><b>Jumlah:</b> {form.quantity} kode</li>
                  <li><b>Redeem:</b> {form.redeem_start} — {form.redeem_end}</li>
                </ul>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setStep(1)} className="py-3 rounded-xl text-sm font-bold border border-slate-200">
                    Kembali
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="py-3 rounded-xl text-sm font-bold bg-sky-600 text-white disabled:opacity-60"
                  >
                    {saving ? 'Menyimpan…' : 'Simpan program'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {programs.length === 0 && (
              <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-xs text-slate-400">
                Belum ada program voucher. Banner tetap di menu Promo / Banner.
              </div>
            )}
            {programs.map((p) => (
              <div key={p.id} className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-black text-slate-900">{p.name}</p>
                    <p className="text-[11px] text-slate-500">
                      {benefitLabel(p)} · {p.quantity} kode · {p.distribution === 'sistem' ? 'Sistem' : 'Manual'}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      Program {p.program_start || '—'} — {p.program_end || '—'} · Redeem {p.redeem_start || '—'} — {p.redeem_end || '—'}
                    </p>
                  </div>
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${p.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {p.is_active ? 'Aktif' : 'Nonaktif'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => printVoucherPdf(p, codes[p.id] || [], p.outlet_id === null ? 'Semua outlet' : outlets.find((o) => o.id === p.outlet_id)?.name || 'Outlet')}
                    className="text-[10px] font-bold text-sky-600"
                  >
                    Export PDF
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await setVoucherProgramActive(p.id, !p.is_active);
                      await load();
                    }}
                    className="text-[10px] font-bold text-amber-700"
                  >
                    {p.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                </div>
                <div className="bg-slate-50 rounded-xl p-2 max-h-40 overflow-y-auto space-y-1">
                  {(codes[p.id] || []).length === 0 && (
                    <p className="text-[10px] text-slate-400">Belum ada kode pada program ini.</p>
                  )}
                  {(codes[p.id] || []).map((c) => (
                    <div key={c.id || c.code} className="flex justify-between gap-2 text-[11px] font-mono">
                      <span className="font-black text-slate-800">{c.code}</span>
                      <span className="text-slate-400">{c.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {benefitOpen && (
        <div className="fixed inset-0 z-[90] bg-black/40 flex items-end md:items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl p-4 space-y-3">
            <h3 className="text-sm font-black text-slate-900">Atur Benefit Voucher</h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setForm((s) => ({ ...s, benefit_type: 'nominal' }))}
                className={`py-2 rounded-xl text-xs font-bold border ${form.benefit_type === 'nominal' ? 'bg-sky-600 text-white border-sky-600' : 'border-slate-200'}`}
              >
                Potongan Rp
              </button>
              <button
                type="button"
                onClick={() => setForm((s) => ({ ...s, benefit_type: 'percent' }))}
                className={`py-2 rounded-xl text-xs font-bold border ${form.benefit_type === 'percent' ? 'bg-sky-600 text-white border-sky-600' : 'border-slate-200'}`}
              >
                Diskon %
              </button>
            </div>
            <input
              type="number"
              min={1}
              value={form.benefit_value || ''}
              onChange={(e) => setForm((s) => ({ ...s, benefit_value: Number(e.target.value) || 0 }))}
              placeholder={form.benefit_type === 'percent' ? 'Contoh: 20' : 'Contoh: 10000'}
              className={inputCls}
            />
            <button type="button" onClick={() => setBenefitOpen(false)} className="w-full bg-sky-600 text-white font-bold py-2.5 rounded-xl text-sm">
              Simpan benefit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  required,
  children
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">
        {label} {required ? <span className="text-rose-500">*</span> : null}
      </span>
      {children}
    </label>
  );
}
