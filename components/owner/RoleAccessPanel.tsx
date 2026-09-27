'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { CONFIGURABLE_ROLES, PERMISSIONS, type PermissionGroup } from '@/lib/accessControl';
import { postStaffApi } from '@/lib/staffApiClient';
import { clearPermissionsCache } from '@/lib/staffPermissionsClient';
import { isStaffSessionError, staffRelogin } from '@/lib/staffRelogin';
import { toast } from '@/lib/toast';

type Loaded = { matrix: Record<string, string[]>; customized: string[]; tableReady: boolean };

const GROUPS: { key: PermissionGroup; title: string; hint: string }[] = [
  { key: 'view', title: 'Boleh memantau', hint: 'Halaman yang boleh dibuka.' },
  { key: 'action', title: 'Boleh menyetujui / mengubah', hint: 'Dicek ulang oleh server setiap kali disimpan.' }
];

/**
 * Owner mengatur hak akses tiap role (/api/owner/role-permissions). Owner
 * sendiri selalu punya semua hak dan tidak tampil di sini.
 */
export default function RoleAccessPanel() {
  const [data, setData] = useState<Loaded | null>(null);
  const [problem, setProblem] = useState<{ text: string; relogin: boolean } | null>(null);
  const [role, setRole] = useState<string>('supervisor');
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/staff/permissions', { cache: 'no-store', credentials: 'same-origin' }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok || !json.matrix) {
      setProblem({ text: json?.error || 'Hak akses belum bisa dimuat.', relogin: isStaffSessionError(json) });
      return;
    }
    setProblem(null);
    setData({ matrix: json.matrix, customized: json.customized || [], tableReady: json.tableReady !== false });
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const saved = useMemo(() => new Set(data?.matrix[role] || []), [data, role]);
  useEffect(() => {
    const t = window.setTimeout(() => setDraft(new Set(saved)), 0);
    return () => window.clearTimeout(t);
  }, [saved]);

  const dirty = saved.size !== draft.size || [...draft].some((k) => !saved.has(k));
  const roleLabel = CONFIGURABLE_ROLES.find((r) => r.value === role)?.label || role;

  const toggle = (key: string) =>
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const submit = async (reset = false) => {
    if (reset && !confirm(`Kembalikan hak akses ${roleLabel} ke bawaan aplikasi?`)) return;
    setBusy(true);
    const res = await postStaffApi('/api/owner/role-permissions', reset ? { role, reset: true } : { role, permissions: [...draft] });
    setBusy(false);
    if (!res.ok) {
      setProblem({ text: res.error, relogin: res.relogin });
      return;
    }
    clearPermissionsCache();
    toast(reset ? 'Hak akses dikembalikan ke bawaan.' : 'Hak akses tersimpan.', 'ok');
    void load();
  };

  return (
    <div className="bg-white border rounded-2xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b">
        <h3 className="text-sm font-black inline-flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4" /> Hak akses role
        </h3>
        <p className="text-[11px] text-slate-400">
          Atur apa yang boleh dipantau dan disetujui tiap role. Owner selalu punya semua hak. Perubahan berlaku saat staf membuka
          halaman berikutnya (paling lambat 1 menit).
        </p>
      </div>
      {problem && (
        <div className="mx-4 mt-3 text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2 space-y-2" role="alert">
          <p>{problem.text}</p>
          {problem.relogin && (
            <button type="button" onClick={staffRelogin} className="bg-rose-600 text-white font-bold px-3 py-1.5 rounded-md">
              Masuk ulang
            </button>
          )}
        </div>
      )}
      {data && !data.tableReady && (
        <p className="mx-4 mt-3 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          Tabel hak akses belum dibuat di database (migrasi 20261010_role_permissions.sql). Sementara semua role memakai hak bawaan.
        </p>
      )}
      <div className="p-4 space-y-4 text-xs">
        <label className="block">
          <span className="text-[11px] font-bold text-slate-500">Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role yang diatur" className="mt-1 w-full border rounded-lg p-2 bg-slate-50">
            {CONFIGURABLE_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
                {data?.customized.includes(r.value) ? ' · diatur owner' : ''}
              </option>
            ))}
          </select>
        </label>
        {GROUPS.map((g) => (
          <fieldset key={g.key} className="border border-slate-100 rounded-xl p-3">
            <legend className="px-1 text-[11px] font-black text-slate-700">{g.title}</legend>
            <p className="text-[10px] text-slate-400 mb-2">{g.hint}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {PERMISSIONS.filter((p) => p.group === g.key).map((p) => (
                <label key={p.key} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50 cursor-pointer">
                  <input type="checkbox" checked={draft.has(p.key)} onChange={() => toggle(p.key)} disabled={!data || busy} className="mt-0.5" />
                  <span>
                    <span className="font-semibold text-slate-700">{p.label}</span>
                    {p.hint && <span className="block text-[10px] text-slate-400">{p.hint}</span>}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <div className="flex flex-wrap gap-2 justify-end">
          <button type="button" onClick={() => submit(true)} disabled={!data || busy} className="border border-slate-200 font-bold rounded-lg px-3 py-2 disabled:opacity-50">
            Kembalikan ke bawaan
          </button>
          <button type="button" onClick={() => submit(false)} disabled={!data || busy || !dirty} className="bg-slate-900 text-white font-black rounded-lg px-4 py-2 disabled:opacity-50">
            {busy ? 'Menyimpan…' : `Simpan hak ${roleLabel.split(' (')[0]}`}
          </button>
        </div>
        <p className="text-[10px] text-slate-400">
          Catatan: pembatasan &quot;memantau&quot; mengatur halaman yang bisa dibuka di aplikasi. Data laporan masih bisa dibaca dari
          browser sampai tahap pengamanan baca data selesai.
        </p>
      </div>
    </div>
  );
}
