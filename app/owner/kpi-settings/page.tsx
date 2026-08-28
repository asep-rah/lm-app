'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getStaffSession, isOwnerRole, homePathForRole } from '@/lib/staffSession';
import {
  currentMonthYear,
  KPI_CATALOG,
  KPI_ROLES,
  shiftMonthYear,
  SLA_PENALTY_KEY
} from '@/lib/kpiCatalog';
import {
  copyMonthConfigs,
  deleteKpiConfig,
  fetchKpiConfigs,
  seedMonthDefaults,
  upsertKpiConfig,
  type KpiConfigRow
} from '@/lib/kpiConfigs';

export default function KpiSettingsPage() {
  const session = useMemo(() => getStaffSession(), []);
  const canEdit = isOwnerRole(session.role);

  const [monthYear, setMonthYear] = useState(currentMonthYear());
  const [role, setRole] = useState(KPI_ROLES[0].key);
  const [rows, setRows] = useState<KpiConfigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | 'new' | null>(null);
  const [msg, setMsg] = useState('');
  const [customLabel, setCustomLabel] = useState('');
  const [customBind, setCustomBind] = useState('');
  const [customTarget, setCustomTarget] = useState('');
  const [customWeight, setCustomWeight] = useState('10');

  const load = async () => {
    setLoading(true);
    const data = await fetchKpiConfigs(monthYear);
    setRows(data);
    setLoading(false);
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw =
      localStorage.getItem('laundry_owner_user') || localStorage.getItem('laundry_user');
    if (!raw) {
      window.location.href = '/login';
      return;
    }
    const user = JSON.parse(raw);
    const role = String(user.role || '').toLowerCase();
    if (!isOwnerRole(role)) {
      window.location.href = homePathForRole(role);
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthYear]);

  const roleRows = rows.filter((r) => r.role === role);
  const scored = roleRows.filter((r) => r.metric_key !== SLA_PENALTY_KEY && r.is_active);
  const weightSum = scored.reduce((s, r) => s + (Number(r.weight_percentage) || 0), 0);
  const bindOptions = KPI_CATALOG[role] || [];

  const flash = (text: string) => {
    setMsg(text);
    setTimeout(() => setMsg(''), 3500);
  };

  const saveRow = async (row: KpiConfigRow) => {
    setSavingId(row.id || 'new');
    try {
      await upsertKpiConfig({ ...row, month_year: monthYear, updated_by: session.name });
      flash('✅ Tersimpan');
      await load();
    } catch (err: any) {
      alert('❌ Gagal simpan: ' + (err.message || 'Cek tabel kpi_configs'));
    }
    setSavingId(null);
  };

  const removeRow = async (id?: string) => {
    if (!id) return;
    if (!confirm('Hapus metrik ini dari bulan terpilih?')) return;
    try {
      await deleteKpiConfig(id);
      await load();
    } catch (err: any) {
      alert('❌ ' + err.message);
    }
  };

  const handleSeed = async () => {
    try {
      const res = await seedMonthDefaults(monthYear, session.name);
      flash(res.seeded ? `✅ ${res.seeded} metrik default dimuat` : 'ℹ️ Bulan ini sudah ada konfigurasi');
      await load();
    } catch (err: any) {
      alert('❌ Gagal seed: ' + (err.message || 'Jalankan migrasi kpi_configs'));
    }
  };

  const handleCopyPrev = async () => {
    try {
      const n = await copyMonthConfigs(shiftMonthYear(monthYear, -1), monthYear, session.name);
      flash(`✅ ${n} metrik disalin dari bulan lalu`);
      await load();
    } catch (err: any) {
      alert('❌ ' + err.message);
    }
  };

  const handleAddCustom = async () => {
    if (!customLabel.trim() || !customBind) return alert('Isi label dan pilih realisasi yang diikat.');
    await saveRow({
      month_year: monthYear,
      role,
      metric_key: customBind,
      metric_label: customLabel.trim(),
      target_value: Number(customTarget) || 0,
      weight_percentage: Number(customWeight) || 0,
      is_active: true,
      updated_by: session.name
    });
    setCustomLabel('');
    setCustomTarget('');
  };

  const patch = (id: string, field: keyof KpiConfigRow, value: any) => {
    setRows(rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  if (!canEdit) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center p-6">
        <p className="text-sm">Hanya Owner / Head Management yang dapat mengatur KPI.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black">🎯 KPI Configurator</h1>
            <p className="text-xs text-slate-400 mt-1">
              Target & bobot per bulan untuk 7 role. Skor monitoring = realisasi vs target, tertimbang.
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/owner" className="text-xs bg-white border border-slate-200 px-3 py-2 rounded-xl">
              ← Dashboard
            </Link>
          </div>
        </div>

        {msg && <p className="text-xs font-bold text-emerald-400">{msg}</p>}

        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 flex flex-col md:flex-row gap-3 items-end shadow-sm">
          <div className="flex-1">
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Bulan (month_year)</label>
            <input
              type="month"
              value={monthYear}
              onChange={(e) => setMonthYear(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
            />
          </div>
          <button onClick={handleSeed} className="bg-indigo-600 text-white text-xs font-bold px-4 py-2.5 rounded-xl">
            Isi default 7 role
          </button>
          <button onClick={handleCopyPrev} className="bg-slate-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl">
            Salin bulan lalu
          </button>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {KPI_ROLES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRole(r.key)}
              className={`whitespace-nowrap text-[11px] font-bold px-3 py-2 rounded-xl ${
                role === r.key ? 'bg-sky-500 text-white' : 'bg-white border border-slate-200 text-slate-600'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <p className={`text-[11px] font-bold ${Math.abs(weightSum - 100) < 0.5 ? 'text-emerald-600' : 'text-amber-600'}`}>
          Total bobot metrik aktif (tanpa SLA): {weightSum}% {Math.abs(weightSum - 100) >= 0.5 ? '— dinormalisasi saat scoring jika ≠ 100' : ''}
        </p>

        {loading ? (
          <p className="text-xs text-slate-400">Memuat konfigurasi…</p>
        ) : roleRows.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-8 text-center text-xs text-slate-400">
            Belum ada metrik untuk {monthYear}. Tekan <b>Isi default 7 role</b> atau tambah custom di bawah.
          </div>
        ) : (
          <div className="space-y-2">
            {roleRows.map((row) => {
              const isSla = row.metric_key === SLA_PENALTY_KEY;
              return (
                <div
                  key={row.id}
                  className={`bg-white border rounded-2xl p-3 grid grid-cols-1 md:grid-cols-12 gap-2 items-end ${
                    isSla ? 'border-rose-200' : 'border-slate-200/80'
                  }`}
                >
                  <div className="md:col-span-4">
                    <label className="block text-[9px] font-bold text-slate-500 mb-1">Label</label>
                    <input
                      value={row.metric_label}
                      onChange={(e) => patch(row.id!, 'metric_label', e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs"
                    />
                    <p className="text-[9px] text-slate-500 mt-0.5 font-mono">{row.metric_key}</p>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[9px] font-bold text-slate-500 mb-1">
                      {isSla ? 'Poin / tugas overdue' : 'Target'}
                    </label>
                    <input
                      type="number"
                      value={row.target_value}
                      onChange={(e) => patch(row.id!, 'target_value', Number(e.target.value))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold text-amber-700"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[9px] font-bold text-slate-500 mb-1">Bobot %</label>
                    <input
                      type="number"
                      disabled={isSla}
                      value={row.weight_percentage}
                      onChange={(e) => patch(row.id!, 'weight_percentage', Number(e.target.value))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold text-sky-700 disabled:opacity-40"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[9px] font-bold text-slate-500 mb-1">Aktif</label>
                    <button
                      type="button"
                      onClick={() => patch(row.id!, 'is_active', !row.is_active)}
                      className={`w-full text-xs font-bold py-2 rounded-xl ${
                        row.is_active ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      {row.is_active ? 'ON' : 'OFF'}
                    </button>
                  </div>
                  <div className="md:col-span-2 flex gap-1">
                    <button
                      disabled={savingId === row.id}
                      onClick={() => saveRow(row)}
                      className="flex-1 bg-emerald-700 text-white text-[10px] font-bold py-2 rounded-xl"
                    >
                      Simpan
                    </button>
                    <button
                      onClick={() => removeRow(row.id)}
                      className="px-2 bg-rose-50 text-rose-600 text-[10px] font-bold rounded-xl"
                    >
                      Hapus
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="bg-white border border-amber-200 rounded-2xl p-4 space-y-3 shadow-sm">
          <h3 className="text-sm font-black text-amber-700">Fokus sementara (custom metric)</h3>
          <p className="text-[10px] text-slate-400">
            Contoh: “Fokus Promo September” diikat ke <b>redemptions</b> target 500, atau “Nol Komplain” diikat ke{' '}
            <b>complaints</b> target 0. Realisasi tetap dari data live; yang berubah hanya target & bobot bulan ini.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
            <input
              placeholder="Label, mis. Fokus Promo September"
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              className="md:col-span-4 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
            />
            <select
              value={customBind}
              onChange={(e) => setCustomBind(e.target.value)}
              className="md:col-span-3 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
            >
              <option value="">Ikat ke realisasi…</option>
              {bindOptions.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              placeholder="Target"
              value={customTarget}
              onChange={(e) => setCustomTarget(e.target.value)}
              className="md:col-span-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
            />
            <input
              type="number"
              placeholder="Bobot %"
              value={customWeight}
              onChange={(e) => setCustomWeight(e.target.value)}
              className="md:col-span-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
            />
            <button
              onClick={handleAddCustom}
              className="md:col-span-2 bg-amber-500 text-slate-900 font-bold text-xs rounded-xl"
            >
              Tambah fokus
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
