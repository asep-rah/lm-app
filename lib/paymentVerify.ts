import { supabase } from '@/lib/supabaseClient';
import { insertWithFallback, updateWithFallback } from '@/lib/safeWrite';
import { canonicalPhone, insertChatMessage } from '@/lib/csChat';
import { notifyCustomerPayment } from '@/lib/notifications';
import { maybeAwardLoyalty } from '@/lib/crm-automation';
import { insertAuditLog } from '@/lib/paymentSecurity';

export const PENDING_PAY_STATUS = 'menunggu_pembayaran';

export const isNonCashVerifyMethod = (method: any) => {
  const s = String(method || '').toLowerCase();
  return s.includes('qris') || s.includes('transfer');
};

export const isPaymentLocked = (order: any) => {
  if (order?.is_paid === true) return false;
  const pay = String(order?.payment_status || '').toLowerCase();
  const st = String(order?.status || '').toLowerCase();
  if (['paid', 'lunas', 'verified'].includes(pay)) return false;
  if (st === 'paid' || st.includes('lunas')) return false;
  if (st.includes('menunggu_pembayaran') || st.includes('menunggu pembayaran')) return true;
  return pay === 'pending' || pay === 'menunggu';
};

export const isCsVerifiedPaid = (order: any) => {
  if (order?.is_paid === true) return true;
  const pay = String(order?.payment_status || '').toLowerCase();
  if (['paid', 'lunas', 'verified'].includes(pay)) return true;
  const st = String(order?.status || '').toLowerCase();
  if (st === 'paid' || st.includes('lunas')) return true;
  if (!isNonCashVerifyMethod(order?.payment_method)) return false;
  return Boolean(order?.payment_proof_url);
};

export async function createPaymentVerifyTask(tx: {
  id?: string;
  pickup_id?: string;
  receipt_number?: string;
  customer_name?: string;
  customer_phone?: string;
  amount?: number;
  payment_method?: string;
  outlet_id?: string;
}) {
  if (!tx?.id) return { error: new Error('Transaksi kosong') };

  const due = new Date();
  due.setHours(due.getHours() + 2);
  const resi = tx.receipt_number || tx.id;
  const title = `Konfirmasi Pembayaran ${resi}`;
  const description = `${tx.customer_name || 'Pelanggan'} · ${tx.customer_phone || '-'} · ${tx.payment_method || 'QRIS/Transfer'} · Rp ${Number(tx.amount || 0).toLocaleString('id-ID')}`;

  const { error } = await insertWithFallback('system_tasks', [
    {
      title,
      description,
      assigned_to_role: 'cs',
      sla_hours: 2,
      due_date: due.toISOString(),
      kpi_penalty_points: 10,
      status: 'pending',
      source_type: 'PAYMENT_VERIFY',
      source_id: tx.id
    },
    {
      title,
      description,
      assigned_to_role: 'cs',
      due_date: due.toISOString(),
      status: 'pending'
    },
    {
      title,
      description,
      assigned_to_role: 'cs',
      status: 'pending'
    }
  ]);

  if (tx.customer_phone) {
    await insertChatMessage({
      customer_phone: canonicalPhone(tx.customer_phone) || tx.customer_phone,
      pickup_order_id: tx.pickup_id || null,
      transaction_id: tx.id,
      sender_type: 'cs',
      sender_name: 'Kasir',
      message: `Halo Kak, transaksi ${resi} (Rp ${Number(tx.amount || 0).toLocaleString('id-ID')}) via ${tx.payment_method || 'QRIS/Transfer'} menunggu konfirmasi CS. Unggah bukti pembayaran di chat ini ya.`
    });
  }

  return { error };
}

export async function completePaymentVerifyTasks(transactionId: string, receipt?: string) {
  const { data: rows } = await supabase
    .from('system_tasks')
    .select('id, source_id, title, source_type, status')
    .in('assigned_to_role', ['cs', 'head_cs'])
    .limit(80);

  const ids = (rows || [])
    .filter((t: any) => {
      const st = String(t.status || '').toLowerCase();
      if (st === 'completed' || st === 'done' || st === 'selesai') return false;
      if (String(t.source_id || '') === String(transactionId)) return true;
      if (t.source_type === 'PAYMENT_VERIFY' && receipt && String(t.title || '').includes(receipt)) return true;
      return Boolean(receipt && String(t.title || '').includes(receipt));
    })
    .map((t: any) => t.id);

  for (const id of ids) {
    await updateWithFallback('system_tasks', [{ status: 'completed' }], { column: 'id', value: id });
  }
}

