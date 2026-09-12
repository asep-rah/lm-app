/** Mayar.id QRIS helper. Live API when a valid key exists; otherwise mock QRIS. */

export type MayarChargeInput = {
  amount: number;
  name?: string;
  description?: string;
  mobile?: string;
  email?: string;
  receipt?: string;
  transactionId?: string;
  outletId?: string;
  apiKey?: string;
  payoutAccountId?: string;
  baseUrl?: string;
  /**
   * pos_qris = hanya QRIS dinamis (tanpa payment-link).
   * Mencegah double bayar: scan QR kasir vs tautan invoice Mayar.
   */
  mode?: 'full' | 'pos_qris';
};

export type MayarChargeResult = {
  mock: boolean;
  paymentId: string;
  /** ID payment-link / single payment request (jika ada) — untuk di-close setelah lunas. */
  linkPaymentId?: string;
  invoiceUrl: string;
  qrisUrl: string;
  /** true = QR berisi payload QRIS GPN yang bisa di-scan e-wallet */
  scanReady?: boolean;
  qrString?: string;
  raw?: unknown;
};

const MAYAR_CREATE_URL = 'https://api.mayar.id/hl/v1/payment/create';
const MAYAR_CREATE_URL_V2 = 'https://api.mayar.id/hl/v2/payments/create';
const MAYAR_QR_CREATE_V2 = 'https://api.mayar.id/hl/v2/qr-codes/create';
const MAYAR_QR_CREATE_V1 = 'https://api.mayar.id/hl/v1/qrcode/create';

export const isMayarKeyValid = (key?: string | null) => {
  const k = String(key || '').trim();
  if (k.length < 12) return false;
  if (/^(mock|test|invalid|undefined|null|changeme)$/i.test(k)) return false;
  return true;
};

export const appBaseUrl = (override?: string) =>
  String(override || process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || 'http://localhost:3000')
    .replace(/\/$/, '')
    .replace(/^(?!https?:\/\/)/, 'https://');

export const isMockPaymentsEnabled = () =>
  /^(1|true|yes|on)$/i.test(
    String(process.env.NEXT_PUBLIC_ENABLE_MOCK_PAYMENTS || process.env.ENABLE_MOCK_PAYMENTS || '')
  );

export const mockQrisImageUrl = (payload?: string) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(
    payload || 'https://mayar.id'
  )}`;

export const buildMockMayarCharge = (input: MayarChargeInput): MayarChargeResult => {
  const receipt = String(input.receipt || input.transactionId || Date.now());
  const paymentId = `mock_${receipt.replace(/[^a-zA-Z0-9_-]/g, '').slice(-16)}_${Date.now().toString(36)}`;
  const invoiceUrl = `${appBaseUrl(input.baseUrl)}/pay/mock/${encodeURIComponent(paymentId)}?resi=${encodeURIComponent(
    receipt
  )}&amount=${Number(input.amount) || 0}&tx=${encodeURIComponent(String(input.transactionId || ''))}`;
  return {
    mock: true,
    paymentId,
    invoiceUrl,
    qrisUrl: mockQrisImageUrl(invoiceUrl),
    scanReady: false
  };
};

const resolveKey = (input?: MayarChargeInput) => {
  if (isMayarKeyValid(input?.apiKey)) return String(input?.apiKey).trim();
  if (isMayarKeyValid(process.env.MAYAR_API_KEY)) return String(process.env.MAYAR_API_KEY).trim();
  return '';
};

const asInvoiceUrl = (value: unknown) => {
  const s = String(value || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return `https://mayar.id/pl/${s}`;
};

const isEmvQrisString = (raw: string) => {
  const s = String(raw || '').trim();
  return s.startsWith('000201') && s.length > 40;
};

const isMayarQrImageUrl = (raw: string) => {
  const s = String(raw || '').trim();
  return /^https?:\/\//i.test(s) && (/media\.mayar\./i.test(s) || /\.(png|jpg|jpeg|webp)(\?|$)/i.test(s));
};

const pickQrisFromPayload = (
  data: any
): { qrisUrl: string; scanReady: boolean; qrString?: string } => {
  const direct =
    data?.qrisUrl ||
    data?.qrUrl ||
    data?.qr_url ||
    data?.qrImage ||
    data?.qr_image ||
    data?.qris_url ||
    data?.url;
  if (direct && isMayarQrImageUrl(String(direct))) {
    return { qrisUrl: String(direct), scanReady: true };
  }
  const raw = String(data?.qrString || data?.qr_string || data?.qrisString || '').trim();
  if (isEmvQrisString(raw)) {
    return { qrisUrl: mockQrisImageUrl(raw), scanReady: true, qrString: raw };
  }
  // Jangan encode tautan https jadi QR — e-wallet tidak membacanya sebagai QRIS.
  return { qrisUrl: '', scanReady: false };
};

