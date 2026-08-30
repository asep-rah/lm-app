'use client';

import { useEffect, useState } from 'react';
import { toast } from '@/lib/toast';
import { idr, type GrowthAction, type GrowthBullet, type PassiveCustomer } from '@/lib/aiCopilotAnalytics';

type Props = {
  open: boolean;
  onClose: () => void;
  payload: Record<string, unknown>;
};

type Analysis = {
  summary?: string;
  metrics?: {
    grossRevenue?: number;
    averageTransactionValue?: number;
    customerRepeatRate?: number;
    txCount?: number;
    uniqueCustomers?: number;
    peakHourLabel?: string;
  };
  patterns?: GrowthBullet[];
  crossSell?: GrowthBullet[];
  winBack?: PassiveCustomer[];
  actions?: GrowthAction[];
  source?: string;
};

const TABS = [
  { id: 'pola', label: 'Pola Transaksi' },
  { id: 'upsell', label: 'Cross-Sell' },
  { id: 'retensi', label: 'Retensi' },
  { id: 'aksi', label: 'Aksi Minggu Ini' }
] as const;

export default function TransactionGrowthModal({ open, onClose, payload }: Props) {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('pola');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Analysis | null>(null);
  const [approved, setApproved] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) return;
    setTab('pola');
    setApproved({});
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/ai/transaction-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const json = await res.json().catch(() => ({}));
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) {
          setData(null);
          toast('Analisa transaksi belum bisa dimuat. Coba lagi.', 'err');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [open, JSON.stringify(payload)]);

  if (!open) return null;

  const approve = (action: GrowthAction) => {
    setApproved((p) => ({ ...p, [action.id]: true }));
    toast(`Aksi disetujui: ${action.title}`, 'ok');
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-end md:items-center justify-center p-0 md:p-4" onClick={onClose}>
      <div
        className="bg-white w-full max-w-3xl max-h-[92vh] rounded-t-3xl md:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-5 pt-4 pb-3 border-b border-slate-100 flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-600">Revenue Growth Analyzer</p>
            <h3 className="text-base font-black text-slate-900">Analisa Transaksi & Peningkatan Omset</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 font-black"
            aria-label="Tutup"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-50 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-2 py-2">
            <p className="text-[9px] font-bold uppercase text-emerald-700">Omset</p>
            <p className="text-sm font-black text-emerald-900">{idr(data?.metrics?.grossRevenue || 0)}</p>
          </div>
          <div className="rounded-xl bg-sky-50 border border-sky-100 px-2 py-2">
            <p className="text-[9px] font-bold uppercase text-sky-700">AOV</p>
            <p className="text-sm font-black text-sky-900">{idr(data?.metrics?.averageTransactionValue || 0)}</p>
          </div>
          <div className="rounded-xl bg-amber-50 border border-amber-100 px-2 py-2">
            <p className="text-[9px] font-bold uppercase text-amber-700">Repeat</p>
            <p className="text-sm font-black text-amber-900">{(data?.metrics?.customerRepeatRate || 0).toFixed(0)}%</p>
          </div>
        </div>

        <div className="px-4 pt-3 flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-xl ${
                tab === t.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {loading && <p className="text-xs text-slate-500 py-10 text-center">Menganalisis transaksi outlet…</p>}
          {!loading && data?.summary && (
            <p className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-2xl px-3 py-2.5 leading-relaxed">
              {data.summary}
            </p>
          )}

          {tab === 'pola' &&
            (data?.patterns || []).map((p, i) => (
              <article key={i} className="border border-slate-200 rounded-2xl p-3">
                <h4 className="text-xs font-black text-slate-900">{p.title}</h4>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">{p.body}</p>
              </article>
            ))}

          {tab === 'upsell' &&
            (data?.crossSell || []).map((p, i) => (
              <article key={i} className="border border-indigo-100 bg-indigo-50/40 rounded-2xl p-3">
                <h4 className="text-xs font-black text-indigo-900">{p.title}</h4>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">{p.body}</p>
                {p.offer && (
                  <p className="mt-2 text-[11px] font-bold text-indigo-700 bg-white border border-indigo-100 rounded-xl px-2 py-1.5">
                    Penawaran: {p.offer}
                  </p>
                )}
              </article>
            ))}

          {tab === 'retensi' && (
            <>
              {(data?.winBack || []).length === 0 && !loading && (
                <p className="text-xs text-slate-400 text-center py-8">Tidak ada pelanggan pasif (&gt;21 hari) pada filter ini.</p>
              )}
              {(data?.winBack || []).map((c) => (
                <article key={c.phone} className="border border-amber-100 bg-amber-50/50 rounded-2xl p-3 space-y-2">
                  <div className="flex justify-between gap-2">
                    <div>
                      <p className="text-xs font-black text-slate-900">{c.name}</p>
                      <p className="text-[10px] text-slate-500">
                        {c.daysSince} hari tidak cuci · {c.visits}x · AOV {idr(c.aov)}
                      </p>
                    </div>
                    {c.waUrl && (
                      <a
                        href={c.waUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 bg-emerald-600 text-white text-[10px] font-bold px-3 py-2 rounded-xl"
                      >
                        WhatsApp
                      </a>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">{c.draft}</p>
                </article>
              ))}
            </>
          )}

          {tab === 'aksi' &&
            (data?.actions || []).map((a) => (
              <article key={a.id} className="border border-slate-200 rounded-2xl p-3 flex gap-3 items-start">
                <div className="flex-1 min-w-0">
                  <h4 className="text-xs font-black text-slate-900">{a.title}</h4>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">{a.detail}</p>
                  <p className="text-[10px] font-bold text-emerald-700 mt-1">{a.impact}</p>
                </div>
                <button
                  type="button"
                  disabled={approved[a.id]}
                  onClick={() => approve(a)}
                  className="shrink-0 text-[10px] font-bold px-3 py-2 rounded-xl bg-slate-900 text-white disabled:bg-emerald-600"
                >
                  {approved[a.id] ? 'Disetujui' : 'Setujui'}
                </button>
              </article>
            ))}
        </div>
      </div>
    </div>
  );
}
