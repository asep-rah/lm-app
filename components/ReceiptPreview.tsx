'use client';

import { DEFAULT_RECEIPT_LAYOUT, DEFAULT_RECEIPT_TERMS, type ReceiptLayout } from '@/lib/receiptLayout';

export { DEFAULT_RECEIPT_TERMS };

type PreviewItem = { name: string; qtyLabel: string; amount: string; note?: string };

type Props = {
  layout?: Partial<ReceiptLayout>;
  outletName?: string;
  outletPhone?: string;
  terms?: string;
  customerName?: string;
  customerPhone?: string;
  receiptNumber?: string;
  items?: PreviewItem[];
  totalLabel?: string;
  payMethod?: string;
};

export default function ReceiptPreview({
  layout,
  outletName = 'Laundrivery',
  outletPhone,
  terms,
  customerName = 'Budi Santoso',
  customerPhone = '0812-0000-0000',
  receiptNumber = 'LDV-000123',
  items = [
    { name: 'Cuci Kering Gosok', qtyLabel: '3 Kg x Rp 8.000', amount: 'Rp 24.000' },
    { name: 'Bedcover Double', qtyLabel: '1 Pcs x Rp 40.000', amount: 'Rp 40.000', note: 'Merk: King Koil · Warna: Putih' }
  ],
  totalLabel = 'Rp 64.000',
  payMethod = 'QRIS'
}: Props) {
  const L = { ...DEFAULT_RECEIPT_LAYOUT, ...layout };
  const brand = (L.brandName || outletName || 'Laundrivery').trim();
  const termsText = String(terms || L.terms || '').trim() || DEFAULT_RECEIPT_TERMS;

  return (
    <div className="bg-slate-100 rounded-2xl p-3 border border-slate-200">
      <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2 text-center">Preview struk thermal 58mm</p>
      <div className="mx-auto w-[58mm] max-w-full bg-white text-black shadow-sm p-2 font-mono text-[10px] leading-tight">
        <div className="text-center font-bold text-[13px] mb-0.5">{brand}</div>
        <div className="text-center text-[8px] mb-1">
          {L.tagline}
          {outletPhone ? <div className="font-bold">{L.csLabel}: {outletPhone}</div> : null}
        </div>
        <div className="border-b border-black border-dashed mb-1.5" />
        <div>{L.dateLabel}: {new Date().toLocaleDateString('id-ID')}</div>
        <div className="font-bold">{L.receiptLabel}: {receiptNumber}</div>
        <div className="border-b border-black border-dashed my-1.5" />
        <div>{L.nameLabel}: <b>{customerName}</b></div>
        <div className="mb-1.5">{L.phoneLabel}: {customerPhone}</div>
        <div className="border-b border-black border-dashed mb-1.5" />
        <div className="space-y-1 mb-1.5">
          {items.map((item, idx) => (
            <div key={idx} className="flex justify-between items-start gap-1">
              <div>
                <span className="font-bold block">{item.name}</span>
                <span className="text-[8px]">{item.qtyLabel}</span>
                {item.note ? <span className="block text-[8px] italic">({item.note})</span> : null}
              </div>
              <span className="font-bold whitespace-nowrap">{item.amount}</span>
            </div>
          ))}
        </div>
        <div className="border-b border-black border-dashed mb-1.5" />
        <div className="flex justify-between font-bold mb-0.5">
          <span>{L.totalLabel}</span>
          <span>{totalLabel}</span>
        </div>
        <div className="flex justify-between mb-1.5">
          <span>{L.payLabel}</span>
          <span>{payMethod}</span>
        </div>
        <div className="border-t border-black border-dashed pt-1.5 text-[8px] leading-tight space-y-1">
          <div className="font-bold text-center">{L.termsTitle}:</div>
          <div className="whitespace-pre-line">{termsText}</div>
          {L.extraNote ? <div className="whitespace-pre-line">{L.extraNote}</div> : null}
        </div>
        {L.footer ? <div className="text-center text-[8px] mt-2 font-bold">{L.footer}</div> : null}
      </div>
    </div>
  );
}
