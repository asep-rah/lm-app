/**
 * Ringkasan terjadwal untuk n8n: tugas terlambat / segera jatuh tempo, plus
 * antrean yang perlu didorong.
 *
 * Dijadwalkan dari n8n, bukan dari vercel.json, supaya jadwal dan tujuan
 * pengiriman bisa diubah tanpa deploy.
 *
 * `?emit=1` sekaligus mengirim kejadian ke N8N_WEBHOOK_URL. Kegagalan kirim
 * tidak membuat permintaan ini gagal — ringkasannya tetap dikembalikan.
 */
import { NextResponse } from 'next/server';
import { n8nAuthorized, unauthorized } from '@/lib/n8nAuth';
import { paymentServiceDb } from '@/lib/paymentSecurity';
import { DUE_SOON_HOURS, buildRequisitionQueue, buildTaskDigest } from '@/lib/taskDigest';
import { N8N_EVENT, emitN8nEvent } from '@/lib/n8nEvents';
import { currentPeriod, periodBounds, unbilledEntries } from '@/lib/vendorRecap';

export const dynamic = 'force-dynamic';

const run = async (req: Request) => {
  if (!n8nAuthorized(req)) return unauthorized();

  const url = new URL(req.url);
  const hours = Math.max(1, Math.min(72, Number(url.searchParams.get('hours')) || DUE_SOON_HOURS));
  const emit = ['1', 'true', 'yes'].includes(String(url.searchParams.get('emit') || '').toLowerCase());

  const db = paymentServiceDb();
  const period = currentPeriod();
  const bounds = periodBounds(period);
  // Dibatasi periode & jumlah: 115 outlet membuat kueri tanpa batas tumbuh
  // cepat (docs/PRD.md §8).
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();

  const [tasksRes, prsRes, usageRes] = await Promise.all([
    db
      .from('system_tasks')
      .select('id, title, status, due_date, assigned_to_role, target_role, assigned_to_employee_id')
      .gte('created_at', since)
      .limit(1000),
    db
      .from('purchase_requests')
      // title/category/estimated_cost ikut ditarik karena prTitle/prAmount
      // membacanya sebagai cadangan; tanpa itu setiap pengajuan terkirim ke
      // n8n dengan judul "Pengajuan Pembelian" dan nominal 0.
      .select('id, status, title, category, amount, estimated_cost, created_at')
      .gte('created_at', since)
      .limit(500),
    bounds
      ? db
          .from('vendor_usage_entries')
          .select('id, vendor_key, amount, billed_at, usage_date')
          .gte('usage_date', bounds.start)
          .lte('usage_date', bounds.end)
          .limit(1000)
      : Promise.resolve({ data: [], error: null })
  ]);

  const firstError = tasksRes.error || prsRes.error || usageRes.error;
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 });

  const now = Date.now();
  const digest = buildTaskDigest(tasksRes.data || [], now, hours);
  // Dirinci, bukan sekadar dihitung: n8n butuh ID pengajuan untuk meminta token
  // approval lewat /request-approval-token.
  const requisitions = buildRequisitionQueue(prsRes.data || [], now);
  const usage = usageRes.data || [];

  const body = {
    ok: true,
    ...digest,
    requisitions,
    vendorUsage: {
      period,
      unbilledEntries: unbilledEntries(usage as never).length
    },
    emitted: [] as string[]
  };

  if (emit) {
    if (digest.overdue.length) {
      const res = await emitN8nEvent(N8N_EVENT.TASK_OVERDUE, { tasks: digest.overdue });
      if (res.sent) body.emitted.push(N8N_EVENT.TASK_OVERDUE);
    }
    if (digest.dueSoon.length) {
      const res = await emitN8nEvent(N8N_EVENT.TASK_DUE_SOON, {
        hours,
        tasks: digest.dueSoon
      });
      if (res.sent) body.emitted.push(N8N_EVENT.TASK_DUE_SOON);
    }
    if (requisitions.pendingApproval.length) {
      const res = await emitN8nEvent(N8N_EVENT.REQUISITION_AWAITING_APPROVAL, {
        requisitions: requisitions.pendingApproval
      });
      if (res.sent) body.emitted.push(N8N_EVENT.REQUISITION_AWAITING_APPROVAL);
    }
    if (requisitions.awaitingOwnerPayment.length) {
      // Pengingat saja. Pembayaran tetap dilakukan owner di dalam aplikasi
      // (docs/BUSINESS_RULES.md §18 butir 2) — tidak ada aksi WhatsApp di sini.
      const res = await emitN8nEvent(N8N_EVENT.REQUISITION_AWAITING_OWNER, {
        requisitions: requisitions.awaitingOwnerPayment
      });
      if (res.sent) body.emitted.push(N8N_EVENT.REQUISITION_AWAITING_OWNER);
    }
  }

  return NextResponse.json(body);
};

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
