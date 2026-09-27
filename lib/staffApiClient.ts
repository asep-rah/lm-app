import { isStaffSessionError } from '@/lib/staffRelogin';

export type StaffApiResult<T = Record<string, unknown>> = { ok: boolean; data: T; error: string; relogin: boolean };

/** POST JSON ke API staf/owner dengan cookie sesi staf (browser). */
export async function postStaffApi<T = Record<string, unknown>>(path: string, body: unknown): Promise<StaffApiResult<T>> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).catch(() => null);
  const data = (res ? await res.json().catch(() => ({})) : {}) as T & { error?: string };
  if (res?.ok) return { ok: true, data, error: '', relogin: false };
  return {
    ok: false,
    data,
    error: String(data?.error || (res ? `Gagal (${res.status})` : 'Koneksi bermasalah')),
    relogin: isStaffSessionError(data)
  };
}
