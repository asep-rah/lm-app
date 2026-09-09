'use client';

import {
  ASSET_CATEGORIES,
  assetCostOf,
  defaultLifeOf,
  emptyAsset,
  idr,
  openingGap,
  recordedPayables,
  resolvedOpeningCash,
  type CapitalMove,
  type OutletBook
} from '@/lib/outletBooks';

type Props = {
  value: OutletBook;
  onChange: (next: OutletBook) => void;
};

const nid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export default function OutletBooksEditor({ value, onChange }: Props) {
  const set = (patch: Partial<OutletBook>) => onChange({ ...value, ...patch });
  const assets = value.assets || [];
  const cost = assetCostOf(value);
  const cash = resolvedOpeningCash(value);
  const uses = cash + (Number(value.receivables) || 0) + (Number(value.otherCurrentAssets) || 0) + cost;
  const gap = openingGap({ ...value, openingCash: cash });

  return (
    <div className="bg-white border border-emerald-200 rounded-xl p-3 space-y-3">
      <div>
        <h4 className="text-xs font-black text-emerald-900">Pembukuan awal outlet</h4>
        <p className="text-[10px] text-slate-500">
          Isi seperti neraca cabang: modal, rekening bank, piutang, hutang, dan aset per kelompok (Machine, Furniture, Promotion Tools, Tools & Equipment, IT Solution, Renovation).
        </p>
      </div>

      <div>
        <label className="text-[10px] font-bold text-emerald-900 block mb-1">Tanggal mulai pembukuan</label>
        <input
          type="date"
          value={value.booksStart?.slice(0, 10) || ''}
          onChange={(e) => set({ booksStart: e.target.value })}
          className="w-full border rounded-lg p-2 text-xs bg-slate-50"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <MoneyField label="Modal (Rp)" value={value.openingCapital} onChange={(n) => set({ openingCapital: n })} />
        <MoneyField
          label="Rekening bank / omset awal (Rp)"
          value={value.openingCash}
          placeholder={cash && !value.openingCash ? String(Math.round(cash)) : 'Otomatis sisa setelah aset'}
          onChange={(n) => set({ openingCash: n })}
        />
        <MoneyField label="Piutang usaha (Rp)" value={value.receivables} onChange={(n) => set({ receivables: n })} />
        <MoneyField label="Aset lancar lainnya (Rp)" value={value.otherCurrentAssets} onChange={(n) => set({ otherCurrentAssets: n })} />
        <MoneyField label="Utang usaha jangka pendek (Rp)" value={value.tradePayables} onChange={(n) => set({ tradePayables: n })} />
        <MoneyField label="Utang usaha jangka panjang (Rp)" value={value.longTermPayables} onChange={(n) => set({ longTermPayables: n })} />
        <MoneyField label="Utang sewa (Rp)" value={value.leasePayables} onChange={(n) => set({ leasePayables: n })} />
      </div>

      <div className={`text-[10px] rounded-lg px-2 py-1.5 ${Math.abs(gap) < 1 ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
        Kas {idr(cash)} + Piutang {idr(value.receivables || 0)} + Aset {idr(cost)} = {idr(uses)}
        {' · '}
        Modal + Utang = {idr((Number(value.openingCapital) || 0) + recordedPayables(value))}
        {Math.abs(gap) >= 1 ? ` · selisih ${idr(gap)} ke ekuitas` : ' · seimbang'}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h5 className="text-[10px] font-black uppercase text-slate-500">Daftar aset tetap</h5>
          <button
            type="button"
            onClick={() => set({ assets: [...assets, emptyAsset()] })}
            className="text-[10px] font-bold text-emerald-700"
          >
            + Tambah aset
          </button>
        </div>
        {assets.map((asset, idx) => (
          <div key={asset.id} className="border border-slate-200 rounded-xl p-2 space-y-2 bg-slate-50">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="Nama aset (contoh: Washer 18kg)"
                value={asset.name}
                onChange={(e) => {
                  const next = [...assets];
                  next[idx] = { ...asset, name: e.target.value };
                  set({ assets: next });
                }}
                className="border rounded-lg p-2 text-xs bg-white"
              />
              <select
                value={asset.category}
                onChange={(e) => {
                  const next = [...assets];
                  next[idx] = { ...asset, category: e.target.value, lifeMonths: defaultLifeOf(e.target.value) };
                  set({ assets: next });
                }}
                className="border rounded-lg p-2 text-xs bg-white"
              >
                {ASSET_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <MoneyField
                label="Harga perolehan"
                value={asset.cost}
                onChange={(n) => {
                  const next = [...assets];
                  next[idx] = { ...asset, cost: n };
                  set({ assets: next });
                }}
              />
              <MoneyField
                label="Nilai sisa"
                value={asset.residual}
                onChange={(n) => {
                  const next = [...assets];
                  next[idx] = { ...asset, residual: n };
                  set({ assets: next });
                }}
              />
              <div>
                <label className="text-[9px] font-bold text-slate-500 block mb-1">Tgl perolehan</label>
                <input
                  type="date"
                  value={asset.acquiredAt?.slice(0, 10) || ''}
                  onChange={(e) => {
                    const next = [...assets];
                    next[idx] = { ...asset, acquiredAt: e.target.value };
                    set({ assets: next });
                  }}
                  className="w-full border rounded-lg p-2 text-xs bg-white"
                />
              </div>
              <div>
                <label className="text-[9px] font-bold text-slate-500 block mb-1">Manfaat (bulan)</label>
                <input
                  type="number"
                  min={1}
                  value={asset.lifeMonths || ''}
                  onChange={(e) => {
                    const next = [...assets];
                    next[idx] = { ...asset, lifeMonths: Number(e.target.value) || 1 };
                    set({ assets: next });
                  }}
                  className="w-full border rounded-lg p-2 text-xs bg-white"
                />
              </div>
            </div>
            {asset.cost > 0 && asset.lifeMonths > 0 ? (
              <p className="text-[10px] text-slate-500">
                Penyusutan / bln {idr(Math.max(0, asset.cost - (asset.residual || 0)) / asset.lifeMonths)}
              </p>
            ) : null}
            {assets.length > 1 ? (
              <button
                type="button"
                onClick={() => set({ assets: assets.filter((_, i) => i !== idx) })}
                className="text-[10px] font-bold text-rose-600"
              >
                Hapus aset
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <MoveList
        title="Setoran modal tambahan"
        rows={value.extraCapital}
        onChange={(extraCapital) => set({ extraCapital })}
      />
      <MoveList
        title="Prive / penarikan pemilik"
        rows={value.drawings}
        onChange={(drawings) => set({ drawings })}
      />
    </div>
  );
}

function MoneyField({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-[9px] font-bold text-slate-500 block mb-1">{label}</label>
      <input
        type="number"
        min={0}
        placeholder={placeholder}
        value={value || ''}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-full border rounded-lg p-2 text-xs bg-white font-bold"
      />
    </div>
  );
}

function MoveList({
  title,
  rows,
  onChange
}: {
  title: string;
  rows: CapitalMove[];
  onChange: (rows: CapitalMove[]) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <h5 className="text-[10px] font-black uppercase text-slate-500">{title}</h5>
        <button
          type="button"
          onClick={() => onChange([...rows, { id: nid(), date: new Date().toISOString().slice(0, 10), amount: 0, note: '' }])}
          className="text-[10px] font-bold text-emerald-700"
        >
          + Catat
        </button>
      </div>
      {rows.map((row, idx) => (
        <div key={row.id} className="grid grid-cols-6 gap-1">
          <input
            type="date"
            value={row.date?.slice(0, 10) || ''}
            onChange={(e) => {
              const next = [...rows];
              next[idx] = { ...row, date: e.target.value };
              onChange(next);
            }}
            className="col-span-2 border rounded-lg p-1.5 text-[10px] bg-white"
          />
          <input
            type="number"
            placeholder="Rp"
            value={row.amount || ''}
            onChange={(e) => {
              const next = [...rows];
              next[idx] = { ...row, amount: Number(e.target.value) || 0 };
              onChange(next);
            }}
            className="col-span-2 border rounded-lg p-1.5 text-[10px] bg-white"
          />
          <input
            type="text"
            placeholder="Catatan"
            value={row.note}
            onChange={(e) => {
              const next = [...rows];
              next[idx] = { ...row, note: e.target.value };
              onChange(next);
            }}
            className="col-span-1 border rounded-lg p-1.5 text-[10px] bg-white"
          />
          <button
            type="button"
            onClick={() => onChange(rows.filter((_, i) => i !== idx))}
            className="col-span-1 text-[10px] font-bold text-rose-600"
          >
            Hapus
          </button>
        </div>
      ))}
    </div>
  );
}
