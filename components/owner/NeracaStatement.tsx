'use client';

import { monthLabel, type PnlMonthRef } from '@/lib/pnlReport';
import type { BalanceSheet } from '@/lib/financeStatements';

const money = (n: number, paren = false) => {
  const text = Math.round(Math.abs(n) || 0).toLocaleString('id-ID');
  if (!n) return '0';
  if (paren || n < 0) return `(${text})`;
  return text;
};

type Props = {
  title: string;
  asOf: PnlMonthRef;
  sheet: BalanceSheet;
};

export default function NeracaStatement({ title, asOf, sheet }: Props) {
  const balanced = Math.abs(sheet.totalAssets - sheet.totalPasiva) < 2;
  const groups = sheet.faGroups.filter((g) => g.cost > 0 || g.accum > 0);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b text-center">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Laporan Posisi Keuangan</p>
        <h2 className="text-base md:text-lg font-black text-slate-900 mt-1">{title}</h2>
        <p className="text-[11px] text-slate-500">Per {monthLabel(asOf)} · dalam Rupiah</p>
      </div>
      <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-5 text-[13px]">
        <section>
          <Head>ASET</Head>
          <Sub>ASET LANCAR</Sub>
          <Line label="Rekening Bank Outlet / Omset" value={sheet.cash} indent={2} />
          <Line label="Kas Tunai Belum Disetor" value={sheet.undepositedCash || 0} indent={2} />
          <Line label="Piutang Usaha" value={sheet.receivables} indent={2} />
          <Line label="QRIS / Gateway Clearing" value={sheet.gatewayClearing || 0} indent={2} />
          <Line label="Aset Lancar Lainnya" value={sheet.otherCurrent} indent={2} />
          <Line label="Jumlah Aset Lancar" value={sheet.currentAssets} total />
          <Sub>ASET TIDAK LANCAR</Sub>
          <p className="text-[10px] font-black uppercase text-slate-400 pt-2 pl-3">Aset Tetap</p>
          {(groups.length ? groups : sheet.faGroups).map((g) => (
            <Line key={g.key} label={g.label} value={g.cost} indent={2} />
          ))}
          <Line label="Jumlah Nilai Aset" value={sheet.fixedAtCost} total indent={1} />
          <p className="text-[10px] font-black uppercase text-slate-400 pt-2 pl-3">Akumulasi Penyusutan</p>
          {(groups.length ? groups : sheet.faGroups).map((g) => (
            <Line key={`dep-${g.key}`} label={`Akumulasi Penyusutan ${g.short}`} value={g.accum} indent={2} paren />
          ))}
          <Line label="Jumlah Akumulasi Penyusutan" value={sheet.accumDep} total indent={1} paren />
          <Line label="Jumlah Aset Tidak Lancar" value={sheet.nonCurrent} total />
          <Line label="JUMLAH ASET" value={sheet.totalAssets} grand />
        </section>

        <section>
          <Head>LIABILITAS DAN EKUITAS</Head>
          <Sub>LIABILITAS</Sub>
          <p className="text-[10px] font-black uppercase text-slate-400 pt-2 pl-3">Liabilitas Jangka Pendek</p>
          <Line label="Utang Usaha" value={sheet.tradePayables} indent={2} />
          <p className="text-[10px] font-bold text-slate-400 pt-1 pl-6">Kewajiban Jangka Pendek Lainnya</p>
          <Line label="Bagi Hasil Pengelolaan" value={sheet.profitShare} indent={3} />
          <Line label="Jumlah Liabilitas Jangka Pendek" value={sheet.shortLiab} total indent={1} />
          <p className="text-[10px] font-black uppercase text-slate-400 pt-2 pl-3">Liabilitas Jangka Panjang</p>
          <Line label="Utang Usaha" value={sheet.longTermPayables} indent={2} />
          <Line label="Utang Sewa" value={sheet.leasePayables} indent={2} />
          <Line label="Jumlah Liabilitas Jangka Panjang" value={sheet.longLiab} total indent={1} />
          <Line label="Jumlah Kewajiban" value={sheet.totalLiab} total />

          <Sub>EKUITAS</Sub>
          <Line label="Modal" value={sheet.paidInCapital} indent={1} />
          <Line label="Ekuitas Saldo Awal" value={sheet.equityBegin} indent={1} />
          {sheet.extraYear ? <Line label="Setoran modal tahun ini" value={sheet.extraYear} indent={1} /> : null}
          <Line label="Laba Tahun Ini" value={sheet.yearProfit} indent={1} />
          {sheet.drawingsYear ? <Line label="Prive tahun ini" value={sheet.drawingsYear} indent={1} paren /> : null}
          <Line label="Jumlah Ekuitas" value={sheet.totalEquity} total />
          <Line label="JUMLAH LIABILITAS DAN EKUITAS" value={sheet.totalPasiva} grand />
          <p className={`text-[11px] font-bold pt-2 ${balanced ? 'text-emerald-700' : 'text-rose-600'}`}>
            {balanced
              ? 'Aritmetika neraca seimbang (aset = liabilitas + ekuitas). Ini belum membuktikan kas bank sudah diverifikasi atau pembukuan awal lengkap.'
              : `Belum seimbang · selisih ${money(sheet.totalAssets - sheet.totalPasiva)}`}
          </p>
          {sheet.tradeReceivablesFromSales > 0 && (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 mt-2 leading-relaxed">
              Piutang penjualan belum dikoleksi bertanggal: Rp {money(sheet.tradeReceivablesFromSales)}.
              QRIS lunas yang belum masuk rekening outlet dicatat di Clearing (Rp {money(sheet.gatewayClearing || 0)}),
              bukan Bank.
            </p>
          )}
          {sheet.completeness && !sheet.completeness.complete && (
            <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 mt-2 leading-relaxed">
              Status pembukuan awal: belum lengkap / belum diverifikasi.
              {sheet.completeness.issues.length ? ` ${sheet.completeness.issues[0]}` : ''}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function Head({ children }: { children: string }) {
  return <h3 className="text-sm font-black tracking-wide text-slate-900 border-b-2 border-slate-900 pb-1">{children}</h3>;
}

function Sub({ children }: { children: string }) {
  return <h4 className="text-[11px] font-black uppercase tracking-wide text-slate-600 pt-3">{children}</h4>;
}

function Line({
  label,
  value,
  indent = 0,
  total,
  grand,
  paren
}: {
  label: string;
  value: number;
  indent?: number;
  total?: boolean;
  grand?: boolean;
  paren?: boolean;
}) {
  const pad = ['pl-0', 'pl-3', 'pl-6', 'pl-9'][Math.min(indent, 3)];
  return (
    <div
      className={`flex justify-between gap-4 py-0.5 ${pad} ${
        grand ? 'font-black text-slate-900 border-t-2 border-b-2 border-slate-900 mt-2 py-1.5' : total ? 'font-black text-slate-800 border-t border-slate-200 mt-1 pt-1' : 'text-slate-600'
      }`}
    >
      <span>{label}</span>
      <span className="tabular-nums whitespace-nowrap">{money(value, paren)}</span>
    </div>
  );
}
