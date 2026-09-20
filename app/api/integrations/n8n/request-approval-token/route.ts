/**
 * Terbitkan token approval sekali pakai untuk dikirim lewat WhatsApp oleh n8n.
 *
 * Token dicetak di server dan dikembalikan SEKALI. Aplikasi hanya menyimpan
 * hash-nya, jadi token yang hilang harus diterbitkan ulang, tidak bisa dibaca
 * kembali.
 *
 * Penerima harus karyawan dengan peran yang berhak dan nomor WhatsApp
 * terdaftar; nomor sembarang tidak bisa diberi token.
 */
import { NextResponse } from 'next/server';
import { n8nAuthorized, unauthorized } from '@/lib/n8nAuth';
import { insertAuditLog, paymentServiceDb } from '@/lib/paymentSecurity';
import { APPROVAL_PURPOSE, issueApprovalToken, normalizePhone } from '@/lib/approvalTokens';
import { isPrPending, prAmount, prTitle } from '@/lib/cmsRequisition';

export const dynamic = 'force-dynamic';

/** Peran yang boleh menyetujui pengajuan dari WhatsApp. */
const APPROVER_ROLES = ['supervisor', 'owner'];

export async function POST(req: Request) {
  if (!n8nAuthorized(req)) return unauthorized();

  let body: { requisition_id?: string; phone?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Body harus JSON' }, { status: 400 });
  }

  const requisitionId = String(body?.requisition_id || '').trim();
  const phone = normalizePhone(body?.phone);
  if (!requisitionId) return NextResponse.json({ error: 'requisition_id wajib' }, { status: 400 });
  if (!phone) return NextResponse.json({ error: 'phone wajib' }, { status: 400 });

  const db = paymentServiceDb();

  const { data: prs, error: prErr } = await db
    .from('purchase_requests')
    .select('id, status, title, category, amount, estimated_cost, outlet_id')
    .eq('id', requisitionId)
    .limit(1);
  if (prErr) return NextResponse.json({ error: prErr.message }, { status: 500 });

  const pr = (prs || [])[0];
  if (!pr) return NextResponse.json({ error: 'Pengajuan tidak ditemukan' }, { status: 404 });
  // Token hanya untuk tahap persetujuan supervisor. Tahap pembayaran tidak
  // pernah lewat WhatsApp (docs/BUSINESS_RULES.md §18 butir 2).
  if (!isPrPending(pr)) {
    return NextResponse.json(
      { error: `Pengajuan tidak berada di tahap persetujuan (status: ${pr.status})` },
      { status: 409 }
    );
  }

  const { data: emps, error: empErr } = await db
    .from('employees')
    .select('id, name, role, whatsapp')
    .not('whatsapp', 'is', null)
    .limit(500);
  if (empErr) return NextResponse.json({ error: empErr.message }, { status: 500 });

  const approver = (emps || []).find(
    (e) =>
      normalizePhone(e.whatsapp) === phone &&
      APPROVER_ROLES.includes(String(e.role || '').toLowerCase())
  );
  if (!approver) {
    await insertAuditLog({
      action: 'N8N_APPROVAL_TOKEN_DENIED',
      entity_type: 'purchase_request',
      entity_id: requisitionId,
      meta: { reason: 'nomor tidak terdaftar sebagai supervisor/owner', phoneTail: phone.slice(-4) }
    });
    return NextResponse.json(
      { error: 'Nomor bukan supervisor/owner terdaftar' },
      { status: 403 }
    );
  }

  const { token, expiresAt, error } = await issueApprovalToken({
    purpose: APPROVAL_PURPOSE.REQUISITION_APPROVAL,
    entityType: 'purchase_request',
    entityId: requisitionId,
    phone,
    name: approver.name
  });
  if (error || !token) {
    return NextResponse.json({ error: error || 'Gagal menerbitkan token' }, { status: 500 });
  }

  await insertAuditLog({
    user_id: approver.id,
    user_name: approver.name,
    role: approver.role,
    action: 'N8N_APPROVAL_TOKEN_ISSUED',
    entity_type: 'purchase_request',
    entity_id: requisitionId,
    amount: prAmount(pr),
    meta: { expiresAt, phoneTail: phone.slice(-4) }
  });

  return NextResponse.json({
    ok: true,
    token,
    expiresAt,
    approver: { name: approver.name, role: approver.role },
    requisition: { id: pr.id, title: prTitle(pr), amount: prAmount(pr) }
  });
}
