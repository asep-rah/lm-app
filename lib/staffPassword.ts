import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const PREFIX = 'scrypt$';
const KEYLEN = 64;

/** Hash password staf (scrypt). Format: scrypt$saltHex$hashHex */
export function hashStaffPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(String(plain), salt, KEYLEN);
  return `${PREFIX}${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function isHashedStaffPassword(stored: string): boolean {
  return String(stored || '').startsWith(PREFIX);
}

/**
 * Verifikasi password. Mendukung:
 * - hash scrypt baru
 * - plaintext legacy (sementara, sampai login berikutnya me-rehash)
 */
export function verifyStaffPassword(stored: string, plain: string): boolean {
  const s = String(stored || '');
  const p = String(plain || '');
  if (!s || !p) return false;

  if (isHashedStaffPassword(s)) {
    const parts = s.split('$');
    if (parts.length !== 3) return false;
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    if (!salt.length || !expected.length) return false;
    try {
      const actual = scryptSync(p, salt, expected.length);
      return timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }

  // Legacy plaintext — bandingkan panjang-aman bila memungkinkan
  const a = Buffer.from(s);
  const b = Buffer.from(p);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
