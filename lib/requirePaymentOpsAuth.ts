import { verifySharedSecret, paymentServiceDb } from '@/lib/paymentSecurity';
import { verifyStaffSession } from '@/lib/staffAuth/core';
import { STAFF_SESSION_COOKIE, staffSessionSecret } from '@/lib/staffAuth/server';
import { sanitizePublicError } from '@/lib/supabaseEnv';

const MANUAL_ROLES = new Set([
  'cs',
  'cs_care',
  'head_cs',
  'owner',
  'supervisor',
  'finance',
  'head_finance',
  'admin_ops',
  'admin',
  'kasir',
  'cashier',
  'pos',
  'crew',
  'outlet'
]);

const RESYNC_ROLES = new Set(['owner', 'supervisor', 'finance', 'head_finance', 'admin_ops', 'admin']);

export type PaymentOpsAuth = {
  ok: true;
  agentName: string;
  role: string;
  staffId: string;
};

export type PaymentOpsAuthFail = {
  ok: false;
  status: number;
  error: string;
  /** STAFF_SESSION_REQUIRED → layar menawarkan "Masuk ulang". */
  code?: string;
};

const cookieOf = (req: Request, name: string) => {
  const raw = req.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
};

/**
 * PAYMENT_OPS_SECRET sebagai satu-satunya bukti hanya sah bila TIDAK ikut
 * dikirim ke browser. Dengan NEXT_PUBLIC_PAYMENT_OPS_SECRET terisi, rahasia itu
 * ada di bundle JS publik: siapa pun bisa memakainya dengan staffId karangan.
 */
const bearerOnlyAllowed = () => !String(process.env.NEXT_PUBLIC_PAYMENT_OPS_SECRET || '').trim();

/** Bearer PAYMENT_OPS_SECRET (atau CRON_SECRET) + staf terdaftar dengan role yang diizinkan. */
export async function requirePaymentOpsAuth(
  req: Request,
  body: { staffId?: string; agentName?: string; role?: string },
  kind: 'manual' | 'resync' = 'manual'
): Promise<PaymentOpsAuth | PaymentOpsAuthFail> {
  const isProd = process.env.NODE_ENV === 'production';
  const allowedRoles = kind === 'resync' ? RESYNC_ROLES : MANUAL_ROLES;

  // 1) Sesi staf bertanda tangan (cookie dari /api/auth/staff-login): identitas &
  //    role dibaca dari employees, isi body (staffId/agentName/role) diabaikan.
  const sessionSecret = staffSessionSecret();
  if (sessionSecret) {
    const session = verifyStaffSession(cookieOf(req, STAFF_SESSION_COOKIE), sessionSecret);
    if (session) {
      try {
        const { data: emp } = await paymentServiceDb().from('employees').select('id, name, role').eq('id', session.sid).maybeSingle();
        if (!emp) return { ok: false, status: 401, error: 'Akun staf tidak ditemukan. Keluar lalu masuk lagi.', code: 'STAFF_SESSION_REQUIRED' };
        const role = String(emp.role || '').toLowerCase().trim();
        if (!allowedRoles.has(role)) return { ok: false, status: 403, error: `Role ${role || '—'} tidak boleh operasi pembayaran ini` };
        return { ok: true, agentName: String(emp.name || 'Staf'), role, staffId: String(emp.id) };
      } catch (e: any) {
        return { ok: false, status: 500, error: sanitizePublicError(`Gagal verifikasi staf: ${String(e?.message || '')}`) };
      }
    }
    if (isProd && !bearerOnlyAllowed()) {
      return {
        ok: false,
        status: 401,
        error: 'Sesi login staf berakhir atau belum ada. Keluar lalu masuk lagi.',
        code: 'STAFF_SESSION_REQUIRED'
      };
    }
  }

  // 2) Rahasia server (skrip/cron) — hanya bila rahasianya tidak publik, atau sesi staf
  //    belum dikonfigurasi (perilaku lama; system-health menandainya merah).
  const expected = String(process.env.PAYMENT_OPS_SECRET || process.env.CRON_SECRET || '').trim();
  const header =
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    req.headers.get('x-payment-ops-secret') ||
    '';

  if (isProd) {
    if (!header && sessionSecret) {
      return { ok: false, status: 401, error: 'Sesi login staf berakhir atau belum ada. Keluar lalu masuk lagi.', code: 'STAFF_SESSION_REQUIRED' };
    }
    if (!expected) {
      return { ok: false, status: 503, error: 'PAYMENT_OPS_SECRET / CRON_SECRET belum dikonfigurasi di server' };
    }
    if (!verifySharedSecret(header, expected)) {
      return { ok: false, status: 401, error: 'Unauthorized' };
    }
  } else if (expected && !verifySharedSecret(header, expected)) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  const staffId = String(body.staffId || '').trim();
  const agentName = String(body.agentName || '').trim();
  const claimedRole = String(body.role || '').toLowerCase().trim();
  const allowed = allowedRoles;

  if (!staffId && !agentName) {
    return { ok: false, status: 401, error: 'Identitas staf wajib (staffId / agentName)' };
  }

  try {
    const db = paymentServiceDb();
    let emp: { id?: string; name?: string; role?: string } | null = null;

    if (staffId) {
      const byId = await db.from('employees').select('id, name, role').eq('id', staffId).maybeSingle();
      emp = byId.data;
      if (!emp) {
        const byUser = await db.from('employees').select('id, name, role').eq('username', staffId).maybeSingle();
        emp = byUser.data;
      }
    }
    if (!emp && agentName) {
      const byName = await db.from('employees').select('id, name, role').eq('name', agentName).limit(1);
      emp = byName.data?.[0] || null;
    }

    if (!emp) {
      // Dev: izinkan claimed role.
      // Prod + secret sudah OK: izinkan role elevated (resync) agar Owner tidak
      // terkunci setelah reset DB / mismatch localStorage vs baris employees.
      const canBootstrap =
        claimedRole &&
        allowed.has(claimedRole) &&
        (!isProd || (kind === 'resync' && RESYNC_ROLES.has(claimedRole)));
      if (canBootstrap) {
        return {
          ok: true,
          agentName: agentName || 'Owner',
          role: claimedRole,
          staffId: staffId || 'bootstrap'
        };
      }
      return { ok: false, status: 403, error: 'Staf tidak ditemukan / tidak berwenang' };
    }

    const role = String(emp.role || claimedRole || '').toLowerCase().trim();
    if (!allowed.has(role)) {
      return { ok: false, status: 403, error: `Role ${role || '—'} tidak boleh operasi pembayaran ini` };
    }

    return {
      ok: true,
      agentName: String(emp.name || agentName || 'Staf'),
      role,
      staffId: String(emp.id || staffId)
    };
  } catch (e: any) {
    const msg = String(e?.message || '');
    if (/SUPABASE_SERVICE_ROLE_KEY/i.test(msg)) {
      return {
        ok: false,
        status: 503,
        error: 'SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi di server (Vercel)'
      };
    }
    return {
      ok: false,
      status: 500,
      error: sanitizePublicError(msg ? `Gagal verifikasi staf: ${msg}` : 'Gagal verifikasi staf')
    };
  }
}

/** Header untuk fetch dari client staff (set NEXT_PUBLIC_PAYMENT_OPS_SECRET = PAYMENT_OPS_SECRET). */
export function paymentOpsClientHeaders(extra?: Record<string, string>): HeadersInit {
  const secret = String(process.env.NEXT_PUBLIC_PAYMENT_OPS_SECRET || '').trim();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(extra || {})
  };
  if (secret) headers.Authorization = `Bearer ${secret}`;
  return headers;
}
