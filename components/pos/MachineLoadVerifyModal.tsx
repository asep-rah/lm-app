'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { playScanFeedback } from '@/lib/opsNotify';
import {
  parseBagQr,
  verifyBagAgainstMachine,
  washerDisplayName,
  type WasherRow
} from '@/lib/lgThinq';

export type LoadVerifyTarget = {
  washerId?: string | null;
  washerName?: string | null;
  orderId?: string | null;
  receipt?: string | null;
  cycleId?: string | null;
  bagLabel?: string | null;
};

export default function MachineLoadVerifyModal({
  open,
  target,
  onCancel,
  onVerified
}: {
  open: boolean;
  target: LoadVerifyTarget | null;
  onCancel: () => void;
  onVerified: (payload: LoadVerifyTarget) => void | Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!open) return;
    setValue('');
    setError('');
    setBusy(false);
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [open, target?.cycleId, target?.washerId]);

  useEffect(() => {
    if (!open || !camOn) {
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
      return;
    }
    let stop = false;
    const run = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stop) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const Detector = (window as any).BarcodeDetector;
        if (!Detector) return;
        const detector = new Detector({ formats: ['qr_code'] });
        const tick = async () => {
          if (stop || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const text = codes?.[0]?.rawValue;
            if (text) {
              setValue(text);
              await submit(text);
              return;
            }
          } catch {
            /* keep scanning */
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      } catch {
        setCamOn(false);
        setError('Kamera tidak tersedia. Scan stiker dengan scanner atau ketik kode QR.');
      }
    };
    run();
    return () => {
      stop = true;
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    };
  }, [open, camOn]);

  if (!open || !target) return null;

  const machineLabel = target.washerName || 'mesin yang ditugaskan';

  const submit = async (raw?: string) => {
    const scanned = parseBagQr(raw ?? value);
    const check = verifyBagAgainstMachine(scanned, {
      washerId: target.washerId,
      orderId: target.orderId,
      receipt: target.receipt
    });
    if (check.ok) {
      playScanFeedback(true);
      setError('');
      setBusy(true);
      try {
        await onVerified(target);
      } finally {
        setBusy(false);
      }
      return;
    }
    playScanFeedback(false);
    let correct = machineLabel;
    if (check.scannedWasherId) {
      const { data } = await supabase.from('washers').select('*').eq('id', check.scannedWasherId).maybeSingle();
      if (data) {
        correct =
          String((data as WasherRow).machine_name || '').trim() ||
          washerDisplayName(data as WasherRow, [data as WasherRow]);
      }
    }
    setError(`SALAH MESIN! Kantong ini dialokasikan untuk ${correct}`);
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl border border-slate-200 p-5 space-y-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-cyan-700">Verifikasi Muat Mesin</p>
          <h3 className="text-lg font-black text-slate-900 mt-0.5">Scan stiker kantong</h3>
          <p className="text-xs text-slate-500 mt-1">
            Scan QR di stiker sebelum siklus LG ThinQ dimulai. Target:{' '}
            <span className="font-bold text-slate-800">{machineLabel}</span>
            {target.bagLabel ? ` · ${target.bagLabel}` : ''}
            {target.receipt ? ` · ${target.receipt}` : ''}
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-2"
        >
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Scan / tempel kode QR stiker…"
            className="w-full border border-slate-200 rounded-xl px-3 py-3 text-sm font-mono font-bold bg-slate-50 focus:outline-none focus:ring-2 focus:ring-cyan-500"
            autoComplete="off"
            inputMode="text"
          />
          {error && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[12px] font-black px-3 py-2">
              🚨 {error}
            </div>
          )}
          {camOn && (
            <video ref={videoRef} className="w-full rounded-xl bg-black aspect-video object-cover" muted playsInline />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCamOn((v) => !v)}
              className="flex-1 border border-slate-200 rounded-xl py-2.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
            >
              {camOn ? 'Tutup Kamera' : '📷 Kamera'}
            </button>
            <button
              type="submit"
              disabled={busy || !value.trim()}
              className="flex-[2] bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white rounded-xl py-2.5 text-[11px] font-black"
            >
              {busy ? 'Memverifikasi…' : '🔔 Verifikasi & Mulai'}
            </button>
          </div>
        </form>
        <button
          type="button"
          onClick={onCancel}
          className="w-full text-[11px] font-bold text-slate-500 py-2"
        >
          Batal
        </button>
      </div>
    </div>
  );
}
