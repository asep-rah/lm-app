/** Human-readable troubleshooting hints for owner system-health panel. */

export type DiagnosisRule = {
  match: RegExp;
  code: string;
  title: string;
  solution: string;
};

export const DIAGNOSIS_RULES: DiagnosisRule[] = [
  {
    match: /signature|unauthorized webhook|hmac|sha512/i,
    code: 'WEBHOOK_SIGNATURE',
    title: 'Signature / token webhook tidak cocok',
    solution:
      'Cek MAYAR_WEBHOOK_TOKEN / MAYAR_WEBHOOK_SECRET / PAYMENT_GATEWAY_SERVER_KEY di Vercel Environment Variables, lalu redeploy.'
  },
  {
    match: /amount.?mismatch|nominal|total_amount/i,
    code: 'AMOUNT_MISMATCH',
    title: 'Nominal webhook beda dengan tagihan',
    solution:
      'Bandingkan amount di Payment Gateway dengan transactions.amount. Jangan ubah harga di client setelah QRIS dibuat; buat tagihan baru jika perlu.'
  },
  {
    match: /rls|row.?level|permission denied|42501/i,
    code: 'RLS_DENIED',
    title: 'Akses RLS Supabase ditolak',
    solution:
      'Pastikan API memakai SUPABASE_SERVICE_ROLE_KEY (bukan anon). Jalankan ulang migrasi SQL RLS di Supabase SQL Editor.'
  },
  {
    match: /timeout|ETIMEDOUT|fetch failed|network/i,
    code: 'API_TIMEOUT',
    title: 'API Payment Gateway timeout',
    solution:
      'Cek status Mayar. Gunakan tombol Re-sync / Cek Status Pembayaran, atau jalankan cron /api/cron/sync-payments.'
  },
  {
    match: /tidak ditemukan|not found|404/i,
    code: 'TX_NOT_FOUND',
    title: 'Transaksi / top-up tidak ditemukan',
    solution:
      'Pastikan mayar_payment_id atau receipt_number tersimpan saat create QRIS. Cocokkan external_id webhook dengan kolom tersebut.'
  },
  {
    match: /mayar|api key|401|403/i,
    code: 'GATEWAY_AUTH',
    title: 'Autentikasi Payment Gateway gagal',
    solution:
      'Perbarui MAYAR_API_KEY (global) atau mayar_api_key per outlet di Owner → Pengaturan Outlet.'
  }
];

export function diagnosisHintOf(message: string): string {
  const raw = String(message || '');
  for (const rule of DIAGNOSIS_RULES) {
    if (rule.match.test(raw)) {
      return `Error: ${rule.title}. Solusi: ${rule.solution}`;
    }
  }
  return `Error: ${raw.slice(0, 180) || 'Tidak diketahui'}. Solusi: Cek log Vercel Functions, tabel webhook_logs, dan status transaksi di Payment Gateway.`;
}

export function diagnosisCardOf(message: string, code?: string | null) {
  const raw = `${code || ''} ${message || ''}`;
  for (const rule of DIAGNOSIS_RULES) {
    if (rule.match.test(raw)) return rule;
  }
  return {
    match: /.*/,
    code: code || 'UNKNOWN',
    title: 'Anomali sistem',
    solution:
      'Buka detail context JSON, bandingkan dengan webhook_logs, lalu coba Re-sync. Hubungi support jika berulang.'
  } as DiagnosisRule;
}
