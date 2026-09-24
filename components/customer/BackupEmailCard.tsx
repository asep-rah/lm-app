'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2, Mail, ShieldAlert } from 'lucide-react';
import { postJson, type CustomerAuthState } from '@/lib/customerAuth/client';

/**
 * Profil → Email cadangan. Shown only when the email feature is enabled on the
 * server. Linking requires a verified session (WhatsApp/email), and the email
 * is linked only after its 6-digit code is confirmed.
 */
export default function BackupEmailCard({
  auth,
  onLinked,
  onRelogin
}: {
  auth: CustomerAuthState | null;
  onLinked: () => void;
  onRelogin: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!auth?.config.email) return null;
  const linked = auth.session?.email;

  const start = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { ok, data } = await postJson('/api/customer/auth/email/link/start', { email });
      if (!ok) return setError(data?.error || 'Gagal mengirim kode.');
      setChallengeId(String(data.challengeId || ''));
      setMsg(String(data.message || 'Kode dikirim ke email Anda.'));
      setCode('');
    } catch {
      setError('Koneksi bermasalah. Coba lagi.');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { ok, data } = await postJson('/api/customer/auth/email/link/verify', { challengeId, code });
      if (!ok) return setError(data?.error || 'Kode salah.');
      setEditing(false);
      setChallengeId('');
      setEmail('');
      onLinked();
    } catch {
      setError('Koneksi bermasalah. Coba lagi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pt-2 border-t border-slate-100 space-y-2">
      <span className="text-[10px] text-slate-400 uppercase font-extrabold block">Email cadangan (untuk masuk)</span>

      {!auth.session ? (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 space-y-2">
          <p className="text-[11px] text-amber-900 font-semibold inline-flex items-start gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            Untuk menautkan email, masuk ulang dengan WhatsApp terverifikasi terlebih dahulu.
          </p>
          <button type="button" onClick={onRelogin} className="text-[11px] font-extrabold text-brand-700 underline">
            Verifikasi nomor WhatsApp
          </button>
        </div>
      ) : linked?.verified && !editing ? (
        <div className="flex items-center justify-between gap-2">
          <p className="font-bold text-slate-800 text-xs inline-flex items-center gap-1.5 min-w-0">
            <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate">{linked.masked}</span>
            <span className="shrink-0 inline-flex items-center gap-0.5 text-[9px] font-black text-emerald-700 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded-full">
              <CheckCircle2 className="w-3 h-3" /> Terverifikasi
            </span>
          </p>
          <button type="button" onClick={() => setEditing(true)} className="text-[10px] font-extrabold text-brand-700 shrink-0">
            Ganti
          </button>
        </div>
      ) : !challengeId ? (
        <form onSubmit={start} className="space-y-2">
          {!linked && (
            <p className="text-[11px] text-slate-500">
              Belum ada email tertaut. Tambahkan agar tetap bisa masuk bila WhatsApp tidak tersedia.
            </p>
          )}
          <input
            type="email"
            autoComplete="email"
            placeholder="nama@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-800"
            required
          />
          {error && <p className="text-[11px] font-semibold text-rose-600" role="alert">{error}</p>}
          <div className="flex gap-2">
            {editing && (
              <button type="button" onClick={() => setEditing(false)} className="flex-1 border border-slate-200 text-slate-600 text-[11px] font-bold py-2.5 rounded-xl">
                Batal
              </button>
            )}
            <button type="submit" disabled={busy} className="flex-1 bg-brand-600 text-white text-[11px] font-extrabold py-2.5 rounded-xl inline-flex items-center justify-center gap-1 disabled:opacity-60">
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Kirim kode verifikasi
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-2">
          <p className="text-[11px] text-slate-600">{msg}</p>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="Kode 6 digit"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-base font-bold text-center tracking-[0.4em]"
            required
          />
          {error && <p className="text-[11px] font-semibold text-rose-600" role="alert">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setChallengeId('')} className="flex-1 border border-slate-200 text-slate-600 text-[11px] font-bold py-2.5 rounded-xl">
              Ganti email
            </button>
            <button type="submit" disabled={busy || code.length !== 6} className="flex-1 bg-brand-600 text-white text-[11px] font-extrabold py-2.5 rounded-xl disabled:opacity-60">
              Verifikasi
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
