'use client';

/**
 * Browser helpers for the customer login. The verified session itself lives in
 * an HttpOnly cookie (unreadable here); these helpers only read the public
 * state from /api/customer/auth/session and keep the legacy localStorage keys
 * that the dashboard/POS-facing code already uses in sync.
 */

export type CustomerAuthConfig = {
  whatsapp: boolean;
  email: boolean;
  legacy: boolean;
  legacyWaNumber: string | null;
};

export type CustomerAuthSession = {
  phone: string;
  method: 'whatsapp' | 'email';
  expiresAt: number;
  email: { masked: string; verified: boolean } | null;
};

export type CustomerAuthState = { config: CustomerAuthConfig; session: CustomerAuthSession | null };

/** Used when the API is unreachable: behave exactly like before this change. */
export const LEGACY_ONLY_STATE: CustomerAuthState = {
  // Same number the legacy login page used before this change.
  config: { whatsapp: false, email: false, legacy: true, legacyWaNumber: '6285172141494' },
  session: null
};

export async function fetchCustomerAuthState(): Promise<CustomerAuthState> {
  try {
    const res = await fetch('/api/customer/auth/session', { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) return LEGACY_ONLY_STATE;
    const json = await res.json();
    if (!json?.config) return LEGACY_ONLY_STATE;
    return { config: json.config, session: json.session || null };
  } catch {
    return LEGACY_ONLY_STATE;
  }
}

export const LOCAL_PHONE_KEY = 'laundry_customer_phone';
const LOCAL_PROFILE_KEY = 'laundrivery_customer';

export function persistCustomerLocal(phone: string) {
  try {
    localStorage.setItem(LOCAL_PHONE_KEY, phone);
    localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify({ phone, login_time: new Date().toISOString() }));
  } catch {
    /* storage unavailable */
  }
}

export function clearCustomerLocal() {
  try {
    localStorage.removeItem(LOCAL_PHONE_KEY);
    localStorage.removeItem(LOCAL_PROFILE_KEY);
  } catch {
    /* ignore */
  }
}

export async function logoutCustomer() {
  clearCustomerLocal();
  try {
    await fetch('/api/customer/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {
    /* cookie expires by itself */
  }
}

/** Only same-app relative paths are allowed as post-login redirect targets. */
export const safeNextPath = (raw: string | null | undefined) => {
  const s = String(raw || '');
  return s.startsWith('/') && !s.startsWith('//') && !s.includes('\\') ? s : '/customer/dashboard';
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON body from our own API routes
export async function postJson<T = any>(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body ?? {})
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}
