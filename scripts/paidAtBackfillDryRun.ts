/**
 * Dry-run backfill paid_at — TIDAK menulis produksi.
 *
 * Memindai transaksi is_paid tanpa paid_at dan mencetak usulan + bukti.
 * Hanya mengisi usulan bila ada bukti bertanggal yang aman (saat ini: hampir selalu
 * "jangan otomatis" — butuh audit webhook / mutasi).
 *
 * Usage: npx tsx scripts/paidAtBackfillDryRun.ts
 */
import { createClient } from '@supabase/supabase-js';
import { missingPaidAtWhilePaid, proposePaidAtBackfill } from '../lib/financeRecognition';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.log(
      JSON.stringify(
        {
          mode: 'dry-run',
          wrote: false,
          note: 'Env Supabase tidak di-set — tidak ada query produksi. Gate rilis: backfill paid_at berbasis bukti wajib sebelum merge.',
          policy: [
            'Jangan isi paid_at dari updated_at.',
            'Sumber bukti yang diterima: webhook paid timestamp, mutasi bank, audit mark-manual note+time.',
            'Setelah backfill: rekonsiliasi jurnal Agustus/September per outlet.'
          ]
        },
        null,
        2
      )
    );
    return;
  }

  const db = createClient(url, key);
  const { data, error } = await db
    .from('transactions')
    .select('id, receipt_number, outlet_id, amount, is_paid, payment_status, payment_method, paid_at, paid_via, created_at')
    .eq('is_paid', true)
    .is('paid_at', null)
    .limit(200);

  if (error) {
    console.error('Query gagal (dry-run abort, no writes):', error.message);
    process.exitCode = 1;
    return;
  }

  const rows = (data || []).filter((t) => missingPaidAtWhilePaid(t));
  const report = rows.map((t) => {
    const proposal = proposePaidAtBackfill(t);
    return {
      id: t.id,
      receipt: t.receipt_number,
      amount: t.amount,
      method: t.payment_method,
      created_at: t.created_at,
      proposal
    };
  });

  console.log(
    JSON.stringify(
      {
        mode: 'dry-run',
        wrote: false,
        candidates: report.length,
        applyable: report.filter((r) => r.proposal.apply).length,
        sample: report.slice(0, 20)
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
