'use client';

import {
  MACHINE_OPTIONS,
  assignmentBadge,
  needsWasherCycle,
  type CartMachineItem,
  type MachineMode
} from '@/lib/lgThinq';

export default function WasherAssignPanel({
  items,
  onChangeItem,
  splitPerBag,
  onSplitChange,
  bagCount
}: {
  items: CartMachineItem[];
  onChangeItem: (index: number, mode: MachineMode) => void;
  splitPerBag: boolean;
  onSplitChange: (next: boolean) => void;
  bagCount?: number | string;
}) {
  const washRows = (items || [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => needsWasherCycle(item));

  if (!washRows.length) return null;

  return (
    <div className="rounded-2xl border border-cyan-100 bg-cyan-50/70 p-3 space-y-2.5">
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-cyan-800">LG ThinQ · Assignment Mesin</p>
        <p className="text-[10px] text-cyan-900/80">Hanya item cuci mesin. Setrika / dry clean manual tidak ditampilkan.</p>
      </div>
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
        {washRows.map(({ item, index }, row) => (
          <div
            key={item.id || item.cart_item_id || item.service_name || item.name || index}
            className="bg-white border border-cyan-100 rounded-xl px-2.5 py-2"
          >
            <p className="text-[11px] font-bold text-slate-800 leading-snug">{assignmentBadge(item, row + 1)}</p>
            <select
              value={item.machineMode === 'LG_24' || item.machineMode === 'LG_15' ? item.machineMode : 'LG_15'}
              onChange={(e) => onChangeItem(index, e.target.value as MachineMode)}
              className="mt-1.5 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] font-bold bg-slate-50"
            >
              {MACHINE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
