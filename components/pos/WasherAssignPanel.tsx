'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  OP_LIMIT_LG15_KG,
  SLOT_SPLIT_BANNER,
  applyCycleSlot,
  balanceWasherAssignments,
  expandWashSlots,
  fetchActiveOutletWashers,
  isBedcoverDouble,
  isBedcoverItem,
  isLargeWasher,
  isWasherDisabledForItem,
  itemWeightKg,
  modeFromCapacity,
  needsWasherCycle,
  washSlotTitle,
  washerCompactOptionLabel,
  washerDisplayName,
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

  const showSplitBanner = useMemo(
    () =>
      (items || []).some((it) => {
        if (!needsWasherCycle(it)) return false;
        return isBedcoverItem(it) || itemWeightKg(it) > OP_LIMIT_LG15_KG;
      }) || washSlots.some((s) => s.slotTotal > 1),
    [items, washSlots]
  );

  useEffect(() => {
    if (!outletId) return;
    let alive = true;
    const load = async () => {
      const rows = (await fetchActiveOutletWashers(supabase as any, outletId)) as WasherRow[];
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
        next = {
          ...next,
          ...applyCycleSlot(next, s.slotIndex, {
            machineMode: p.machineMode,
            washerId: p.washer.id,
            washerName: washerDisplayName(p.washer, washers)
          })
        };
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
    <div className="rounded-xl border border-slate-200 bg-white p-2.5 space-y-1.5">
      {showSplitBanner && (
        <p className="text-[10px] font-semibold text-slate-600 leading-tight truncate">
          {SLOT_SPLIT_BANNER}
        </p>
      )}
      {washers.length === 0 && (
        <p className="text-[10px] font-semibold text-amber-700 leading-tight">
          Belum ada mesin aktif. Owner: Pengaturan → Manajemen Mesin Cuci.
        </p>
      )}
      <label className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500">
        <input
          type="checkbox"
          checked={splitPerBag}
          onChange={(e) => onSplitChange(e.target.checked)}
          className="shrink-0"
        />
        <span className="truncate">
          Pisah per kantong{bagCount ? ` · ${bagCount} kantong` : ''}
        </span>
      </label>
      <div className="space-y-1">
        {washSlots.map((slot) => {
          const { item, sourceIndex, slotIndex } = slot;
          const source = items[sourceIndex] || item;
          const hard24 = isBedcoverDouble(source);
          const assign = planBySlot.get(`${sourceIndex}:${slotIndex}`);
          const selectedId = item.washerId && washers.some((w) => w.id === item.washerId) ? String(item.washerId) : '';
          return (
            <div
              key={`${source.id || source.cart_item_id || source.name || sourceIndex}:${slotIndex}`}
              className="rounded-lg border border-slate-100 bg-slate-50/80 px-2 py-1.5"
            >
              <p className="text-[11px] font-bold text-slate-800 leading-tight truncate">
                {washSlotTitle(slot)}
              </p>
              <select
                value={selectedId}
                onChange={(e) => {
                  if (!hard24) touched.current.add(`${sourceIndex}:${slotIndex}`);
                  const w = washers.find((x) => x.id === e.target.value);
                  if (w && isWasherDisabledForItem(source, w)) return;
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
                  onChangeItem(sourceIndex, applyCycleSlot(source, slotIndex, patch));
                }}
                className="mt-1 w-full border border-slate-200 rounded-md px-2 py-1 text-[11px] font-semibold bg-white text-slate-800"
              >
                {!selectedId && <option value="">Pilih mesin…</option>}
                {washers.map((w) => {
                  const disabled = isWasherDisabledForItem(source, w) && w.id !== selectedId;
                  const shorterQueue = Boolean(assign?.shorterQueue && assign?.washer?.id === w.id);
                  return (
                    <option key={w.id} value={w.id} disabled={disabled}>
                      {washerCompactOptionLabel(w, washers, { disabled, shorterQueue })}
                    </option>
                  );
                })}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
