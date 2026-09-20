'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { getStaffSession, homePathForRole, isHeadManagementRole, isOwnerRole } from '@/lib/staffSession';
import { toast } from '@/lib/toast';
import {
  MARKETING_REQUEST_TYPES,
  MARKETING_STATUS,
  MARKETING_STATUS_LABEL,
  advanceMarketingRequest,
  createMarketingRequest,
  googleStatusByOutlet,
  isMarketingOpen,
  loadGoogleSnapshots,
  loadMarketingRequests,
  marketingTypeLabel,
  nextStatuses,
  outletsNeedingAttention,
  type MarketingRequest
} from '@/lib/marketingRequest';

type Outlet = { id: string; name: string };

/** Rentang baca default. PRD §8 melarang kueri all-time tanpa batas. */
const LOOKBACK_DAYS = 90;

const sinceIso = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
};

const STATUS_TONE: Record<string, string> = {
  [MARKETING_STATUS.SUBMITTED]: 'bg-amber-50 text-amber-800 border-amber-200',
  [MARKETING_STATUS.IN_PROGRESS]: 'bg-sky-50 text-sky-800 border-sky-200',
  [MARKETING_STATUS.WAITING_APPROVAL]: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  [MARKETING_STATUS.DONE]: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  [MARKETING_STATUS.REJECTED]: 'bg-rose-50 text-rose-800 border-rose-200'
};

