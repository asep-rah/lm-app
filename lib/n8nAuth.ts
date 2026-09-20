/**
 * Autentikasi endpoint masuk n8n.
 *
 * Mengikuti pola app/api/cron/crm-retention/route.ts: bearer shared secret,
 * dibandingkan dengan timingSafeEqual lewat verifySharedSecret.
 *
 * Bedanya satu hal: di production, secret yang belum di-set berarti TOLAK,
 * bukan izinkan. Endpoint ini menulis data tagihan dan menyentuh otorisasi,
 * jadi salah-konfigurasi tidak boleh berarti terbuka.
 */

import { verifySharedSecret } from '@/lib/paymentSecurity';

export const n8nAuthorized = (req: Request): boolean => {
  const expected = String(process.env.N8N_SHARED_SECRET || '').trim();
  const provided =
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    req.headers.get('x-n8n-secret') ||
    '';

  if (!expected) {
    // Dev tanpa secret: izinkan supaya workflow bisa diuji lokal.
    return process.env.NODE_ENV !== 'production';
  }
  return verifySharedSecret(provided, expected);
};

export const unauthorized = () =>
  Response.json({ error: 'Unauthorized' }, { status: 401 });
