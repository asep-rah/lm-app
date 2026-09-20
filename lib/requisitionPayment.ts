/**
 * Pembayaran pengajuan pembelian oleh OWNER.
 *
 * Satu pengajuan = paling banyak satu baris expenses (docs/BUSINESS_RULES.md §18
 * butir 4-6). Sebelumnya pencatatan biaya dilakukan di dalam
 * components/RequisitionForm.tsx tanpa pengaman: bila insert biaya berhasil tapi
 * update status gagal, klik berikutnya membuat biaya kedua, dan dua jalur
 * fallback-nya tidak menyertakan requisition_id sehingga biaya ganda itu tidak
 * bisa dilacak balik. Semua itu dipusatkan di sini.
 *
 * Urutan sengaja: cek biaya yang sudah ada -> insert biaya -> baru ubah status.
 * Dengan urutan ini percobaan ulang setelah kegagalan di tengah aman, karena
 * langkah pertama menemukan biaya yang sudah tercatat dan tidak menggandakannya.
 *
 * RISIKO L4 -- menyentuh pencatatan uang.
 */

import { supabase } from '@/lib/supabaseClient';
import { updateWithFallback } from '@/lib/safeWrite';
import {
  PR_STATUS,
  isPrAwaitingOwner,
  isPrPaid,
  prAmount,
  prDescription,
  prReceiptUrl,
  prRequestedBy,
  prTitle
} from '@/lib/cmsRequisition';

/** Keterangan biaya yang tetap bisa dibaca di laporan tanpa membuka pengajuan. */
export const expenseDescriptionFor = (req: any) =>
  prDescription(req) || `${prTitle(req)} — ${prRequestedBy(req) || 'Outlet'}`;

/**
 * Payload insert expenses dari lengkap ke minimal, untuk berjaga bila kolom
 * opsional belum ada di schema live.
 *
 * `requisition_id` WAJIB ada di setiap percobaan: biaya tanpa penunjuk ke
 * pengajuan asalnya tidak bisa diaudit dan tidak terlindungi indeks unik.
 */
export const expenseAttemptsFor = (opts: {
  req: any;
  paidAmount: number;
  proofUrl?: string | null;
  actorName?: string;
  now?: string;
}): Record<string, unknown>[] => {
  const { req, paidAmount, proofUrl, actorName, now = new Date().toISOString() } = opts;
  const desc = expenseDescriptionFor(req);
  const base = {
    outlet_id: req?.outlet_id ?? null,
    amount: paidAmount,
    category: req?.category || 'Lain-lain',
    requisition_id: req?.id
  };
  return [
    {
      ...base,
      description: desc,
      notes: desc,
      proof_url: proofUrl || null,
      status: 'PAID',
      created_by: actorName || 'Owner',
      created_at: now
    },
    { ...base, description: desc, proof_url: proofUrl || null, created_at: now },
    { ...base, description: desc }
  ];
};

/** Pelanggaran indeks unik expenses_requisition_uniq = biaya sudah tercatat. */
export const isDuplicateExpenseError = (err: any): boolean => {
  const code = String(err?.code || '');
  if (code === '23505') return true;
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('duplicate key') || msg.includes('expenses_requisition_uniq');
};

/**
 * Apakah owner boleh membayar pengajuan ini? Mengembalikan alasan penolakan,
 * atau null bila boleh. Ini cermin aturan §18 butir 2-3 di sisi klien; otorisasi
 * sebenarnya tetap milik batas server.
 */
export const ownerPaymentBlocker = (req: any): string | null => {
  if (!req?.id) return 'Pengajuan tidak dikenali.';
  if (isPrPaid(req)) return 'Pengajuan ini sudah dibayar.';
  if (!isPrAwaitingOwner(req)) {
    return 'Pengajuan belum diverifikasi Admin Operasional, jadi belum bisa dibayar.';
  }
  return null;
};

