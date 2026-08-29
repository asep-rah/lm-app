'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { getStaffSession, canAccessSettings, homePathForRole, isOwnerRole } from '@/lib/staffSession';
import { isVoidTransaction } from '@/lib/voidTx';

const fmt = (n: number) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;

export default function TransaksiHistoryPage() {
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    const s = getStaffSession();
    const raw = localStorage.getItem('laundry_owner_user') || localStorage.getItem('laundry_user');
    if (!raw) {
      window.location.href = '/login';
      return;
    }
    const role = String(s.role || '').toLowerCase();
    if (isOwnerRole(role) || canAccessSettings(role)) {
      window.location.href = '/owner?tab=history';
      return;
    }
    if (!role) {
      window.location.href = homePathForRole(role);
      return;
    }

    const from = new Date();
    from.setDate(from.getDate() - 90);
    Promise.all([
      supabase.from('transactions').select('id, created_at, amount, receipt_number, customer_name, payment_method, status, outlet_id').gte('created_at', from.toISOString()).order('created_at', { ascending: false }).limit(200),
      supabase.from('expenses').select('id, created_at, amount, category, description, outlet_id').gte('created_at', from.toISOString()).order('created_at', { ascending: false }).limit(200),
      supabase.from('outlets').select('id, name')
    ]).then(([txRes, expRes, outRes]) => {
      const names = Object.fromEntries((outRes.data || []).map((o: any) => [o.id, o.name]));
      const txs = (txRes.data || [])
        .filter((t: any) => !isVoidTransaction(t))
        .map((t: any) => ({
          date: t.created_at,
          type: 'Income',
          title: t.receipt_number || t.customer_name || 'Transaksi',
          desc: `${t.payment_method || '-'} · ${t.status || ''}`,
          amount: Number(t.amount) || 0,
          outlet: names[t.outlet_id] || '—'
        }));
      const exps = (expRes.data || []).map((e: any) => ({
        date: e.created_at,
        type: 'Expense',
        title: e.category || 'Beban',
        desc: e.description || '',
        amount: -(Number(e.amount) || 0),
        outlet: names[e.outlet_id] || '—'
      }));
      setRows([...txs, ...exps].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
      setReady(true);
    });
  }, []);

  if (!ready) return <div className="min-h-screen bg-slate-50" />;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex justify-between items-center">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-sky-600">Ledger</p>
            <h1 className="text-2xl font-black">Transaksi</h1>
            <p className="text-xs text-slate-400">90 hari terakhir</p>
          </div>
          <Link href="/workspace" className="text-xs font-bold px-3 py-2 rounded-xl border border-slate-200">
            ← Workspace
          </Link>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="bg-slate-50 text-slate-500 font-bold">
                <tr>
                  <th className="p-3">Tanggal</th>
                  <th className="p-3">Outlet</th>
                  <th className="p-3">Judul</th>
                  <th className="p-3">Detail</th>
                  <th className="p-3 text-right">Nominal</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="p-3 font-mono text-slate-500">{new Date(r.date).toLocaleString('id-ID')}</td>
                    <td className="p-3">{r.outlet}</td>
                    <td className="p-3 font-bold">{r.title}</td>
                    <td className="p-3 text-slate-500">{r.desc}</td>
                    <td className={`p-3 text-right font-black ${r.type === 'Income' ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {r.amount > 0 ? '+' : ''}{fmt(r.amount)}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={5} className="p-8 text-center text-slate-400">Belum ada transaksi.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
