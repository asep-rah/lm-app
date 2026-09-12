'use client';

import {
  PNL_COGS,
  PNL_OPEX,
  PNL_REVENUE,
  type PnlMonth
} from '@/lib/pnlReport';

const idr = (n: number) =>
  Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 });

type Props = {
  outletName: string;
  adminName?: string;
  left: PnlMonth;
  right: PnlMonth;
};

function SectionHead({ title, colSpan }: { title: string; colSpan: number }) {
  return (
    <tr className="bg-rose-100">
      <td colSpan={colSpan} className="px-3 py-2 font-black text-[11px] uppercase tracking-wide text-rose-800">
        {title}
      </td>
    </tr>
  );
}

function MoneyCells({ a, b, className = '' }: { a: number; b: number; className?: string }) {
  const tone = (n: number) => (n < 0 ? 'text-rose-600' : '');
  return (
    <>
      <td className={`px-3 py-1.5 text-right tabular-nums ${tone(a)} ${className}`}>{idr(a)}</td>
      <td className={`px-3 py-1.5 text-right tabular-nums ${tone(b)} ${className}`}>{idr(b)}</td>
    </>
  );
}

export default function PnlStatement({ outletName, adminName, left, right }: Props) {
  const extraLabels = Array.from(
    new Set([...left.extraOpex.map((x) => x.label), ...right.extraOpex.map((x) => x.label)])
  );
  const extraAmt = (month: PnlMonth, label: string) =>
    month.extraOpex.find((x) => x.label === label)?.amount || 0;

  const costsLookEmpty =
    (left.totalRevenue > 0 && left.totalCogs + left.totalOpex <= 0) ||
    (right.totalRevenue > 0 && right.totalCogs + right.totalOpex <= 0);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex flex-col md:flex-row md:items-end md:justify-between gap-1">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-rose-600">Laporan Laba Rugi</p>
          <h3 className="text-sm md:text-base font-black text-slate-900">{outletName}</h3>
          <p className="text-[11px] text-slate-500">
            {adminName ? `${adminName} · ` : ''}
            {left.label} (lebih lama) → {right.label} (lebih baru)
          </p>
          {costsLookEmpty && (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-2.5 py-2 mt-2 leading-relaxed">
              Beban tercatat Rp0 pada salah satu bulan sementara pendapatan ada. Pastikan seluruh biaya sudah diinput
              sebelum menilai laba — angka Rp0 belum berarti efisiensi terkendali.
            </p>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[640px]">
          <thead>
            <tr className="bg-slate-800 text-white">
              <th className="px-3 py-2 text-left font-bold w-24">Kode</th>
              <th className="px-3 py-2 text-left font-bold">Akun</th>
              <th className="px-3 py-2 text-right font-bold">{left.label}</th>
              <th className="px-3 py-2 text-right font-bold">{right.label}</th>
            </tr>
          </thead>
          <tbody>
            <SectionHead title="Pendapatan" colSpan={4} />
            {PNL_REVENUE.map((a) => (
              <tr key={a.code} className="border-b border-slate-100">
                <td className="px-3 py-1.5 font-mono text-[10px] text-slate-500">{a.code}</td>
                <td className="px-3 py-1.5 text-slate-800">{a.label}</td>
                <MoneyCells a={left.revenue[a.code] || 0} b={right.revenue[a.code] || 0} />
              </tr>
            ))}
            <tr className="bg-emerald-100 font-black border-b border-emerald-200">
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-emerald-900">Total Pendapatan</td>
              <MoneyCells a={left.totalRevenue} b={right.totalRevenue} className="text-emerald-900" />
            </tr>

            <SectionHead title="Beban Pokok Penjualan" colSpan={4} />
            {PNL_COGS.map((a) => (
              <tr key={a.code} className="border-b border-slate-100">
                <td className="px-3 py-1.5 font-mono text-[10px] text-slate-500">{a.code}</td>
                <td className="px-3 py-1.5 text-slate-800">{a.label}</td>
                <MoneyCells a={left.cogs[a.code] || 0} b={right.cogs[a.code] || 0} />
              </tr>
            ))}
            <tr className="bg-emerald-100 font-black border-b border-emerald-200">
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-emerald-900">Total Beban Pokok Penjualan</td>
              <MoneyCells a={left.totalCogs} b={right.totalCogs} className="text-emerald-900" />
            </tr>

            <SectionHead title="Beban Operasional" colSpan={4} />
            {PNL_OPEX.map((a) => (
              <tr key={a.code} className="border-b border-slate-100">
                <td className="px-3 py-1.5 font-mono text-[10px] text-slate-500">{a.code}</td>
                <td className="px-3 py-1.5 text-slate-800">{a.label}</td>
                <MoneyCells a={left.opex[a.code] || 0} b={right.opex[a.code] || 0} />
              </tr>
            ))}
            {extraLabels.map((label) => (
              <tr key={label} className="border-b border-slate-100">
                <td className="px-3 py-1.5 font-mono text-[10px] text-slate-400">—</td>
                <td className="px-3 py-1.5 text-slate-700">{label}</td>
                <MoneyCells a={extraAmt(left, label)} b={extraAmt(right, label)} />
              </tr>
            ))}
            <tr className="bg-emerald-100 font-black border-b border-emerald-200">
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-emerald-900">Total Beban Operasional</td>
              <MoneyCells a={left.totalOpex} b={right.totalOpex} className="text-emerald-900" />
            </tr>

            <tr className="bg-amber-100 font-black border-y border-amber-200">
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5 text-amber-950">LABA BERSIH</td>
              <MoneyCells a={left.labaBersih} b={right.labaBersih} className="text-amber-950" />
            </tr>
            <tr className="border-b border-slate-100">
              <td className="px-3 py-1.5" />
              <td className="px-3 py-1.5 text-slate-700">Bagi Hasil Pengelolaan</td>
              <MoneyCells a={left.bagiHasil} b={right.bagiHasil} />
            </tr>
            <tr className="border-b border-slate-100">
              <td className="px-3 py-1.5" />
              <td className="px-3 py-1.5 text-slate-700">Tabungan THR Crew</td>
              <MoneyCells a={left.tabunganThr} b={right.tabunganThr} />
            </tr>
            <tr className="bg-emerald-200 font-black">
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5 text-emerald-950">LABA BERSIH SETELAH BAGI HASIL</td>
              <MoneyCells a={left.sisaLaba} b={right.sisaLaba} className="text-emerald-950" />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
