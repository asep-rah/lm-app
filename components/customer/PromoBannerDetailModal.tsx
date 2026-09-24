'use client';

import { Gift, MapPin, Tag, X } from 'lucide-react';
import type { BannerSlide } from '@/lib/outletShowcase';
import type { CatalogPromo } from '@/lib/promoCatalog';

export type PromoEligibility = {
  /** Nama outlet tempat promo berlaku; null = semua outlet. */
  outletNames: string[] | null;
  /** Voucher yang terhubung ke banner (dari tabel promos), bila ada. */
  voucher: CatalogPromo | null;
};

const voucherValueLabel = (v: CatalogPromo) =>
  v.type === 'percent'
    ? `Diskon ${v.value}%`
    : v.type === 'ongkir'
    ? `Potongan ongkir s.d. Rp ${Number(v.value).toLocaleString('id-ID')}`
    : `Potongan Rp ${Number(v.value).toLocaleString('id-ID')}`;

export default function PromoBannerDetailModal({
  slide,
  claimed,
  eligibility,
  onClose,
  onClaim
}: {
  slide: BannerSlide | null;
  claimed?: boolean;
  eligibility?: PromoEligibility | null;
  onClose: () => void;
  onClaim: () => void;
}) {
  if (!slide || slide.kind !== 'promo') return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[90] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-3xl max-w-sm w-full shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative h-40 bg-gradient-to-br from-sky-500 via-brand-600 to-indigo-700">
          {slide.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={slide.image} alt="" className="absolute inset-0 w-full h-full object-cover" />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent" />
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/35 text-white flex items-center justify-center"
            aria-label="Tutup"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="absolute bottom-3 left-4 right-4">
            <p className="text-white text-sm font-black leading-tight">{slide.title}</p>
          </div>
        </div>
        <div className="p-5 space-y-3">
          {slide.subtitle ? <p className="text-xs text-slate-600 leading-relaxed">{slide.subtitle}</p> : null}
          {eligibility ? (
            <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 space-y-1 text-[11px] text-slate-700">
              <p className="inline-flex items-start gap-1.5">
                <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-500" />
                <span>
                  Berlaku di:{' '}
                  <b>
                    {eligibility.outletNames === null
                      ? 'semua outlet Laundrivery'
                      : eligibility.outletNames.length
                      ? eligibility.outletNames.join(', ')
                      : 'outlet tertentu'}
                  </b>
                </span>
              </p>
              {eligibility.voucher ? (
                <p className="inline-flex items-start gap-1.5">
                  <Tag className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-500" />
                  <span>
                    {voucherValueLabel(eligibility.voucher)}
                    {eligibility.voucher.minTx > 0 ? ` · min. transaksi Rp ${eligibility.voucher.minTx.toLocaleString('id-ID')}` : ''}
                    {eligibility.voucher.max_quota > 0
                      ? ` · sisa kuota ${Math.max(0, eligibility.voucher.max_quota - eligibility.voucher.used_count)}`
                      : ''}
                  </span>
                </p>
              ) : (
                <p className="text-slate-500">Banner informasi — belum terhubung ke voucher, jadi tidak bisa diklaim di aplikasi.</p>
              )}
            </div>
          ) : null}
          {slide.promoCode ? (
            <p className="text-[11px] font-extrabold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
              Kode: {slide.promoCode}
            </p>
          ) : null}
          <button
            type="button"
            onClick={onClaim}
            className={`w-full font-extrabold py-3 rounded-2xl text-xs uppercase shadow-md inline-flex items-center justify-center gap-1.5 ${
              claimed ? 'bg-emerald-600 text-white' : 'bg-amber-500 hover:bg-amber-600 text-white'
            }`}
          >
            <Gift className="w-4 h-4" /> {claimed ? 'Promo Terpasang' : 'Klaim Promo'}
          </button>
        </div>
      </div>
    </div>
  );
}
