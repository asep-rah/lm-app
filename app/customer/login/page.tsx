'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Loader2, Phone, Truck } from 'lucide-react';

export default function CustomerLogin() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState(1);
  const [loginCode, setLoginCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Standarisasi Format Nomor HP (0812xxxx)
  const cleanPhone = (str: string) => {
    let cleaned = str.trim().replace(/\D/g, '');
    if (cleaned.startsWith('62')) cleaned = '0' + cleaned.slice(2);
    return cleaned;
  };

  const handleGenerateWA = (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedPhone = cleanPhone(phone);
    if (normalizedPhone.length < 9) return alert('Nomor WhatsApp tidak valid!');

    const code = 'LDRV-' + Math.floor(1000 + Math.random() * 9000);
    setLoginCode(code);
    setStep(2);

    // Ganti dengan Nomor WA Admin/CS Resmi Outlet Anda
    const adminWA = '6285172141494'; 
    const message = `Halo Admin Laundrivery!%0A%0ASaya ingin masuk ke Aplikasi Pelanggan.%0A%0A*Nomor WA:* ${normalizedPhone}%0A*Kode Akses:* ${code}%0A%0ATerima kasih!`;
    
    window.open(`https://wa.me/${adminWA}?text=${message}`, '_blank');
  };

  const handleConfirmLogin = () => {
    setIsSubmitting(true);
    const normalizedPhone = cleanPhone(phone);
    
    // SINKRONISASI KEY LOCALSTORAGE SESUAI CUSTOMER DASHBOARD
    localStorage.setItem('laundry_customer_phone', normalizedPhone);
    localStorage.setItem('laundrivery_customer', JSON.stringify({
      phone: normalizedPhone,
      login_time: new Date().toISOString()
    }));

    setTimeout(() => {
      router.push('/customer/dashboard');
    }, 800);
  };

  return (
    <div className="min-h-screen bg-slate-900 flex justify-center items-center p-4">
      <div className="bg-white w-full max-w-sm rounded-[32px] p-6 shadow-2xl relative overflow-hidden">
        
        <div className="absolute -top-16 -right-16 w-32 h-32 bg-blue-100 rounded-full blur-2xl opacity-60"></div>
        <div className="absolute -bottom-16 -left-16 w-32 h-32 bg-indigo-100 rounded-full blur-2xl opacity-60"></div>

        <div className="relative z-10 text-center mt-4 mb-8">
          <div className="bg-blue-900 text-white w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-950/40 rotate-3">
            <Truck className="w-8 h-8" strokeWidth={2} />
          </div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight">Laundrivery.</h1>
          <p className="text-xs text-slate-500 mt-1 font-medium">Cuci baju tanpa keluar rumah.</p>
        </div>

        {step === 1 && (
          <form onSubmit={handleGenerateWA} className="relative z-10 space-y-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                Nomor WhatsApp Anda
              </label>
              <input
                type="tel"
                placeholder="Contoh: 08123456789"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3.5 text-sm font-bold text-slate-800 focus:outline-none focus:border-blue-800 focus:bg-white transition-all shadow-inner"
                required
              />
            </div>
            
            <button type="submit" className="w-full bg-blue-900 hover:bg-blue-950 text-white font-black py-4 rounded-2xl text-sm shadow-xl shadow-blue-900/30 transition-all active:scale-[0.98] inline-flex items-center justify-center gap-2">
              <Phone className="w-4 h-4" /> Masuk dengan WhatsApp
            </button>
            <p className="text-[10px] text-center text-slate-400 mt-4 leading-relaxed px-4">
              Kami akan membuka WhatsApp Anda untuk mengirim kode keamanan (Tanpa biaya OTP / SMS).
            </p>
          </form>
        )}

        {step === 2 && (
          <div className="relative z-10 space-y-5 animate-in fade-in zoom-in duration-300">
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-center">
              <p className="text-[10px] font-bold text-blue-900 uppercase mb-1">Kode Akses Anda</p>
              <h2 className="text-3xl font-black text-blue-900 tracking-widest">{loginCode}</h2>
            </div>

            <div className="text-center space-y-2">
              <p className="text-xs font-semibold text-slate-600">
                Silakan kirim pesan WhatsApp yang baru saja terbuka ke nomor kami.
              </p>
              <p className="text-[10px] text-amber-800 font-bold bg-amber-50 p-2 rounded-lg border border-amber-200 inline-flex items-center justify-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Jangan tutup halaman ini sebelum Anda mengirim pesan WA!
              </p>
            </div>

            <button
              onClick={handleConfirmLogin}
              disabled={isSubmitting}
              className="w-full bg-blue-900 hover:bg-blue-950 text-white font-black py-4 rounded-2xl text-sm shadow-xl shadow-blue-900/30 transition-all active:scale-[0.98] inline-flex items-center justify-center gap-2"
            >
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
        )}
      </div>
    </div>
  );
}