'use client';

import { useEffect, useMemo, useState } from 'react';
import OwnerExecNav from '@/components/OwnerExecNav';
import { CRM_TIERS, DEFAULT_CRM_SETTINGS, idr, saveCrmSettings, waMeUrl, type CrmSettings } from '@/lib/crm';
import { filterCrmAudience, loadCrmAnalytics, runRetentionSweep, type CrmAnalytics } from '@/lib/crm-automation';
import { queuePush } from '@/lib/notifications';
import { canAccessSettings, homePathForRole, isOwnerRole, isWorkspaceRole } from '@/lib/staffSession';
import { supabase } from '@/lib/supabaseClient';

type OutletOpt = { id: string; name: string };

const emptyAnalytics = (): CrmAnalytics => ({
  settings: DEFAULT_CRM_SETTINGS,
  profiles: [],
  active: [],
  atRisk: [],
  vip: [],
  repeatOrderRate: 0,
  avgLtv: 0,
  totalPointsIssued: 0,
  totalCustomers: 0
});

export default function OwnerCrmPage() {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [outlets, setOutlets] = useState<OutletOpt[]>([]);
  const [analytics, setAnalytics] = useState<CrmAnalytics>(emptyAnalytics);
  const [settings, setSettings] = useState<CrmSettings>(DEFAULT_CRM_SETTINGS);
  const [saveMsg, setSaveMsg] = useState('');

  const [outletId, setOutletId] = useState('ALL');
  const [tier, setTier] = useState('ALL');
  const [segment, setSegment] = useState<'all' | 'active' | 'at_risk' | 'vip'>('all');
  const [broadcastTitle, setBroadcastTitle] = useState('Promo Loyalty Laundrivery');
  const [broadcastBody, setBroadcastBody] = useState('Nikmati poin cashback sesuai tier Anda. Order cucian hari ini!');
  const [broadcasting, setBroadcasting] = useState(false);
  const [retentionBusy, setRetentionBusy] = useState(false);
  const [waLinks, setWaLinks] = useState<{ phone: string; name: string; url: string }[]>([]);

  const load = async () => {
    setLoading(true);
    const [a, { data: outletRows }] = await Promise.all([
      loadCrmAnalytics(),
      supabase.from('outlets').select('id, name').order('name')
    ]);
    setAnalytics(a);
    setSettings(a.settings);
    setOutlets((outletRows || []) as OutletOpt[]);
    setLoading(false);
  };

  useEffect(() => {
    const raw = localStorage.getItem('laundry_owner_user');
    if (!raw) {
      window.location.href = '/login';
      return;
    }
    const role = String(JSON.parse(raw).role || '').toLowerCase();
    if (isWorkspaceRole(role) && !canAccessSettings(role)) {
      window.location.href = '/workspace';
      return;
    }
    if (!canAccessSettings(role) && !isOwnerRole(role)) {
      window.location.href = homePathForRole(role);
      return;
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    load();
  }, [ready]);

  const audience = useMemo(
    () =>
      filterCrmAudience({
        profiles: analytics.profiles,
        settings: analytics.settings,
        outletId,
        tier,
        segment
      }),
    [analytics.profiles, analytics.settings, outletId, tier, segment]
  );

  const handleSaveSettings = async () => {
    setSaving(true);
    setSaveMsg('');
    const { error } = await saveCrmSettings(settings);
    setSaving(false);
    if (error) {
      setSaveMsg(error.message);
      return;
    }
    setSaveMsg('Aturan loyalty tersimpan.');
    await load();
  };

  const handleBroadcastPush = async () => {
    if (!audience.length) return alert('Tidak ada pelanggan pada filter ini.');
    if (!broadcastTitle.trim() || !broadcastBody.trim()) return alert('Isi judul dan isi pesan.');
    setBroadcasting(true);
    audience.forEach((p) => {
      queuePush({
        kind: 'crm_campaign',
        phone: p.phone,
        title: broadcastTitle.trim(),
        body: broadcastBody.trim(),
        url: '/customer/dashboard'
      });
    });
    setBroadcasting(false);
    alert(`Push terkirim ke ${audience.length} pelanggan (filter ${segment}/${tier}).`);
  };

  const handleBroadcastWa = () => {
    if (!audience.length) return alert('Tidak ada pelanggan pada filter ini.');
    const links = audience
      .map((p) => ({
        phone: p.phone,
        name: p.name || p.phone,
        url: waMeUrl(p.phone, broadcastBody)
      }))
      .filter((x) => x.url);
    setWaLinks(links);
    if (links[0]?.url) window.open(links[0].url, '_blank');
  };

  const handleRetention = async () => {
    setRetentionBusy(true);
    try {
      const res = await runRetentionSweep();
      alert(`Re-engagement: ${res.sent} push terkirim, ${res.skipped} dilewati (masih aktif / cooldown).`);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Gagal menjalankan retention.');
    } finally {
      setRetentionBusy(false);
    }
  };

  if (!ready) return <div className="min-h-screen bg-slate-50" />;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-3 md:p-8">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="bg-white border border-slate-200/80 p-5 md:p-6 rounded-2xl shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600">Owner CRM</p>
            <h1 className="text-2xl font-black text-slate-900 mt-0.5">Loyalty & Retensi Pelanggan</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Poin dihitung saat cucian diserahkan (status Selesai), sesuai persentase tier yang Anda atur.
            </p>
          </div>
          <div className="flex flex-col items-stretch md:items-end gap-2">
            <OwnerExecNav active="crm" />
            <button
              type="button"
              onClick={handleRetention}
              disabled={retentionBusy}
              className="text-xs font-bold px-3 py-1.5 rounded-lg bg-amber-500 text-white disabled:opacity-60"
            >
              {retentionBusy ? 'Menjalankan…' : 'Jalankan retensi inactive'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Metric label="Repeat Order Rate" value={`${analytics.repeatOrderRate}%`} />
          <Metric label="Avg. Customer LTV" value={idr(analytics.avgLtv)} />
          <Metric label="Poin aktif terbit" value={Math.round(analytics.totalPointsIssued).toLocaleString('id-ID')} />
          <Metric label="Profil CRM" value={String(analytics.totalCustomers)} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <SegmentCard
            title="Active"
            hint={`Order dalam ${analytics.settings.inactive_days} hari`}
            count={analytics.active.length}
            tone="emerald"
          />
          <SegmentCard
            title="At-Risk"
            hint={`Tidak order >${analytics.settings.inactive_days} hari`}
            count={analytics.atRisk.length}
            tone="amber"
          />
          <SegmentCard title="VIP Champions" hint="Gold & Platinum" count={analytics.vip.length} tone="slate" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
            <h2 className="text-sm font-black text-slate-900">Aturan poin & naik tier</h2>
            <div className="grid grid-cols-2 gap-3">
              <NumField
                label="Standard %"
                value={settings.standard_rate}
                onChange={(v) => setSettings((s) => ({ ...s, standard_rate: v }))}
              />
              <NumField
                label="Silver %"
                value={settings.silver_rate}
                onChange={(v) => setSettings((s) => ({ ...s, silver_rate: v }))}
              />
              <NumField
                label="Gold %"
                value={settings.gold_rate}
                onChange={(v) => setSettings((s) => ({ ...s, gold_rate: v }))}
              />
              <NumField
                label="Platinum %"
                value={settings.platinum_rate}
                onChange={(v) => setSettings((s) => ({ ...s, platinum_rate: v }))}
              />
              <NumField
                label="Ambang Silver (Rp)"
                value={settings.silver_threshold}
                onChange={(v) => setSettings((s) => ({ ...s, silver_threshold: v }))}
              />
              <NumField
                label="Ambang Gold (Rp)"
                value={settings.gold_threshold}
                onChange={(v) => setSettings((s) => ({ ...s, gold_threshold: v }))}
              />
              <NumField
                label="Ambang Platinum (Rp)"
                value={settings.platinum_threshold}
                onChange={(v) => setSettings((s) => ({ ...s, platinum_threshold: v }))}
              />
              <NumField
                label="Inactive (hari)"
                value={settings.inactive_days}
                onChange={(v) => setSettings((s) => ({ ...s, inactive_days: v }))}
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Pesan retensi otomatis</label>
              <textarea
                value={settings.retention_message}
                onChange={(e) => setSettings((s) => ({ ...s, retention_message: e.target.value }))}
                rows={3}
                className="w-full border border-slate-200 rounded-xl p-2.5 text-xs bg-slate-50"
              />
            </div>
            <button
              type="button"
              onClick={handleSaveSettings}
              disabled={saving}
              className="w-full bg-slate-900 text-white font-bold text-xs py-2.5 rounded-xl disabled:opacity-60"
            >
              {saving ? 'Menyimpan…' : 'Simpan aturan CRM'}
            </button>
            {saveMsg ? <p className="text-[11px] font-semibold text-emerald-700">{saveMsg}</p> : null}
            {loading ? <p className="text-[10px] text-slate-400">Memuat data…</p> : null}
          </section>

          <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
            <h2 className="text-sm font-black text-slate-900">Broadcast Push & WhatsApp</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <select
                value={outletId}
                onChange={(e) => setOutletId(e.target.value)}
                className="border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold bg-slate-50"
              >
                <option value="ALL">Semua outlet</option>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <select
                value={tier}
                onChange={(e) => setTier(e.target.value)}
                className="border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold bg-slate-50"
              >
                <option value="ALL">Semua tier</option>
                {CRM_TIERS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <select
                value={segment}
                onChange={(e) => setSegment(e.target.value as typeof segment)}
                className="border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold bg-slate-50"
              >
                <option value="all">Semua segmen</option>
                <option value="active">Active</option>
                <option value="at_risk">At-Risk</option>
                <option value="vip">VIP Champions</option>
              </select>
            </div>
            <p className="text-[11px] font-bold text-slate-500">{audience.length} pelanggan terfilter</p>
            <input
              value={broadcastTitle}
              onChange={(e) => setBroadcastTitle(e.target.value)}
              placeholder="Judul push"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold bg-slate-50"
            />
            <textarea
              value={broadcastBody}
              onChange={(e) => setBroadcastBody(e.target.value)}
              rows={3}
              className="w-full border border-slate-200 rounded-xl p-2.5 text-xs bg-slate-50"
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleBroadcastPush}
                disabled={broadcasting}
                className="bg-indigo-600 text-white font-bold text-xs py-2.5 rounded-xl disabled:opacity-60"
              >
                Kirim Push
              </button>
              <button
                type="button"
                onClick={handleBroadcastWa}
                className="bg-emerald-600 text-white font-bold text-xs py-2.5 rounded-xl"
              >
                Siapkan WhatsApp
              </button>
            </div>
            {waLinks.length > 0 && (
              <div className="max-h-48 overflow-y-auto border border-slate-100 rounded-xl divide-y">
                {waLinks.map((row) => (
                  <a
                    key={row.phone}
                    href={row.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex justify-between gap-2 px-3 py-2 text-[11px] hover:bg-slate-50"
                  >
                    <span className="font-bold text-slate-800 truncate">{row.name}</span>
                    <span className="text-emerald-700 font-bold shrink-0">WA</span>
                  </a>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-xl font-black text-slate-900 mt-1 tabular-nums">{value}</p>
    </div>
  );
}

function SegmentCard({
  title,
  hint,
  count,
  tone
}: {
  title: string;
  hint: string;
  count: number;
  tone: 'emerald' | 'amber' | 'slate';
}) {
  const cls =
    tone === 'emerald'
      ? 'border-emerald-200 bg-emerald-50'
      : tone === 'amber'
        ? 'border-amber-200 bg-amber-50'
        : 'border-slate-200 bg-slate-50';
  return (
    <div className={`rounded-2xl border p-4 ${cls}`}>
      <p className="text-xs font-black text-slate-900">{title}</p>
      <p className="text-2xl font-black tabular-nums mt-1">{count}</p>
      <p className="text-[10px] text-slate-500 mt-1">{hint}</p>
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-full border border-slate-200 rounded-xl px-2.5 py-2 text-xs font-bold bg-slate-50"
      />
    </label>
  );
}
