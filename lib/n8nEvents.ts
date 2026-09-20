/**
 * Kejadian keluar: aplikasi -> n8n.
 *
 * Dipakai dari konteks SERVER saja (route handler / cron). Memanggilnya dari
 * browser akan memaksa N8N_SHARED_SECRET dipublikasikan sebagai NEXT_PUBLIC_,
 * dan itu dilarang AGENTS.md. Untuk kejadian yang lahir di browser, biarkan n8n
 * yang menarik lewat /api/integrations/n8n/task-digest.
 *
 * GAGAL-DIAM adalah keputusan sadar: kegagalan webhook notifikasi tidak boleh
 * membatalkan transaksi bisnis yang sudah berhasil. Kegagalan dicatat ke log,
 * tidak dilempar ke pemanggil.
 */

/**
 * Kejadian yang BENAR-BENAR dikirim aplikasi — semuanya dari
 * /api/integrations/n8n/task-digest saat dipanggil dengan ?emit=1.
 *
 * Daftar ini sengaja tidak memuat kejadian "saat dibuat" seperti task.created,
 * supervision.submitted atau complaint.created. Ketiganya lahir di browser
 * (RequisitionForm, VisitForm, form komplain), dan mengirimnya dari sana
 * menuntut N8N_SHARED_SECRET diterbitkan sebagai NEXT_PUBLIC_ — dilarang
 * AGENTS.md. Nama kejadian yang tidak pernah terkirim lebih buruk daripada
 * tidak ada: workflow n8n akan menunggu sesuatu yang tidak akan datang.
 * Untuk hal-hal itu, biarkan n8n MENARIK lewat task-digest.
 */
export const N8N_EVENT = {
  TASK_DUE_SOON: 'task.due_soon',
  TASK_OVERDUE: 'task.overdue',
  REQUISITION_AWAITING_APPROVAL: 'requisition.awaiting_approval',
  REQUISITION_AWAITING_OWNER: 'requisition.awaiting_owner'
} as const;

export type N8nEventName = (typeof N8N_EVENT)[keyof typeof N8N_EVENT];

/** Bentuk amplop yang diterima n8n. Stabil — workflow di n8n bergantung padanya. */
export type N8nEnvelope = {
  event: N8nEventName;
  sentAt: string;
  source: 'lm-app';
  data: Record<string, unknown>;
};

export const buildEnvelope = (
  event: N8nEventName,
  data: Record<string, unknown>,
  now = new Date()
): N8nEnvelope => ({
  event,
  sentAt: now.toISOString(),
  source: 'lm-app',
  data
});

export const n8nConfigured = () => Boolean(String(process.env.N8N_WEBHOOK_URL || '').trim());

/**
 * Kirim satu kejadian. Mengembalikan status, tidak pernah melempar.
 *
 * Batas waktu 5 detik: n8n menumpang di VPS yang sama dengan Postgres dan
 * Evolution API, jadi permintaan yang menggantung bisa menahan route handler
 * lebih lama daripada nilai notifikasinya.
 */
export const emitN8nEvent = async (
  event: N8nEventName,
  data: Record<string, unknown>
): Promise<{ sent: boolean; reason?: string }> => {
  const url = String(process.env.N8N_WEBHOOK_URL || '').trim();
  if (!url) return { sent: false, reason: 'N8N_WEBHOOK_URL belum di-set' };

  const secret = String(process.env.N8N_SHARED_SECRET || '').trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(secret ? { authorization: `Bearer ${secret}` } : {})
      },
      body: JSON.stringify(buildEnvelope(event, data)),
      signal: controller.signal
    });
    if (!res.ok) {
      console.warn(`[n8n] ${event} ditolak: HTTP ${res.status}`);
      return { sent: false, reason: `HTTP ${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.warn(`[n8n] ${event} gagal dikirim:`, (err as Error)?.message || err);
    return { sent: false, reason: (err as Error)?.message || 'gagal' };
  } finally {
    clearTimeout(timer);
  }
};
