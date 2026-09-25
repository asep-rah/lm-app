/**
 * Phone numbers of customers — Indonesian AND foreign — in one place.
 *
 * Forms (all derived from the same parse):
 * - stored   (customers.phone, pickup_orders.customer_phone, …):
 *              Indonesia  → 08…            (unchanged; existing data stays valid)
 *              foreign    → +<cc><number>  (the "+" keeps it apart from 08…/62…)
 * - key      (unambiguous comparison key, thread keys, WA login challenges):
 *              Indonesia  → 62…            (what the app used before)
 *              foreign    → +<cc><number>
 * - wa       (wa.me links, Evolution API, payment "mobile"): digits with
 *              the country code, no "+": 62…, 65…, 81…
 *
 * Parsing rules:
 * - "+…" or "00…" → international. +62… is Indonesia.
 * - no "+": 0… / 62… / 8… (9–13 digits) → Indonesia (as before);
 *   any other 7–15 digits → treated as already carrying a country code.
 * Foreign numbers that start with 8 (Japan +81, Korea +82, China +86, …)
 * MUST be typed with "+" (the country picker does this), otherwise they
 * read as Indonesian 8… — the long-standing Indonesian shorthand wins.
 */

export type ParsedPhone = {
  /** Indonesian number (+62). */
  indonesia: boolean;
  /** Country code + number, digits only (62812…, 6591…). */
  digits: string;
};

const MIN_E164 = 7;
const MAX_E164 = 15;
const ID_MOBILE = /^628\d{7,12}$/;

export function parsePhone(raw: unknown, opts: { international?: boolean } = {}): ParsedPhone | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  let d = s.replace(/\D/g, '');
  if (!d) return null;
  let intl = opts.international === true || s.startsWith('+');
  if (!intl && d.startsWith('00')) {
    d = d.slice(2);
    intl = true;
  }
  if (intl) {
    if (d.startsWith('62')) return d.length > 4 ? { indonesia: true, digits: d } : null;
    if (d.startsWith('0') || d.length < MIN_E164 || d.length > MAX_E164) return null;
    return { indonesia: false, digits: d };
  }
  if (d.startsWith('0')) return d.length > 4 ? { indonesia: true, digits: '62' + d.slice(1) } : null;
  if (d.startsWith('62')) return d.length > 4 ? { indonesia: true, digits: d } : null;
  if (d.startsWith('8') && d.length >= 9 && d.length <= 13) return { indonesia: true, digits: '62' + d };
  if (d.length >= MIN_E164 + 1 && d.length <= MAX_E164) return { indonesia: false, digits: d };
  return null;
}

/** Stored form: 08… for Indonesia, +<cc>… otherwise. '' when unparseable. */
export const storedPhone = (raw: unknown, opts?: { international?: boolean }): string => {
  const p = parsePhone(raw, opts);
  if (!p) return '';
  return p.indonesia ? '0' + p.digits.slice(2) : '+' + p.digits;
};

/** Comparison key: 62… for Indonesia, +<cc>… otherwise. '' when unparseable. */
export const phoneKey = (raw: unknown, opts?: { international?: boolean }): string => {
  const p = parsePhone(raw, opts);
  if (!p) return '';
  return p.indonesia ? p.digits : '+' + p.digits;
};

/** Digits for wa.me / WhatsApp gateways (country code, no "+"). '' when unparseable. */
export const waDigits = (raw: unknown): string => parsePhone(raw)?.digits ?? '';

/** Valid customer WhatsApp number: Indonesian mobile (08…) or any foreign number (7–15 digits). */
export const isValidCustomerPhone = (raw: unknown, opts?: { international?: boolean }): boolean => {
  const p = parsePhone(raw, opts);
  if (!p) return false;
  return p.indonesia ? ID_MOBILE.test(p.digits) : p.digits.length >= MIN_E164 && p.digits.length <= MAX_E164;
};

/**
 * Every form a number may have been stored in before (for lookups with
 * .in(column, keys)). Indonesian: raw, 08…, 62…, +62…; foreign: raw, +cc…, cc….
 */
export const phoneLookupKeys = (raw: unknown): string[] => {
  const out = new Set<string>();
  const s = String(raw ?? '').trim();
  if (s) out.add(s);
  const p = parsePhone(raw);
  if (p) {
    if (p.indonesia) {
      const n = p.digits.slice(2);
      out.add('0' + n);
      out.add('62' + n);
      out.add('+62' + n);
    } else {
      out.add('+' + p.digits);
      out.add(p.digits);
    }
  } else {
    const d = s.replace(/\D/g, '');
    if (d) out.add(d);
  }
  return [...out].filter(Boolean);
};

/** Same customer? (any stored form). */
export const samePhone = (a: unknown, b: unknown): boolean => {
  const x = phoneKey(a);
  return Boolean(x) && x === phoneKey(b);
};

/** 08•••1234 / +65•••4567 — for screens that must not show the full number. */
export const maskPhone = (raw: unknown): string => {
  const p = parsePhone(raw);
  const d = p?.digits || String(raw ?? '').replace(/\D/g, '');
  if (d.length < 4) return '';
  const last4 = d.slice(-4);
  if (!p || p.indonesia) return `08•••${last4}`;
  return `+${d.slice(0, 2)}•••${last4}`;
};
