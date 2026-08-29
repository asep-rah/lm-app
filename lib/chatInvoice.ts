import { insertChatMessage } from '@/lib/csChat';
import { requestMayarInvoice } from '@/lib/mayar';
import { supabase } from '@/lib/supabaseClient';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Hanya UUID pickup_orders yang boleh masuk support_chats.order_id. */
async function resolvePickupOrderId(tx: { id?: string; pickup_id?: string; receipt_number?: string }) {
  if (tx.pickup_id && UUID_RE.test(String(tx.pickup_id))) return String(tx.pickup_id);
  if (tx.id && UUID_RE.test(String(tx.id))) {
    const { data, error } = await supabase
      .from('pickup_orders')
      .select('id')
      .eq('transaction_id', tx.id)
      .limit(1);
    if (!error && data?.[0]?.id) return String(data[0].id);
  }
  const resi = String(tx.receipt_number || '').trim();
  if (resi) {
    const { data, error } = await supabase
      .from('pickup_orders')
      .select('id')
      .eq('order_number', resi)
      .limit(1);
    if (!error && data?.[0]?.id) return String(data[0].id);
  }
  return null;
}

export const INVOICE_TAG_RE = /\[INVOICE\|([^\]|]*)\|([^\]|]*)\|([^\]|]*)\|([^\]|]*)(?:\|([^\]]*))?\]/;

export type ChatInvoice = {
  resi: string;
  amount: string;
  service: string;
  qrisUrl: string;
  invoiceUrl: string;
};

export const parseChatInvoice = (message: any): ChatInvoice | null => {
  const text = typeof message === 'string' ? message : String(message?.message || '');
  const m = text.match(INVOICE_TAG_RE);
  if (!m) return null;
  return {
    resi: m[1] || '-',
    amount: m[2] || '0',
    service: m[3] || '',
    qrisUrl: m[4] || '',
    invoiceUrl: m[5] || ''
  };
};

export const stripInvoiceTag = (text: string) => String(text || '').replace(INVOICE_TAG_RE, '').trim();

export const invoiceQrUrl = (resi: string, amount: number) => {
  const payload = `Laundrivery ${resi} Rp${Number(amount) || 0}`;
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(payload)}`;
};

export const buildInvoiceChatBody = (
  tx: {
    receipt_number?: string;
    customer_name?: string;
    service_type?: string;
    weight_kg?: number;
    pcs_count?: number;
    amount?: number;
    outlets?: { name?: string };
  },
  charge?: { qrisUrl?: string; invoiceUrl?: string; mock?: boolean }
) => {
  const resi = tx.receipt_number || '-';
  const amount = Number(tx.amount) || 0;
  const qty = [tx.weight_kg ? `${tx.weight_kg} Kg` : '', tx.pcs_count ? `${tx.pcs_count} Pcs` : '']
    .filter(Boolean)
    .join(' / ');
  const qris = charge?.qrisUrl || invoiceQrUrl(resi, amount);
  const invoiceUrl = charge?.invoiceUrl || '';
  return [
    `Halo Kak ${tx.customer_name || ''}! Berikut tagihan cucian Anda.`.trim(),
    '',
    `[INVOICE|${resi}|${amount}|${tx.service_type || ''}|${qris}|${invoiceUrl}]`,
    '',
    `Cabang: ${tx.outlets?.name || '-'}`,
    qty ? `Rincian: ${qty}` : '',
    charge?.mock
      ? 'Mode uji QRIS (Mayar KYC belum aktif). Scan QR atau buka tautan invoice, lalu minta CS menjalankan Test Auto-Payment.'
      : 'Silakan scan QRIS atau buka tautan invoice, lalu pembayaran akan terkonfirmasi otomatis.'
  ]
    .filter((line) => line !== '')
    .join('\n');
};

export async function sendInvoiceToLiveChat(
  tx: {
    id?: string;
    pickup_id?: string;
    outlet_id?: string;
    receipt_number?: string;
    customer_name?: string;
    customer_phone?: string;
    service_type?: string;
    weight_kg?: number;
    pcs_count?: number;
    amount?: number;
    outlets?: { name?: string };
  },
  agentName?: string
) {
  const phone = String(tx.customer_phone || '').trim();
  if (!phone) return { error: { message: 'Nomor pelanggan tidak ditemukan' } };
  let charge: { qrisUrl?: string; invoiceUrl?: string; mock?: boolean } | undefined;
  try {
    charge = await requestMayarInvoice({
      amount: Number(tx.amount) || 0,
      name: `Laundrivery ${tx.receipt_number || ''}`.trim(),
      description: `Tagihan ${tx.receipt_number || ''} ${tx.service_type || ''}`.trim(),
      mobile: phone,
      receipt: tx.receipt_number,
      transactionId: tx.id,
      outletId: tx.outlet_id
    });
  } catch (e: any) {
    console.warn('Mayar invoice fallback QR lokal:', e?.message);
  }
  const pickupOrderId = await resolvePickupOrderId(tx);
  const txRef = tx.id && UUID_RE.test(String(tx.id)) ? String(tx.id) : null;
  return insertChatMessage({
    customer_phone: phone,
    pickup_order_id: pickupOrderId,
    transaction_id: txRef,
    sender_type: 'cs',
    sender_name: agentName || 'CS',
    message: buildInvoiceChatBody(tx, charge)
  });
}
