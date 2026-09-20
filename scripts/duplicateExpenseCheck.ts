/**
 * Cek biaya ganda per pengajuan — HANYA MEMBACA, tidak menulis apa pun.
 *
 * Jalankan SEBELUM memasang migrasi 20260920_requisition_owner_payment.sql.
 * Migrasi itu membuat indeks unik pada expenses (requisition_id); bila data lama
 * sudah mengandung duplikat, migrasinya akan berhenti dengan pesan kesalahan.
 * Skrip ini memberi tahu lebih dulu, beserta baris mana yang harus diperiksa.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/duplicateExpenseCheck.ts
 */
import { createClient } from '@supabase/supabase-js';

type ExpenseRow = {
  id: string;
  requisition_id: string | null;
  outlet_id: string | null;
  amount: number | null;
  description: string | null;
  created_at: string | null;
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.log(
      JSON.stringify(
        {
          mode: 'read-only',
          checked: false,
          note: 'Env Supabase tidak di-set — tidak ada kueri. Jalankan dengan kredensial produksi.',
          why: 'Indeks unik expenses_requisition_uniq akan gagal dipasang bila duplikat sudah ada.'
        },
        null,
        2
      )
    );
    return;
  }

  const db = createClient(url, key);
  // Dibatasi: pengecekan ini untuk memutuskan boleh-tidaknya memasang indeks,
  // bukan audit keuangan lengkap.
  const { data, error } = await db
    .from('expenses')
    .select('id, requisition_id, outlet_id, amount, description, created_at')
    .not('requisition_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5000);

  if (error) {
    console.error('Kueri gagal (tidak ada penulisan):', error.message);
    process.exitCode = 1;
    return;
  }

  const byRequisition = new Map<string, ExpenseRow[]>();
  ((data as ExpenseRow[]) || []).forEach((row) => {
    const key = String(row.requisition_id);
    byRequisition.set(key, [...(byRequisition.get(key) || []), row]);
  });

  const duplicates = Array.from(byRequisition.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([requisitionId, rows]) => ({
      requisitionId,
      count: rows.length,
      totalAmount: rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0),
      rows: rows.map((r) => ({ id: r.id, amount: r.amount, created_at: r.created_at }))
    }))
    .sort((a, b) => b.count - a.count);

  console.log(
    JSON.stringify(
      {
        mode: 'read-only',
        checked: true,
        expensesWithRequisition: (data || []).length,
        duplicateGroups: duplicates.length,
        overcountedAmount: duplicates.reduce(
          (sum, d) => sum + d.totalAmount - (Number(d.rows[0].amount) || 0),
          0
        ),
        safeToAddUniqueIndex: duplicates.length === 0,
        sample: duplicates.slice(0, 20)
      },
      null,
      2
    )
  );

  if (duplicates.length) {
    console.error(
      `\n⚠️  ${duplicates.length} pengajuan punya lebih dari satu baris expenses.\n` +
        'Putuskan baris mana yang sah SEBELUM menjalankan migrasi. Jangan hapus baris\n' +
        'keuangan sebagai rutinitas — lihat docs/BUSINESS_RULES.md §12.'
    );
    process.exitCode = 2;
  }
}

void main();
