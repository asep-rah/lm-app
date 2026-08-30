'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  assignmentBadge,
  ensureDefaultWashers,
  inferMachineMode,
  itemWeightKg,
  modeFromCapacity,
  needsWasherCycle,
  remainingLabel,
  suggestBadge,
  suggestWasher,
  washerDisplayName,
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

  const suggestion = useMemo(() => {
    const weight = washRows.reduce((s, { item }) => s + itemWeightKg(item), 0);
    const prefer = washRows[0] ? inferMachineMode(washRows[0].item) : null;
    return suggestWasher(weight || itemWeightKg(washRows[0]?.item || {}), washers, prefer);
  }, [washers, washRows]);

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
      const sug = suggestWasher(itemWeightKg(item), washers, inferMachineMode(item));
      if (!sug) return;
      if (item.washerId === sug.id) return;
      onChangeItem(index, {
        machineMode: modeFromCapacity(sug.capacity_kg),
        washerId: sug.id,
        washerName: washerDisplayName(sug, washers)
      });
    });
    // onChangeItem from POS is inline; appliedKey prevents a suggest loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [washers, items, outletId]);

  if (!washRows.length) return null;

  return (
    <div className="rounded-2xl border border-cyan-100 bg-cyan-50/70 p-3 space-y-2.5">
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-cyan-800">LG ThinQ · Assignment Mesin</p>
        <p className="text-[10px] text-cyan-900/80">Hanya item cuci mesin. Setrika / dry clean manual tidak ditampilkan.</p>
      </div>
      <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-2.5 py-2 text-[11px] font-black text-emerald-800">
        {suggestBadge(suggestion, washers)}
      </div>
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
          const selectedId = item.washerId || '';
          return (
            <div
              key={item.id || item.cart_item_id || item.service_name || item.name || index}
              className="bg-white border border-cyan-100 rounded-xl px-2.5 py-2"
            >
              <p className="text-[11px] font-bold text-slate-800 leading-snug">{assignmentBadge(item, row + 1)}</p>
              <select
                value={selectedId}
                onChange={(e) => {
                  touched.current.add(index);
                  const w = washers.find((x) => x.id === e.target.value);
                  if (!w) {
                    onChangeItem(index, {
                      machineMode: e.target.value === 'LG_24' ? 'LG_24' : 'LG_15',
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
                    {washerDisplayName(w, washers)} · {remainingLabel(w)}
                    {suggestion?.id === w.id ? ' · Rekomendasi' : ''}
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
