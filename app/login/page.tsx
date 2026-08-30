'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';
import { homePathForRole } from '@/lib/staffSession';

const supabase = createClient(
  'https://qlgbjvzabnfqmfnjdkmo.supabase.co',
  'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs'
);

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Auto-redirect jika pengguna sudah login sebelumnya
  useEffect(() => {
    const raw = localStorage.getItem('laundry_owner_user') || localStorage.getItem('laundry_user');
    if (!raw) return;
    try {
      const user = JSON.parse(raw);
      window.location.href = homePathForRole(user.role);
    } catch {
      /* ignore */
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setErrorMsg('⚠️ Username dan Password wajib diisi!');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    const cleanUsername = username.toLowerCase().trim();

    // Fetch data karyawan berdasarkan username
    const { data: user, error } = await supabase
      .from('employees')
      .select('*, outlets(id, name)')
      .eq('username', cleanUsername)
      .single();

    if (error || !user) {
      setErrorMsg('❌ Username tidak ditemukan! Periksa kembali username Anda.');
      setIsSubmitting(false);
      return;
    }

    // Verifikasi Password
    if (user.password !== password) {
      setErrorMsg('❌ Password salah! Silakan coba lagi.');
      setIsSubmitting(false);
      return;
    }

    // SIMPAN SESI & AUTO-REDIRECT BERDASARKAN ROLE
    const role = (user.role || 'kasir').toLowerCase();
    localStorage.setItem('laundry_user', JSON.stringify(user));
    localStorage.setItem('laundry_owner_user', JSON.stringify(user));
    window.location.href = homePathForRole(role);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-800 flex items-center justify-center p-4 font-sans">
      <div className="bg-white w-full max-w-md rounded-3xl p-6 md:p-8 shadow-2xl space-y-6 border border-slate-800">
        
        {/* LOGO & TITLE */}
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-blue-900 text-white rounded-2xl flex items-center justify-center text-3xl mx-auto font-black shadow-lg">
            🏛️
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Laundrivery <span className="text-blue-600">ERP</span>
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            Portal Login Staf, Investor & Management
          </p>
        </div>

        {errorMsg && (
          <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold p-3 rounded-2xl text-center shadow-sm animate-in fade-in">
            {errorMsg}
          </div>
        )}

        {/* FORM LOGIN */}
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase tracking-wider">
              Username Staf / Investor
            </label>
            <input
              type="text"
              placeholder="Ketik username Anda..."
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full border border-slate-300 rounded-2xl px-4 py-3 text-sm font-bold bg-slate-50 focus:outline-none focus:border-blue-600 focus:bg-white transition"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase tracking-wider">
              Password
            </label>
            <input
              type="password"
              placeholder="Masukkan password..."
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-slate-300 rounded-2xl px-4 py-3 text-sm font-bold bg-slate-50 focus:outline-none focus:border-blue-600 focus:bg-white transition"
              required
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-blue-900 hover:bg-blue-950 text-white font-black py-4 rounded-2xl text-xs shadow-lg transition active:scale-95"
          >
            {isSubmitting ? 'Memeriksa Akun...' : '⚡ MASUK KE SYSTEM'}
          </button>
        </form>

        {/* LINK LOGIN PELANGGAN */}
        <div className="pt-4 border-t border-slate-100 text-center space-y-2">
          <p className="text-[11px] text-slate-400 font-medium">
            Apakah Anda Pelanggan yang ingin pesan jemputan?
          </p>
          <Link
            href="/customer/login"
            className="inline-block text-xs font-bold text-blue-600 hover:underline"
          >
            📱 Masuk ke Aplikasi Pelanggan
          </Link>
        </div>

      </div>
    </div>
  );
}