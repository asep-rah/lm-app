'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { updateWithFallback } from '@/lib/safeWrite';
import { toast } from '@/lib/toast';
import {
  PR_STATUS,
  isPrAwaitingOwner,
  isPrPending,
  prAmount,
  prDescription,
  prRequestedBy,
  prTitle
} from '@/lib/cmsRequisition';
import { payRequisition, returnToAdminOps } from '@/lib/requisitionPayment';

/** Tab Persetujuan ringkas — digabung dari /owner/dashboard agar satu halaman owner. */
export default function OwnerApprovalsTab({ currentUserName }: { currentUserName: string }) {
  const [purchaseRequests, setPurchaseRequests] = useState<any[]>([]);
  const [submissionsList, setSubmissionsList] = useState<any[]>([]);
  const [loansList, setLoansList] = useState<any[]>([]);
  const [outletIssues, setOutletIssues] = useState<any[]>([]);
  const [approvalBusy, setApprovalBusy] = useState<string | null>(null);
  const [payReturnReason, setPayReturnReason] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const [{ data: prs }, { data: subs }, { data: loans }, { data: issues }] = await Promise.all([
      supabase.from('purchase_requests').select('*, outlets(name)').order('created_at', { ascending: false }).limit(80),
      supabase.from('submissions').select('*').order('created_at', { ascending: false }).limit(80),
      supabase.from('employee_loans').select('*').order('created_at', { ascending: false }).limit(80),
      supabase
        .from('outlet_issues')
        .select('*, outlets(name)')
        .order('created_at', { ascending: false })
        .limit(40)
    ]);
    if (prs) setPurchaseRequests(prs);
    if (subs) setSubmissionsList(subs);
    if (loans) setLoansList(loans);
    if (issues) setOutletIssues(issues);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const markSubmission = async (sourceId: string | null | undefined, status: string) => {
    if (!sourceId) return;
    await updateWithFallback(
      'submissions',
      [{ status }, { status: status === 'approved' ? 'approved' : 'rejected' }],
      { column: 'source_id', value: String(sourceId) }
    );
  };

  const pendingPurchases = useMemo(() => purchaseRequests.filter((r) => isPrPending(r)), [purchaseRequests]);
  /**
   * Antrean bayar owner: hanya yang sudah diverifikasi Admin Ops. Owner tidak
   * boleh melihat pengajuan yang belum lewat gerbang verifikasi
   * (docs/BUSINESS_RULES.md §18 butir 3).
   */
  const awaitingOwnerPayment = useMemo(
    () => purchaseRequests.filter((r) => isPrAwaitingOwner(r)),
    [purchaseRequests]
  );
  const pendingLoans = useMemo(
    () => loansList.filter((l) => String(l.status || '').toLowerCase().includes('pending')),
    [loansList]
  );
  const openIssues = useMemo(
    () =>
      outletIssues.filter((i) => {
        const s = String(i.status || '').toLowerCase();
        return !s.includes('selesai') && !s.includes('done') && !s.includes('closed');
      }),
    [outletIssues]
  );
  const pendingSubs = useMemo(() => {
    return submissionsList.filter((s) => {
      const st = String(s.status || '').toLowerCase();
      if (st && !st.includes('pending') && st !== 'new' && st !== 'open') return false;
      if (
        s.source_id &&
        (pendingPurchases.some((p) => String(p.id) === String(s.source_id)) ||
          pendingLoans.some((l) => String(l.id) === String(s.source_id)))
      ) {
        return false;
      }
      return true;
    });
  }, [submissionsList, pendingPurchases, pendingLoans]);

  const approvalCount =
    pendingPurchases.length +
    awaitingOwnerPayment.length +
    pendingLoans.length +
    openIssues.length +
    pendingSubs.length;

  const handleApprovePurchase = async (req: any) => {
    setApprovalBusy(req.id);
    const now = new Date().toISOString();
    const { error } = await updateWithFallback(
      'purchase_requests',
      [
        { status: PR_STATUS.APPROVED, supervisor_approved_at: now, approved_by: currentUserName || 'Owner' },
        { status: PR_STATUS.APPROVED, approved_at: now },
        { status: PR_STATUS.APPROVED }
      ],
      { column: 'id', value: req.id }
    );
    await markSubmission(req.id, 'approved');
    if (error) toast(error.message, 'err');
    else toast('Pengajuan pembelian disetujui.', 'ok');
    await refresh();
    setApprovalBusy(null);
  };

  const handleRejectPurchase = async (req: any) => {
    if (!confirm('Tolak pengajuan pembelian ini?')) return;
    setApprovalBusy(req.id);
    const { error } = await updateWithFallback(
      'purchase_requests',
      [{ status: PR_STATUS.REJECTED, rejected_at: new Date().toISOString() }, { status: PR_STATUS.REJECTED }],
      { column: 'id', value: req.id }
    );
    await markSubmission(req.id, 'rejected');
    if (error) toast(error.message, 'err');
    else toast('Pengajuan pembelian ditolak.', 'ok');
    await refresh();
    setApprovalBusy(null);
  };

  /**
   * Owner membayar satu pengajuan. Pencatatan biaya dan perubahan status
   * dipusatkan di payRequisition() supaya idempoten: satu pengajuan tetap satu
   * baris expenses walau tombol ditekan dua kali atau update status gagal.
   */
  const handlePayPurchase = async (req: any) => {
    const amount = prAmount(req);
    if (
      !confirm(
        `Bayar pengajuan ini?\n\n${prTitle(req)}\n${req.outlets?.name || 'Outlet'} · Rp ${amount.toLocaleString('id-ID')}\n\nBiaya akan tercatat di laporan pengeluaran.`
      )
    ) {
      return;
    }
    setApprovalBusy(req.id);
    const { error, alreadyRecorded } = await payRequisition({
      req,
      actorName: currentUserName || 'Owner'
    });
    if (error) toast(error.message, 'err');
    else if (alreadyRecorded) toast('Status diselesaikan — biaya sudah tercatat sebelumnya.', 'ok');
    else toast('Pengajuan dibayar dan tercatat di pengeluaran.', 'ok');
    await refresh();
    setApprovalBusy(null);
  };

  const handleReturnToAdminOps = async (req: any) => {
    const reason = (payReturnReason[req.id] || '').trim();
    if (!reason) return alert('Isi alasan pengembalian ke Admin Ops.');
    setApprovalBusy(req.id);
    const { error } = await returnToAdminOps({ req, reason, actorName: currentUserName || 'Owner' });
    if (error) toast(error.message, 'err');
    else {
      setPayReturnReason({ ...payReturnReason, [req.id]: '' });
      toast('Dikembalikan ke Admin Operasional.', 'ok');
    }
    await refresh();
    setApprovalBusy(null);
  };

  const handleApproveKasbon = async (loan: any) => {
    setApprovalBusy(loan.id);
    const amt = Number(loan.amount || loan.total_loan) || 0;
    const { error } = await updateWithFallback(
      'employee_loans',
      [
        {
          status: 'Active',
          approved_by: currentUserName || 'Owner',
          total_loan: amt || loan.total_loan,
          monthly_deduction: Number(loan.monthly_deduction) || Math.ceil(amt / 5) || 0,
          employee_name: loan.employee_name || currentUserName
        },
        { status: 'Active', approved_by: currentUserName || 'Owner' },
        { status: 'Active' }
      ],
      { column: 'id', value: loan.id }
    );
    await markSubmission(loan.id, 'approved');
    if (error) toast(error.message, 'err');
    else toast('Kasbon staf disetujui.', 'ok');
    await refresh();
    setApprovalBusy(null);
  };

  const handleRejectKasbon = async (loan: any) => {
    if (!confirm('Tolak kasbon staf ini?')) return;
    setApprovalBusy(loan.id);
    const { error } = await updateWithFallback(
      'employee_loans',
      [{ status: 'Rejected' }, { status: 'rejected' }],
      { column: 'id', value: loan.id }
    );
    await markSubmission(loan.id, 'rejected');
    if (error) toast(error.message, 'err');
    else toast('Kasbon ditolak.', 'ok');
    await refresh();
    setApprovalBusy(null);
  };

  const handleUpdateIssueStatus = async (id: string, status: string) => {
    const { error } = await updateWithFallback('outlet_issues', [{ status }], { column: 'id', value: id });
    if (error) toast(error.message, 'err');
    else toast('Status kendala diperbarui.', 'ok');
    await refresh();
  };

  const handleApproveSubmission = async (row: any) => {
    setApprovalBusy(row.id);
    const { error } = await updateWithFallback(
      'submissions',
      [{ status: 'approved' }],
      { column: 'id', value: row.id }
    );
    if (error) toast(error.message, 'err');
    else toast('Pengajuan disetujui.', 'ok');
    await refresh();
    setApprovalBusy(null);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 p-4 md:p-6 rounded-2xl shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="font-black text-slate-900 text-sm">Persetujuan / Approval</h3>
            <p className="text-[10px] text-slate-500">Pengajuan kasir masuk otomatis ke antrian ini.</p>
          </div>
          <span className="text-xs font-black text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-full">
            {approvalCount} pending
          </span>
        </div>
      </div>

      <div className="bg-white border border-amber-200 p-4 md:p-6 rounded-2xl shadow-sm space-y-3">
        <h4 className="font-bold text-amber-800 text-xs uppercase">Pengajuan Pembelian</h4>
        {pendingPurchases.map((req) => (
          <div
            key={req.id}
            className="border border-amber-200 bg-amber-50/50 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
          >
            <div>
              <p className="text-xs font-black text-slate-900">{prTitle(req)}</p>
              <p className="text-[10px] text-slate-500">
                {prRequestedBy(req) || 'Kasir'} · {req.outlets?.name || 'Outlet'} · Rp{' '}
                {prAmount(req).toLocaleString('id-ID')}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={approvalBusy === req.id}
                onClick={() => handleApprovePurchase(req)}
                className="bg-emerald-600 text-white text-[10px] font-bold px-3 py-2 rounded-lg"
              >
                Setujui
              </button>
              <button
                type="button"
                disabled={approvalBusy === req.id}
                onClick={() => handleRejectPurchase(req)}
                className="bg-rose-100 text-rose-700 text-[10px] font-bold px-3 py-2 rounded-lg"
              >
                Tolak
              </button>
            </div>
          </div>
        ))}
        {pendingPurchases.length === 0 && (
          <p className="text-xs text-slate-400 text-center py-4">Tidak ada pengajuan pembelian menunggu.</p>
        )}
      </div>

      <div className="bg-white border border-emerald-200 p-4 md:p-6 rounded-2xl shadow-sm space-y-3">
        <div>
          <h4 className="font-bold text-emerald-800 text-xs uppercase">Menunggu Pembayaran Anda</h4>
          <p className="text-[10px] text-slate-500">
            Sudah disetujui Supervisor dan diverifikasi Admin Operasional. Bayar satu per satu;
            bukti transfer diunggah Admin Ops setelah Anda beri tahu.
          </p>
        </div>
        {awaitingOwnerPayment.map((req) => (
          <div key={req.id} className="border border-emerald-200 bg-emerald-50/40 rounded-xl p-3 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-black text-slate-900">{prTitle(req)}</p>
                <p className="text-[10px] text-slate-500">
                  {prRequestedBy(req) || 'Kasir'} · {req.outlets?.name || 'Outlet'} · {req.category || '—'}
                </p>
                {prDescription(req) && (
                  <p className="text-[10px] text-slate-500 mt-1 leading-snug">{prDescription(req)}</p>
                )}
                <p className="text-[10px] text-slate-400 mt-1">
                  Disetujui: {req.approved_by || req.supervisor_approved_at ? 'Supervisor' : '—'} · Diverifikasi:{' '}
                  {req.verified_by_name || 'Admin Ops'}
                  {req.verified_at ? ` (${new Date(req.verified_at).toLocaleDateString('id-ID')})` : ''}
                </p>
                {req.duplicate_of_id && (
                  <p className="text-[10px] text-amber-700 font-bold mt-1">
                    Ditandai mirip pengajuan lain — Admin Ops sudah memeriksa.
                  </p>
                )}
              </div>
              <p className="text-sm font-black text-slate-900 shrink-0">
                Rp {prAmount(req).toLocaleString('id-ID')}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                disabled={approvalBusy === req.id}
                onClick={() => handlePayPurchase(req)}
                className="bg-emerald-600 text-white text-[10px] font-bold px-3 py-2 rounded-lg disabled:opacity-50"
              >
                {approvalBusy === req.id ? '…' : 'Bayar'}
              </button>
              <input
                placeholder="Alasan kembalikan ke Admin Ops"
                value={payReturnReason[req.id] || ''}
                onChange={(e) => setPayReturnReason({ ...payReturnReason, [req.id]: e.target.value })}
                className="flex-1 border border-slate-200 rounded-lg px-2 py-2 text-[10px]"
              />
              <button
                type="button"
                disabled={approvalBusy === req.id}
                onClick={() => handleReturnToAdminOps(req)}
                className="bg-orange-50 text-orange-700 text-[10px] font-bold px-3 py-2 rounded-lg disabled:opacity-50"
              >
                Kembalikan
              </button>
            </div>
          </div>
        ))}
        {awaitingOwnerPayment.length === 0 && (
          <p className="text-xs text-slate-400 text-center py-4">Tidak ada pengajuan menunggu pembayaran.</p>
        )}
      </div>

      <div className="bg-white border border-indigo-200 p-4 md:p-6 rounded-2xl shadow-sm space-y-3">
        <h4 className="font-bold text-indigo-800 text-xs uppercase">Kasbon Staf</h4>
        {pendingLoans.map((loan) => (
          <div
            key={loan.id}
            className="border border-indigo-200 bg-indigo-50/50 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
          >
            <div>
              <p className="text-xs font-black text-slate-900">{loan.employee_name || 'Staf'}</p>
              <p className="text-[10px] text-slate-500">
                Rp {Number(loan.amount || loan.total_loan || 0).toLocaleString('id-ID')} ·{' '}
                {loan.reason || loan.notes || 'Kasbon'}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={approvalBusy === loan.id}
                onClick={() => handleApproveKasbon(loan)}
                className="bg-emerald-600 text-white text-[10px] font-bold px-3 py-2 rounded-lg"
              >
                Setujui
              </button>
              <button
                type="button"
                disabled={approvalBusy === loan.id}
                onClick={() => handleRejectKasbon(loan)}
                className="bg-rose-100 text-rose-700 text-[10px] font-bold px-3 py-2 rounded-lg"
              >
                Tolak
              </button>
            </div>
          </div>
        ))}
        {pendingLoans.length === 0 && (
          <p className="text-xs text-slate-400 text-center py-4">Tidak ada kasbon menunggu.</p>
        )}
      </div>

      <div className="bg-white border border-rose-200 p-4 md:p-6 rounded-2xl shadow-sm space-y-3">
        <h4 className="font-bold text-rose-800 text-xs uppercase">Laporan Kendala Outlet</h4>
        {openIssues.slice(0, 20).map((issue) => (
          <div
            key={issue.id}
            className="border border-rose-200 bg-rose-50/40 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
          >
            <div>
              <p className="text-xs font-black text-slate-900">{issue.title || issue.category || 'Kendala'}</p>
              <p className="text-[10px] text-slate-500">
                {issue.outlets?.name || 'Outlet'} · {issue.status}
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleUpdateIssueStatus(issue.id, 'Selesai')}
              className="bg-slate-800 text-white text-[10px] font-bold px-3 py-2 rounded-lg"
            >
              Tandai Selesai
            </button>
          </div>
        ))}
        {openIssues.length === 0 && (
          <p className="text-xs text-slate-400 text-center py-4">Tidak ada kendala terbuka.</p>
        )}
      </div>

      {pendingSubs.length > 0 && (
        <div className="bg-white border border-slate-200 p-4 md:p-6 rounded-2xl shadow-sm space-y-3">
          <h4 className="font-bold text-slate-800 text-xs uppercase">Pengajuan Lain</h4>
          {pendingSubs.map((row) => (
            <div
              key={row.id}
              className="border border-slate-200 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
            >
              <div>
                <p className="text-xs font-black text-slate-900">{row.title || row.type}</p>
                <p className="text-[10px] text-slate-500">
                  {row.requested_by || 'Kasir'} · {row.type} · Rp{' '}
                  {Number(row.amount || 0).toLocaleString('id-ID')}
                </p>
              </div>
              <button
                type="button"
                disabled={approvalBusy === row.id}
                onClick={() => handleApproveSubmission(row)}
                className="bg-emerald-600 text-white text-[10px] font-bold px-3 py-2 rounded-lg"
              >
                Setujui
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