/** Biaya yang sudah tercatat untuk pengajuan ini, bila ada. */
const findExistingExpenseId = async (requisitionId: string): Promise<string | null> => {
  const { data, error } = await supabase
    .from('expenses')
    .select('id')
    .eq('requisition_id', requisitionId)
    .limit(1);
  if (error) {
    // Tidak bisa memastikan -> jangan lanjut menulis. Menebak di sini berarti
    // mengambil risiko biaya ganda.
    throw new Error(`Gagal memeriksa biaya yang sudah ada: ${error.message}`);
  }
  return data?.[0]?.id ? String(data[0].id) : null;
};

export type PayResult = {
  error: { message: string } | null;
  expenseId: string | null;
  /** true bila biaya sudah tercatat sebelumnya -- percobaan ulang yang aman. */
  alreadyRecorded: boolean;
};

/**
 * Owner membayar satu pengajuan: catat biaya lalu tandai Paid.
 *
 * Bukti transfer TIDAK diminta di sini. Bukti diunggah Admin Ops setelah
 * diberi tahu (§18 butir 7), jadi Paid dengan payment_proof_url kosong adalah
 * kondisi sah, bukan kelalaian.
 */
export const payRequisition = async (opts: {
  req: any;
  paidAmount?: number;
  actorName?: string;
}): Promise<PayResult> => {
  const { req, actorName } = opts;
  const blocker = ownerPaymentBlocker(req);
  if (blocker) return { error: { message: blocker }, expenseId: null, alreadyRecorded: false };

  const paidAmount = Number(opts.paidAmount ?? prAmount(req)) || 0;
  if (paidAmount <= 0) {
    return { error: { message: 'Nominal pembayaran harus lebih dari 0.' }, expenseId: null, alreadyRecorded: false };
  }

  const now = new Date().toISOString();
  let expenseId: string | null = null;
  let alreadyRecorded = false;

  try {
    expenseId = await findExistingExpenseId(String(req.id));
    alreadyRecorded = Boolean(expenseId);

    if (!expenseId) {
      const attempts = expenseAttemptsFor({
        req,
        paidAmount,
        proofUrl: prReceiptUrl(req) || null,
        actorName,
        now
      });

      let lastErr: any = null;
      for (const row of attempts) {
        const { data, error } = await supabase.from('expenses').insert([row]).select('id');
        if (!error) {
          expenseId = data?.[0]?.id ? String(data[0].id) : null;
          lastErr = null;
          break;
        }
        // Balapan dua klik: baris sudah masuk dari percobaan lain. Jangan coba
        // payload berikutnya -- itu hanya akan menabrak indeks unik yang sama.
        if (isDuplicateExpenseError(error)) {
          expenseId = await findExistingExpenseId(String(req.id));
          alreadyRecorded = true;
          lastErr = null;
          break;
        }
        lastErr = error;
      }
      if (lastErr) throw new Error(lastErr.message || 'Gagal mencatat biaya');
    }
  } catch (err: any) {
    return {
      error: { message: err?.message || 'Gagal mencatat biaya' },
      expenseId: null,
      alreadyRecorded: false
    };
  }

  const upd = await updateWithFallback(
    'purchase_requests',
    [
      {
        status: PR_STATUS.PAID,
        paid_by: actorName || 'Owner',
        paid_at: now,
        admin_paid_at: now,
        actual_cost: paidAmount,
        amount: paidAmount,
        expense_id: expenseId
      },
      { status: PR_STATUS.PAID, paid_by: actorName || 'Owner', paid_at: now, expense_id: expenseId },
      { status: PR_STATUS.PAID, paid_at: now },
      { status: PR_STATUS.PAID }
    ],
    { column: 'id', value: req.id }
  );

  // Biaya sudah tercatat walau status gagal berubah. Percobaan ulang aman:
  // langkah pertama akan menemukan biaya itu dan hanya mengulang update status.
  if (upd.error) {
    return {
      error: {
        message: `Biaya sudah tercatat, tetapi status gagal diperbarui: ${upd.error.message}. Tekan Bayar sekali lagi untuk menyelesaikan — biaya tidak akan dobel.`
      },
      expenseId,
      alreadyRecorded
    };
  }

  return { error: null, expenseId, alreadyRecorded };
};