export default function MarketingPage() {
  const session = useMemo(() => getStaffSession(), []);
  const role = String(session.role || '').toLowerCase();
  const isMarketingTeam = role === 'digital_marketing';
  // Tim marketing yang mengerjakan; owner & head boleh ikut memindahkan status.
  const canHandle = isMarketingTeam || isOwnerRole(role) || isHeadManagementRole(role);

  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [requests, setRequests] = useState<MarketingRequest[]>([]);
  const [googleStatuses, setGoogleStatuses] = useState<ReturnType<typeof googleStatusByOutlet>>([]);

  const [formType, setFormType] = useState(MARKETING_REQUEST_TYPES[0].value);
  const [formOutlet, setFormOutlet] = useState('');
  const [formBrief, setFormBrief] = useState('');
  const [formBudget, setFormBudget] = useState('');
  const [formTarget, setFormTarget] = useState('');
  const [resultUrl, setResultUrl] = useState<Record<string, string>>({});

  useEffect(() => {
    const raw = localStorage.getItem('laundry_owner_user') || localStorage.getItem('laundry_user');
    if (!raw) {
      window.location.href = '/login';
      return;
    }
    const allowed = [
      'digital_marketing',
      'supervisor',
      'admin_ops',
      'admin',
      'owner',
      'head',
      'head_management'
    ];
    if (!allowed.includes(role)) {
      window.location.href = homePathForRole(role);
      return;
    }
    setReady(true);
  }, [role]);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: outs }, reqs, snaps] = await Promise.all([
      supabase.from('outlets').select('id, name').order('name'),
      loadMarketingRequests({ sinceIso: sinceIso(LOOKBACK_DAYS), limit: 200 }),
      loadGoogleSnapshots({ sinceDate: sinceIso(LOOKBACK_DAYS).slice(0, 10), limit: 1000 })
    ]);
    setOutlets((outs as Outlet[]) || []);
    setRequests(reqs);
    setGoogleStatuses(googleStatusByOutlet(snaps));
    setLoading(false);
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  const outletName = useMemo(
    () => Object.fromEntries(outlets.map((o) => [o.id, o.name])),
    [outlets]
  );
  const attention = useMemo(() => outletsNeedingAttention(googleStatuses), [googleStatuses]);
  const open = useMemo(() => requests.filter(isMarketingOpen), [requests]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('form');
    const { error } = await createMarketingRequest({
      type: formType,
      outletId: formOutlet || null,
      brief: formBrief,
      budget: formBudget ? Number(formBudget) : null,
      targetDate: formTarget || null,
      requester: { name: session.name, role }
    });
    setBusy('');
    if (error) return toast(error.message, 'err');
    setFormBrief('');
    setFormBudget('');
    setFormTarget('');
    toast('Pengajuan terkirim ke tim Digital Marketing.', 'ok');
    load();
  };

  const handleAdvance = async (req: MarketingRequest, to: string) => {
    setBusy(req.id);
    const { error } = await advanceMarketingRequest({
      req,
      to,
      handlerName: session.name,
      resultUrl: resultUrl[req.id] || undefined
    });
    setBusy('');
    if (error) return toast(error.message, 'err');
    toast(`Status → ${MARKETING_STATUS_LABEL[to] || to}`, 'ok');
    load();
  };

  if (!ready) return <div className="min-h-screen bg-[#f7f7f5]" />;

  return (
    <div className="min-h-screen bg-[#f7f7f5] pb-20">
      <header className="bg-white border-b border-slate-200 px-4 py-3 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div>
            <h1 className="text-sm font-bold text-slate-900">Digital Marketing</h1>
            <p className="text-[11px] text-slate-500">
              {session.name} · {open.length} pengajuan berjalan
            </p>
          </div>
          <Link
            href="/workspace"
            className="text-[11px] font-semibold px-3 py-2 rounded-lg border border-slate-200 text-slate-600"
          >
            Workspace
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        <section className="bg-white border border-slate-200 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-slate-900 mb-1">Ajukan ke Tim Marketing</h2>
          <p className="text-[11px] text-slate-500 mb-3">
            Pengajuan langsung masuk ke inbox tugas tim Digital Marketing beserta SLA-nya.
          </p>
          <form onSubmit={handleSubmit} className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <select
                value={formType}
                onChange={(e) => setFormType(e.target.value)}
                className="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white"
              >
                {MARKETING_REQUEST_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <select
                value={formOutlet}
                onChange={(e) => setFormOutlet(e.target.value)}
                className="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white"
              >
                <option value="">Pusat / semua outlet</option>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
            <p className="text-[10px] text-slate-400">
              {MARKETING_REQUEST_TYPES.find((t) => t.value === formType)?.hint}
            </p>
            <textarea
              rows={3}
              value={formBrief}
              onChange={(e) => setFormBrief(e.target.value)}
              placeholder="Brief: apa yang dibutuhkan, target, dan batasannya"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs"
              required
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                min="0"
                value={formBudget}
                onChange={(e) => setFormBudget(e.target.value)}
                placeholder="Budget (opsional)"
                className="border border-slate-200 rounded-xl px-3 py-2 text-xs"
              />
              <input
                type="date"
                value={formTarget}
                onChange={(e) => setFormTarget(e.target.value)}
                className="border border-slate-200 rounded-xl px-3 py-2 text-xs"
              />
            </div>
            <button
              type="submit"
              disabled={busy === 'form'}
              className="w-full bg-slate-900 text-white font-bold py-2.5 rounded-xl text-xs disabled:opacity-50"
            >
              {busy === 'form' ? 'Mengirim…' : 'KIRIM PENGAJUAN'}
            </button>
          </form>
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-slate-900 mb-1">Google Bisnis Perlu Perhatian</h2>
          <p className="text-[11px] text-slate-500 mb-3">
            Rating turun atau review belum dibalas, dari snapshot {LOOKBACK_DAYS} hari terakhir.
          </p>
          {loading ? (
            <p className="text-xs text-slate-400">Memuat…</p>
          ) : googleStatuses.length === 0 ? (
            <p className="text-xs text-slate-400">
              Belum ada snapshot Google. Data ini diisi otomatis lewat integrasi n8n.
            </p>
          ) : attention.length === 0 ? (
            <p className="text-xs text-emerald-700">Tidak ada outlet yang perlu perhatian.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {attention.slice(0, 20).map((s) => (
                <li key={s.outletId} className="py-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-800 truncate">
                    {outletName[s.outletId] || s.outletId}
                  </span>
                  <span className="text-[10px] shrink-0 flex items-center gap-2">
                    <b className="text-slate-900">{s.rating ?? '—'}</b>
                    {s.ratingDelta != null && s.ratingDelta < 0 && (
                      <span className="text-rose-600 font-bold">{s.ratingDelta}</span>
                    )}
                    {s.unreplied > 0 && (
                      <span className="text-amber-700 font-bold">{s.unreplied} belum dibalas</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Papan Pengajuan</h2>
          {loading ? (
            <p className="text-xs text-slate-400">Memuat…</p>
          ) : requests.length === 0 ? (
            <p className="text-xs text-slate-400">Belum ada pengajuan.</p>
          ) : (
            <div className="space-y-2">
              {requests.slice(0, 50).map((req) => (
                <article key={req.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900">
                        {marketingTypeLabel(req.type)}
                        {req.outlet_id ? ` · ${outletName[req.outlet_id] || 'Outlet'}` : ' · Pusat'}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {req.requested_by_name || '—'} ·{' '}
                        {new Date(req.created_at).toLocaleDateString('id-ID')}
                        {req.target_date ? ` · target ${req.target_date}` : ''}
                        {req.budget ? ` · Rp ${Number(req.budget).toLocaleString('id-ID')}` : ''}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-[9px] font-bold px-2 py-0.5 rounded-lg border ${
                        STATUS_TONE[String(req.status).toLowerCase()] || 'bg-slate-50 text-slate-600 border-slate-200'
                      }`}
                    >
                      {MARKETING_STATUS_LABEL[String(req.status).toLowerCase()] || req.status}
                    </span>
                  </div>
                  {req.brief && (
                    <p className="text-[11px] text-slate-600 mt-2 leading-relaxed">{req.brief}</p>
                  )}
                  {req.result_url && (
                    <a
                      href={req.result_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] text-sky-700 font-semibold underline mt-1 inline-block"
                    >
                      Lihat hasil
                    </a>
                  )}
                  {canHandle && nextStatuses(req.status).length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        value={resultUrl[req.id] || ''}
                        onChange={(e) => setResultUrl({ ...resultUrl, [req.id]: e.target.value })}
                        placeholder="Link hasil (opsional)"
                        className="flex-1 min-w-[140px] border border-slate-200 rounded-lg px-2 py-1.5 text-[10px]"
                      />
                      {nextStatuses(req.status).map((to) => (
                        <button
                          key={to}
                          type="button"
                          disabled={busy === req.id}
                          onClick={() => handleAdvance(req, to)}
                          className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-slate-900 text-white disabled:opacity-50"
                        >
                          {MARKETING_STATUS_LABEL[to]}
                        </button>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
