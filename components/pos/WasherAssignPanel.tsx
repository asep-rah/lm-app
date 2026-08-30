'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  BEDCOVER_DOUBLE_BADGE,
  OVER_LIMIT_BADGE,
  OP_LIMIT_LG15_KG,
  OP_LIMIT_LG24_KG,
  PARALLEL_WASH_NOTICE,
  assignmentBadge,
  balanceWasherAssignments,
  eligibleWashersForItem,
  ensureDefaultWashers,
  exceedsOpLimit,
  isBedcoverDouble,
  isLargeWasher,
  itemWeightKg,
  modeFromCapacity,
  needsWasherCycle,
  remainingLabel,
  splitPayloadKg,
  suggestBadge,
  washerCapKg,
  washerDisplayName,
  washerOptionLabel,
  workloadByWasherId,
  type CartMachineItem,
  type MachineMode,
  type WasherRow
} from '@/lib/lgThinq';

export default function WasherAssignPanel({
  items,
  onChangeItem,
  splitPerBag,
  onSplitChange,
  bagCount,
  outletId
}: {
  items: CartMachineItem[];
  onChangeItem: (
    index: number,
    patch: { machineMode?: MachineMode; washerId?: string | null; washerName?: string | null }
  ) => void;
  splitPerBag: boolean;
  onSplitChange: (next: boolean) => void;
  bagCount?: number | string;
  outletId?: string;
}) {
  const [washers, setWashers] = useState<WasherRow[]>([]);
  const [pendingCycles, setPendingCycles] = useState<any[]>([]);
  const touched = useRef<Set<number>>(new Set());
  const appliedKey = useRef('');

  const washRows = (items || [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => needsWasherCycle(item));

  useEffect(() => {
    if (!outletId) return;
    let alive = true;
    const load = async () => {
      const rows = (await ensureDefaultWashers(supabase as any, outletId)) as WasherRow[];
      if (!alive) return;
      setWashers(rows || []);
      const ids = (rows || []).map((w) => w.id);
      if (!ids.length) {
        setPendingCycles([]);
        return;
      }
      const { data } = await supabase
        .from('washer_cycle_logs')
        .select('id, washer_id, status, duration_minutes, split_weight_kg')
        .in('washer_id', ids)
        .in('status', ['PENDING', 'QUEUED', 'RUNNING']);
      if (alive) setPendingCycles(data || []);
    };
    load();
    const t = setInterval(load, 20000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [outletId]);

  const workloads = useMemo(() => workloadByWasherId(washers, pendingCycles), [washers, pendingCycles]);

  const reservedIds = useMemo(() => {
    const ids: string[] = [];
    washRows.forEach(({ item, index }) => {
      if (touched.current.has(index) && item.washerId) ids.push(String(item.washerId));
    });
    return ids;
  }, [washRows]);

  const plan = useMemo(
    () => balanceWasherAssignments(items || [], washers, reservedIds, workloads),
    [items, washers, reservedIds, workloads]
  );

  const planByIndex = useMemo(() => {
    const map = new Map<number, (typeof plan)[number]>();
    plan.forEach((p) => map.set(p.index, p));
    return map;
  }, [plan]);

  const parallelNotice = useMemo(() => {
    const assigned = plan.map((p) => p.washer).filter(Boolean) as WasherRow[];
    const ids = new Set(assigned.map((w) => w.id));
    const types = new Set(assigned.map((w) => washerCapKg(w)));
    return ids.size > 1 || types.size > 1 || plan.some((p) => p.loadBalanced || p.queueDiverted);
  }, [plan]);

  const anyOverLimit = washRows.some(({ item }) => exceedsOpLimit(itemWeightKg(item)));

  useEffect(() => {
    if (!washers.length || !washRows.length) return;
    const key =
      washRows.map(({ item, index }) => `${index}:${item.qty}:${item.name}:${item.weight || 0}`).join('|') +
      '|' +
      washers.map((w) => `${w.id}:${w.status}`).join(',') +
      '|' +
      plan.map((p) => `${p.index}:${p.washer?.id || ''}:${p.loadBalanced ? 1 : 0}:${p.queueDiverted ? 1 : 0}`).join(',');
    if (appliedKey.current === key) return;
    appliedKey.current = key;
    plan.forEach((p) => {
      const item = items[p.index];
      if (!item || !needsWasherCycle(item) || !p.washer) return;
      if (isBedcoverDouble(item) && !isLargeWasher(p.washer)) return;
      if (touched.current.has(p.index) && !(isBedcoverDouble(item) && !isLargeWasher(washers.find((w) => w.id === item.washerId)))) {
        return;
      }
      if (item.washerId === p.washer.id) return;
      onChangeItem(p.index, {
        machineMode: p.machineMode,
        washerId: p.washer.id,
        washerName: washerDisplayName(p.washer, washers)
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [washers, items, outletId, plan]);

  if (!washRows.length) return null;

  return (
    <div className="rounded-2xl border border-cyan-100 bg-cyan-50/70 p-3 space-y-2.5">
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-cyan-800">LG ThinQ · Assignment Mesin</p>
        <p className="text-[10px] text-cyan-900/80">
          Batas operasional: LG 15kg maks {OP_LIMIT_LG15_KG}kg · LG 24kg maks {OP_LIMIT_LG24_KG}kg. Setrika / dry clean tidak tampil.
        </p>
      </div>
      {parallelNotice && (
        <div className="rounded-xl bg-violet-50 border border-violet-200 px-2.5 py-2 text-[11px] font-black text-violet-900 leading-snug">
          {PARALLEL_WASH_NOTICE}
        </div>
      )}
      {anyOverLimit && (
        <div className="rounded-xl bg-amber-50 border border-amber-300 px-2.5 py-2 space-y-1.5">
          <p className="text-[11px] font-black text-amber-900">{OVER_LIMIT_BADGE}</p>
          <button
            type="button"
            onClick={() => onSplitChange(true)}
            className="text-[10px] font-black text-amber-800 underline"
          >
            Terapkan bagi kloter otomatis
          </button>
        </div>
      )}
      {washers.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {washers.map((w) => {
            const idle = String(w.status || 'IDLE').toUpperCase() === 'IDLE';
            const load = Math.round(workloads.get(String(w.id)) || 0);
            return (
              <span
                key={w.id}
                className={`text-[9px] font-black px-2 py-0.5 rounded-full border ${
                  idle ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-amber-50 text-amber-800 border-amber-200'
                }`}
              >
                {washerDisplayName(w, washers)} · {idle ? 'IDLE' : remainingLabel(w)}
                {load > 0 ? ` · antri ${load}m` : ''}
              </span>
            );
          })}
        </div>
      )}
      <label className="flex items-start gap-2 text-[11px] font-bold text-slate-800">
        <input
          type="checkbox"
          checked={splitPerBag}
          onChange={(e) => onSplitChange(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          Pisahkan Pengerjaan Per Kantong (Request Customer)
          <span className="block font-normal text-slate-500">
            Jangan gabung kiloan ke 1 siklus. {bagCount ? `${bagCount} kantong fisik.` : ''}
          </span>
        </span>
      </label>
      <div className="space-y-1.5">
        {washRows.map(({ item, index }, row) => {
          const weight = itemWeightKg(item);
          const over = exceedsOpLimit(weight);
          const hard24 = isBedcoverDouble(item);
          const assign = planByIndex.get(index);
          const options = eligibleWashersForItem(item, washers);
          const rowWasher = assign?.washer || options.find((w) => w.id === item.washerId) || null;
          const loadBalanced = Boolean(assign?.loadBalanced);
          const queueDiverted = Boolean(assign?.queueDiverted);
          const parts = splitPayloadKg(weight, item);
          const selectedId = item.washerId && options.some((w) => w.id === item.washerId) ? item.washerId : '';
          return (
            <div
              key={item.id || item.cart_item_id || item.service_name || item.name || index}
              className="bg-white border border-cyan-100 rounded-xl px-2.5 py-2"
            >
              <p className="text-[11px] font-bold text-slate-800 leading-snug">{assignmentBadge(item, row + 1)}</p>
              {hard24 && (
                <p className="mt-1 text-[10px] font-black text-indigo-800">{BEDCOVER_DOUBLE_BADGE}</p>
              )}
              {rowWasher && (
                <p className="mt-1 text-[10px] font-black text-emerald-800">
                  {suggestBadge(rowWasher, washers, { loadBalanced, queueDiverted })}
                </p>
              )}
              {over && (
                <p className="mt-1 text-[10px] font-black text-amber-800">
                  {OVER_LIMIT_BADGE}
                  {parts.length > 1
                    ? ` → ${parts.map((p, i) => `Kloter ${i + 1}: ${p.qty}kg ${p.machineMode === 'LG_24' ? 'LG 24kg' : 'LG 15kg'}`).join(' + ')}`
                    : ''}
                </p>
              )}
              <select
                value={selectedId}
                onChange={(e) => {
                  if (!hard24) touched.current.add(index);
                  const w = options.find((x) => x.id === e.target.value);
                  if (!w) {
                    onChangeItem(index, {
                      machineMode: hard24 ? 'LG_24' : assign?.machineMode,
                      washerId: null,
                      washerName: null
                    });
                    return;
                  }
                  if (hard24 && !isLargeWasher(w)) return;
                  onChangeItem(index, {
                    machineMode: modeFromCapacity(w.capacity_kg),
                    washerId: w.id,
                    washerName: washerDisplayName(w, washers)
                  });
                }}
                className="mt-1.5 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] font-bold bg-slate-50"
              >
                {!selectedId && <option value="">Pilih mesin…</option>}
                {options.map((w) => (
                  <option key={w.id} value={w.id}>
                    {washerOptionLabel(w, washers, {
                      recommended: rowWasher?.id === w.id && !loadBalanced && !queueDiverted,
                      loadBalanced: rowWasher?.id === w.id && loadBalanced,
                      queueDiverted: rowWasher?.id === w.id && queueDiverted
                    })}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
