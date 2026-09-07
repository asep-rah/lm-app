export type ReceiptLayout = {
  brandName: string;
  tagline: string;
  csLabel: string;
  dateLabel: string;
  doneLabel: string;
  receiptLabel: string;
  nameLabel: string;
  phoneLabel: string;
  totalLabel: string;
  payLabel: string;
  termsTitle: string;
  terms: string;
  footer: string;
  extraNote: string;
};

export const DEFAULT_RECEIPT_TERMS = 'Komplain maksimal 1x24 jam setelah cucian diambil.';

export const DEFAULT_RECEIPT_LAYOUT: ReceiptLayout = {
  brandName: '',
  tagline: 'Spesialis Laundry Profesional',
  csLabel: 'CS',
  dateLabel: 'Tgl Masuk',
  doneLabel: 'Est. Selesai',
  receiptLabel: 'Resi',
  nameLabel: 'Nama',
  phoneLabel: 'No. HP',
  totalLabel: 'TOTAL',
  payLabel: 'BAYAR',
  termsTitle: 'SYARAT & KETENTUAN',
  terms: DEFAULT_RECEIPT_TERMS,
  footer: 'Cek Cucian: lm-coral.vercel.app/track',
  extraNote: ''
};

export function parseReceiptLayout(raw: unknown, termsFallback?: string): ReceiptLayout {
  const parsed = typeof raw === 'string' ? (() => {
    try { return JSON.parse(raw); } catch { return null; }
  })() : raw;
  const src = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  const terms = String(src.terms || termsFallback || DEFAULT_RECEIPT_TERMS);
  return {
    ...DEFAULT_RECEIPT_LAYOUT,
    brandName: String(src.brandName ?? ''),
    tagline: String(src.tagline ?? DEFAULT_RECEIPT_LAYOUT.tagline),
    csLabel: String(src.csLabel ?? DEFAULT_RECEIPT_LAYOUT.csLabel),
    dateLabel: String(src.dateLabel ?? DEFAULT_RECEIPT_LAYOUT.dateLabel),
    doneLabel: String(src.doneLabel ?? DEFAULT_RECEIPT_LAYOUT.doneLabel),
    receiptLabel: String(src.receiptLabel ?? DEFAULT_RECEIPT_LAYOUT.receiptLabel),
    nameLabel: String(src.nameLabel ?? DEFAULT_RECEIPT_LAYOUT.nameLabel),
    phoneLabel: String(src.phoneLabel ?? DEFAULT_RECEIPT_LAYOUT.phoneLabel),
    totalLabel: String(src.totalLabel ?? DEFAULT_RECEIPT_LAYOUT.totalLabel),
    payLabel: String(src.payLabel ?? DEFAULT_RECEIPT_LAYOUT.payLabel),
    termsTitle: String(src.termsTitle ?? DEFAULT_RECEIPT_LAYOUT.termsTitle),
    terms,
    footer: String(src.footer ?? DEFAULT_RECEIPT_LAYOUT.footer),
    extraNote: String(src.extraNote ?? '')
  };
}
