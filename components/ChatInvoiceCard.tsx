'use client';

import { parseChatInvoice } from '@/lib/chatInvoice';

export default function ChatInvoiceCard({ message }: { message: any }) {
  const inv = parseChatInvoice(message);
  if (!inv) return null;
  const amount = Number(inv.amount) || 0;

  return (
    <div className="mt-1.5 rounded-xl border border-amber-200 bg-white text-slate-900 overflow-hidden">
      <div className="px-3 py-2.5 space-y-2">
        <p className="text-[9px] font-black uppercase tracking-wider text-amber-700">Tagihan QRIS</p>
        <div className="flex justify-between gap-2 items-start">
          <div>
            <p className="text-[10px] text-slate-400 font-bold">Resi</p>
            <p className="text-xs font-black font-mono">{inv.resi}</p>
            {inv.service ? <p className="text-[10px] text-slate-500 mt-0.5">{inv.service}</p> : null}
          </div>
          <p className="text-sm font-black text-emerald-700">Rp {amount.toLocaleString('id-ID')}</p>
        </div>
        {inv.qrisUrl ? (
          <div className="bg-slate-50 rounded-xl p-2 flex flex-col items-center">
            <img src={inv.qrisUrl} alt="QRIS" className="w-36 h-36 object-contain bg-white rounded-lg" />
            <p className="text-[9px] text-slate-500 font-bold mt-1">Scan QRIS / Transfer sesuai nominal</p>
          </div>
        ) : (
          <p className="text-[10px] text-slate-500">Bayar via QRIS sebesar nominal di atas, lalu unggah bukti di chat.</p>
        )}
      </div>
    </div>
  );
}
