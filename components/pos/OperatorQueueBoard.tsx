'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  ensureDefaultWashers,
  isWasherIdle,
  progressPct,
  remainingLabel,
  remainingMs,
  startVerifiedWasherCycle,
  washerDisplayName,
  type WasherRow
} from '@/lib/lgThinq';
import MachineLoadVerifyModal, { type LoadVerifyTarget } from '@/components/pos/MachineLoadVerifyModal';
import { toast } from '@/lib/toast';

type CycleRow = {
  id: string;
  washer_id?: string | null;
  order_id?: string | null;
  status?: string;
  bag_label?: string | null;
  batch_index?: number;
  machine_tag?: string | null;
  cycle_type?: string;
  created_at?: string;
};

type TxMini = {
  id: string;
  receipt_number?: string;
  customer_name?: string;
  status?: string;
};

export default function OperatorQueueBoard({
  outletId,
  actorId,
  compact
}: {
  outletId?: string;
  actorId?: string;
  compact?: boolean;
}) {
  const [washers, setWashers] = useState<WasherRow[]>([]);
  const [cycles, setCycles] = useState<CycleRow[]>([]);
  const [txs, setTxs] = useState<Record<string, TxMini>>({});
  const [now, setNow] = useState(Date.now());
  const [verify, setVerify] = useState<LoadVerifyTarget | null>(null);

  const load = useCallback(async () => {
    if (!outletId) return;
    const rows = (await ensureDefaultWashers(supabase as any, outletId)) as WasherRow[];
    setWashers(rows || []);
    const ids = (rows || []).map((w) => w.id);
    const { data: cycleRows } = await supabase
      .from('washer_cycle_logs')
      .select('id, washer_id, order_id, status, bag_label, batch_index, machine_tag, cycle_type, created_at')
      .in('status', ['PENDING', 'QUEUED', 'RUNNING'])
      .order('created_at', { ascending: true })
      .limit(80);
    const scoped = (cycleRows || []).filter(
      (c: CycleRow) => !c.washer_id || ids.includes(String(c.washer_id))
    ) as CycleRow[];
    setCycles(scoped);
    const orderIds = [...new Set(scoped.map((c) => c.order_id).filter(Boolean))] as string[];
    if (orderIds.length) {
      const { data: txRows } = await supabase
        .from('transactions')
        .select('id, receipt_number, customer_name, status')
        .in('id', orderIds);
      const map: Record<string, TxMini> = {};
      (txRows || []).forEach((t: TxMini) => {
        map[t.id] = t;
      });
      setTxs(map);
    } else {
      setTxs({});
    }
  }, [outletId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!outletId) return;
    const ch = supabase
      .channel(`operator-queue-${outletId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'washers' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'washer_cycle_logs' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [outletId, load]);

  const byWasher = useMemo(() => {
    const map = new Map<string, CycleRow[]>();
    cycles.forEach((c) => {
      const key = String(c.washer_id || 'unassigned');
      map.set(key, [...(map.get(key) || []), c]);
    });
    return map;
  }, [cycles]);

  if (!outletId) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-500 font-semibold">
        Pilih outlet untuk menampilkan antrian mesin.
      </div>
    );
  }

  const openLoad = (washer: WasherRow, cycle: CycleRow) => {
    const tx = cycle.order_id ? txs[cycle.order_id] : undefined;
    setVerify({
      washerId: washer.id,
      washerName: washerDisplayName(washer, washers),
      orderId: cycle.order_id,
      receipt: tx?.receipt_number,
      cycleId: cycle.id,
      bagLabel: cycle.bag_label
    });
  };

  return (
    <div className={compact ? 'space-y-3' : 'space-y-5'}>
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-cyan-700">Operator Queue</p>
          <h2 className={`font-black text-slate-900 ${compact ? 'text-base' : 'text-xl'}`}>Papan Antrian Mesin</h2>
        </div>
        <button type="button" onClick={load} className="text-[10px] font-bold text-cyan-700 hover:underline">
          Refresh
        </button>
      </div>

      <section>
        <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-2">Mesin aktif</h3>
        <div className={`grid gap-3 ${compact ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 md:grid-cols-2'}`}>
          {washers.map((w) => {
            const running = (byWasher.get(w.id) || []).find((c) => String(c.status).toUpperCase() === 'RUNNING');
            const tx = running?.order_id ? txs[running.order_id] : undefined;
            const pct = progressPct(w, now);
            const idle = isWasherIdle(w);
            return (
              <div
                key={w.id}
                className={`rounded-2xl border p-3 ${idle ? 'bg-white border-slate-200' : 'bg-cyan-50 border-cyan-200'}`}
              >
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <p className="text-sm font-black text-slate-900">{washerDisplayName(w, washers)}</p>
                    <p className="text-[10px] font-bold text-slate-500">{w.machine_name || `LG ${Number(w.capacity_kg) || 15}kg`}</p>
                  </div>
                  <span
                    className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                      idle ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {idle ? 'IDLE' : remainingLabel(w, now)}
                  </span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${idle ? 'bg-slate-200' : 'bg-cyan-500'}`}
                    style={{ width: `${idle ? 0 : pct}%` }}
                  />
                </div>
                <p className="text-[10px] font-semibold text-slate-600 mt-1.5">
                  {running
                    ? `${tx?.receipt_number || 'Order'} · ${running.bag_label || 'Siklus cuci'} · ${Math.ceil(remainingMs(w, now) / 60000) || 0} mnt`
                    : 'Tidak ada siklus berjalan'}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-2">Next Up · Siap dimuat</h3>
        <div className="space-y-3">
          {(byWasher.get('unassigned') || []).filter((c) =>
            ['PENDING', 'QUEUED'].includes(String(c.status || '').toUpperCase())
          ).length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 mb-3">
              <p className="text-[11px] font-black text-amber-900 mb-2">Belum terikat mesin</p>
              <div className="flex flex-wrap gap-2">
                {(byWasher.get('unassigned') || [])
                  .filter((c) => ['PENDING', 'QUEUED'].includes(String(c.status || '').toUpperCase()))
                  .map((c) => {
                    const tx = c.order_id ? txs[c.order_id] : undefined;
                    const fallback = washers[0];
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => fallback && openLoad(fallback, c)}
                        className="text-left rounded-xl border border-amber-300 bg-white px-3 py-2 min-w-[140px]"
                      >
                        <p className="text-[10px] font-black text-amber-900">{c.bag_label || `Kantong ${c.batch_index || 1}`}</p>
                        <p className="text-[10px] font-bold text-slate-700">{tx?.receipt_number || 'Tanpa resi'}</p>
                        <p className="text-[9px] font-black text-cyan-700 mt-1">Scan & Muat →</p>
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
          {washers.map((w) => {
            const waiting = (byWasher.get(w.id) || []).filter((c) =>
              ['PENDING', 'QUEUED'].includes(String(c.status || '').toUpperCase())
            );
            return (
              <div key={`q-${w.id}`} className="rounded-2xl border border-slate-200 bg-white p-3">
                <p className="text-[11px] font-black text-slate-800 mb-2">{washerDisplayName(w, washers)}</p>
                {waiting.length ? (
                  <div className="flex flex-wrap gap-2">
                    {waiting.map((c) => {
                      const tx = c.order_id ? txs[c.order_id] : undefined;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => openLoad(w, c)}
                          className="text-left rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 min-w-[140px] hover:border-amber-400"
                        >
                          <p className="text-[10px] font-black text-amber-900">{c.bag_label || `Kantong ${c.batch_index || 1}`}</p>
                          <p className="text-[10px] font-bold text-slate-700">{tx?.receipt_number || 'Tanpa resi'}</p>
                          <p className="text-[9px] text-slate-500">{tx?.customer_name || 'Pelanggan'}</p>
                          <p className="text-[9px] font-black text-cyan-700 mt-1">Scan & Muat →</p>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400 font-semibold">Tidak ada kantong menunggu.</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <MachineLoadVerifyModal
        open={Boolean(verify)}
        target={verify}
        onCancel={() => setVerify(null)}
        onVerified={async (t) => {
          await startVerifiedWasherCycle({
            db: supabase as any,
            cycleId: t.cycleId,
            washerId: t.washerId,
            orderId: t.orderId,
            startedBy: actorId
          });
          setVerify(null);
          toast('Mesin diverifikasi. Siklus cuci dimulai.', 'ok');
          load();
        }}
      />
    </div>
  );
}
