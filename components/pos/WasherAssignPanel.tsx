'use client';

import { MACHINE_OPTIONS, type MachineMode } from '@/lib/lgThinq';

type Item = { id?: string; name?: string; machineMode?: MachineMode };

export default function WasherAssignPanel({
  items,
  onChangeItem,
  splitPerBag,
  onSplitChange,
  bagCount
}: {
  items: Item[];
  onChangeItem: (index: number, mode: MachineMode) => void;
  splitPerBag: boolean;
  onSplitChange: (next: boolean) => void;
  bagCount?: number | string;
}) {
  return (
    <div className="rounded-2xl border border-cyan-100 bg-cyan-50/70 p-3 space-y-2.5">
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-cyan-800">LG ThinQ · Assignment Mesin</p>
        <p className="text-[10px] text-cyan-900/80">Pilih LG 24 kg, LG 15 kg, atau proses manual per baris nota.</p>
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
        {items.map((item, idx) => (
          <div key={item.id || idx} className="bg-white border border-cyan-100 rounded-xl px-2.5 py-2">
            <p className="text-[11px] font-bold text-slate-800 truncate">{item.name || `Item ${idx + 1}`}</p>
            <select
              value={item.machineMode || 'LG_15'}
              onChange={(e) => onChangeItem(idx, e.target.value as MachineMode)}
              className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] font-bold bg-slate-50"
            >
              {MACHINE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-[10px] text-slate-500 italic">Tambah item ke nota dulu, lalu pilih mesin.</p>
        )}
      </div>
    </div>
  );
}
