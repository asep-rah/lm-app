'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  canCreateRequisition,
  getStaffSession,
  isAdminOpsRole,
  isSupervisorRole
} from '@/lib/staffSession';
import {
  PR_STATUS,
  cmsInsertPayload,
  isPrApprovedAwaiting,
  isPrPaid,
  isPrPending,
  prAmount,
  prDescription,
  prReceiptUrl,
  prRequestedBy,
  prTitle
} from '@/lib/cmsRequisition';
import { toast } from '@/lib/toast';
import FileProofInput from '@/components/FileProofInput';

const formatRp = (n: any) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;

const statusBadge = (status: string) => {
  const s = String(status || '');
  if (s === PR_STATUS.PENDING) return 'bg-amber-100 text-amber-800 border-amber-200';
  if (s === PR_STATUS.APPROVED) return 'bg-blue-100 text-blue-800 border-blue-200';
  if (s === PR_STATUS.PAID) return 'bg-emerald-100 text-emerald-800 border-emerald-200';
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
  const canPay = isAdminOpsRole(actorRole);

  const [outlets, setOutlets] = useState<any[]>([]);
  const [outletId, setOutletId] = useState(outletHint || '');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Detergen & Parfum');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [quoteFile, setQuoteFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [requests, setRequests] = useState<any[]>([]);
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});
  const [actualCost, setActualCost] = useState<Record<string, string>>({});
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
      toast('Hanya Kasir yang dapat mengajukan Purchase Request.', 'warn');
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

  const handleMarkPaid = async (req: any) => {
    const paidAmount = Number(actualCost[req.id] ?? prAmount(req)) || 0;
    if (paidAmount <= 0) return alert('Nominal transfer harus lebih dari 0.');

    setBusyId(req.id);
    try {
      let proofUrl = prReceiptUrl(req);
      const file = payProof[req.id];
      if (file) {
        try {
          proofUrl = await uploadReceipt(file);
        } catch (upErr: any) {
          if (!confirm(`${upErr.message}\n\nTandai Paid tanpa bukti transfer?`)) {
            setBusyId(null);
            return;
          }
        }
      }

      const now = new Date().toISOString();
      const desc =
        prDescription(req) ||
        `${prTitle(req)} — ${prRequestedBy(req) || 'Outlet'}`;

      const cmsRow = {
        outlet_id: req.outlet_id,
        amount: paidAmount,
        category: req.category || 'Lain-lain',
        proof_url: proofUrl || null,
        created_at: now
      };
      const { error: expErr } = await supabase.from('expenses').insert([
        { ...cmsRow, description: desc, notes: desc, requisition_id: req.id, status: 'PAID', created_by: actorName }
      ]);
      if (expErr) {
        const { error: expErr2 } = await supabase.from('expenses').insert([cmsRow]);
        if (expErr2) {
          const { error: expErr3 } = await supabase.from('expenses').insert([
            { outlet_id: req.outlet_id, category: req.category || 'Lain-lain', amount: paidAmount, description: desc }
          ]);
          if (expErr3) throw expErr3;
        }
      }

      await updatePr(req.id, [
        {
          status: PR_STATUS.PAID,
          admin_paid_at: now,
          amount: paidAmount,
          proof_url: proofUrl || null,
          receipt_url: proofUrl || prReceiptUrl(req) || null
        },
        { status: PR_STATUS.PAID, paid_at: now }
      ]);
      loadRequests();
    } catch (err: any) {
      alert('❌ Gagal menandai Paid: ' + (err.message || 'Koneksi bermasalah'));
    } finally {
      setBusyId(null);
    }
  };

  const mine = requests.filter(
    (r) => prRequestedBy(r) === actorName || r.outlet_id === outletId
  );
  const pending = requests.filter(isPrPending);
  const awaitingPay = requests.filter(isPrApprovedAwaiting);
  const cats = Array.from(new Set(requests.map((r) => String(r.category || 'Lain-lain'))));
  const tableRows = [...(canCreate && !canApprove && !canPay ? mine : requests)]
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
            <h3 className="text-sm font-black text-slate-800">🛒 Purchase Request (CMS)</h3>
            <p className="text-[10px] text-slate-500 mt-0.5">
              Outlet → <b>Pending Approval</b> → Supervisor → <b>Approved - Awaiting Admin Ops</b> → Finance <b>Paid</b>
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
                <option>Detergen & Parfum</option>
                <option>Sparepart Mesin</option>
                <option>Packing & Plastik</option>
                <option>Maintenance & Servis</option>
                <option>ATK / Operasional</option>
                <option>Lain-lain</option>
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
              {pending.length} pending · {awaitingPay.length} awaiting pay · Paid menulis `expenses`
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
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
                <th className="p-2.5 text-right">Nominal</th>
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
                  <td className="p-2.5 text-right font-black text-slate-900">{formatRp(prAmount(req))}</td>
                  <td className="p-2.5">
                    <span className={`px-2 py-0.5 rounded-full border text-[9px] font-bold ${statusBadge(req.status)}`}>
                      {req.status}
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
                      {canPay && isPrApprovedAwaiting(req) && (
                        <>
                          <input
                            type="number"
                            value={actualCost[req.id] ?? String(prAmount(req) || '')}
                            onChange={(e) => setActualCost({ ...actualCost, [req.id]: e.target.value })}
                            className="w-full border border-slate-200 rounded-lg p-1.5 text-[10px] font-bold"
                          />
                          <FileProofInput
                            file={payProof[req.id] || null}
                            onFile={(f) => setPayProof({ ...payProof, [req.id]: f })}
                            accept="image/*,.pdf"
                            icon="upload"
                          />
                          <button
                            disabled={busyId === req.id}
                            onClick={() => handleMarkPaid(req)}
                            className="w-full bg-sky-500 text-white font-bold py-1.5 rounded-lg text-[10px]"
                          >
                            {busyId === req.id ? '…' : 'Mark Paid'}
                          </button>
                        </>
                      )}
                      {isPrPaid(req) && (
                        <span className="text-[10px] text-emerald-600 font-bold">Logged to expenses</span>
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
