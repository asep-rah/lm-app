'use client';

import { parseChatInvoice } from '@/lib/chatInvoice';
import CheckPaymentStatusButton from '@/components/payment/CheckPaymentStatusButton';

export default function ChatInvoiceCard({ message }: { message: any }) {
  const inv = parseChatInvoice(message);
  if (!inv) return null;
  const amount = Number(inv.amount) || 0;
  const orderId = String((inv as any).transactionId || (inv as any).txId || message?.transaction_id || '').trim();

  return (
    <div className="mt-1.5 rounded-xl border border-amber-200 bg-white text-slate-900 overflow-hidden">
      <div className="px-3 py-2.5 space-y-2">
        <p className="text-[9px] font-black uppercase tracking-wider text-amber-700">Tagihan QRIS</p>
        <div className="flex justify-between gap-2 items-start">
          <div>
            <p className="text-[10px] text-slate-500 font-bold">Resi</p>
            <p className="text-xs font-black font-mono">{inv.resi}</p>
            {inv.service ? <p className="text-[10px] text-slate-600 mt-0.5">{inv.service}</p> : null}
          </div>
          <p className="text-sm font-black text-emerald-700">Rp {amount.toLocaleString('id-ID')}</p>
        </div>
        {inv.qrisUrl ? (
          <div className="bg-slate-50 rounded-xl p-2 flex flex-col items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={inv.qrisUrl} alt="QRIS" className="w-36 h-36 object-contain bg-white rounded-lg" />
            <p className="text-[9px] text-slate-600 font-bold mt-1">Scan QRIS sesuai nominal</p>
          </div>
        ) : (
          <p className="text-[10px] text-slate-600">Bayar via QRIS sebesar nominal di atas.</p>
        )}
        {inv.invoiceUrl ? (
          <a
            href={inv.invoiceUrl}
            target="_blank"
            rel="noreferrer"
            className="block text-center text-[11px] font-black bg-amber-500 text-white py-2 rounded-xl"
          >
            Buka tautan invoice
          </a>
        ) : null}
        {orderId ? (
          <CheckPaymentStatusButton orderId={orderId} className="w-full" />
        ) : inv.resi ? (
          <CheckPaymentStatusButton orderId={inv.resi} className="w-full" />
        ) : null}
      </div>
    </div>
  );
}
