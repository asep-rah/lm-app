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
};

export type MayarChargeResult = {
  mock: boolean;
  paymentId: string;
  invoiceUrl: string;
  qrisUrl: string;
  raw?: unknown;
};

const MAYAR_CREATE_URL = 'https://api.mayar.id/hl/v1/payment/create';
const MAYAR_CREATE_URL_V2 = 'https://api.mayar.id/hl/v2/payments/create';

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
  `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(
    payload || 'MOCK_DEPOSIT_PAYMENT'
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
    qrisUrl: mockQrisImageUrl(`MOCK_DEPOSIT_PAYMENT:${receipt}`)
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

const pickQrisUrl = (data: any, invoiceUrl: string) => {
  const direct =
    data?.qrisUrl ||
    data?.qrUrl ||
    data?.qr_url ||
    data?.qrImage ||
    data?.qr_image ||
    data?.qris_url;
  if (direct) return String(direct);
  const raw = data?.qrString || data?.qr_string || data?.qrisString;
  if (raw) return mockQrisImageUrl(String(raw));
  return mockQrisImageUrl(invoiceUrl);
};

const parseMayarCreate = (json: any): MayarChargeResult | null => {
  const data = json?.data || json?.result || json;
  if (!data || typeof data !== 'object') return null;
  const paymentId = String(data.id || data.transactionId || data.paymentId || '').trim();
  const invoiceUrl = asInvoiceUrl(data.link || data.url || data.paymentLink || data.invoiceUrl);
  if (!paymentId && !invoiceUrl) return null;
  return {
    mock: false,
    paymentId: paymentId || `mayar_${Date.now()}`,
    invoiceUrl,
    qrisUrl: pickQrisUrl(data, invoiceUrl),
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
    return parsed!;
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
  const st = String(data?.status || data?.transactionStatus || body?.status || '').toLowerCase();
  return st === 'success' || st === 'paid' || st === 'settled' || st === 'lunas';
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
  const res = await fetch('/api/mayar/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || 'Gagal simulasi pembayaran');
  return json;
}
