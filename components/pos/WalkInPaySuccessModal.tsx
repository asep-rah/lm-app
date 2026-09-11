'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { simulateMayarAutoPay } from '@/lib/mayar';
import CheckPaymentStatusButton from '@/components/payment/CheckPaymentStatusButton';
import { toast } from '@/lib/toast';

export type WalkInPaySuccessTx = {
  id: string;
  receipt_number?: string;
  customer_name?: string;
  customer_phone?: string | null;
  created_at?: string;
  duration?: string;
  service_type?: string;
  amount?: number;
  payment_method?: string;
  is_paid?: boolean;
  needs_qris?: boolean;
  needs_cash_confirm?: boolean;
  qris_url?: string | null;
  invoice_url?: string | null;
  mayar_payment_id?: string | null;
  mayar_mock?: boolean;
  qris_scan_ready?: boolean;
  /** QRIS Mayar masih dibuat — modal sudah tampil agar kasir tidak bingung. */
  qris_loading?: boolean;
  items?: any[];
  bag_count?: number;
};

type Props = {
  tx: WalkInPaySuccessTx;
  estDateLabel: string;
  cashReceivedOk: boolean;
  qtyReady?: boolean;
  qtyBlockMessage?: string;
  onCashReceived: () => void;
  onPaid: (tx: WalkInPaySuccessTx) => void | Promise<void>;
  onPrintReceipt: () => void;
  onPrintStickers: () => void;
  onClose: () => void;
};

