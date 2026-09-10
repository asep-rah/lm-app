'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';
import { homePathForRole } from '@/lib/staffSession';

/** Fallback login lama: hanya dipakai jika API staff-login belum deploy / service role belum siap. */
function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!url || !key) return null;
  return createClient(url, key);
}

async function loginViaApi(username: string, password: string) {
  const res = await fetch('/api/auth/staff-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

/** Cadangan: cocokkan username/password langsung (butuh SELECT password diizinkan ke anon). */
async function loginViaAnonFallback(username: string, password: string) {
  const supabase = anonClient();
  if (!supabase) {
    return { error: 'Env Supabase client belum dikonfigurasi di Vercel' };
  }

  const { data: rows, error } = await supabase
    .from('employees')
    .select('id, name, role, outlet_id, username, password, phone, whatsapp, access_outlets, assigned_outlet_ids, basic_salary, outlets(id, name)')
    .ilike('username', username)
    .limit(1);

  if (error) {
    return {
      error: `Gagal baca employees (${error.message}). Jalankan hotfix SQL login atau set SUPABASE_SERVICE_ROLE_KEY + deploy staff-login.`
    };
  }

  const user = rows?.[0];
  if (!user) {
    return { error: 'Username tidak ditemukan di employees (cek Table Editor).' };
  }

  if (String((user as any).password || '') !== password) {
    return { error: 'Password salah' };
  }

  const { password: _pw, ...safe } = user as any;
  return { user: safe };
}

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

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

  const finishLogin = (user: any) => {
    const role = (user.role || 'kasir').toLowerCase();
    localStorage.setItem('laundry_user', JSON.stringify(user));
    localStorage.setItem('laundry_owner_user', JSON.stringify(user));
    if (user?.id) localStorage.setItem('user_id', String(user.id));
    window.location.href = homePathForRole(role);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setErrorMsg('⚠️ Username dan Password wajib diisi!');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    const cleanUsername = username.toLowerCase().trim();

    try {
      const { res, json } = await loginViaApi(cleanUsername, password);

      if (res.ok && json.user) {
        finishLogin(json.user);
        return;
      }

      // API belum ada (404) / service role belum siap (503) / error server → coba fallback anon
      const shouldFallback = res.status === 404 || res.status === 503 || res.status >= 500;
      if (shouldFallback) {
        const fb = await loginViaAnonFallback(cleanUsername, password);
        if (fb.user) {
          finishLogin(fb.user);
          return;
        }
        setErrorMsg(`❌ ${fb.error || json.error || 'Login gagal'}`);
        setIsSubmitting(false);
        return;
      }

      // 401 dll dari API — jika username "tidak ditemukan" padahal bisa jadi RLS, coba fallback sekali
      if (res.status === 401) {
        const fb = await loginViaAnonFallback(cleanUsername, password);
        if (fb.user) {
          finishLogin(fb.user);
          return;
        }
      }

      setErrorMsg(`❌ ${json.error || 'Login gagal'}`);
      setIsSubmitting(false);
    } catch {
      try {
        const fb = await loginViaAnonFallback(cleanUsername, password);
        if (fb.user) {
          finishLogin(fb.user);
          return;
        }
        setErrorMsg(`❌ ${fb.error || 'Jaringan bermasalah. Coba lagi.'}`);
      } catch {
        setErrorMsg('❌ Jaringan bermasalah. Coba lagi.');
      }
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-800 flex items-center justify-center p-4 font-sans">
      <div className="bg-white w-full max-w-md rounded-3xl p-6 md:p-8 shadow-2xl space-y-6 border border-slate-800">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-blue-900 text-white rounded-2xl flex items-center justify-center text-3xl mx-auto font-black shadow-lg">
            🏛️
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Laundrivery <span className="text-blue-600">ERP</span>
          </h1>
          <p className="text-xs text-slate-500 font-medium">Portal Login Staf, Investor & Management</p>
        </div>

        {errorMsg && (
          <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold p-3 rounded-2xl text-center shadow-sm">
            {errorMsg}
          </div>
        )}

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
              autoComplete="username"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase tracking-wider">Password</label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-slate-300 rounded-2xl px-4 py-3 text-sm font-bold bg-slate-50 focus:outline-none focus:border-blue-600 focus:bg-white transition"
              required
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-slate-900 hover:bg-blue-700 disabled:opacity-60 text-white font-black py-3.5 rounded-2xl text-sm tracking-wide transition shadow-lg"
          >
            {isSubmitting ? 'Memverifikasi…' : '⚡ MASUK KE SYSTEM'}
          </button>
        </form>

        <p className="text-center text-[11px] text-slate-500 leading-relaxed">
          Apakah Anda Pelanggan yang ingin pesan jemputan?{' '}
          <Link href="/customer/login" className="text-blue-600 font-bold hover:underline">
            📱 Masuk ke Aplikasi Pelanggan
          </Link>
        </p>
      </div>
    </div>
  );
}
