'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { simulateMayarAutoPay } from '@/lib/mayar';
import { isCashDepositBalanced, netDepositOf } from '@/lib/cashDepositQris';
import { resolveActorUuid, resolveOutletUuid } from '@/lib/outletUuid';
import { toast } from '@/lib/toast';

const QR_TTL_SEC = 10 * 60;

type Charge = {
  qris_image_url: string;
  payment_url: string;
  mayar_transaction_id: string;
  deposit_id: string | null;
  receipt: string;
  net_deposit_amount: number;
  mock?: boolean;
};

export default function CashDepositQrisPanel({
  outletId,
  kasirId,
  physicalCash,
  adminFee,
  shiftDate
}: {
  outletId: string;
  kasirId?: string;
  physicalCash: number;
  adminFee: number;
  shiftDate?: string;
}) {
  const net = netDepositOf(physicalCash, adminFee);
  const [busy, setBusy] = useState(false);
  const [charge, setCharge] = useState<Charge | null>(null);
  const [left, setLeft] = useState(QR_TTL_SEC);
  const [balanced, setBalanced] = useState(false);

  useEffect(() => {
    if (!charge?.deposit_id || balanced) return;
    const channel = supabase
      .channel('cash_deposit_qris_' + charge.deposit_id)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cash_deposits', filter: `id=eq.${charge.deposit_id}` },
        (payload) => {
          if (isCashDepositBalanced(payload.new)) {
            setBalanced(true);
            toast('Pembayaran Berhasil! Setoran Terverifikasi Otomatis', 'ok');
          }
        }
      )
      .subscribe();

    const poll = window.setInterval(async () => {
      const { data } = await supabase.from('cash_deposits').select('*').eq('id', charge.deposit_id).maybeSingle();
      if (isCashDepositBalanced(data)) {
        setBalanced(true);
        toast('Pembayaran Berhasil! Setoran Terverifikasi Otomatis', 'ok');
      }
    }, 4000);

    return () => {
      supabase.removeChannel(channel);
      window.clearInterval(poll);
    };
  }, [charge?.deposit_id, balanced]);

  useEffect(() => {
    if (!charge || balanced) return;
    setLeft(QR_TTL_SEC);
    const t = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(t);
  }, [charge?.mayar_transaction_id, balanced]);

  const clock = useMemo(() => {
    const m = Math.floor(left / 60);
    const s = left % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }, [left]);

  const generate = async () => {
    if (!outletId) return toast('Pilih outlet dulu.', 'warn');
    if (net < 1000) return toast('Net setoran (fisik − admin) minimal Rp 1.000.', 'warn');
    setBusy(true);
    setBalanced(false);
    try {
      const outletUuid = await resolveOutletUuid(supabase, outletId);
      if (!outletUuid) {
        throw new Error('Outlet ID tidak valid (bukan UUID). Pilih cabang ulang dari daftar outlet.');
      }
      const res = await fetch('/api/mayar/create-deposit-qris', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outlet_id: outletUuid,
          kasir_id: resolveActorUuid(kasirId) || undefined,
          net_deposit_amount: net,
          physical_cash: physicalCash,
          admin_fee: adminFee,
          shift_date: shiftDate || new Date().toISOString().slice(0, 10)
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'Gagal generate QRIS');
      setCharge(json);
      toast('QRIS setoran siap discan dari e-wallet.', 'ok');
    } catch (e: any) {
      toast(e?.message || 'Gagal generate QRIS setoran', 'err');
    } finally {
      setBusy(false);
    }
  };

  const simulate = async () => {
    if (!charge?.deposit_id) return;
    setBusy(true);
    try {
      await simulateMayarAutoPay({
        cashDepositId: charge.deposit_id,
        receipt: charge.receipt,
        amount: charge.net_deposit_amount,
        paymentId: charge.mayar_transaction_id
      });
    } catch (e: any) {
      toast(e?.message || 'Simulasi gagal', 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-2.5 flex justify-between items-center">
        <div>
          <p className="text-[10px] font-bold uppercase text-emerald-700">Net QRIS setoran</p>
          <p className="text-lg font-black text-emerald-900">Rp {net.toLocaleString('id-ID')}</p>
          <p className="text-[10px] text-emerald-800">Fisik Rp {physicalCash.toLocaleString('id-ID')} − admin Rp {adminFee.toLocaleString('id-ID')}</p>
        </div>
        <button
          type="button"
          disabled={busy || net < 1000}
          onClick={generate}
          className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[11px] font-bold px-3 py-2.5 rounded-xl"
        >
          {busy ? 'Memproses…' : charge ? 'Generate ulang' : 'Generate QRIS Setoran Mayar'}
        </button>
      </div>

      {charge && (
        <div className="rounded-2xl border border-slate-200 p-3 space-y-2 text-center">
          {balanced ? (
            <p className="text-sm font-black text-emerald-700 py-6">Pembayaran Berhasil! Setoran Terverifikasi Otomatis</p>
          ) : (
            <>
              <p className="text-[11px] font-bold text-amber-700">Menunggu Scan QRIS...</p>
              {charge.qris_image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={charge.qris_image_url}
                  alt="QRIS Setoran Mayar"
                  className="w-48 h-48 mx-auto bg-white rounded-xl border object-contain"
                />
              )}
              <p className="text-[10px] font-mono text-slate-500">Berlaku {clock}</p>
              {left === 0 && <p className="text-[10px] text-rose-600 font-bold">QR kedaluwarsa. Generate ulang jika belum terbayar.</p>}
              {charge.payment_url && (
                <a href={charge.payment_url} target="_blank" rel="noreferrer" className="block text-[11px] font-bold text-sky-700">
                  Buka tautan pembayaran
                </a>
              )}
              {charge.mock && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={simulate}
                  className="w-full bg-amber-500 text-white text-[11px] font-bold py-2 rounded-xl"
                >
                  Test Auto-Payment (Mock)
                </button>
              )}
            </>
          )}
          <p className="text-[9px] text-slate-400 font-mono">{charge.receipt}</p>
        </div>
      )}
    </div>
  );
}
