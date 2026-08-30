'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { isVoidTransaction } from '@/lib/voidTx';
import { toast } from '@/lib/toast';
import { updateWithFallback } from '@/lib/safeWrite';
import FinanceReconBoard from '@/components/FinanceReconBoard';
import FinanceAlertListener from '@/components/FinanceAlertListener';

const fmt = (n: number) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;

const thisMonthStart = () => {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

type Panel = 'pnl' | 'coa' | 'recon' | 'roi' | 'audit' | null;

export default function FinanceWorkspacePanel() {
  const [open, setOpen] = useState<Panel>(null);
  const [outlets, setOutlets] = useState<any[]>([]);
  const [txs, setTxs] = useState<any[]>([]);
  const [exps, setExps] = useState<any[]>([]);
  const [topups, setTopups] = useState<any[]>([]);
  const [coaText, setCoaText] = useState('');
  const [savingCoa, setSavingCoa] = useState(false);
  const [editExp, setEditExp] = useState<Record<string, { amount: string; description: string }>>({});
  const [busyExp, setBusyExp] = useState<string | null>(null);

  const load = async () => {
    const from = thisMonthStart();
    const [{ data: outs }, { data: txData }, { data: expData }, { data: topData }, { data: settings }] =
      await Promise.all([
        supabase.from('outlets').select('id, name').order('name'),
        supabase.from('transactions').select('id, outlet_id, amount, payment_method, is_paid, status, created_at, receipt_number').gte('created_at', from).limit(800),
        supabase.from('expenses').select('id, outlet_id, amount, category, description, created_at').gte('created_at', from).order('created_at', { ascending: false }).limit(400),
        supabase.from('deposit_topups').select('id, amount, status, payment_method, mayar_payment_id, created_at').gte('created_at', from).limit(400),
        supabase.from('app_settings').select('coa_categories').eq('id', 1).maybeSingle()
      ]);
    setOutlets(outs || []);
    setTxs((txData || []).filter((t: any) => !isVoidTransaction(t)));
    setExps(expData || []);
    setTopups(topData || []);
    const raw = settings?.coa_categories;
    const list = Array.isArray(raw) ? raw : (() => { try { return JSON.parse(raw || '[]'); } catch { return []; } })();
    setCoaText((list || []).join('\n'));
  };

  useEffect(() => {
    load();
  }, []);

  const income = txs.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const opex = exps.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const profit = income - opex;

  const isQris = (row: any) => {
    const pm = String(row.payment_method || '').toLowerCase();
    return pm.includes('qris') || pm.includes('mayar') || pm.includes('transfer') || !!row.mayar_payment_id;
  };
  const isCash = (row: any) => String(row.payment_method || '').toLowerCase().includes('cash') || !isQris(row);

  const qrisTx = txs.filter(isQris);
  const cashTx = txs.filter((t) => !isQris(t) && isCash(t));
  const qrisPaid = qrisTx.filter((t) => t.is_paid === true);
  const qrisUnmatched = qrisTx.filter((t) => t.is_paid !== true);
  const topupOk = topups.filter((t) => String(t.status || '').toLowerCase().includes('success') || String(t.status || '').toLowerCase() === 'paid');

  const roiRows = useMemo(() => {
    return outlets.map((o) => {
      const rev = txs.filter((t) => t.outlet_id === o.id).reduce((s, t) => s + (Number(t.amount) || 0), 0);
      const exp = exps.filter((e) => e.outlet_id === o.id).reduce((s, e) => s + (Number(e.amount) || 0), 0);
      const net = rev - exp;
      const margin = rev > 0 ? (net / rev) * 100 : 0;
      return { ...o, rev, exp, net, margin };
    }).sort((a, b) => b.rev - a.rev);
  }, [outlets, txs, exps]);

  const saveCoa = async () => {
    setSavingCoa(true);
    const arr = coaText.split('\n').map((s) => s.trim()).filter(Boolean);
    const { error } = await updateWithFallback(
      'app_settings',
      [{ coa_categories: JSON.stringify(arr) }],
      { column: 'id', value: 1 }
    );
    setSavingCoa(false);
    if (error) {
      toast('Gagal simpan COA: ' + error.message, 'err');
      return;
    }
    toast('COA tersimpan.', 'ok');
  };

  const saveExpense = async (row: any) => {
    const draft = editExp[row.id] || { amount: String(row.amount || ''), description: row.description || '' };
    setBusyExp(row.id);
    const { error } = await updateWithFallback(
      'expenses',
      [{ amount: Number(draft.amount) || 0, description: draft.description }],
      { column: 'id', value: row.id }
    );
    setBusyExp(null);
    if (error) {
      toast('Gagal revisi: ' + error.message, 'err');
      return;
    }
    toast('Entri pengeluaran diperbarui.', 'ok');
    load();
  };

  const cards = [
    {
      id: 'pnl' as const,
      title: 'Lihat & Revisi PnL',
      desc: 'Analisis omset vs beban bulan ini, plus koreksi entri expense.',
      tone: 'bg-emerald-50 border-emerald-100 text-emerald-900'
    },
    {
      id: 'coa' as const,
      title: 'Kelola COA (Chart of Accounts)',
      desc: 'Tambah, ubah, atau kelompokkan kode akun pengeluaran.',
      tone: 'bg-sky-50 border-sky-100 text-sky-900'
    },
    {
      id: 'recon' as const,
      title: 'Rekonsiliasi Bank & Kas',
      desc: 'Cocokkan QRIS Mayar dengan settlement kas tunai.',
      tone: 'bg-indigo-50 border-indigo-100 text-indigo-900'
    },
    {
      id: 'roi' as const,
      title: 'Monitoring ROI & Keuangan Outlet',
      desc: 'Kesehatan finansial realtime per cabang.',
      tone: 'bg-amber-50 border-amber-100 text-amber-900'
    },
    {
      id: 'audit' as const,
      title: 'Auto-Reconciliation & Audit Board',
      desc: 'Matched/unmatched harian, analisa kebocoran, revisi, dan eskalasi Supervisor.',
      tone: 'bg-rose-50 border-rose-100 text-rose-900'
    }
  ];

  return (
    <div className="space-y-3">
      <FinanceAlertListener onOpenBoard={() => setOpen('audit')} />
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Financial Control</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {cards.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setOpen(c.id)}
            className={`text-left rounded-xl border px-3 py-2.5 ${c.tone}`}
          >
            <p className="text-[12px] font-bold leading-snug">{c.title}</p>
            <p className="text-[10px] opacity-80 mt-0.5 leading-relaxed">{c.desc}</p>
          </button>
        ))}
      </div>
      <Link href="/history" className="block text-center text-[11px] font-semibold py-2 rounded-lg border border-slate-200">
        Buka Transaksi
      </Link>
      <Link href="/expense" className="block text-center text-[11px] font-semibold py-2 rounded-lg bg-slate-900 text-white">
        Buku pengeluaran
      </Link>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-3" onClick={() => setOpen(null)}>
          <div
            className={`bg-white w-full ${open === 'audit' ? 'max-w-3xl' : 'max-w-2xl'} max-h-[88vh] overflow-y-auto rounded-2xl p-4 shadow-xl`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-sm font-black text-slate-900">{cards.find((c) => c.id === open)?.title}</h3>
              <button type="button" onClick={() => setOpen(null)} className="text-xs font-bold text-slate-400">Tutup</button>
            </div>

            {open === 'pnl' && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl border border-slate-100 p-2.5">
                    <p className="text-[9px] uppercase font-bold text-slate-400">Omset</p>
                    <p className="text-sm font-black text-emerald-600">{fmt(income)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 p-2.5">
                    <p className="text-[9px] uppercase font-bold text-slate-400">Beban</p>
                    <p className="text-sm font-black text-rose-600">{fmt(opex)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 p-2.5">
                    <p className="text-[9px] uppercase font-bold text-slate-400">Net Profit</p>
                    <p className={`text-sm font-black ${profit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{fmt(profit)}</p>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500">Revisi entri pengeluaran bulan ini. Omset mengikuti transaksi kasir.</p>
                <div className="space-y-2">
                  {exps.slice(0, 12).map((e) => {
                    const draft = editExp[e.id] || { amount: String(e.amount || ''), description: e.description || '' };
                    return (
                      <div key={e.id} className="border border-slate-100 rounded-xl p-2 space-y-1.5">
                        <p className="text-[10px] font-bold text-slate-500">{e.category} · {new Date(e.created_at).toLocaleDateString('id-ID')}</p>
                        <input
                          value={draft.description}
                          onChange={(ev) => setEditExp({ ...editExp, [e.id]: { ...draft, description: ev.target.value } })}
                          className="w-full border border-slate-200 rounded-lg px-2 py-1 text-[11px]"
                        />
                        <div className="flex gap-2">
                          <input
                            type="number"
                            value={draft.amount}
                            onChange={(ev) => setEditExp({ ...editExp, [e.id]: { ...draft, amount: ev.target.value } })}
                            className="flex-1 border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-bold"
                          />
                          <button
                            type="button"
                            disabled={busyExp === e.id}
                            onClick={() => saveExpense(e)}
                            className="text-[10px] font-bold px-2.5 rounded-lg bg-slate-900 text-white"
                          >
                            Simpan
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {exps.length === 0 && <p className="text-xs text-slate-400">Belum ada expense bulan ini.</p>}
                </div>
              </div>
            )}

            {open === 'coa' && (
              <div className="space-y-3">
                <p className="text-[11px] text-slate-500">Satu kode / kategori per baris. Dipakai kasir dan buku pengeluaran.</p>
                <textarea
                  rows={10}
                  value={coaText}
                  onChange={(e) => setCoaText(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl p-2.5 text-xs font-mono"
                />
                <button
                  type="button"
                  disabled={savingCoa}
                  onClick={saveCoa}
                  className="w-full bg-sky-600 text-white text-xs font-bold py-2.5 rounded-xl"
                >
                  {savingCoa ? 'Menyimpan…' : 'Simpan COA'}
                </button>
              </div>
            )}

            {open === 'recon' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-2.5">
                    <p className="text-[9px] uppercase font-bold text-indigo-500">QRIS Mayar matched</p>
                    <p className="text-sm font-black">{qrisPaid.length} trx · {fmt(qrisPaid.reduce((s, t) => s + Number(t.amount || 0), 0))}</p>
                    <p className="text-[10px] text-indigo-700 mt-1">Top-up sukses: {topupOk.length}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-2.5">
                    <p className="text-[9px] uppercase font-bold text-slate-400">Kas tunai</p>
                    <p className="text-sm font-black">{cashTx.length} trx · {fmt(cashTx.reduce((s, t) => s + Number(t.amount || 0), 0))}</p>
                  </div>
                </div>
                <p className="text-[11px] font-bold text-rose-600">Belum cocok (QRIS belum lunas): {qrisUnmatched.length}</p>
                <div className="max-h-56 overflow-y-auto space-y-1.5">
                  {qrisUnmatched.slice(0, 20).map((t) => (
                    <div key={t.id} className="text-[11px] border border-rose-100 rounded-lg px-2 py-1.5 flex justify-between">
                      <span className="font-semibold">{t.receipt_number || t.id}</span>
                      <span>{fmt(t.amount)}</span>
                    </div>
                  ))}
                  {qrisUnmatched.length === 0 && <p className="text-xs text-slate-400">Semua QRIS bulan ini sudah matched.</p>}
                </div>
              </div>
            )}

            {open === 'audit' && <FinanceReconBoard embedded />}

            {open === 'roi' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px] whitespace-nowrap">
                  <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[9px]">
                    <tr>
                      <th className="p-2">Outlet</th>
                      <th className="p-2 text-right">Omset</th>
                      <th className="p-2 text-right">OPEX</th>
                      <th className="p-2 text-right">Net</th>
                      <th className="p-2 text-right">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roiRows.map((o) => (
                      <tr key={o.id} className="border-t border-slate-100">
                        <td className="p-2 font-bold">{o.name}</td>
                        <td className="p-2 text-right">{fmt(o.rev)}</td>
                        <td className="p-2 text-right text-rose-600">{fmt(o.exp)}</td>
                        <td className={`p-2 text-right font-black ${o.net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{fmt(o.net)}</td>
                        <td className="p-2 text-right">{o.margin.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
