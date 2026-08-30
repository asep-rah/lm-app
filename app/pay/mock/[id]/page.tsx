'use client';

import { useEffect, useState } from 'react';
import { simulateMayarAutoPay } from '@/lib/mayar';

export default function MockMayarPayPage() {
  const [meta, setMeta] = useState({ paymentId: '', resi: '-', amount: 0, tx: '', topup: '', cashDeposit: '', phone: '', href: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const parts = window.location.pathname.split('/');
    setMeta({
      paymentId: parts[parts.length - 1] || '',
      resi: q.get('resi') || '-',
      amount: Number(q.get('amount') || 0),
      tx: q.get('tx') || '',
      topup: q.get('topup') || '',
      cashDeposit: q.get('cashDeposit') || '',
      phone: q.get('phone') || '',
      href: window.location.href
    });
  }, []);

  const qris = meta.href
    ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(meta.href)}`
    : '';

  const pay = async () => {
    if (!meta.tx && !meta.topup && !meta.cashDeposit) {
      setErr('Transaksi tidak tertaut. Gunakan tombol Test Auto-Payment di CS/POS.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await simulateMayarAutoPay({
        transactionId: meta.tx || undefined,
        topupId: meta.topup || undefined,
        cashDepositId: meta.cashDeposit || undefined,
        receipt: meta.resi,
        amount: meta.amount,
        customerPhone: meta.phone || undefined
      });
      setDone(true);
    } catch (e: any) {
      setErr(e?.message || 'Gagal simulasi');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 max-w-sm w-full space-y-3 text-center">
        <p className="text-[10px] font-black uppercase tracking-wider text-amber-700">Mayar Mock Invoice</p>
        <p className="font-mono font-black text-slate-900">{meta.resi}</p>
        <p className="text-2xl font-black text-emerald-700">Rp {meta.amount.toLocaleString('id-ID')}</p>
        {qris && <img src={qris} alt="QRIS mock" className="w-40 h-40 mx-auto bg-white rounded-xl border" />}
        <p className="text-[11px] text-slate-500">Mode uji (KYC Mayar belum aktif). QR ini tidak memotong saldo sungguhan.</p>
        {done ? (
          <p className="text-sm font-black text-emerald-700">Pembayaran mock terkonfirmasi.</p>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={pay}
            className="w-full bg-emerald-600 text-white font-black text-sm py-3 rounded-xl"
          >
            {busy ? 'Memproses…' : 'Test Auto-Payment Sim'}
          </button>
        )}
        {err && <p className="text-[11px] text-rose-600 font-bold">{err}</p>}
        <p className="text-[9px] text-slate-400 font-mono truncate">{meta.paymentId}</p>
      </div>
    </div>
  );
}