const parseMayarCreate = (json: any): MayarChargeResult | null => {
  const data = json?.data || json?.result || json;
  if (!data || typeof data !== 'object') return null;
  const paymentId = String(data.id || data.transactionId || data.paymentId || '').trim();
  const invoiceUrl = asInvoiceUrl(data.link || data.url || data.paymentLink || data.invoiceUrl);
  if (!paymentId && !invoiceUrl) return null;
  const picked = pickQrisFromPayload(data);
  return {
    mock: false,
    paymentId: paymentId || `mayar_${Date.now()}`,
    invoiceUrl,
    qrisUrl: picked.qrisUrl,
    scanReady: picked.scanReady,
    qrString: picked.qrString,
    raw: json
  };
};

const postMayarCreate = async (url: string, apiKey: string, body: Record<string, unknown>) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
};

/** QRIS dinamis Mayar — gambar/string yang bisa di-scan e-wallet (bukan tautan halaman). */
export async function createMayarDynamicQris(
  apiKey: string,
  amount: number,
  meta?: { receipt?: string; description?: string }
): Promise<{ url: string; qrString?: string; id?: string } | null> {
  const amt = Math.round(Number(amount) || 0);
  if (!apiKey || amt < 1000) return null;
  const endpoints = [MAYAR_QR_CREATE_V2, MAYAR_QR_CREATE_V1];
  const receipt = String(meta?.receipt || '').trim();
  const body: Record<string, unknown> = {
    amount: amt,
    ...(receipt
      ? {
          description: meta?.description || `Laundrivery ${receipt}`,
          note: receipt,
          merchantRef: receipt
        }
      : {})
  };
  for (const endpoint of endpoints) {
    try {
      const posted = await postMayarCreate(endpoint, apiKey, body);
      if (!posted.ok) {
        console.warn('Mayar dynamic QR failed:', endpoint, posted.status, posted.json);
        continue;
      }
      const data = posted.json?.data || posted.json?.result || posted.json;
      const imageUrl = String(data?.url || data?.qrUrl || data?.qrisUrl || data?.qr_image || '').trim();
      const qrString = String(data?.qrString || data?.qr_string || data?.qrisString || '').trim();
      const idFromField = String(data?.id || data?.transactionId || data?.paymentId || '').trim();
      const idFromUrl =
        (imageUrl.match(
          /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(?:png|jpe?g|webp)/i
        ) || [])[1] || '';
      const id = idFromField || idFromUrl || undefined;
      if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
        return { url: imageUrl, qrString: isEmvQrisString(qrString) ? qrString : undefined, id };
      }
      if (isEmvQrisString(qrString)) {
        return { url: mockQrisImageUrl(qrString), qrString, id };
      }
    } catch (e) {
      console.warn('Mayar dynamic QR error:', endpoint, e);
    }
  }
  return null;
}

/** Tutup single payment request Mayar agar tidak bisa dibayar lagi. */
export async function closeMayarPaymentRequest(apiKey: string, paymentId: string): Promise<boolean> {
  const id = String(paymentId || '').trim();
  if (!apiKey || !id || id.startsWith('mock_') || id.startsWith('qris_')) return false;
  const urls = [
    `https://api.mayar.id/hl/v2/payments/${encodeURIComponent(id)}/close`,
    `https://api.mayar.id/hl/v2/payments/${encodeURIComponent(id)}/closed`,
    `https://api.mayar.id/hl/v1/payment/close/${encodeURIComponent(id)}`
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: url.includes('/v1/') ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
      });
      if (res.ok) return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

