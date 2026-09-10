'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2, Upload, X } from 'lucide-react';
import { fileToCompressedDataUrl, uploadProofFile } from '@/lib/uploadProof';
import { paymentOpsClientHeaders } from '@/lib/requirePaymentOpsAuth';

type Props = {
  open: boolean;
  order: {
    id: string;
    receipt_number?: string;
    amount?: number;
    customer_phone?: string;
    customer_name?: string;
  } | null;
  agentName?: string;
  role?: string;
  onClose: () => void;
  onSuccess?: () => void;
};

export default function ManualMarkPaidModal({ open, order, agentName = 'CS', role = 'cs', onClose, onSuccess }: Props) {
  const [note, setNote] = useState('');
  const [bankRef, setBankRef] = useState('');
  const [proofUrl, setProofUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!open || !order) return null;

  const submit = async () => {
    setErr('');
    if (note.trim().length < 5) {
      setErr('Catatan verifikasi wajib (min. 5 karakter).');
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
    } catch (e: any) {
      setErr(e?.message || 'Gagal menyimpan');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
          <div>
            <p className="text-sm font-black">Tandai Lunas Manual</p>
            <p className="text-[10px] text-blue-100">
              {order.receipt_number || order.id} · Rp {Number(order.amount || 0).toLocaleString('id-ID')}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-[11px] text-slate-600 leading-relaxed">
            Wajib lampiran bukti / ref bank + catatan. Status akan sinkron ke Customer, POS, Driver, dan Owner.
          </p>
          <div>
            <label className="text-[10px] font-extrabold text-slate-500 uppercase">Catatan verifikasi *</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Contoh: Verifikasi manual via mutasi BCA / QRIS Mayar"
              className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800"
            />
          </div>
          <div>
            <label className="text-[10px] font-extrabold text-slate-500 uppercase">No. referensi bank</label>
            <input
              value={bankRef}
              onChange={(e) => setBankRef(e.target.value)}
              placeholder="Opsional jika ada bukti gambar"
              className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold"
            />
          </div>
          <div>
            <label className="text-[10px] font-extrabold text-slate-500 uppercase">URL bukti / unggah</label>
            <input
              value={proofUrl}
              onChange={(e) => setProofUrl(e.target.value)}
              placeholder="https://... atau pilih file di bawah"
              className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold"
            />
            <label className="mt-2 flex items-center gap-2 text-[11px] font-bold text-blue-700 cursor-pointer">
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
            <p className="text-[11px] font-bold text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{err}</p>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-3 rounded-2xl text-xs shadow-md disabled:opacity-60 inline-flex items-center justify-center gap-2 transition"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Konfirmasi Lunas
          </button>
        </div>
      </div>
    </div>
  );
}
