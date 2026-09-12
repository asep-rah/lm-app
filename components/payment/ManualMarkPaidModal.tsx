'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2, Upload, X } from 'lucide-react';
import { fileToCompressedDataUrl, uploadProofFile } from '@/lib/uploadProof';
import { paymentOpsClientHeaders } from '@/lib/requirePaymentOpsAuth';

type OrderShape = {
  id: string;
  receipt_number?: string;
  amount?: number;
  customer_phone?: string;
  customer_name?: string;
  created_at?: string;
  outlet_name?: string | null;
  outlet_id?: string;
  payment_method?: string | null;
  payment_status?: string | null;
  status?: string | null;
  mayar_payment_id?: string | null;
  pending_hours?: number | null;
};

type Props = {
  open: boolean;
  order: OrderShape | null;
  agentName?: string;
  role?: string;
  onClose: () => void;
  onSuccess?: () => void;
};

function formatPendingAge(hours: number | null | undefined, createdAt?: string) {
  if (typeof hours === 'number' && Number.isFinite(hours)) {
    if (hours < 24) return `${hours} jam`;
    return `${Math.floor(hours / 24)} hari ${hours % 24} jam`;
  }
  if (createdAt) {
    const h = Math.max(0, Math.round((Date.now() - new Date(createdAt).getTime()) / 36e5));
    return formatPendingAge(h);
  }
  return 'belum diketahui';
}

export default function ManualMarkPaidModal({ open, order, agentName = 'CS', role = 'cs', onClose, onSuccess }: Props) {
  const [note, setNote] = useState('');
  const [bankRef, setBankRef] = useState('');
  const [proofUrl, setProofUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ack, setAck] = useState(false);

  if (!open || !order) return null;

  const submit = async () => {
    setErr('');
    if (!ack) {
      setErr('Centang konfirmasi akibat tindakan terlebih dahulu.');
      return;
    }
    if (note.trim().length < 5) {
      setErr('Catatan verifikasi / alasan wajib (min. 5 karakter).');
      return;
    }
    setBusy(true);
    try {
      let url = proofUrl.trim();
      if (file && !url) {
        url =
          (await uploadProofFile(file, `manual_pay_${order.id}`).catch(() => '')) ||
          (await fileToCompressedDataUrl(file).catch(() => ''));
      }
      if (!url && !bankRef.trim()) {
        setErr('Lampirkan bukti gambar atau isi nomor referensi bank.');
        setBusy(false);
        return;
      }
      const res = await fetch('/api/pay/mark-manual', {
        method: 'POST',
        headers: paymentOpsClientHeaders(),
        body: JSON.stringify({
          transactionId: order.id,
          amount: order.amount,
          receipt: order.receipt_number,
          customerPhone: order.customer_phone,
          agentName,
          role,
          staffId: typeof window !== 'undefined'
            ? (() => {
                try {
                  const raw = localStorage.getItem('laundry_owner_user') || localStorage.getItem('laundry_user');
                  const u = raw ? JSON.parse(raw) : {};
                  return String(u.id || u.username || '');
                } catch {
                  return '';
                }
              })()
            : '',
          note: note.trim(),
          bankRef: bankRef.trim(),
          proofUrl: url
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal menandai lunas');
      onSuccess?.();
      onClose();
      setNote('');
      setBankRef('');
      setProofUrl('');
      setFile(null);
      setAck(false);
    } catch (e: any) {
      setErr(e?.message || 'Gagal menyimpan');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-slate-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-paid-title"
    >
      <div
        className="bg-white w-full max-w-md max-h-[92vh] overflow-y-auto rounded-2xl shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-blue-600 to-indigo-600 text-white sticky top-0 z-10">
          <div>
            <p id="manual-paid-title" className="text-sm font-black">
              Tandai Lunas Manual
            </p>
            <p className="text-[10px] text-blue-100">
              {order.receipt_number || order.id} · Rp {Number(order.amount || 0).toLocaleString('id-ID')}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-2.5 min-h-[44px] min-w-[44px] rounded-lg hover:bg-white/10" aria-label="Tutup dialog">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] text-amber-950 leading-relaxed space-y-1">
            <p className="font-black text-[10px] uppercase tracking-wide text-amber-800">Konfirmasi akibat</p>
            <p>
              Menandai lunas akan mengubah status pembayaran transaksi ini menjadi lunas di Customer, POS, Driver, dan
              Owner. Gunakan hanya jika pembayaran sudah diverifikasi di luar sistem (mutasi bank / bukti QRIS).
            </p>
            <ul className="text-[10px] space-y-0.5 text-amber-900/90 list-disc pl-4">
              <li>Outlet: {order.outlet_name || order.outlet_id || '—'}</li>
              <li>
                Waktu:{' '}
                {order.created_at
                  ? new Date(order.created_at).toLocaleString('id-ID')
                  : '—'}{' '}
                · tertunda {formatPendingAge(order.pending_hours, order.created_at)}
              </li>
              <li>Metode: {order.payment_method || '—'} · status: {order.payment_status || order.status || 'pending'}</li>
              <li>Pelanggan: {order.customer_name || '—'} · {order.customer_phone || '—'}</li>
              {order.mayar_payment_id ? <li>ID gateway: {order.mayar_payment_id}</li> : null}
            </ul>
          </div>

          <label className="flex items-start gap-2 text-[11px] font-semibold text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span>Saya memahami akibatnya dan telah memverifikasi pembayaran transaksi di atas.</span>
          </label>

          <div>
            <label htmlFor="manual-paid-note" className="text-[10px] font-extrabold text-slate-500 uppercase">
              Alasan / catatan verifikasi *
            </label>
            <textarea
              id="manual-paid-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Contoh: Verifikasi manual via mutasi BCA / QRIS Mayar"
              className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800 min-h-[88px]"
            />
          </div>
          <div>
            <label htmlFor="manual-paid-ref" className="text-[10px] font-extrabold text-slate-500 uppercase">
              No. referensi bank
            </label>
            <input
              id="manual-paid-ref"
              value={bankRef}
              onChange={(e) => setBankRef(e.target.value)}
              placeholder="Opsional jika ada bukti gambar"
              className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-xs font-semibold min-h-[44px]"
            />
          </div>
          <div>
            <label htmlFor="manual-paid-proof-url" className="text-[10px] font-extrabold text-slate-500 uppercase">
              URL bukti / unggah
            </label>
            <input
              id="manual-paid-proof-url"
              value={proofUrl}
              onChange={(e) => setProofUrl(e.target.value)}
              placeholder="https://... atau pilih file di bawah"
              className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-xs font-semibold min-h-[44px]"
            />
            <label className="mt-2 flex items-center gap-2 text-[11px] font-bold text-blue-700 cursor-pointer min-h-[44px]">
              <Upload className="w-3.5 h-3.5" />
              <span>{file ? file.name : 'Pilih gambar bukti'}</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </label>
          </div>
          {err ? (
            <p className="text-[11px] font-bold text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2" role="alert">
              {err}
            </p>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-3 min-h-[48px] rounded-2xl text-xs shadow-md disabled:opacity-60 inline-flex items-center justify-center gap-2 transition"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Konfirmasi Lunas Manual
          </button>
        </div>
      </div>
    </div>
  );
}
