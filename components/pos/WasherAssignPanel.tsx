'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  OVER_LIMIT_BADGE,
  OP_LIMIT_LG15_KG,
  OP_LIMIT_LG24_KG,
  assignmentBadge,
  ensureDefaultWashers,
  exceedsOpLimit,
  itemWeightKg,
  modeFromCapacity,
  needsWasherCycle,
  recommendModeForWeight,
  remainingLabel,
  splitPayloadKg,
  suggestBadge,
  suggestWasher,
  washerDisplayName,
  washerOptionLabel,
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
  const touched = useRef<Set<number>>(new Set());
  const appliedKey = useRef('');

  const washRows = (items || [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => needsWasherCycle(item));

  useEffect(() => {
    if (!outletId) return;
    let alive = true;
    const load = () =>
      ensureDefaultWashers(supabase as any, outletId).then((rows) => {
        if (alive) setWashers((rows || []) as WasherRow[]);
      });
    load();
    const t = setInterval(load, 20000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [outletId]);

  const anyOverLimit = washRows.some(({ item }) => exceedsOpLimit(itemWeightKg(item)));

  useEffect(() => {
    if (!washers.length || !washRows.length) return;
    const key =
      washRows.map(({ item, index }) => `${index}:${item.qty}:${item.name}:${item.weight || 0}`).join('|') +
      '|' +
      washers.map((w) => `${w.id}:${w.status}:${w.last_started_at || ''}`).join(',');
    if (appliedKey.current === key) return;
    appliedKey.current = key;
    washRows.forEach(({ item, index }) => {
      if (touched.current.has(index)) return;
      const w = itemWeightKg(item);
      const sug = suggestWasher(w, washers, recommendModeForWeight(w, item));
      if (!sug) return;
      if (item.washerId === sug.id) return;
      onChangeItem(index, {
        machineMode: modeFromCapacity(sug.capacity_kg),
        washerId: sug.id,
        washerName: washerDisplayName(sug, washers)
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [washers, items, outletId]);

  if (!washRows.length) return null;

  return (
    <div className="rounded-2xl border border-cyan-100 bg-cyan-50/70 p-3 space-y-2.5">
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-cyan-800">LG ThinQ · Assignment Mesin</p>
        <p className="text-[10px] text-cyan-900/80">
          Batas operasional: LG 15kg maks {OP_LIMIT_LG15_KG}kg · LG 24kg maks {OP_LIMIT_LG24_KG}kg. Setrika / dry clean tidak tampil.
        </p>
      </div>
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
            return (
              <span
                key={w.id}
                className={`text-[9px] font-black px-2 py-0.5 rounded-full border ${
                  idle ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-amber-50 text-amber-800 border-amber-200'
                }`}
              >
                {washerDisplayName(w, washers)} · {idle ? 'IDLE' : remainingLabel(w)}
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
          const prefer = recommendModeForWeight(weight, item);
          const rowSug = suggestWasher(weight, washers, prefer);
          const parts = splitPayloadKg(weight, item);
          const selectedId = item.washerId || '';
          return (
            <div
              key={item.id || item.cart_item_id || item.service_name || item.name || index}
              className="bg-white border border-cyan-100 rounded-xl px-2.5 py-2"
            >
              <p className="text-[11px] font-bold text-slate-800 leading-snug">{assignmentBadge(item, row + 1)}</p>
              {rowSug && (
                <p className="mt-1 text-[10px] font-black text-emerald-800">{suggestBadge(rowSug, washers)}</p>
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
                  touched.current.add(index);
                  const w = washers.find((x) => x.id === e.target.value);
                  if (!w) {
                    onChangeItem(index, {
                      machineMode: prefer,
                      washerId: null,
                      washerName: null
                    });
                    return;
                  }
                  onChangeItem(index, {
                    machineMode: modeFromCapacity(w.capacity_kg),
                    washerId: w.id,
                    washerName: washerDisplayName(w, washers)
                  });
                }}
                className="mt-1.5 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] font-bold bg-slate-50"
              >
                {!selectedId && <option value="">Pilih mesin…</option>}
                {washers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {washerOptionLabel(w, washers, { recommended: rowSug?.id === w.id })}
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