/**
 * Admin Ops memverifikasi pengajuan yang sudah disetujui supervisor dan
 * meneruskannya ke owner. Admin Ops tidak boleh men-set Paid (§18 butir 1).
 */
export const verifyAndForwardToOwner = async (opts: {
  req: any;
  actorName?: string;
  duplicateOfId?: string | null;
}) => {
  const { req, actorName, duplicateOfId } = opts;
  const now = new Date().toISOString();
  return updateWithFallback(
    'purchase_requests',
    [
      {
        status: PR_STATUS.AWAITING_OWNER,
        verified_by_name: actorName || null,
        verified_at: now,
        duplicate_of_id: duplicateOfId || null
      },
      { status: PR_STATUS.AWAITING_OWNER, verified_by_name: actorName || null, verified_at: now },
      { status: PR_STATUS.AWAITING_OWNER }
    ],
    { column: 'id', value: req.id }
  );
};

/** Admin Ops mengembalikan pengajuan ke pemohon. Alasan wajib. */
export const returnForRevision = async (opts: { req: any; reason: string; actorName?: string }) => {
  const reason = String(opts.reason || '').trim();
  if (!reason) return { error: { message: 'Alasan pengembalian wajib diisi.' } };
  const now = new Date().toISOString();
  return updateWithFallback(
    'purchase_requests',
    [
      {
        status: PR_STATUS.NEEDS_REVISION,
        revision_reason: reason,
        verified_by_name: opts.actorName || null,
        verified_at: now
      },
      { status: PR_STATUS.NEEDS_REVISION, revision_reason: reason },
      { status: PR_STATUS.NEEDS_REVISION }
    ],
    { column: 'id', value: opts.req.id }
  );
};

/**
 * Owner mengembalikan pengajuan ke Admin Ops untuk diperiksa ulang.
 *
 * Jejak verifikasi dikosongkan supaya pengajuan benar-benar kembali ke antrean
 * Admin Ops, bukan hanya berpindah label.
 */
export const returnToAdminOps = async (opts: { req: any; reason: string; actorName?: string }) => {
  const reason = String(opts.reason || '').trim();
  if (!reason) return { error: { message: 'Alasan pengembalian wajib diisi.' } };
  return updateWithFallback(
    'purchase_requests',
    [
      {
        status: PR_STATUS.APPROVED,
        revision_reason: `Dikembalikan Owner: ${reason}`,
        verified_by_name: null,
        verified_at: null
      },
      { status: PR_STATUS.APPROVED, revision_reason: `Dikembalikan Owner: ${reason}` },
      { status: PR_STATUS.APPROVED }
    ],
    { column: 'id', value: opts.req.id }
  );
};

/** Admin Ops mengunggah bukti transfer setelah owner membayar. */
export const attachPaymentProof = async (opts: {
  req: any;
  proofUrl: string;
  actorName?: string;
}) => {
  const now = new Date().toISOString();
  return updateWithFallback(
    'purchase_requests',
    [
      {
        payment_proof_url: opts.proofUrl,
        proof_url: opts.proofUrl,
        receipt_url: opts.proofUrl,
        proof_uploaded_by: opts.actorName || null,
        proof_uploaded_at: now
      },
      { payment_proof_url: opts.proofUrl, proof_uploaded_at: now },
      { payment_proof_url: opts.proofUrl }
    ],
    { column: 'id', value: opts.req.id }
  );
};

/** Pengajuan sudah dibayar tetapi bukti transfernya belum diunggah (§18 butir 7). */
export const needsProofUpload = (req: any) =>
  isPrPaid(req) && !String(req?.payment_proof_url || req?.proof_url || '').trim();
