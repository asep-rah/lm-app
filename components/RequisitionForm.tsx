'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  canCreateRequisition,
  canVerifyRequisition,
  getStaffSession,
  isSupervisorRole
} from '@/lib/staffSession';
import {
  PR_STATUS,
  cmsInsertPayload,
  exportPurchaseRequestsCsv,
  isPrApprovedAwaiting,
  isPrAwaitingOwner,
  isPrFulfilled,
  isPrNeedsRevision,
  isPrPaid,
  isPrPending,
  prAmount,
  prDescription,
  prQty,
  prRequestedBy,
  prStatusLabel,
  prTitle
} from '@/lib/cmsRequisition';
import {
  attachPaymentProof,
  needsProofUpload,
  returnForRevision,
  verifyAndForwardToOwner
} from '@/lib/requisitionPayment';
import { duplicateSuspicionMap } from '@/lib/requisitionVerify';
import { toast } from '@/lib/toast';
import FileProofInput from '@/components/FileProofInput';
import { updateWithFallback } from '@/lib/safeWrite';
import { writeSubmission } from '@/lib/posSync';
import { EXPENSE_COA_GROUPS, EXPENSE_COA_OPTIONS, expenseCoaLabel } from '@/lib/pnlReport';

const formatRp = (n: any) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;

const statusBadge = (status: string) => {
  const s = String(status || '');
  if (s === PR_STATUS.PENDING) return 'bg-amber-100 text-amber-800 border-amber-200';
  if (s === PR_STATUS.APPROVED) return 'bg-blue-100 text-blue-800 border-blue-200';
  if (s === PR_STATUS.AWAITING_OWNER) return 'bg-indigo-100 text-indigo-800 border-indigo-200';
  if (s === PR_STATUS.NEEDS_REVISION) return 'bg-orange-100 text-orange-800 border-orange-200';
  if (s === PR_STATUS.PAID) return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (String(s).toLowerCase().includes('fulfil')) return 'bg-violet-100 text-violet-800 border-violet-200';
  if (s.toLowerCase().includes('reject')) return 'bg-rose-100 text-rose-800 border-rose-200';
  return 'bg-slate-100 text-slate-600 border-slate-200';
};

async function uploadReceipt(file: File): Promise<string> {
  const ext = file.name.split('.').pop() || 'jpg';
  const fileName = `pr_${Date.now()}.${ext}`;
  const buckets = ['purchase-quotes', 'outlet-issues'];
  for (const bucket of buckets) {
    const { error } = await supabase.storage.from(bucket).upload(fileName, file);
    if (!error) {
      const { data } = supabase.storage.from(bucket).getPublicUrl(fileName);
      return data.publicUrl;
    }
  }
  throw new Error('Gagal mengunggah bukti. Lanjutkan tanpa lampiran atau cek bucket storage.');
}

async function insertPr(payload: Record<string, any>) {
  const attempts = [
    payload,
    { ...payload, proof_url: undefined },
    { ...payload, receipt_url: undefined }
  ];
  let lastErr: any = null;
  for (const row of attempts) {
    const clean = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
    const { error } = await supabase.from('purchase_requests').insert([clean]);
    if (!error) return;
    lastErr = error;
  }
  throw lastErr;
}

async function updatePr(id: string, payloads: Record<string, any>[]) {
  let lastErr: any = null;
  for (const row of payloads) {
    const { error } = await supabase.from('purchase_requests').update(row).eq('id', id);
    if (!error) return;
    lastErr = error;
  }
  throw lastErr;
}

