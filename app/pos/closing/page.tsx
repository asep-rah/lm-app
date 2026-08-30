'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import CashDepositQrisPanel from '@/components/CashDepositQrisPanel';

export default function PosClosingPage() {
  const [ready, setReady] = useState(false);
  const [outletId, setOutletId] = useState('');
  const [outlets, setOutlets] = useState<Array<{ id: string; name: string }>>([]);
  const [kasirId, setKasirId] = useState('');
  const [kasirName, setKasirName] = useState('Kasir');
  const [physical, setPhysical] = useState('');
  const [adminFee, setAdminFee] = useState('0');

  useEffect(() => {
    const raw = localStorage.getItem('laundry_user') || localStorage.getItem('laundry_owner_user');
    if (!raw) {
      window.location.href = '/login';
      return;
    }
    const user = JSON.parse(raw);
    const role = String(user.role || '').toLowerCase();
    if (!['kasir', 'pos', 'owner', 'supervisor'].includes(role)) {
      window.location.href = '/login';
      return;
    }
    setKasirId(String(user.id || user.username || ''));
    setKasirName(String(user.name || user.username || 'Kasir'));
    const stored = localStorage.getItem('user_outlet_id') || user.outlet_id || '';
    setOutletId(String(stored || ''));
    setReady(true);
    supabase
      .from('outlets')
      .select('id, name')
      .order('name')
      .then(({ data }) => setOutlets(data || []));
  }, []);

  if (!ready) return <div className="p-6 text-sm text-slate-500">Memuat…</div>;

  const cash = Number(physical) || 0;
  const fee = Number(adminFee) || 0;

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="max-w-md mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">POS · Closing</p>
            <h1 className="text-lg font-black text-slate-900">Setoran Tunai QRIS Mayar</h1>
            <p className="text-xs text-slate-500">{kasirName}</p>
          </div>
          <Link href="/pos" className="text-[11px] font-bold text-slate-600 border border-slate-200 bg-white px-3 py-2 rounded-xl">
            ← POS
          </Link>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 shadow-sm">
          <div>
            <label className="text-[10px] font-bold text-slate-600 block mb-1">Outlet</label>
            <select
              value={outletId}
              onChange={(e) => setOutletId(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold bg-slate-50"
            >
              <option value="">Pilih outlet</option>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-600 block mb-1">Uang tunai fisik (Rp)</label>
            <input
              type="number"
              value={physical}
              onChange={(e) => setPhysical(e.target.value)}
              placeholder="450000"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-black bg-slate-50"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-600 block mb-1">Biaya admin (Rp)</label>
            <input
              type="number"
              value={adminFee}
              onChange={(e) => setAdminFee(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold bg-slate-50"
            />
            <p className="text-[10px] text-slate-400 mt-1">Otomatis jadi OPEX setelah QRIS lunas: Biaya Admin Setoran Cash (OPEX).</p>
          </div>

          <CashDepositQrisPanel
            outletId={outletId}
            kasirId={kasirId}
            physicalCash={cash}
            adminFee={fee}
          />
        </div>
      </div>
    </div>
  );
}