export default function WalkInPaySuccessModal({
  tx,
  estDateLabel,
  cashReceivedOk,
  qtyReady = true,
  qtyBlockMessage,
  onCashReceived,
  onPaid,
  onPrintReceipt,
  onPrintStickers,
  onClose
}: Props) {
  const [busySim, setBusySim] = useState(false);
  const [busyConfirm, setBusyConfirm] = useState(false);
  const paid = Boolean(tx.is_paid);
  const waitingQris = Boolean(tx.needs_qris) && !paid;
  const waitingCash = Boolean(tx.needs_cash_confirm) && !cashReceivedOk;
  const canPrint = paid && !waitingCash && qtyReady;
  const qrisLoading = Boolean(tx.qris_loading) && waitingQris;

  useEffect(() => {
    if (!waitingQris || !tx.id || qrisLoading) return;

    let cancelled = false;
    const markPaid = async () => {
      if (cancelled) return;
      await onPaid({ ...tx, is_paid: true, payment_status: 'paid' } as WalkInPaySuccessTx);
    };

    const channel = supabase
      .channel(`walkin_qris_${tx.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'transactions', filter: `id=eq.${tx.id}` },
        (payload) => {
          const row = payload.new as any;
          if (row?.is_paid === true || String(row?.payment_status || '').toLowerCase() === 'paid') {
            void markPaid();
          }
        }
      )
      .subscribe();

    // Mulai poll setelah QR siap + jeda singkat, agar tidak salah deteksi pembayaran lama.
    const poll = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/pay/check-status?order_id=${encodeURIComponent(tx.id)}`);
        const json = await res.json().catch(() => ({}));
        if (json.status === 'PAID' || json.is_paid) {
          toast(json.message || 'QRIS lunas — siap cetak struk.', 'ok');
          await markPaid();
        }
      } catch {
        /* ignore transient poll errors */
      }
    }, 5000);

    // Cek sekali segera setelah QR siap (settlement Mayar kadang 5–20 dtk)
    void (async () => {
      await new Promise((r) => setTimeout(r, 2500));
      if (cancelled) return;
      try {
        const res = await fetch(`/api/pay/check-status?order_id=${encodeURIComponent(tx.id)}`);
        const json = await res.json().catch(() => ({}));
        if (json.status === 'PAID' || json.is_paid) {
          toast(json.message || 'QRIS lunas — siap cetak struk.', 'ok');
          await markPaid();
        }
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      window.clearInterval(poll);
    };
  }, [waitingQris, tx.id, qrisLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const simulate = async () => {
    if (!tx.id || busySim) return;
    setBusySim(true);
    try {
      await simulateMayarAutoPay({
        transactionId: tx.id,
        paymentId: tx.mayar_payment_id || undefined,
        receipt: tx.receipt_number,
        amount: Number(tx.amount) || 0,
        customerPhone: tx.customer_phone || undefined
      });
      toast('Simulasi QRIS berhasil — pembayaran lunas.', 'ok');
      await onPaid({ ...tx, is_paid: true });
    } catch (e: any) {
      // Cadangan: konfirmasi kasir langsung jika simulasi API gagal
      try {
        const res = await fetch('/api/pay/check-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            order_id: tx.id,
            cashier_confirm: true,
            agentName: 'Simulasi POS'
          })
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || e?.message || 'Simulasi gagal');
        toast('Simulasi OK (via konfirmasi kasir).', 'ok');
        await onPaid({ ...tx, is_paid: true });
      } catch (e2: any) {
        toast(e2?.message || e?.message || 'Simulasi gagal', 'err');
      }
    } finally {
      setBusySim(false);
    }
  };

  const confirmCashierPaid = async () => {
    if (!tx.id || busyConfirm) return;
    const ok = window.confirm(
      'Konfirmasi: pelanggan sudah bayar QRIS (lihat bukti e-wallet)? Transaksi akan ditandai lunas.'
    );
    if (!ok) return;
    setBusyConfirm(true);
    try {
      const res = await fetch('/api/pay/check-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: tx.id,
          cashier_confirm: true,
          agentName: 'Kasir POS'
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal konfirmasi');
      toast(json.message || 'Dikonfirmasi lunas oleh kasir.', 'ok');
      await onPaid({ ...tx, is_paid: true });
    } catch (e: any) {
      toast(e?.message || 'Gagal konfirmasi lunas', 'err');
    } finally {
      setBusyConfirm(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in print:hidden">
      <div className="bg-white rounded-3xl p-6 max-w-sm w-full text-center space-y-4 shadow-2xl border border-slate-200 max-h-[92vh] overflow-y-auto">
        <div
          className={`w-16 h-16 rounded-full flex items-center justify-center text-3xl mx-auto font-black ${
            waitingQris || waitingCash ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'
          }`}
        >
          {waitingQris || waitingCash ? '⏳' : '✅'}
        </div>
        <div>
          <h3 className="text-lg font-black text-slate-900">
            {qrisLoading
              ? 'Menyiapkan QRIS…'
              : waitingQris
                ? 'Menunggu Pembayaran QRIS'
                : waitingCash
                  ? 'Konfirmasi Uang Tunai'
                  : 'Orderan Berhasil Dibuat!'}
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            No. Resi: <b className="text-indigo-600 font-mono">{tx.receipt_number}</b>
          </p>
        </div>

        <div className="bg-slate-50 p-3 rounded-2xl border text-xs text-left space-y-1">
          <p>
            <b>Pelanggan:</b> {tx.customer_name} ({tx.customer_phone || '-'})
          </p>
          <p>
            <b>Est. Selesai:</b> {estDateLabel}
          </p>
          <p>
            <b>Layanan:</b> {tx.service_type}
          </p>
          <p>
            <b>Metode:</b> {tx.payment_method || '-'}
          </p>
          <p>
            <b>Total:</b> Rp {Number(tx.amount || 0).toLocaleString('id-ID')}
          </p>
        </div>

        {waitingQris && (
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-3 space-y-2">
            {qrisLoading ? (
              <div className="flex flex-col items-center gap-2 py-6">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                <p className="text-[11px] font-bold text-indigo-900">Mengambil QRIS Mayar…</p>
                <p className="text-[10px] text-slate-500">Klik sudah diterima — tunggu sebentar.</p>
              </div>
            ) : (
              <>
                {tx.mayar_mock ? (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-left">
                    <p className="text-[11px] font-black text-amber-900">Mode uji / QRIS belum live Mayar</p>
                    <p className="text-[10px] text-amber-800 mt-0.5 leading-relaxed">
                      Jangan scan dengan e-wallet bank. Pakai <b>Buka tautan pembayaran</b> atau <b>Simulasi Bayar</b>. Pastikan Mayar API Key outlet aktif.
                    </p>
                  </div>
                ) : tx.qris_scan_ready === false || (!tx.qris_url && tx.invoice_url) ? (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-left">
                    <p className="text-[11px] font-black text-amber-900">QRIS gambar belum tersedia dari Mayar</p>
                    <p className="text-[10px] text-amber-800 mt-0.5 leading-relaxed">
                      Buka tautan pembayaran — di halaman Mayar ada QRIS yang bisa di-scan e-wallet.
                    </p>
                  </div>
                ) : (
                  <p className="text-[11px] font-bold text-indigo-900">
                    Scan QRIS Mayar di bawah dengan e-wallet. Cetak struk setelah lunas.
                  </p>
                )}
                {tx.qris_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={tx.qris_url}
                    alt="QRIS Mayar"
                    className="w-52 h-52 mx-auto bg-white rounded-xl border object-contain"
                  />
                ) : (
                  <p className="text-[11px] text-amber-700 font-bold py-4">
                    QR belum tersedia
                    {Number(tx.amount) > 0 && Number(tx.amount) < 1000 ? ' — nominal minimal QRIS Rp 1.000' : ''}.
                  </p>
                )}
                {tx.invoice_url && (
                  <a
                    href={tx.invoice_url}
                    target="_blank"
                    rel="noreferrer"
                    className="block w-full text-center rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-extrabold py-2.5"
                  >
                    Buka tautan pembayaran Mayar
                  </a>
                )}
                <div className="flex flex-col gap-2">
                  <CheckPaymentStatusButton orderId={tx.id} onPaid={() => void onPaid({ ...tx, is_paid: true })} />
                  <button
                    type="button"
                    disabled={busyConfirm}
                    onClick={confirmCashierPaid}
                    className="w-full inline-flex items-center justify-center gap-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 text-slate-700 text-[11px] font-bold py-2.5 rounded-xl border border-slate-200"
                  >
                    {busyConfirm ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    Darurat: konfirmasi kasir (jika gateway lambat)
                  </button>
                  <button
                    type="button"
                    disabled={busySim}
                    onClick={simulate}
                    className="w-full inline-flex items-center justify-center gap-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white text-[11px] font-extrabold py-2.5 rounded-xl"
                  >
                    {busySim ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    Simulasi Bayar QRIS (Test)
                  </button>
                </div>
                <p className="text-[9px] text-slate-500">
                  Customer buru-buru? Arahkan ke QR akrilik outlet → login WA di PWA untuk bayar tagihan sendiri.
                </p>
              </>
            )}
          </div>
        )}

        {waitingCash && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 space-y-2 text-left">
            <p className="text-[11px] font-bold text-amber-900">
              Pastikan uang tunai sudah diterima di kasir sebelum mencetak struk.
            </p>
            <button
              type="button"
              onClick={onCashReceived}
              className="w-full bg-amber-600 hover:bg-amber-700 text-white font-extrabold py-3 rounded-xl text-xs shadow-md"
            >
              ✓ Uang diterima — aktifkan cetak struk
            </button>
          </div>
        )}

        {!qtyReady && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-left">
            <p className="text-[11px] font-bold text-rose-800">
              {qtyBlockMessage || 'Lengkapi jumlah Kg dan Pcs di detail transaksi sebelum cetak struk.'}
            </p>
          </div>
        )}

        {!waitingQris && paid && !waitingCash && qtyReady && (
          <p className="text-[11px] font-bold text-emerald-700">Pembayaran lunas. Silakan cetak struk untuk pelanggan.</p>
        )}

        <div className="space-y-2 pt-1">
          <button
            type="button"
            disabled={!canPrint}
            onClick={onPrintReceipt}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl text-xs shadow-md transition flex items-center justify-center gap-2"
          >
            🖨️ CETAK STRUK / NOTA
          </button>
          <button
            type="button"
            disabled={!canPrint}
            onClick={onPrintStickers}
            className="w-full bg-cyan-600 hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-2.5 rounded-xl text-xs shadow-md transition"
          >
            🏷️ Cetak Stiker Kantong
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full bg-slate-200 text-slate-700 font-bold py-2.5 rounded-xl text-xs hover:bg-slate-300 transition"
          >
            Tutup Saja
          </button>
        </div>
      </div>
    </div>
  );
}
