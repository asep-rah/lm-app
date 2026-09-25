'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, Loader2, Mail, MessageCircle, RefreshCw, Send } from 'lucide-react';
import {
  fetchCustomerAuthState,
  persistCustomerLocal,
  postJson,
  safeNextPath,
  type CustomerAuthConfig
} from '@/lib/customerAuth/client';
import PhoneNumberInput from '@/components/PhoneNumberInput';
import { isValidCustomerPhone, storedPhone } from '@/lib/phone';

// Nomor tersimpan (lib/phone): 08… untuk Indonesia, +<kode negara>… untuk luar negeri.
const cleanPhone = (str: string) => storedPhone(str);

const WA_PENDING_KEY = 'ldrv_wa_login_pending';
const RESEND_COOLDOWN_SEC = 30;

type WaChallenge = { challengeId: string; code: string; waLink: string; expiresAt: string; phone: string };
type WaPhase = 'input' | 'waiting' | 'verified' | 'expired' | 'failed';

function BrandLogo() {
  return (
    <div className="flex flex-col items-center">
      <Image
        src="/images/Logo-Laundrivery.png"
        alt="Laundrivery — Tinggal Klik, Delivery Quick."
        width={1525}
        height={1240}
        priority
        sizes="176px"
        className="w-44 h-auto"
      />
    </div>
  );
}

const inputClass =
  'w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3.5 text-base font-bold text-slate-800 focus:outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100 focus:bg-white transition-all';
const primaryBtn =
  'w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-black py-4 rounded-2xl text-sm shadow-lg shadow-brand-600/25 transition-all active:scale-[0.98] inline-flex items-center justify-center gap-2';

