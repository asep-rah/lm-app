/**
 * Approve / tolak pengajuan dari balasan WhatsApp, diteruskan n8n.
 *
 * BATASAN YANG SENGAJA DIPASANG: endpoint ini hanya melakukan persetujuan
 * SUPERVISOR (Pending -> Approved) atau penolakan. Ia tidak bisa menandai Paid.
 * docs/BUSINESS_RULES.md §18 butir 2 mengharuskan owner membayar satu per satu
 * sambil melihat rinciannya, dan balasan WhatsApp tidak memenuhi syarat itu.
 *
 * Setiap hasil — berhasil maupun gagal — masuk audit_logs. Kegagalan verifikasi
 * berarti tolak, tidak pernah lanjut.
 */
import { NextResponse } from 'next/server';
import { n8nAuthorized, unauthorized } from '@/lib/n8nAuth';
import { clientIp, insertAuditLog, paymentServiceDb } from '@/lib/paymentSecurity';
import {
  APPROVAL_DECISIONS,
  APPROVAL_PURPOSE,
  consumeApprovalToken,
  normalizePhone,
  parseApprovalDecision
} from '@/lib/approvalTokens';
import { PR_STATUS, isPrPending, prAmount } from '@/lib/cmsRequisition';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!n8nAuthorized(req)) return unauthorized();

  let body: { token?: string; phone?: string; decision?: string; reason?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Body harus JSON' }, { status: 400 });
  }

  const ip = clientIp(req);
  const phone = normalizePhone(body?.phone);
  const decision = parseApprovalDecision(body?.decision);

  const deny = async (reason: string, status = 403) => {
    await insertAuditLog({
      action: 'N8N_APPROVAL_DENIED',
      entity_type: 'purchase_request',
      meta: { reason, phoneTail: phone.slice(-4) || null, decision: body?.decision || null },
      ip_address: ip
    });
    return NextResponse.json({ error: reason }, { status });
  };

  if (!decision) {
    return deny(`Keputusan tidak dikenali. Gunakan salah satu: ${APPROVAL_DECISIONS.join(', ')}`, 400);
  }
  if (!phone) return deny('Nomor pengirim wajib disertakan', 400);

  const consumed = await consumeApprovalToken({
    token: String(body?.token || ''),
    fromPhone: phone,
    purpose: APPROVAL_PURPOSE.REQUISITION_APPROVAL,
    decision
  });
  if (!consumed.ok) return deny(consumed.reason);

  const { row } = consumed;
  const db = paymentServiceDb();

  const { data: prs, error: prErr } = await db
    .from('purchase_requests')
    .select('id, status, amount, estimated_cost, outlet_id')
    .eq('id', row.entity_id)
    .limit(1);
  if (prErr) return NextResponse.json({ error: prErr.message }, { status: 500 });

  const pr = (prs || [])[0];
  if (!pr) return deny('Pengajuan tidak ditemukan', 404);
  // Token sudah terpakai di titik ini; itu memang benar — token sekali pakai
  // tetap hangus walau pengajuannya sudah berpindah status, supaya tidak bisa
  // dicoba ulang nanti.
  if (!isPrPending(pr)) {
    return deny(`Pengajuan sudah tidak di tahap persetujuan (status: ${pr.status})`, 409);
  }

  const now = new Date().toISOString();
  const approverName = row.issued_to_name || 'Approver WhatsApp';

  const payloads =
    decision === 'approve'
      ? [
          { status: PR_STATUS.APPROVED, supervisor_approved_at: now, approved_by: approverName, approved_at: now },
          { status: PR_STATUS.APPROVED, approved_at: now },
          { status: PR_STATUS.APPROVED }
        ]
      : [
          {
            status: PR_STATUS.REJECTED,
            rejected_at: now,
            rejected_by: approverName,
            rejection_reason: String(body?.reason || 'Ditolak lewat WhatsApp')
          },
          { status: PR_STATUS.REJECTED, rejected_at: now },
          { status: PR_STATUS.REJECTED }
        ];

  let lastErr: string | null = null;
  let applied = false;
  for (const payload of payloads) {
    const { error } = await db.from('purchase_requests').update(payload).eq('id', pr.id);
    if (!error) {
      applied = true;
      break;
    }
    lastErr = error.message;
  }

  if (!applied) {
    await insertAuditLog({
      action: 'N8N_APPROVAL_FAILED',
      entity_type: 'purchase_request',
      entity_id: String(pr.id),
      meta: { decision, error: lastErr },
      ip_address: ip
    });
    return NextResponse.json({ error: lastErr || 'Gagal memperbarui pengajuan' }, { status: 500 });
  }

  await insertAuditLog({
    user_name: approverName,
    action: decision === 'approve' ? 'N8N_APPROVAL_APPROVED' : 'N8N_APPROVAL_REJECTED',
    entity_type: 'purchase_request',
    entity_id: String(pr.id),
    amount: prAmount(pr),
    meta: { via: 'whatsapp', tokenId: row.id, phoneTail: phone.slice(-4) },
    ip_address: ip
  });

  return NextResponse.json({
    ok: true,
    decision,
    requisitionId: pr.id,
    newStatus: decision === 'approve' ? PR_STATUS.APPROVED : PR_STATUS.REJECTED,
    note:
      decision === 'approve'
        ? 'Diteruskan ke Admin Operasional untuk verifikasi. Pembayaran tetap dilakukan Owner di aplikasi.'
        : undefined
  });
}
