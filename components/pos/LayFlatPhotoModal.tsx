'use client';

import { useEffect, useRef, useState } from 'react';
import { intakePcsOf, intakePhotosOf, PCS_MISMATCH_ALERT } from '@/lib/layFlatProof';

const MAX_SHOTS = 3;

export default function LayFlatPhotoModal({
  open,
  stage,
  order,
  notes,
  onNotes,
  busy,
  onCancel,
  onSubmit
}: {
  open: boolean;
  stage: 'sortir' | 'kemas';
  order: any;
  notes: string;
  onNotes: (v: string) => void;
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (payload: { files: File[]; pcs: number }) => void | Promise<void>;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [pcs, setPcs] = useState('');
  const [camOn, setCamOn] = useState(false);
  const [camErr, setCamErr] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isKemas = stage === 'kemas';
  const intakePcs = intakePcsOf(order);
  const intakePhotos = intakePhotosOf(order);
  const outputPcs = Number(pcs) || 0;
  const pcsMismatch = isKemas && intakePcs > 0 && outputPcs > 0 && outputPcs !== intakePcs;

  useEffect(() => {
    if (!open) return;
    setFiles([]);
    setCamErr('');
    setCamOn(false);
    setPcs(isKemas ? (intakePcs ? String(intakePcs) : '') : String(order?.pcs_count || ''));
  }, [open, order?.id, stage]);

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  useEffect(() => {
    if (!open || !camOn) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      return;
    }
    let stop = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } } })
      .then((stream) => {
        if (stop) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => undefined);
        }
      })
      .catch(() => {
        setCamOn(false);
        setCamErr('Kamera tidak tersedia. Unggah foto dari galeri.');
      });
    return () => {
      stop = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open, camOn]);

  if (!open) return null;

  const tableLabel = isKemas ? 'Kemas' : 'Sortir';
  const addFiles = (next: File[]) => {
    setFiles((prev) => [...prev, ...next].slice(0, MAX_SHOTS));
  };

  const snap = () => {
    const video = videoRef.current;
    if (!video || files.length >= MAX_SHOTS) return;
    const w = video.videoWidth || 960;
    const h = video.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        addFiles([new File([blob], `layflat_${stage}_${Date.now()}.jpg`, { type: 'image/jpeg' })]);
      },
      'image/jpeg',
      0.82
    );
  };

  return (
    <div className="fixed inset-0 z-[110] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 max-h-[94vh] overflow-y-auto p-4 space-y-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-cyan-700">
            Mode Foto Berjajar di Meja {tableLabel}
          </p>
          <h3 className="text-lg font-black text-slate-900">
            {isKemas ? 'Kemas Akhir · QC Lay-Flat' : 'Sortir Awal · Intake Lay-Flat'}
          </h3>
          <p className="text-xs text-slate-500">
            {order?.customer_name || 'Pelanggan'}
            {order?.receipt_number ? ` · ${order.receipt_number}` : ''}
          </p>
        </div>

        {isKemas && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-2.5">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-2">Perbandingan visual</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] font-black text-slate-600 mb-1">Foto Sortir Awal</p>
                {intakePhotos[0] ? (
                  <img src={intakePhotos[0]} alt="Sortir awal" className="w-full h-28 object-cover rounded-xl border border-slate-200" />
                ) : (
                  <div className="h-28 rounded-xl border border-dashed border-slate-300 text-[10px] text-slate-400 flex items-center justify-center">
                    Belum ada foto sortir
                  </div>
                )}
                {intakePhotos.length > 1 && (
                  <p className="text-[9px] text-slate-400 mt-1">{intakePhotos.length} foto intake</p>
                )}
              </div>
              <div>
                <p className="text-[10px] font-black text-slate-600 mb-1">Foto Kemas Akhir</p>
                {previews[0] ? (
                  <img src={previews[0]} alt="Kemas akhir" className="w-full h-28 object-cover rounded-xl border border-cyan-200" />
                ) : (
                  <div className="h-28 rounded-xl border border-dashed border-cyan-200 text-[10px] text-cyan-600 flex items-center justify-center">
                    Ambil foto kemas
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="relative rounded-2xl overflow-hidden bg-black aspect-[4/3]">
          {camOn ? (
            <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white/70 text-xs font-bold px-6 text-center">
              Nyalakan kamera, susun cucian berjajar di meja, lalu jepret hingga 3 foto.
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="border border-white/35" />
            ))}
          </div>
          <div className="absolute top-2 left-2 right-2 flex justify-between">
            <span className="text-[9px] font-black uppercase tracking-wider bg-black/50 text-white px-2 py-0.5 rounded-full">
              Grid meja {tableLabel}
            </span>
            <span className="text-[9px] font-black bg-black/50 text-white px-2 py-0.5 rounded-full">
              {files.length}/{MAX_SHOTS} burst
            </span>
          </div>
        </div>

        {camErr && <p className="text-[11px] font-bold text-rose-600">{camErr}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setCamOn((v) => !v)}
            className="flex-1 border border-slate-200 rounded-xl py-2.5 text-[11px] font-bold"
          >
            {camOn ? 'Tutup Kamera' : '📷 Nyalakan Kamera'}
          </button>
          <button
            type="button"
            onClick={snap}
            disabled={!camOn || files.length >= MAX_SHOTS}
            className="flex-1 bg-cyan-600 disabled:opacity-40 text-white rounded-xl py-2.5 text-[11px] font-black"
          >
            Jepret
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={files.length >= MAX_SHOTS}
            className="flex-1 border border-slate-200 rounded-xl py-2.5 text-[11px] font-bold"
          >
            Galeri
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) addFiles([f]);
            e.target.value = '';
          }}
        />

        {previews.length > 0 && (
          <div className="flex gap-2">
            {previews.map((src, i) => (
              <button
                key={src}
                type="button"
                onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                className="relative w-16 h-16 rounded-xl overflow-hidden border border-slate-200"
              >
                <img src={src} alt={`Burst ${i + 1}`} className="w-full h-full object-cover" />
                <span className="absolute inset-x-0 bottom-0 text-[8px] font-black text-white bg-black/50 text-center">Hapus</span>
              </button>
            ))}
          </div>
        )}

        <label className="block">
          <span className="text-[11px] font-black text-slate-700">
            {isKemas ? 'Output pcs (hasil kemas)' : 'Total pcs awal (intake)'} <span className="text-rose-500">*</span>
          </span>
          <input
            type="number"
            min={0}
            value={pcs}
            onChange={(e) => setPcs(e.target.value)}
            placeholder="Contoh: 23"
            className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold bg-slate-50"
          />
        </label>
        {isKemas && (
          <p className="text-[11px] font-bold text-slate-500">
            Intake tercatat: <span className="text-slate-800">{intakePcs || 0} pcs</span>
          </p>
        )}
        {pcsMismatch && (
          <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[12px] font-black px-3 py-2">
            {PCS_MISMATCH_ALERT}
          </div>
        )}

        <label className="block">
          <span className="text-[11px] font-bold text-slate-600">Catatan staf (opsional)</span>
          <input
            type="text"
            value={notes}
            onChange={(e) => onNotes(e.target.value)}
            placeholder="Noda kerah, 2 hanger terpisah"
            className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm"
          />
        </label>

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onCancel} className="flex-1 bg-slate-100 font-bold py-3 rounded-xl text-slate-600 text-sm">
            Kembali
          </button>
          <button
            type="button"
            disabled={busy || !files.length || !outputPcs || pcsMismatch}
            onClick={() => onSubmit({ files, pcs: outputPcs })}
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black py-3 rounded-xl text-sm"
          >
            {busy ? 'Mengunggah…' : isKemas ? 'Simpan QC & Lanjut' : 'Simpan Intake & Lanjut'}
          </button>
        </div>
      </div>
    </div>
  );
}
