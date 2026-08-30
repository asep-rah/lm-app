'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  BEDCOVER_DOUBLE_BADGE,
  BEDCOVER_ONE_PCS_BADGE,
  OVER_LIMIT_BADGE,
  OP_LIMIT_LG15_KG,
  OP_LIMIT_LG24_KG,
  PARALLEL_WASH_NOTICE,
  applyCycleSlot,
  assignmentBadge,
  balanceWasherAssignments,
  eligibleWashersForItem,
  ensureDefaultWashers,
  exceedsOpLimit,
  expandWashSlots,
  isBedcoverDouble,
  isBedcoverItem,
  isBedcoverSingle,
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
    patch: {
      machineMode?: MachineMode | null;
      washerId?: string | null;
      washerName?: string | null;
      cycleSlots?: CartMachineItem['cycleSlots'];
    }
  ) => void;
  splitPerBag: boolean;
  onSplitChange: (next: boolean) => void;
  bagCount?: number | string;
  outletId?: string;
}) {
  const [washers, setWashers] = useState<WasherRow[]>([]);
  const [pendingCycles, setPendingCycles] = useState<any[]>([]);
  const touched = useRef<Set<string>>(new Set());
  const appliedKey = useRef('');

  const washSlots = useMemo(() => expandWashSlots(items || []), [items]);
  const hasBedcover = (items || []).some((it) => needsWasherCycle(it) && isBedcoverItem(it));

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
    washSlots.forEach((s) => {
      if (touched.current.has(`${s.sourceIndex}:${s.slotIndex}`) && s.item.washerId) {
        ids.push(String(s.item.washerId));
      }
    });
    return ids;
  }, [washSlots]);

  const plan = useMemo(
    () => balanceWasherAssignments(items || [], washers, reservedIds, workloads),
    [items, washers, reservedIds, workloads]
  );

  const planBySlot = useMemo(() => {
    const map = new Map<string, (typeof plan)[number]>();
    plan.forEach((p) => map.set(`${p.index}:${p.slotIndex ?? 0}`, p));
    return map;
  }, [plan]);

  const parallelNotice = useMemo(() => {
    const assigned = plan.map((p) => p.washer).filter(Boolean) as WasherRow[];
    const ids = new Set(assigned.map((w) => w.id));
    const types = new Set(assigned.map((w) => washerCapKg(w)));
    return ids.size > 1 || types.size > 1 || plan.some((p) => p.loadBalanced || p.queueDiverted);
  }, [plan]);

  const anyOverLimit = (items || []).some((item) => needsWasherCycle(item) && exceedsOpLimit(itemWeightKg(item)));

  useEffect(() => {
    if (!washers.length || !washSlots.length) return;
    const key =
      washSlots
        .map((s) => {
          const src = items[s.sourceIndex];
          return `${s.sourceIndex}:${s.slotIndex}:${src?.qty}:${src?.pcs}:${src?.name}`;
        })
        .join('|') +
      '|' +
      washers.map((w) => `${w.id}:${w.status}`).join(',') +
      '|' +
      plan.map((p) => `${p.index}:${p.slotIndex}:${p.washer?.id || ''}:${p.loadBalanced ? 1 : 0}:${p.queueDiverted ? 1 : 0}`).join(',');
    if (appliedKey.current === key) return;
    appliedKey.current = key;

    const bySource = new Map<number, typeof washSlots>();
    washSlots.forEach((s) => {
      const arr = bySource.get(s.sourceIndex) || [];
      arr.push(s);
      bySource.set(s.sourceIndex, arr);
    });

    bySource.forEach((slots, sourceIndex) => {
      const source = items[sourceIndex];
      if (!source || !needsWasherCycle(source)) return;
      let next = source;
      let changed = false;
      slots.forEach((s) => {
        const p = planBySlot.get(`${s.sourceIndex}:${s.slotIndex}`);
        if (!p?.washer) return;
        if (isBedcoverDouble(source) && !isLargeWasher(p.washer)) return;
        const touchKey = `${s.sourceIndex}:${s.slotIndex}`;
        const currentWasher = washers.find((w) => w.id === s.item.washerId);
        if (
          touched.current.has(touchKey) &&
          !(isBedcoverDouble(source) && currentWasher && !isLargeWasher(currentWasher))
        ) {
          return;
        }
        if (s.item.washerId === p.washer.id && source.cycleSlots?.[s.slotIndex]?.washerId === p.washer.id) return;
        next = { ...next, ...applyCycleSlot(next, s.slotIndex, {
          machineMode: p.machineMode,
          washerId: p.washer.id,
          washerName: washerDisplayName(p.washer, washers)
        }) };
        changed = true;
      });
      if (!changed) return;
      onChangeItem(sourceIndex, {
        machineMode: next.machineMode,
        washerId: next.washerId,
        washerName: next.washerName,
        cycleSlots: next.cycleSlots
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [washers, items, outletId, plan, washSlots]);

  if (!washSlots.length) return null;

  return (
    <div className="rounded-2xl border border-cyan-100 bg-cyan-50/70 p-3 space-y-2.5">
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-cyan-800">LG ThinQ · Assignment Mesin</p>
        <p className="text-[10px] text-cyan-900/80">
          Batas operasional: LG 15kg maks {OP_LIMIT_LG15_KG}kg · LG 24kg maks {OP_LIMIT_LG24_KG}kg. Setrika / dry clean tidak tampil.
        </p>
      </div>
      {hasBedcover && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 px-2.5 py-2 text-[11px] font-black text-rose-900 leading-snug">
          {BEDCOVER_ONE_PCS_BADGE}
        </div>
      )}
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
        {washSlots.map((slot, row) => {
          const { item, sourceIndex, slotIndex } = slot;
          const source = items[sourceIndex] || item;
          const over = exceedsOpLimit(itemWeightKg(source));
          const hard24 = isBedcoverDouble(source);
          const onePiece = isBedcoverItem(source);
          const assign = planBySlot.get(`${sourceIndex}:${slotIndex}`);
          const options = eligibleWashersForItem(source, washers);
          const rowWasher = assign?.washer || options.find((w) => w.id === item.washerId) || null;
          const loadBalanced = Boolean(assign?.loadBalanced);
          const queueDiverted = Boolean(assign?.queueDiverted);
          const parts = splitPayloadKg(itemWeightKg(source), source);
          const selectedId = item.washerId && options.some((w) => w.id === item.washerId) ? item.washerId : '';
          return (
            <div
              key={`${source.id || source.cart_item_id || source.name || sourceIndex}:${slotIndex}`}
              className="bg-white border border-cyan-100 rounded-xl px-2.5 py-2"
            >
              <p className="text-[11px] font-bold text-slate-800 leading-snug">{assignmentBadge(item, row + 1)}</p>
              {onePiece && (
                <p className="mt-1 text-[10px] font-black text-rose-800">{BEDCOVER_ONE_PCS_BADGE}</p>
              )}
              {hard24 && (
                <p className="mt-1 text-[10px] font-black text-indigo-800">{BEDCOVER_DOUBLE_BADGE}</p>
              )}
              {rowWasher && (
                <p className="mt-1 text-[10px] font-black text-emerald-800">
                  {suggestBadge(rowWasher, washers, {
                    loadBalanced,
                    queueDiverted,
                    onePieceCycle: onePiece && !loadBalanced && !queueDiverted
                  })}
                </p>
              )}
              {over && slotIndex === 0 && (
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
                  if (!hard24) touched.current.add(`${sourceIndex}:${slotIndex}`);
                  const w = options.find((x) => x.id === e.target.value);
                  const patch = w
                    ? {
                        machineMode: hard24 ? ('LG_24' as MachineMode) : modeFromCapacity(w.capacity_kg),
                        washerId: w.id,
                        washerName: washerDisplayName(w, washers)
                      }
                    : {
                        machineMode: hard24 ? ('LG_24' as MachineMode) : assign?.machineMode,
                        washerId: null,
                        washerName: null
                      };
                  if (w && hard24 && !isLargeWasher(w)) return;
                  onChangeItem(sourceIndex, applyCycleSlot(source, slotIndex, patch));
                }}
                className="mt-1.5 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] font-bold bg-slate-50"
              >
                {!selectedId && <option value="">Pilih mesin…</option>}
                {options.map((w) => (
                  <option key={w.id} value={w.id}>
                    {washerOptionLabel(w, washers, {
                      recommended: rowWasher?.id === w.id && !loadBalanced && !queueDiverted,
                      loadBalanced: rowWasher?.id === w.id && loadBalanced,
                      queueDiverted: rowWasher?.id === w.id && queueDiverted,
                      onePieceCycle: onePiece && isBedcoverSingle(source) && washerCapKg(w) === 15
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