export async function markInvoicePaid(opts: {
  transactionId: string;
  amount?: number;
  proofUrl?: string;
  receipt?: string;
  agentName?: string;
  customerPhone?: string;
  paidVia?: string;
  note?: string;
  bankRef?: string;
}) {
  const paidAt = new Date().toISOString();
  const paidVia = opts.paidVia || 'MANUAL_VERIFIED';
  const { error } = await updateWithFallback(
    'transactions',
    [
      {
        payment_status: 'paid',
        is_paid: true,
        paid_at: paidAt,
        paid_verified_by: opts.agentName || 'CS',
        paid_via: paidVia,
        payment_proof_url: opts.proofUrl || undefined,
        notes: opts.note
          ? `${opts.note}${opts.bankRef ? ` · Ref: ${opts.bankRef}` : ''}`
          : undefined,
        status: 'Diterima'
      },
      {
        payment_proof_url: opts.proofUrl || undefined,
        payment_status: 'paid',
        paid_via: paidVia,
        status: 'Diterima'
      },
      {
        payment_status: 'paid',
        is_paid: true,
        paid_at: paidAt,
        paid_verified_by: opts.agentName || 'CS',
        status: 'Diterima'
      },
      { payment_status: 'paid', is_paid: true, status: 'Diterima' },
      { payment_status: 'paid', status: 'Diterima' },
      { is_paid: true, status: 'Diterima' },
      { status: 'Diterima' }
    ],
    { column: 'id', value: opts.transactionId }
  );
  if (error) return { error };

  await completePaymentVerifyTasks(opts.transactionId, opts.receipt);

  if (opts.customerPhone) {
    const nominal = Number(opts.amount || 0).toLocaleString('id-ID');
    await insertChatMessage({
      customer_phone: opts.customerPhone,
      pickup_order_id: null,
      transaction_id: opts.transactionId,
      sender_type: 'cs',
      sender_name: opts.agentName || 'CS',
      message: `Terima kasih! Pembayaran Anda sebesar Rp ${nominal} telah diverifikasi oleh CS.`,
      attachment_url: opts.proofUrl || null,
      image_url: opts.proofUrl || null,
      attachment_type: opts.proofUrl ? 'image' : null
    });
  }

  notifyCustomerPayment(opts.customerPhone);
  maybeAwardLoyalty({
    id: opts.transactionId,
    amount: opts.amount,
    customer_phone: opts.customerPhone,
    status: 'Diterima',
    is_paid: true
  });
  void insertAuditLog({
    user_name: opts.agentName || 'CS',
    role: 'cs',
    action: 'PAYMENT_MARK_PAID',
    entity_type: 'transactions',
    entity_id: opts.transactionId,
    amount: opts.amount ?? null,
    meta: { paidVia, note: opts.note, bankRef: opts.bankRef, proofUrl: opts.proofUrl }
  });
  return { error: null };
}

export async function confirmTransactionPayment(opts: {
  transactionId: string;
  proofUrl?: string;
  receipt?: string;
  agentName?: string;
  customerPhone?: string;
  amount?: number;
}) {
  return markInvoicePaid(opts);
}

export const gatewayPaidAttempts = (agentName: string, paidVia = 'GATEWAY') => {
  const paidAt = new Date().toISOString();
  return [
    {
      payment_status: 'paid',
      is_paid: true,
      paid_at: paidAt,
      paid_verified_by: agentName,
      paid_via: paidVia,
      status: 'paid'
    },
    { payment_status: 'paid', is_paid: true, paid_via: paidVia, status: 'paid' },
    { is_paid: true, status: 'paid' },
    {
      payment_status: 'paid',
      is_paid: true,
      paid_at: paidAt,
      paid_verified_by: agentName,
      paid_via: paidVia,
      status: 'Diterima'
    },
    { payment_status: 'paid', is_paid: true, status: 'Diterima' },
    { is_paid: true, status: 'Diterima' },
    { status: 'Diterima' }
  ];
};

export async function markGatewayPaid(opts: {
  transactionId: string;
  receipt?: string;
  amount?: number;
  agentName?: string;
  customerPhone?: string;
  paidVia?: string;
}) {
  const agent = opts.agentName || 'Mayar QRIS';
  const paidVia = opts.paidVia || 'GATEWAY';
  const { error } = await updateWithFallback('transactions', gatewayPaidAttempts(agent, paidVia), {
    column: 'id',
    value: opts.transactionId
  });
  if (error) return { error };
  await completePaymentVerifyTasks(opts.transactionId, opts.receipt);
  if (opts.customerPhone) {
    const nominal = Number(opts.amount || 0).toLocaleString('id-ID');
    await insertChatMessage({
      customer_phone: opts.customerPhone,
      pickup_order_id: null,
      transaction_id: opts.transactionId,
      sender_type: 'cs',
      sender_name: agent,
      message: `Pembayaran QRIS sebesar Rp ${nominal} sudah terkonfirmasi. Cucian masuk antrean produksi.`
    });
  }
  notifyCustomerPayment(opts.customerPhone);
  maybeAwardLoyalty({
    id: opts.transactionId,
    amount: opts.amount,
    customer_phone: opts.customerPhone,
    status: 'Diterima',
    is_paid: true
  });
  return { error: null };
}
