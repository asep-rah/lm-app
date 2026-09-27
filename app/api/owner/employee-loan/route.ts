import { NextResponse, type NextRequest } from 'next/server';
import { clientIp, insertAuditLog, insertErrorLog, paymentServiceDb } from '@/lib/paymentSecurity';
import { isSameOriginRequest } from '@/lib/requestGuards';
import { updateWithFallbackOn } from '@/lib/safeWrite';
import { requirePermission } from '@/lib/staffAuth/permissions';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };
const deny = (status: number, error: string) => NextResponse.json({ error }, { status, headers: noStore });

/**
 * Keputusan kasbon staf (hak 'kasbon.decide', default owner & supervisor): approve / reject / paid (lunas). Browser
 * tidak lagi bisa mengubah employee_loans (menyetujui kasbon sendiri, mengubah
 * nominal / potongan). Pengajuan tetap dari POS dengan status 'pending'
 * (dijaga trigger). Semua keputusan tercatat di audit_logs.
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req.headers)) return deny(403, 'Permintaan ditolak.');
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(body.id || '').trim();
  const action = String(body.action || '');
  if (!id || id.length > 64) return deny(400, 'Kasbon tidak valid.');
  if (!['approve', 'reject', 'paid'].includes(action)) return deny(400, 'Aksi kasbon tidak dikenal.');

  try {
    const db = paymentServiceDb();
    const me = await requirePermission(req, db, 'kasbon.decide');
    if ('error' in me) return me.error;
    const { data: loan } = await db.from('employee_loans').select('*').eq('id', id).maybeSingle();
    if (!loan) return deny(404, 'Kasbon tidak ditemukan.');
    const status = String(loan.status || '').toLowerCase();
    const pending = status.includes('pending');
    const amount = Number(loan.amount || loan.total_loan) || 0;

    let attempts: Record<string, unknown>[];
    if (action === 'approve') {
      if (!pending) return deny(409, 'Kasbon ini sudah diputuskan.');
      attempts = [
        {
          status: 'Active',
          approved_by: me.staff.name || 'Owner',
          total_loan: amount || loan.total_loan,
          monthly_deduction: Number(loan.monthly_deduction) || Math.ceil(amount / 5) || 0
        },
        { status: 'Active', approved_by: me.staff.name || 'Owner' },
        { status: 'Active' }
      ];
    } else if (action === 'reject') {
      if (!pending) return deny(409, 'Kasbon ini sudah diputuskan.');
      attempts = [{ status: 'Rejected' }, { status: 'rejected' }];
    } else {
      if (status === 'paid' || status === 'lunas') return NextResponse.json({ ok: true, already: true }, { headers: noStore });
      if (pending || status.includes('reject') || status.includes('tolak')) return deny(409, 'Hanya kasbon yang sudah disetujui yang bisa ditandai lunas.');
      attempts = [{ status: 'Paid' }, { status: 'lunas' }];
    }
    const { error } = await updateWithFallbackOn(db, 'employee_loans', attempts, { column: 'id', value: id });
    if (error) throw new Error(error.message);
    await insertAuditLog({
      user_id: me.staff.id,
      user_name: me.staff.name,
      role: me.staff.role,
      action: `employee_loan_${action}`,
      entity_type: 'employee_loans',
      entity_id: id,
      amount: amount || null,
      meta: { employee_name: loan.employee_name ?? null, from_status: loan.status ?? null },
      ip_address: clientIp(req)
    });
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (e) {
    await insertErrorLog({ source: 'employee_loan', code: 'EMPLOYEE_LOAN_FAILED', message: String((e as Error)?.message || e).slice(0, 300) });
    return deny(500, 'Keputusan kasbon belum tersimpan. Coba lagi sebentar lagi.');
  }
}
