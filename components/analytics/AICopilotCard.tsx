'use client';

import { useEffect, useMemo, useState } from 'react';
import TransactionGrowthModal from '@/components/analytics/TransactionGrowthModal';
import { idr, type CopilotInsight, type CopilotMetrics, type CopilotPeriod } from '@/lib/aiCopilotAnalytics';

const QUICK_PROMPTS = [
  '💡 Outlet mana yang paling profit?',
  '📉 Analisis pengeluaran OPEX bulan ini',
  '🚀 Strategi tingkatkan repeat order'
];

const renderAskMarkdown = (text: string) => {
  const cleaned = String(text || '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*{3,}/g, '**');
  return cleaned.split('\n').map((line, i) => {
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const content = bullet ? bullet[1] : line;
    const parts = content.split(/(\*\*.*?\*\*)/g);
    const nodes = parts.map((part, j) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={j} className="font-bold text-amber-300">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return <span key={j}>{part}</span>;
    });
    if (bullet) {
      return (
        <p key={i} className="text-[12px] text-slate-100 leading-relaxed pl-3 mb-1.5 before:content-['•'] before:mr-2 before:text-amber-300">
          {nodes}
        </p>
      );
    }
    return (
      <p key={i} className="text-[12px] text-slate-100 leading-relaxed min-h-[1.1em] mb-1.5">
        {nodes}
      </p>
    );
  });
};

type Props = {
  scope?: 'owner' | 'supervisor';
  outletId?: string;
  period?: CopilotPeriod | string;
  supervisorName?: string;
  accessOutlets?: unknown;
};

export default function AICopilotCard({
  scope = 'owner',
  outletId = 'ALL',
  period = 'THIS_MONTH',
  supervisorName,
  accessOutlets
}: Props) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState('');
  const [insights, setInsights] = useState<CopilotInsight[]>([]);
  const [metrics, setMetrics] = useState<Partial<CopilotMetrics> | null>(null);
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState('');
  const [asking, setAsking] = useState(false);
  const [askQuestion, setAskQuestion] = useState('');
  const [askReply, setAskReply] = useState('');

  const payload = useMemo(
    () => ({
      scope,
      outletId,
      period,
      supervisorName,
      accessOutlets
    }),
    [scope, outletId, period, supervisorName, JSON.stringify(accessOutlets || null)]
  );

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/ai/copilot-analytics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        setSummary(json.summary || '');
        setInsights(Array.isArray(json.insights) ? json.insights : []);
        setMetrics(json.metrics || null);
      } catch {
        if (!cancelled) {
          setSummary('Analitik belum tersedia. Coba muat ulang.');
          setInsights([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [payload]);

  const sendAsk = async (text?: string) => {
    const question = String(text ?? ask).trim();
    if (!question || asking) return;
    setAsking(true);
    setAskQuestion(question);
    setAskReply('');
    try {
      const res = await fetch('/api/ai/ask-owner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, question })
      });
      const json = await res.json().catch(() => ({}));
      setAskReply(json.reply || json.error || 'AI belum bisa menjawab. Coba lagi.');
      setAsk('');
    } catch {
      setAskReply('Koneksi AI terputus. Coba kirim ulang pertanyaannya.');
    } finally {
      setAsking(false);
    }
  };

  return (
    <>
      <section className="bg-slate-900 text-white rounded-2xl p-4 md:p-5 shadow-sm border border-slate-800 space-y-4">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-sky-300">AI Copilot Analytics</p>
            <h3 className="text-base font-black mt-0.5">
              {scope === 'supervisor' ? 'Performa cabang pengawasan' : 'Ringkasan otomatis Owner'}
            </h3>
            <p className="text-[11px] text-slate-400 mt-1">
              Insight performa, efisiensi OPEX, skor SLA, plus analisa omset.
            </p>
          </div>
          <div className="flex gap-2 text-center">
            <div className="rounded-xl bg-white/5 border border-white/10 px-3 py-2 min-w-[92px]">
              <p className="text-[9px] uppercase font-bold text-slate-400">Omset</p>
              <p className="text-xs font-black tabular-nums">{idr(metrics?.grossRevenue || 0)}</p>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/10 px-3 py-2 min-w-[72px]">
              <p className="text-[9px] uppercase font-bold text-slate-400">SLA</p>
              <p className="text-lg font-black tabular-nums">{metrics?.slaScore ?? '—'}</p>
            </div>
          </div>
        </div>

        {loading ? (
          <p className="text-xs text-slate-400">Menyusun insight…</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {insights.map((ins) => (
              <article
                key={ins.title}
                className={`rounded-xl px-3 py-2.5 border ${
                  ins.tone === 'warn'
                    ? 'bg-amber-500/10 border-amber-400/30'
                    : ins.tone === 'ok'
                      ? 'bg-emerald-500/10 border-emerald-400/20'
                      : 'bg-white/5 border-white/10'
                }`}
              >
                <p className="text-[10px] font-bold uppercase text-slate-300">{ins.title}</p>
                <p className="text-[11px] text-slate-100 mt-1 leading-relaxed">{ins.body}</p>
              </article>
            ))}
          </div>
        )}

        {summary && !loading && <p className="text-[11px] text-slate-300 leading-relaxed">{summary}</p>}

        <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3 space-y-2.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-sky-300">Tanya AI Copilot</p>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_PROMPTS.map((chip) => (
              <button
                key={chip}
                type="button"
                disabled={asking}
                onClick={() => sendAsk(chip.replace(/^[^\s]+\s/, ''))}
                className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10 disabled:opacity-50"
              >
                {chip}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendAsk();
            }}
            className="flex gap-2"
          >
            <input
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              placeholder="Tanyakan apapun tentang bisnis Anda (misal: 'Cabang mana yang paling boros OPEX?' atau 'Bagaimana cara menaikkan omset Malioboro?')..."
              className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-[11px] text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
            />
            <button
              type="submit"
              disabled={asking || !ask.trim()}
              className="shrink-0 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-900 font-black text-[11px] px-3.5 rounded-xl min-w-[72px] flex items-center justify-center"
            >
              {asking ? (
                <span className="inline-block w-3.5 h-3.5 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
              ) : (
                'Kirim'
              )}
            </button>
          </form>
          {(askQuestion || askReply || asking) && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2.5 max-h-56 overflow-y-auto">
              {askQuestion && (
                <p className="text-[10px] font-bold text-slate-400 mb-2">Anda: {askQuestion}</p>
              )}
              {asking && !askReply ? (
                <p className="text-[11px] text-slate-400">Menyusun jawaban dari data live…</p>
              ) : (
                renderAskMarkdown(askReply)
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full bg-amber-400 hover:bg-amber-300 text-slate-900 font-black text-xs md:text-sm py-3 rounded-xl shadow"
        >
          🚀 Analisa Transaksi & Peningkatan Omset
        </button>
      </section>

      <TransactionGrowthModal open={open} onClose={() => setOpen(false)} payload={payload} />
    </>
  );
}