/** Live Mayar create, or mock QRIS when KYC/key is not ready. */
export async function createMayarPayment(input: MayarChargeInput): Promise<MayarChargeResult> {
  const amount = Math.round(Number(input.amount) || 0);
  if (amount < 1000) {
    throw new Error('Nominal pembayaran minimal Rp 1.000');
  }

  if (isMockPaymentsEnabled()) return buildMockMayarCharge(input);

  const apiKey = resolveKey(input);
  if (!apiKey) return buildMockMayarCharge(input);

  const receipt = String(input.receipt || '').trim();
  const posQrisOnly = input.mode === 'pos_qris';

  // POS kasir: SATU instrumen saja (QRIS dinamis). Jangan buat payment-link
  // supaya tidak bisa bayar double lewat "Buka tautan invoice".
  if (posQrisOnly) {
    try {
      const dyn = await createMayarDynamicQris(apiKey, amount, {
        receipt,
        description: String(input.description || `Tagihan laundry ${receipt}`).trim()
      });
      if (dyn?.url) {
        return {
          mock: false,
          paymentId: dyn.id || `qris_${receipt.replace(/[^a-zA-Z0-9_-]/g, '').slice(-16)}_${Date.now().toString(36)}`,
          invoiceUrl: '',
          qrisUrl: dyn.url,
          scanReady: true,
          qrString: dyn.qrString,
          raw: dyn
        };
      }
      console.warn('Mayar POS dynamic QR empty, falling back to mock');
      return buildMockMayarCharge(input);
    } catch (err) {
      console.warn('Mayar POS dynamic QR error, using mock:', err);
      return buildMockMayarCharge(input);
    }
  }

  const body: Record<string, unknown> = {
    name: input.name || `Laundrivery ${receipt || 'Tagihan'}`.trim(),
    amount,
    description: input.description || `Tagihan laundry ${receipt}`.trim(),
    mobile: String(input.mobile || '').replace(/\D/g, '') || undefined,
    email: input.email || `customer${String(input.mobile || '').replace(/\D/g, '').slice(-8) || '0'}@laundrivery.local`,
    paymentMethod: 'qris',
    note: receipt || undefined
  };
  if (input.payoutAccountId) {
    body.payoutAccountId = input.payoutAccountId;
    body.accountId = input.payoutAccountId;
  }

  try {
    let posted = await postMayarCreate(MAYAR_CREATE_URL, apiKey, body);
    if (posted.status === 404 || posted.status === 405) {
      posted = await postMayarCreate(MAYAR_CREATE_URL_V2, apiKey, body);
    }
    if (!posted.ok) {
      console.warn('Mayar create failed (incl. 401/403/trial), using mock:', posted.status, posted.json);
      return buildMockMayarCharge(input);
    }
    const parsed = parseMayarCreate(posted.json);
    if (!parsed?.invoiceUrl && !parsed?.paymentId) return buildMockMayarCharge(input);
    parsed.linkPaymentId = parsed.paymentId;

    // Payment link ≠ QRIS yang bisa di-scan bank. Ambil gambar/string QRIS dinamis Mayar.
    if (!parsed.scanReady) {
      const dyn = await createMayarDynamicQris(apiKey, amount, {
        receipt,
        description: String(input.description || `Tagihan laundry ${receipt}`).trim()
      });
      if (dyn?.url) {
        parsed.qrisUrl = dyn.url;
        parsed.qrString = dyn.qrString;
        parsed.scanReady = true;
        // Tetap pakai ID payment-link untuk close/check; QR dinamis terpisah.
        // Jangan overwrite paymentId dengan UUID gambar (sering tidak bisa di-query).
      }
    }

    return parsed;
  } catch (err) {
    console.warn('Mayar create error, using mock:', err);
    return buildMockMayarCharge(input);
  }
}

export const isMayarPaidEvent = (body: any) => {
  const event = String(body?.event || body?.type || '').toLowerCase();
  if (event.includes('payment.received') || event.includes('payment.success') || event.includes('payment.paid')) {
    return true;
  }
  const data = body?.data || body;
  if (data?.status === true || body?.status === true) return true;
  const st = String(data?.status || data?.transactionStatus || body?.status || '').toLowerCase();
  return st === 'success' || st === 'paid' || st === 'settled' || st === 'lunas' || st === 'completed';
};

export const mayarWebhookRefs = (body: any) => {
  const data = body?.data || body || {};
  const text = [
    data.productName,
    data.description,
    data.name,
    data.note,
    data.customerName,
    body?.productName,
    body?.description
  ]
    .map((v) => String(v || ''))
    .join(' ');
  const resi =
    (text.match(/SETOR-[A-Z0-9-]+/i) || text.match(/TRX-[A-Z0-9-]+/i) || text.match(/DEP-[A-Z0-9-]+/i) || [])[0] || '';
  return {
    paymentId: String(data.id || data.transactionId || data.paymentId || body?.id || '').trim(),
    receipt: resi,
    mobile: String(data.customerMobile || data.mobile || body?.customerMobile || '').trim(),
    amount: Number(data.amount || body?.amount || 0) || 0,
    data
  };
};

export async function requestMayarInvoice(input: MayarChargeInput): Promise<MayarChargeResult> {
  const res = await fetch('/api/mayar/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || 'Gagal membuat tagihan QRIS');
  return json as MayarChargeResult;
}

export async function simulateMayarAutoPay(opts: {
  transactionId?: string;
  topupId?: string;
  cashDepositId?: string;
  paymentId?: string;
  receipt?: string;
  amount?: number;
  customerPhone?: string;
}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch('/api/mayar/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
      signal: ctrl.signal
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || 'Gagal simulasi pembayaran');
    return json;
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new Error('Simulasi timeout — coba lagi atau pakai Konfirmasi kasir');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