export default function RequisitionForm({
  selectedOutlet,
  employeeName,
  role
}: {
  selectedOutlet?: string;
  employeeName?: string;
  role?: string;
}) {
  const session = useMemo(() => getStaffSession(), []);
  const actorName = employeeName || session.name;
  const actorRole = (role || session.role).toLowerCase();
  const outletHint = selectedOutlet || session.outletId;

  const canCreate = canCreateRequisition(actorRole);
  const canApprove = isSupervisorRole(actorRole);
  // Admin Ops memverifikasi dan meneruskan; yang membayar adalah owner, lewat
  // antrean di halaman Owner. Tombol "Mark Paid" di sini sudah dihapus.
  const canVerify = canVerifyRequisition(actorRole);

  const [outlets, setOutlets] = useState<any[]>([]);
  const [outletId, setOutletId] = useState(outletHint || '');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(EXPENSE_COA_OPTIONS[0]);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [quoteFile, setQuoteFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [requests, setRequests] = useState<any[]>([]);
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});
  const [revisionReason, setRevisionReason] = useState<Record<string, string>>({});
  const [payProof, setPayProof] = useState<Record<string, File | null>>({});
  const [tableQ, setTableQ] = useState('');
  const [tableCat, setTableCat] = useState('ALL');
  const [tableSort, setTableSort] = useState<'date' | 'amount' | 'status'>('date');

  const loadRequests = async () => {
    const { data, error } = await supabase
      .from('purchase_requests')
      .select('*, outlets(name)')
      .order('created_at', { ascending: false })
      .limit(80);

    if (error) {
      console.error('Gagal memuat purchase_requests:', error);
      return;
    }
    setRequests(data || []);
  };

  useEffect(() => {
    supabase.from('outlets').select('id, name, city').then(({ data }) => {
      if (data) {
        setOutlets(data);
        if (!outletId && data.length === 1) setOutletId(data[0].id);
      }
    });
    loadRequests();

    const channel = supabase
      .channel('realtime_purchase_requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_requests' }, () => {
        loadRequests();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreate) {
      toast('Hanya Kasir yang dapat mengajukan pembelian.', 'warn');
      return;
    }
    if (!outletId) return alert('Pilih outlet terlebih dahulu.');
    if (!title.trim()) return alert('Isi judul pengajuan.');
    const nominal = Number(amount) || 0;
    if (nominal <= 0) return alert('Nominal harus lebih dari 0.');

    setIsSubmitting(true);
    try {
      let receiptUrl = '';
      if (quoteFile) {
        try {
          receiptUrl = await uploadReceipt(quoteFile);
        } catch (upErr: any) {
          if (!confirm(`${upErr.message}\n\nSimpan pengajuan tanpa foto?`)) {
            setIsSubmitting(false);
            return;
          }
        }
      }

      await insertPr(
        cmsInsertPayload({
          outlet_id: outletId,
          requested_by: actorName || 'Karyawan Outlet',
          title: title.trim(),
          amount: nominal,
          category,
          description: description.trim(),
          receipt_url: receiptUrl || null
        })
      );

      await writeSubmission({
        type: 'purchase',
        outlet_id: outletId,
        requested_by: actorName || 'Karyawan Outlet',
        title: title.trim(),
        amount: nominal,
        description: description.trim() || category,
        source_table: 'purchase_requests'
      });

      setTitle('');
      setAmount('');
      setDescription('');
      setQuoteFile(null);
      setMsg('✅ Pengajuan terkirim. Menunggu persetujuan Supervisor.');
      setTimeout(() => setMsg(''), 4000);
      loadRequests();
    } catch (err: any) {
      alert('❌ Gagal mengajukan: ' + (err.message || 'Koneksi bermasalah'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApprove = async (req: any) => {
    setBusyId(req.id);
    try {
      const now = new Date().toISOString();
      await updatePr(req.id, [
        { status: PR_STATUS.APPROVED, supervisor_approved_at: now },
        { status: PR_STATUS.APPROVED, approved_at: now }
      ]);
      loadRequests();
    } catch (err: any) {
      toast('Gagal menyetujui: ' + (err.message || 'Koneksi bermasalah'), 'err');
    }
    setBusyId(null);
  };

  const handleReject = async (req: any) => {
    const reason = (rejectReason[req.id] || '').trim();
    if (!reason) return alert('Isi alasan penolakan.');
    setBusyId(req.id);
    try {
      await updatePr(req.id, [
        { status: PR_STATUS.REJECTED, description: `${prDescription(req)}\nDitolak: ${reason}`.trim() },
        { status: PR_STATUS.REJECTED, rejection_reason: reason, rejected_at: new Date().toISOString() }
      ]);
      loadRequests();
    } catch (err: any) {
      alert('❌ Gagal menolak: ' + (err.message || 'Koneksi bermasalah'));
    }
    setBusyId(null);
  };

  const handleVerify = async (req: any) => {
    const suspicions = duplicates[req.id] || [];
    if (suspicions.length) {
      const detail = suspicions
        .slice(0, 3)
        .map((d) => `• ${d.title} — ${formatRp(d.amount)} (${d.reasons.join(', ')})`)
        .join('\n');
      if (!confirm(`Pengajuan ini mirip dengan:\n\n${detail}\n\nTetap teruskan ke Owner?`)) return;
    }

    setBusyId(req.id);
    const { error } = await verifyAndForwardToOwner({
      req,
      actorName,
      duplicateOfId: suspicions[0]?.id || null
    });
    setBusyId(null);
    if (error) {
      toast('Gagal memverifikasi: ' + error.message, 'err');
      return;
    }
    toast('Diteruskan ke Owner untuk dibayar.', 'ok');
    loadRequests();
  };

  const handleReturn = async (req: any) => {
    const reason = (revisionReason[req.id] || '').trim();
    if (!reason) return alert('Isi alasan pengembalian.');
    setBusyId(req.id);
    const { error } = await returnForRevision({ req, reason, actorName });
    setBusyId(null);
    if (error) {
      toast('Gagal mengembalikan: ' + error.message, 'err');
      return;
    }
    setRevisionReason({ ...revisionReason, [req.id]: '' });
    toast('Pengajuan dikembalikan ke pemohon.', 'ok');
    loadRequests();
  };

  // Bukti transfer diunggah Admin Ops setelah owner membayar (§18 butir 7),
  // jadi ini aksi terpisah dari pembayaran, bukan bagian darinya.
  const handleUploadProof = async (req: any) => {
    const file = payProof[req.id];
    if (!file) return alert('Pilih file bukti transfer.');
    setBusyId(req.id);
    try {
      const proofUrl = await uploadReceipt(file);
      const { error } = await attachPaymentProof({ req, proofUrl, actorName });
      if (error) throw new Error(error.message);
      setPayProof({ ...payProof, [req.id]: null });
      toast('Bukti transfer tersimpan.', 'ok');
      loadRequests();
    } catch (err: any) {
      toast('Gagal mengunggah bukti: ' + (err.message || 'Koneksi bermasalah'), 'err');
    } finally {
      setBusyId(null);
    }
  };

  const handleFulfill = async (req: any) => {
    setBusyId(req.id);
    const { error } = await updateWithFallback(
      'purchase_requests',
      [{ status: PR_STATUS.FULFILLED }, { status: 'Fulfilled' }],
      { column: 'id', value: req.id }
    );
    setBusyId(null);
    if (error) {
      toast('Gagal menandai Fulfilled: ' + error.message, 'err');
      return;
    }
    toast('Pengajuan ditandai Fulfilled.', 'ok');
    loadRequests();
  };

  const mine = requests.filter(
    (r) => prRequestedBy(r) === actorName || r.outlet_id === outletId
  );
  const pending = requests.filter(isPrPending);
  const awaitingVerify = requests.filter(isPrApprovedAwaiting);
  const awaitingOwner = requests.filter(isPrAwaitingOwner);
  const missingProof = requests.filter(needsProofUpload);

  // Dugaan kembaran dihitung sekali untuk seluruh daftar, bukan per baris saat
  // render. Hasilnya peringatan untuk Admin Ops, bukan pemblokir.
  const duplicates = useMemo(
    () => (canVerify ? duplicateSuspicionMap(requests) : {}),
    [requests, canVerify]
  );
  const cats = Array.from(
    new Set([...EXPENSE_COA_OPTIONS, ...requests.map((r) => String(r.category || '').trim()).filter(Boolean)])
  );
  const tableRows = [...(canCreate && !canApprove && !canVerify ? mine : requests)]
    .filter((r) => {
      const hay = `${prTitle(r)} ${prRequestedBy(r)} ${r.status} ${r.category}`.toLowerCase();
      if (tableQ && !hay.includes(tableQ.toLowerCase())) return false;
      if (tableCat !== 'ALL' && String(r.category || '') !== tableCat) return false;
      return true;
    })
    .sort((a, b) => {
      if (tableSort === 'amount') return prAmount(b) - prAmount(a);
      if (tableSort === 'status') return String(a.status).localeCompare(String(b.status));
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  return (
    <div className="space-y-5">
      {canCreate && (
        <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
          <div>
            <h3 className="text-sm font-black text-slate-800">Pengajuan Pembayaran</h3>
            <p className="text-[10px] text-slate-500 mt-0.5">
              Outlet → <b>Pending</b> → Supervisor <b>Approve</b> → Admin Ops <b>Verifikasi</b> → Owner <b>Bayar</b>
            </p>
          </div>
          {msg && <p className="text-xs font-bold text-emerald-600">{msg}</p>}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Outlet</label>
              <select
                value={outletId}
                onChange={(e) => setOutletId(e.target.value)}
                className="w-full border rounded-xl p-2.5 text-xs bg-white"
                required
              >
                <option value="">-- Pilih Outlet --</option>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Kategori</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full border rounded-xl p-2.5 text-xs bg-white"
              >
                {EXPENSE_COA_GROUPS.map((group) => (
                  <optgroup key={group.title} label={group.title}>
                    {group.accounts.map((a) => (
                      <option key={a.code} value={expenseCoaLabel(a)}>
                        {expenseCoaLabel(a)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Judul (title)</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Contoh: Restock deterjen 5L outlet Sampangan"
              className="w-full border rounded-xl p-2.5 text-xs"
              required
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Nominal (amount)</label>
            <input
              type="number"
              min="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="150000"
              className="w-full border rounded-xl p-2.5 text-sm font-bold text-rose-600"
              required
            />
          </div>

          <textarea
            rows={2}
            placeholder="Deskripsi / catatan (description)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full border rounded-xl p-2.5 text-xs"
          />

          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">
              Foto / nota (receipt_url)
            </label>
            <FileProofInput file={quoteFile} onFile={setQuoteFile} accept="image/*,.pdf" icon="upload" />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl text-xs"
          >
            {isSubmitting ? 'Mengirim...' : 'AJUKAN KE SUPERVISOR'}
          </button>
        </form>
      )}

      <section className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all space-y-3">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-slate-900">Purchase Requisitions</h3>
            <p className="text-[11px] text-slate-400">
              {pending.length} Pending · {awaitingVerify.length} Perlu verifikasi ·{' '}
              {awaitingOwner.length} Menunggu Owner
              {canVerify && missingProof.length > 0 && ` · ${missingProof.length} bukti belum diunggah`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => exportPurchaseRequestsCsv(tableRows, 'pengajuan_cms')}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] px-3 py-2 rounded-xl"
            >
              EXPORT PENGAJUAN (CSV / EXCEL)
            </button>
            <input
              type="search"
              placeholder="Cari judul, pemohon, status…"
              value={tableQ}
              onChange={(e) => setTableQ(e.target.value)}
              className="border border-slate-200 rounded-xl px-3 py-2 text-xs min-w-[180px]"
            />
            <select
              value={tableCat}
              onChange={(e) => setTableCat(e.target.value)}
              className="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white"
            >
              <option value="ALL">Semua kategori</option>
              {cats.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select
              value={tableSort}
              onChange={(e) => setTableSort(e.target.value as any)}
              className="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white"
            >
              <option value="date">Urut tanggal</option>
              <option value="amount">Urut nominal</option>
              <option value="status">Urut status</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-400 font-bold uppercase tracking-wide">
              <tr>
                <th className="p-2.5">Tanggal</th>
                <th className="p-2.5">Judul</th>
                <th className="p-2.5">Outlet</th>
                <th className="p-2.5">Kategori</th>
                <th className="p-2.5 text-right">Qty</th>
                <th className="p-2.5 text-right">Budget</th>
                <th className="p-2.5">Status</th>
                <th className="p-2.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((req) => (
                <tr key={req.id} className="border-t border-slate-100 hover:bg-slate-50/80">
                  <td className="p-2.5 text-slate-500">{new Date(req.created_at).toLocaleString('id-ID')}</td>
                  <td className="p-2.5">
                    <p className="font-bold text-slate-900">{prTitle(req)}</p>
                    <p className="text-[10px] text-slate-400">{prRequestedBy(req)}</p>
                  </td>
                  <td className="p-2.5 text-slate-600">{req.outlets?.name || '—'}</td>
                  <td className="p-2.5 text-slate-600">{req.category || '—'}</td>
                  <td className="p-2.5 text-right font-bold">{prQty(req) || '—'}</td>
                  <td className="p-2.5 text-right font-black text-slate-900">{formatRp(prAmount(req))}</td>
                  <td className="p-2.5">
                    <span className={`px-2 py-0.5 rounded-full border text-[9px] font-bold ${statusBadge(req.status)}`}>
                      {prStatusLabel(req)}
                    </span>
                  </td>
                  <td className="p-2.5 text-right">
                    <div className="flex flex-col items-end gap-1 min-w-[160px]">
                      {canApprove && isPrPending(req) && (
                        <>
                          <input
                            placeholder="Alasan tolak"
                            value={rejectReason[req.id] || ''}
                            onChange={(e) => setRejectReason({ ...rejectReason, [req.id]: e.target.value })}
                            className="w-full border border-slate-200 rounded-lg p-1.5 text-[10px]"
                          />
                          <div className="flex gap-1 w-full">
                            <button
                              disabled={busyId === req.id}
                              onClick={() => handleApprove(req)}
                              className="flex-1 bg-emerald-500 text-white font-bold py-1.5 rounded-lg text-[10px]"
                            >
                              Approve
                            </button>
                            <button
                              disabled={busyId === req.id}
                              onClick={() => handleReject(req)}
                              className="flex-1 bg-rose-50 text-rose-700 font-bold py-1.5 rounded-lg text-[10px]"
                            >
                              Reject
                            </button>
                          </div>
                        </>
                      )}
                      {canVerify && isPrApprovedAwaiting(req) && (
                        <>
                          {(duplicates[req.id] || []).length > 0 && (
                            <div className="w-full text-left bg-amber-50 border border-amber-200 rounded-lg p-1.5">
                              <p className="text-[9px] font-bold text-amber-800">
                                Dugaan pengajuan double
                              </p>
                              {(duplicates[req.id] || []).slice(0, 2).map((d) => (
                                <p key={d.id} className="text-[9px] text-amber-700 leading-snug">
                                  {d.title} · {formatRp(d.amount)} · {d.reasons.join(', ')}
                                </p>
                              ))}
                              <p className="text-[8px] text-amber-600 mt-0.5">
                                Peringatan saja — Anda yang memutuskan.
                              </p>
                            </div>
                          )}
                          <input
                            placeholder="Alasan kembalikan"
                            value={revisionReason[req.id] || ''}
                            onChange={(e) => setRevisionReason({ ...revisionReason, [req.id]: e.target.value })}
                            className="w-full border border-slate-200 rounded-lg p-1.5 text-[10px]"
                          />
                          <div className="flex gap-1 w-full">
                            <button
                              disabled={busyId === req.id}
                              onClick={() => handleVerify(req)}
                              className="flex-1 bg-indigo-600 text-white font-bold py-1.5 rounded-lg text-[10px]"
                            >
                              {busyId === req.id ? '…' : 'Verifikasi & Teruskan'}
                            </button>
                            <button
                              disabled={busyId === req.id}
                              onClick={() => handleReturn(req)}
                              className="flex-1 bg-orange-50 text-orange-700 font-bold py-1.5 rounded-lg text-[10px]"
                            >
                              Kembalikan
                            </button>
                          </div>
                        </>
                      )}
                      {isPrAwaitingOwner(req) && (
                        <span className="text-[10px] text-indigo-700 font-bold">
                          Menunggu pembayaran Owner
                        </span>
                      )}
                      {isPrNeedsRevision(req) && (
                        <span className="text-[10px] text-orange-700 font-bold text-right">
                          Dikembalikan: {req.revision_reason || 'perlu revisi'}
                        </span>
                      )}
                      {isPrPaid(req) && !isPrFulfilled(req) && (
                        <>
                          <span className="text-[10px] text-emerald-600 font-bold">
                            Dibayar Owner · tercatat di expenses
                          </span>
                          {canVerify && needsProofUpload(req) && (
                            <>
                              <p className="text-[9px] text-amber-700 font-bold">Bukti transfer belum diunggah</p>
                              <FileProofInput
                                file={payProof[req.id] || null}
                                onFile={(f) => setPayProof({ ...payProof, [req.id]: f })}
                                accept="image/*,.pdf"
                                icon="upload"
                              />
                              <button
                                type="button"
                                disabled={busyId === req.id}
                                onClick={() => handleUploadProof(req)}
                                className="w-full bg-sky-500 text-white font-bold py-1.5 rounded-lg text-[10px]"
                              >
                                {busyId === req.id ? '…' : 'Unggah Bukti Transfer'}
                              </button>
                            </>
                          )}
                          {canVerify && (
                            <button
                              type="button"
                              disabled={busyId === req.id}
                              onClick={() => handleFulfill(req)}
                              className="w-full bg-violet-600 text-white font-bold py-1.5 rounded-lg text-[10px]"
                            >
                              Tandai Fulfilled
                            </button>
                          )}
                        </>
                      )}
                      {isPrFulfilled(req) && (
                        <span className="text-[10px] text-violet-700 font-bold">Barang terpenuhi</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {tableRows.length === 0 && (
            <p className="text-xs text-slate-400 italic text-center py-8">Tidak ada pengajuan.</p>
          )}
        </div>
      </section>
    </div>
  );
}