export default function CustomerLogin() {
  const router = useRouter();
  const [config, setConfig] = useState<CustomerAuthConfig | null>(null);
  const [method, setMethod] = useState<'whatsapp' | 'email'>('whatsapp');

  useEffect(() => {
    fetchCustomerAuthState().then((state) => {
      if (state.session?.phone) {
        persistCustomerLocal(state.session.phone);
        router.replace(safeNextPath(new URLSearchParams(window.location.search).get('next')));
        return;
      }
      setConfig(state.config);
      if (!state.config.whatsapp && !state.config.legacy && state.config.email) setMethod('email');
    });
  }, [router]);

  const finishLogin = useCallback(
    (phone: string) => {
      persistCustomerLocal(phone);
      try {
        sessionStorage.removeItem(WA_PENDING_KEY);
      } catch {
        /* ignore */
      }
      router.replace(safeNextPath(new URLSearchParams(window.location.search).get('next')));
    },
    [router]
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50 to-white flex justify-center items-start sm:items-center px-4 py-8">
      <div className="bg-white w-full max-w-sm rounded-[28px] p-6 shadow-xl shadow-brand-900/10 border border-brand-100">
        <div className="mt-2 mb-6">
          <BrandLogo />
          <p className="text-center text-xs text-slate-500 mt-3 font-medium">Masuk untuk memesan jemput & melihat status cucian.</p>
        </div>

        {!config ? (
          <div className="flex justify-center py-10 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" aria-label="Memuat" />
          </div>
        ) : (
          <>
            {config.email && (config.whatsapp || config.legacy) && (
              <div className="grid grid-cols-2 gap-1 bg-slate-100 p-1 rounded-2xl mb-5" role="tablist">
                {(['whatsapp', 'email'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={method === m}
                    onClick={() => setMethod(m)}
                    className={`py-2.5 rounded-xl text-xs font-extrabold inline-flex items-center justify-center gap-1.5 transition ${
                      method === m ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500'
                    }`}
                  >
                    {m === 'whatsapp' ? <MessageCircle className="w-4 h-4" /> : <Mail className="w-4 h-4" />}
                    {m === 'whatsapp' ? 'WhatsApp' : 'Email'}
                  </button>
                ))}
              </div>
            )}

            {method === 'email' && config.email ? (
              <EmailLogin onDone={finishLogin} />
            ) : config.whatsapp ? (
              <WhatsAppVerifiedLogin onDone={finishLogin} />
            ) : config.legacy ? (
              <LegacyWhatsAppLogin adminWa={config.legacyWaNumber || ''} onDone={finishLogin} />
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900 font-semibold text-center">
                Login sedang dalam pemeliharaan. Silakan coba beberapa saat lagi atau hubungi CS outlet.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* WhatsApp — verifikasi otomatis via nomor sistem (Evolution API)            */
/* -------------------------------------------------------------------------- */

function WhatsAppVerifiedLogin({ onDone }: { onDone: (phone: string) => void }) {
  // Lanjutkan menunggu jika halaman dimuat ulang setelah kembali dari WhatsApp.
  // Aman dibaca saat init: komponen ini hanya dirender di browser setelah config dimuat.
  const [resumed] = useState<WaChallenge | null>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(WA_PENDING_KEY) || 'null') as WaChallenge | null;
      if (saved?.challengeId && new Date(saved.expiresAt).getTime() > Date.now()) return saved;
      sessionStorage.removeItem(WA_PENDING_KEY);
    } catch {
      /* ignore */
    }
    return null;
  });
  const [phone, setPhone] = useState(resumed?.phone || '');
  const [phase, setPhase] = useState<WaPhase>(resumed ? 'waiting' : 'input');
  const [challenge, setChallenge] = useState<WaChallenge | null>(resumed);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const pollingRef = useRef(false);

  const checkStatus = useCallback(async () => {
    if (!challenge || pollingRef.current) return;
    pollingRef.current = true;
    try {
      const res = await fetch(`/api/customer/auth/wa/status?id=${encodeURIComponent(challenge.challengeId)}`, {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      const data = await res.json().catch(() => ({}));
      if (data.status === 'verified' && data.phone) {
        setPhase('verified');
        setTimeout(() => onDone(String(data.phone)), 700);
      } else if (data.status === 'expired') {
        setPhase('expired');
        setError(data.error || 'Kode sudah kedaluwarsa. Minta kode baru.');
      } else if (data.status === 'failed') {
        setPhase('failed');
        setError(data.error || 'Verifikasi gagal. Silakan mulai ulang.');
      }
    } catch {
      /* jaringan putus sesaat — coba lagi di interval berikutnya */
    } finally {
      pollingRef.current = false;
    }
  }, [challenge, onDone]);

  useEffect(() => {
    if (phase !== 'waiting') return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const poll = window.setInterval(checkStatus, 2500);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkStatus();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [phase, checkStatus]);

  const start = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError('');
    const normalized = cleanPhone(phone);
    if (!normalized || !isValidCustomerPhone(normalized)) {
      setError('Nomor WhatsApp tidak valid. Contoh: 081234567890, atau pilih kode negara untuk nomor luar negeri.');
      return;
    }
    setBusy(true);
    try {
      const { ok, data } = await postJson('/api/customer/auth/wa/start', { phone: normalized });
      if (!ok) {
        setError(data?.error || 'Gagal memulai verifikasi.');
        if (data?.retryAfterSec) setCooldownUntil(Date.now() + Number(data.retryAfterSec) * 1000);
        return;
      }
      const next: WaChallenge = { ...data, phone: normalized };
      setChallenge(next);
      setPhase('waiting');
      setCooldownUntil(Date.now() + RESEND_COOLDOWN_SEC * 1000);
      try {
        sessionStorage.setItem(WA_PENDING_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    } catch {
      setError('Koneksi bermasalah. Coba lagi.');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setPhase('input');
    setChallenge(null);
    setError('');
    try {
      sessionStorage.removeItem(WA_PENDING_KEY);
    } catch {
      /* ignore */
    }
  };

  const remainingSec = challenge ? Math.max(0, Math.round((new Date(challenge.expiresAt).getTime() - now) / 1000)) : 0;
  const cooldownSec = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  if (phase === 'input') {
    return (
      <form onSubmit={start} className="space-y-4">
        <div>
          <label htmlFor="wa-phone" className="block text-[11px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
            Nomor WhatsApp Anda
          </label>
          <PhoneNumberInput id="wa-phone" value={phone} onChange={setPhone} required />
        </div>
        {error && <p className="text-[11px] font-semibold text-rose-600" role="alert">{error}</p>}
        <button type="submit" disabled={busy || cooldownSec > 0} className={primaryBtn}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
          {cooldownSec > 0 ? `Tunggu ${cooldownSec} dtk` : 'Lanjut verifikasi WhatsApp'}
        </button>
        <p className="text-[11px] text-center text-slate-500 leading-relaxed px-2">
          Anda akan mengirim satu pesan WhatsApp berisi kode ke nomor resmi Laundrivery. Tanpa biaya SMS dan tanpa perlu
          menyalin OTP.
        </p>
      </form>
    );
  }

  if (phase === 'verified') {
    return (
      <div className="text-center space-y-3 py-6" role="status">
        <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
        <p className="font-black text-slate-900">Nomor terverifikasi</p>
        <p className="text-xs text-slate-500">Mengalihkan ke beranda…</p>
      </div>
    );
  }

  if (phase === 'expired' || phase === 'failed') {
    return (
      <div className="space-y-4">
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-center space-y-1" role="alert">
          <AlertTriangle className="w-6 h-6 text-rose-600 mx-auto" />
          <p className="text-sm font-black text-rose-800">{phase === 'expired' ? 'Kode kedaluwarsa' : 'Verifikasi gagal'}</p>
          <p className="text-xs text-rose-700">{error}</p>
        </div>
        <button type="button" onClick={() => start()} disabled={busy || cooldownSec > 0} className={primaryBtn}>
          <RefreshCw className="w-4 h-4" /> {cooldownSec > 0 ? `Minta kode baru (${cooldownSec} dtk)` : 'Minta kode baru'}
        </button>
        <button type="button" onClick={reset} className="w-full text-xs font-bold text-slate-500 py-2 inline-flex items-center justify-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" /> Ganti nomor
        </button>
      </div>
    );
  }

  // phase === 'waiting'
  return (
    <div className="space-y-4">
      <div className="bg-brand-50 border border-brand-200 rounded-2xl p-4 text-center">
        <p className="text-[10px] font-bold text-brand-800 uppercase tracking-wider">Kode masuk untuk {challenge?.phone}</p>
        <p className="text-2xl font-black text-brand-800 tracking-widest mt-1">{challenge?.code}</p>
        <p className="text-[11px] text-brand-700 font-semibold mt-1 inline-flex items-center gap-1">
          <Clock className="w-3.5 h-3.5" /> Berlaku {Math.floor(remainingSec / 60)}:{String(remainingSec % 60).padStart(2, '0')}
        </p>
      </div>

      <ol className="text-xs text-slate-700 space-y-1.5 list-decimal pl-5 font-medium">
        <li>Tekan tombol di bawah untuk membuka WhatsApp. Pesan berisi kode sudah terisi otomatis.</li>
        <li>
          <b>Tekan tombol Kirim</b> <Send className="w-3 h-3 inline -mt-0.5" /> di WhatsApp. Kirim dari nomor yang sama dengan
          yang Anda masukkan.
        </li>
        <li>Kembali ke halaman ini. Anda akan masuk otomatis.</li>
      </ol>

      <a href={challenge?.waLink} target="_blank" rel="noopener noreferrer" className={primaryBtn}>
        <MessageCircle className="w-4 h-4" /> Buka WhatsApp & kirim kode
      </a>

      <div className="flex items-center justify-center gap-2 text-[11px] font-semibold text-slate-500" role="status" aria-live="polite">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Menunggu pesan Anda diterima…
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={reset}
          className="border border-slate-200 text-slate-600 font-bold text-xs py-3 rounded-2xl inline-flex items-center justify-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Kembali
        </button>
        <button
          type="button"
          onClick={() => start()}
          disabled={busy || cooldownSec > 0}
          className="border border-brand-200 text-brand-700 font-bold text-xs py-3 rounded-2xl inline-flex items-center justify-center gap-1 disabled:opacity-50"
        >
          <RefreshCw className="w-3.5 h-3.5" /> {cooldownSec > 0 ? `Kirim ulang (${cooldownSec})` : 'Kode baru'}
        </button>
      </div>
      {error && <p className="text-[11px] font-semibold text-rose-600 text-center">{error}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Email — cadangan (hanya email yang sudah ditautkan & diverifikasi)         */
/* -------------------------------------------------------------------------- */

function EmailLogin({ onDone }: { onDone: (phone: string) => void }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { ok, data } = await postJson('/api/customer/auth/email/start', { email });
      if (!ok) return setError(data?.error || 'Gagal mengirim kode.');
      setChallengeId(String(data.challengeId || ''));
      setInfo(String(data.message || 'Kode dikirim.'));
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
      const { ok, data } = await postJson('/api/customer/auth/email/verify', { challengeId, code });
      if (!ok) return setError(data?.error || 'Kode salah.');
      onDone(String(data.phone));
    } catch {
      setError('Koneksi bermasalah. Coba lagi.');
    } finally {
      setBusy(false);
    }
  };

  if (!challengeId) {
    return (
      <form onSubmit={send} className="space-y-4">
        <div>
          <label htmlFor="login-email" className="block text-[11px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
            Email cadangan
          </label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            placeholder="nama@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            required
          />
        </div>
        {error && <p className="text-[11px] font-semibold text-rose-600" role="alert">{error}</p>}
        <button type="submit" disabled={busy} className={primaryBtn}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />} Kirim kode ke email
        </button>
        <p className="text-[11px] text-center text-slate-500 leading-relaxed">
          Hanya untuk email yang sudah ditautkan dari menu <b>Profil</b> setelah masuk dengan WhatsApp. Belum punya? Masuk
          dengan WhatsApp dulu.
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-4">
      <p className="text-xs text-slate-600 bg-brand-50 border border-brand-100 rounded-2xl p-3 font-medium">{info}</p>
      <div>
        <label htmlFor="login-code" className="block text-[11px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
          Kode 6 digit
        </label>
        <input
          id="login-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          className={`${inputClass} text-center tracking-[0.5em]`}
          required
        />
      </div>
      {error && <p className="text-[11px] font-semibold text-rose-600" role="alert">{error}</p>}
      <button type="submit" disabled={busy || code.length !== 6} className={primaryBtn}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Masuk
      </button>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setChallengeId('')} className="text-xs font-bold text-slate-500 py-2">
          Ganti email
        </button>
        <button type="button" onClick={() => send()} disabled={busy} className="text-xs font-bold text-brand-700 py-2">
          Kirim ulang kode
        </button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Legacy — perilaku lama, dipakai HANYA saat WhatsApp otomatis belum aktif   */
/* (CUSTOMER_WA_LOGIN_ENABLED belum true). Tidak ada verifikasi server.        */
/* -------------------------------------------------------------------------- */

function LegacyWhatsAppLogin({ adminWa, onDone }: { adminWa: string; onDone: (phone: string) => void }) {
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState(1);
  const [loginCode, setLoginCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleGenerateWA = (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedPhone = cleanPhone(phone);
    if (!normalizedPhone || !isValidCustomerPhone(normalizedPhone)) return alert('Nomor WhatsApp tidak valid!');
    const code = 'LDRV-' + Math.floor(1000 + Math.random() * 9000);
    setLoginCode(code);
    setStep(2);
    const message = `Halo Admin Laundrivery!%0A%0ASaya ingin masuk ke Aplikasi Pelanggan.%0A%0A*Nomor WA:* ${normalizedPhone}%0A*Kode Akses:* ${code}%0A%0ATerima kasih!`;
    window.open(`https://wa.me/${adminWa}?text=${message}`, '_blank');
  };

  const handleConfirmLogin = () => {
    setIsSubmitting(true);
    setTimeout(() => onDone(cleanPhone(phone)), 800);
  };

  if (step === 1) {
    return (
      <form onSubmit={handleGenerateWA} className="space-y-4">
        <div>
          <label htmlFor="legacy-phone" className="block text-[11px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
            Nomor WhatsApp Anda
          </label>
          <PhoneNumberInput id="legacy-phone" value={phone} onChange={setPhone} required />
        </div>
        <button type="submit" className={primaryBtn}>
          <MessageCircle className="w-4 h-4" /> Masuk dengan WhatsApp
        </button>
        <p className="text-[10px] text-center text-slate-400 leading-relaxed px-4">
          Kami akan membuka WhatsApp Anda untuk mengirim kode keamanan (Tanpa biaya OTP / SMS).
        </p>
      </form>
    );
  }

  return (
    <div className="space-y-5">
      <div className="bg-brand-50 border border-brand-200 rounded-2xl p-4 text-center">
        <p className="text-[10px] font-bold text-brand-800 uppercase mb-1">Kode Akses Anda</p>
        <h2 className="text-3xl font-black text-brand-800 tracking-widest">{loginCode}</h2>
      </div>
      <div className="text-center space-y-2">
        <p className="text-xs font-semibold text-slate-600">Silakan kirim pesan WhatsApp yang baru saja terbuka ke nomor kami.</p>
        <p className="text-[10px] text-amber-800 font-bold bg-amber-50 p-2 rounded-lg border border-amber-200 inline-flex items-center justify-center gap-1">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Jangan tutup halaman ini sebelum Anda mengirim pesan WA!
        </p>
      </div>
      <button onClick={handleConfirmLogin} disabled={isSubmitting} className={primaryBtn}>
        {isSubmitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> Mengalihkan...
          </>
        ) : (
          <>
            <CheckCircle2 className="w-4 h-4" /> Saya sudah kirim pesan WA
          </>
        )}
      </button>
      <button onClick={() => setStep(1)} className="w-full text-xs font-bold text-slate-400 hover:text-slate-600 pt-2">
        Batal / Ganti Nomor
      </button>
    </div>
  );
}
