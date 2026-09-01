'use client';

import { useState } from 'react';
import { Gift, X } from 'lucide-react';
import type { CatalogPromo } from '@/lib/promoCatalog';

export default function PromoVoucherModal({
  open,
  promos,
  claimedId,
  onClose,
  onClaim,
  onApplyCode
}: {
  open: boolean;
  promos: CatalogPromo[];
  claimedId?: string | null;
  onClose: () => void;
  onClaim: (promo: CatalogPromo) => void;
  onApplyCode: (code: string) => boolean;
}) {
  const [code, setCode] = useState('');

  if (!open) return null;

  const submitCode = (e: React.FormEvent) => {
    e.preventDefault();
    const ok = onApplyCode(code);
    if (ok) setCode('');
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[90] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-3xl p-5 max-w-sm w-full space-y-4 shadow-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center border-b pb-2">
          <h3 className="text-sm font-extrabold text-slate-900 inline-flex items-center gap-1.5">
            <Gift className="w-4 h-4 text-amber-600" /> Klaim Voucher Promo
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Tutup">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={submitCode} className="flex gap-2">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Kode promo"
            className="flex-1 bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-800 uppercase tracking-wide focus:outline-none focus:border-amber-400"
            autoCapitalize="characters"
          />
          <button
            type="submit"
            className="shrink-0 bg-amber-500 hover:bg-amber-600 text-white font-extrabold px-3.5 py-2.5 rounded-xl text-[10px]"
          >
            Gunakan
          </button>
        </form>

        <div className="space-y-2.5">
          {promos.length > 0 ? (
            promos.map((promo) => {
              const isClaimed = claimedId === promo.id;
              return (
                <div
                  key={promo.id}
                  className={`p-3.5 rounded-2xl border transition space-y-2 ${
                    isClaimed ? 'bg-amber-50 border-amber-400' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <h4 className="font-extrabold text-slate-900 text-xs">{promo.title}</h4>
                      <p className="text-[10px] text-slate-500 mt-0.5">{promo.desc}</p>
                      <p className="text-[9px] text-amber-700 font-bold mt-1">
                        Min. Transaksi: Rp {Number(promo.minTx || 0).toLocaleString('id-ID')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onClaim(promo)}
                      className={`text-[10px] font-extrabold px-3 py-1.5 rounded-xl shadow-sm transition shrink-0 ${
                        isClaimed ? 'bg-emerald-600 text-white' : 'bg-amber-500 hover:bg-amber-600 text-white'
                      }`}
                    >
                      {isClaimed ? 'Terpasang' : 'Klaim Promo'}
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-xs text-slate-400 text-center py-4">Belum ada promo aktif saat ini</p>
          )}
        </div>
      </div>
    </div>
  );
}
