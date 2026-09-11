import { verifySharedSecret, paymentServiceDb } from '@/lib/paymentSecurity';
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
};

/** Bearer PAYMENT_OPS_SECRET (atau CRON_SECRET) + staf terdaftar dengan role yang diizinkan. */
export async function requirePaymentOpsAuth(
  req: Request,
  body: { staffId?: string; agentName?: string; role?: string },
  kind: 'manual' | 'resync' = 'manual'
): Promise<PaymentOpsAuth | PaymentOpsAuthFail> {
  const isProd = process.env.NODE_ENV === 'production';
  const expected = String(process.env.PAYMENT_OPS_SECRET || process.env.CRON_SECRET || '').trim();
  const header =
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    req.headers.get('x-payment-ops-secret') ||
    '';

  if (isProd) {
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
  const allowed = kind === 'resync' ? RESYNC_ROLES : MANUAL_ROLES;

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
