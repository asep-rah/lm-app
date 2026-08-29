'use client';

import { useState } from 'react';
import FileProofInput from '@/components/FileProofInput';
import { COURIER_VENDORS } from '@/lib/thirdPartyDelivery';
import { uploadProofFile } from '@/lib/uploadProof';
import { toast } from '@/lib/toast';

export default function ThirdPartyDispatchForm({
  onSubmit,
  busy,
  submitLabel = 'Kirim ke Kurir Pihak Ketiga'
}: {
  onSubmit: (vals: {
    vendor: string;
    driverNameAndPlate: string;
    trackingUrl: string;
    handoverPhotoUrl: string;
  }) => Promise<void> | void;
  busy?: boolean;
  submitLabel?: string;
}) {
  const [vendor, setVendor] = useState('');
  const [driver, setDriver] = useState('');
  const [url, setUrl] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendor) return toast('Pilih vendor kurir.', 'warn');
    if (!driver.trim()) return toast('Isi nama driver dan plat nomor.', 'warn');
    if (!url.trim() || !/^https?:\/\//i.test(url.trim())) {
      return toast('Tempel URL tracking dari aplikasi kurir.', 'warn');
    }
    if (!photo) return toast('Foto serah terima ke kurir wajib diunggah.', 'warn');
    setUploading(true);
    try {
      const handoverPhotoUrl = await uploadProofFile(photo, `tp_handover_${Date.now()}`);
      if (!handoverPhotoUrl) return toast('Gagal unggah foto serah terima.', 'err');
      await onSubmit({
        vendor,
        driverNameAndPlate: driver.trim(),
        trackingUrl: url.trim(),
        handoverPhotoUrl
      });
    } catch (err: any) {
      toast(err?.message || 'Gagal unggah foto.', 'err');
    } finally {
      setUploading(false);
    }
  };

  const locked = busy || uploading;

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-[10px] font-black text-slate-500 mb-1">Vendor kurir</label>
        <select
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
          required
          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-800"
        >
          <option value="">Pilih GoSend / GrabExpress / Lalamove…</option>
          {COURIER_VENDORS.map((v) => (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[10px] font-black text-slate-500 mb-1">Nama driver & plat nomor</label>
        <input
          type="text"
          value={driver}
          onChange={(e) => setDriver(e.target.value)}
          required
          placeholder="Contoh: Budi · B 1234 XYZ"
          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-800"
        />
      </div>
      <div>
        <label className="block text-[10px] font-black text-slate-500 mb-1">URL live tracking</label>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          placeholder="Tempel link dari aplikasi GoSend / Grab / Lalamove"
          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-800"
        />
      </div>
      <div>
        <label className="block text-[10px] font-black text-rose-600 mb-1">Foto serah terima ke kurir (wajib)</label>
        <FileProofInput file={photo} onFile={setPhoto} capture="environment" required label="Ambil / unggah foto kantong ke kurir" />
      </div>
      <button
        type="submit"
        disabled={locked}
        className="w-full bg-amber-500 hover:bg-amber-600 text-white font-black text-xs py-3 rounded-xl disabled:opacity-50"
      >
        {locked ? 'Mengirim…' : submitLabel}
      </button>
    </form>
  );
}
