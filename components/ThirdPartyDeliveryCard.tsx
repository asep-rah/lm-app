'use client';

import { ExternalLink, Truck } from 'lucide-react';
import { parseThirdPartyDelivery, thirdPartyFromOrder, vendorMetaOf, type ThirdPartyPayload } from '@/lib/thirdPartyDelivery';

export default function ThirdPartyDeliveryCard({
  message,
  order,
  payload,
  showConfirm,
  confirmBusy,
  onConfirm,
  onOpenPhoto
}: {
  message?: any;
  order?: any;
  payload?: ThirdPartyPayload | null;
  showConfirm?: boolean;
  confirmBusy?: boolean;
  onConfirm?: () => void;
  onOpenPhoto?: (url: string) => void;
}) {
  const data = payload || parseThirdPartyDelivery(message) || thirdPartyFromOrder(order);
  if (!data || (!data.vendor && !data.trackingUrl && !data.driver && !data.photoUrl)) return null;
  const meta = vendorMetaOf(data.vendor);

  return (
    <div className="mt-1.5 rounded-2xl border border-amber-200 bg-white text-slate-900 overflow-hidden shadow-sm">
      <div className="px-3 py-2.5 space-y-2.5">
        <div className="flex items-center gap-2">
          <span className={`w-9 h-9 rounded-xl ${meta.color} text-white flex items-center justify-center shrink-0`}>
            <Truck className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-wider text-amber-700">Kartu Pengiriman Pihak Ketiga</p>
            <p className="text-sm font-black text-slate-900 truncate">{meta.label}</p>
          </div>
        </div>
        {data.driver ? (
          <p className="text-[11px] font-bold text-slate-700 bg-slate-50 border border-slate-100 rounded-xl px-2.5 py-1.5">
            Driver / plat: {data.driver}
          </p>
        ) : null}
        {data.receipt ? <p className="text-[10px] font-mono font-bold text-slate-500">Resi {data.receipt}</p> : null}
        {data.photoUrl ? (
          <button
            type="button"
            onClick={() => (onOpenPhoto ? onOpenPhoto(data.photoUrl) : window.open(data.photoUrl, '_blank'))}
            className="block w-full text-left"
          >
            <img src={data.photoUrl} alt="Foto serah terima" className="h-24 w-full object-cover rounded-xl border border-slate-200" />
            <p className="text-[9px] text-slate-400 font-bold mt-1">Foto serah terima ke kurir</p>
          </button>
        ) : null}
        {data.trackingUrl ? (
          <a
            href={data.trackingUrl}
            target="_blank"
            rel="noreferrer"
            className="w-full inline-flex items-center justify-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white font-black text-[11px] py-2.5 rounded-xl"
          >
            Lacak Kurir di Peta (Live Tracking)
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        ) : null}
        {showConfirm && onConfirm ? (
          <button
            type="button"
            disabled={confirmBusy}
            onClick={onConfirm}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[11px] py-2.5 rounded-xl disabled:opacity-50"
          >
            {confirmBusy ? 'Mengirim…' : 'Konfirmasi Cucian Diterima'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
