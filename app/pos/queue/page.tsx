'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import OperatorQueueBoard from '@/components/pos/OperatorQueueBoard';
import { getStaffSession } from '@/lib/staffSession';

export default function PosQueuePage() {
  const [ready, setReady] = useState(false);
  const [outletId, setOutletId] = useState('');
  const [actorId, setActorId] = useState('');
  const [outlets, setOutlets] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    const raw = localStorage.getItem('laundry_user') || localStorage.getItem('laundry_owner_user');
    if (!raw) {
      window.location.href = '/login';
      return;
    }
    const session = getStaffSession();
    setActorId(session.id);
    setOutletId(session.outletId);
    setReady(true);
    import('@/lib/supabaseClient').then(({ supabase }) => {
      supabase
        .from('outlets')
        .select('id, name')
        .order('name')
        .then(({ data }) => setOutlets(data || []));
    });
  }, []);

  if (!ready) return <div className="min-h-screen bg-slate-50" />;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-4 md:p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-cyan-700">LG ThinQ</p>
            <h1 className="text-xl font-black">Antrian Operator</h1>
          </div>
          <div className="flex items-center gap-2">
            {outlets.length > 1 && (
              <select
                value={outletId}
                onChange={(e) => setOutletId(e.target.value)}
                className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold bg-white"
              >
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
            <Link href="/pos" className="text-[11px] font-bold px-3 py-2 rounded-xl border border-slate-200 bg-white">
              ← POS
            </Link>
            <Link href="/workspace" className="text-[11px] font-bold px-3 py-2 rounded-xl border border-slate-200 bg-white">
              Workspace
            </Link>
          </div>
        </div>
        <OperatorQueueBoard outletId={outletId} actorId={actorId} />
      </div>
    </div>
  );
}
