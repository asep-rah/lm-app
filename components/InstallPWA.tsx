'use client';

import { useEffect, useState } from 'react';

export default function InstallPWA() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Register Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    // Cek jika aplikasi sudah di-install (mode standalone)
    if (window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone) {
      setIsStandalone(true);
      return;
    }

    // Cek jika perangkat iOS
    const userAgent = window.navigator.userAgent.toLowerCase();
    const ios = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(ios);

    // Tangkap trigger install dari Android / Chrome
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  if (isStandalone) return null;

  return (
    <div className="my-3">
      {/* Banner Android / Chrome */}
      {deferredPrompt && (
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-4 rounded-xl shadow-md flex items-center justify-between">
          <div>
            <p className="font-bold text-sm">Install Aplikasi Laundrivery</p>
            <p className="text-xs text-blue-100">Simpan ke Layar Utama untuk akses lebih mudah.</p>
          </div>
          <button
            onClick={handleInstallClick}
            className="bg-white text-blue-600 px-4 py-2 rounded-lg font-bold text-xs shadow hover:bg-blue-50 transition"
          >
            Install
          </button>
        </div>
      )}

      {/* Banner Khusus iOS / Safari */}
      {isIOS && !deferredPrompt && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 p-3 rounded-xl text-xs shadow-sm">
          <p className="font-bold mb-1">💡 Pasang di iPhone / iPad:</p>
          <p>
            Tekan ikon <span className="font-semibold">Bagikan (Share) 📤</span> di bagian bawah Safari, lalu pilih <span className="font-semibold">"Tambah ke Utama" (Add to Home Screen)</span>.
          </p>
        </div>
      )}
    </div>
  );
}