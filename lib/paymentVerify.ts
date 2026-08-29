import { supabase } from '@/lib/supabaseClient';
import { insertWithFallback, updateWithFallback } from '@/lib/safeWrite';
import { insertChatMessage } from '@/lib/csChat';

export const PENDING_PAY_STATUS = 'menunggu_pembayaran';

export const isNonCashVerifyMethod = (method: any) => {
  const s = String(method || '').toLowerCase();
  return s.includes('qris') || s.includes('transfer');
};

export const isPaymentLocked = (order: any) => {
  const pay = String(order?.payment_status || '').toLowerCase();
  const st = String(order?.status || '').toLowerCase();
  if (['paid', 'lunas', 'verified'].includes(pay)) return false;
  if (st.includes('menunggu_pembayaran') || st.includes('menunggu pembayaran')) return true;
  return pay === 'pending' || pay === 'menunggu';
};

export const isCsVerifiedPaid = (order: any) => {
  const pay = String(order?.payment_status || '').toLowerCase();
  if (!isNonCashVerifyMethod(order?.payment_method)) return false;
  return ['paid', 'lunas', 'verified'].includes(pay) || Boolean(order?.payment_proof_url);
};

export async function createPaymentVerifyTask(tx: {
  id?: string;
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
      customer_phone: tx.customer_phone,
      order_id: tx.id,
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

export async function confirmTransactionPayment(opts: {
  transactionId: string;
  proofUrl: string;
  receipt?: string;
  agentName?: string;
  customerPhone?: string;
}) {
  const { error } = await updateWithFallback(
    'transactions',
    [
      {
        payment_status: 'paid',
        payment_proof_url: opts.proofUrl,
        status: 'Diterima'
      },
      {
        payment_status: 'paid',
        status: 'Diterima'
      },
      { status: 'Diterima' }
    ],
    { column: 'id', value: opts.transactionId }
  );
  if (error) return { error };

  await completePaymentVerifyTasks(opts.transactionId, opts.receipt);

  if (opts.customerPhone) {
    await insertChatMessage({
      customer_phone: opts.customerPhone,
      order_id: opts.transactionId,
      sender_type: 'cs',
      sender_name: opts.agentName || 'CS',
      message: `Pembayaran ${opts.receipt || ''} sudah dikonfirmasi. Cucian siap diproses kasir.`.trim(),
      attachment_url: opts.proofUrl,
      attachment_type: 'image'
    });
  }

  return { error: null };
}
