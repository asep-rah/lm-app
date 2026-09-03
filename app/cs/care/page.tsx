'use client';

import { useEffect, useMemo, useState } from 'react';
import { Camera, CheckCircle2, Headphones, Phone, Store, User } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { getStaffSession, homePathForRole } from '@/lib/staffSession';
import { toast } from '@/lib/toast';
import { uploadProofFile } from '@/lib/uploadProof';
import FileProofInput from '@/components/FileProofInput';
import PhotoLightbox from '@/components/PhotoLightbox';
import { notifyOps, unlockOpsAudio } from '@/lib/opsNotify';
import ComplaintTicketChat from '@/components/ComplaintTicketChat';
import {
  complaintStepOf,
  decisionLabelOf,
  forwardDecisionToCustomer,
  isComplaintIssue,
  issueCustomerName,
  issueDescriptionPlain,
  issueOutletName,
  issuePhone,
  issuePhotos,
  issueResi,
  issueVideo,
  loadCareComplaints,
  submitFindingsToSupervisor
} from '@/lib/csCare';
import {
  ensureComplaintTicketFromIssue,
  findComplaintTicket,
  resolveComplaintInvestigation,
  ticketTitleOf
} from '@/lib/complaintTicket';

const canAccessCare = (role: string) =>
  ['cs_care', 'cs', 'head_cs', 'owner', 'supervisor'].includes(String(role || '').toLowerCase());

const isOpenIssue = (row: any) => complaintStepOf(row) !== 'resolved';

const stepLabel = (issue: any) => {
  const step = complaintStepOf(issue);
  if (step === 'pending_supervisor') return 'Menunggu Supervisor';
  if (step === 'decision_ready') return 'Siap diteruskan';
  if (step === 'awaiting_customer') return 'Menunggu pelanggan';
  if (step === 'appealed') return 'Banding — investigasi ulang';
  if (step === 'resolved') return 'Selesai';
  return 'Investigasi CS Care';
};

export default function CsCarePage() {
  const agent = useMemo(() => getStaffSession(), []);
  const [ready, setReady] = useState(false);
  const [issues, setIssues] = useState<any[]>([]);
  const [outlets, setOutlets] = useState<any[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [findings, setFindings] = useState('');
  const [cctvNotes, setCctvNotes] = useState('');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [tab, setTab] = useState<'open' | 'done'>('open');
  const [tickets, setTickets] = useState<Record<string, any>>({});

  const load = async () => {
    const [{ data }, outs] = await Promise.all([
      loadCareComplaints(),
      supabase.from('outlets').select('id, name')
    ]);
    setIssues(data || []);
    setOutlets(outs.data || []);
    const next: Record<string, any> = {};
    await Promise.all(
      (data || []).map(async (issue: any) => {
        const ticket = isOpenIssue(issue)
          ? await ensureComplaintTicketFromIssue(issue)
          : await findComplaintTicket(issue);
        if (ticket) next[issue.id] = ticket;
      })
    );
    setTickets(next);
  };

  useEffect(() => {
    const role = getStaffSession().role;
    if (!role) {
      window.location.href = '/login';
      return;
    }
    if (!canAccessCare(role)) {
      window.location.href = homePathForRole(role);
      return;
    }
    setReady(true);
    load();
    const seenIssues = new Set<string>();
    const seenChats = new Set<string>();
    const ch = supabase
      .channel('cs_care_issues')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'outlet_issues' }, (payload) => {
        const row: any = payload.new;
        if (payload.eventType === 'INSERT' && isComplaintIssue(row) && row?.id && !seenIssues.has(row.id)) {
          seenIssues.add(row.id);
          notifyOps('complaint', 'Komplain baru dari pelanggan. Mulai investigasi CS Care.', true);
        }
        load();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'complaint_chat_messages' }, (payload) => {
        const row: any = payload.new;
        if (row && String(row.sender_type).toLowerCase() === 'customer' && row.id && !seenChats.has(row.id)) {
          seenChats.add(row.id);
          notifyOps('chat', 'Pesan baru di Tiket Komplain.', true);
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const visible = issues.filter((i) => (tab === 'open' ? isOpenIssue(i) : !isOpenIssue(i)));

  const handleSubmitSupervisor = async (issue: any) => {
    if (!findings.trim()) return toast('Isi temuan investigasi & analisis CCTV.', 'warn');
    setBusyId(issue.id);
    try {
      let evidenceUrl = '';
      if (evidenceFile) {
        evidenceUrl = await uploadProofFile(evidenceFile, `care_${issue.id}`);
      }
      const { error } = await submitFindingsToSupervisor({
        issue,
        findings,
        cctvNotes,
        evidenceUrl,
        agentName: agent.name
      });
      if (error) {
        toast('Gagal kirim ke Supervisor: ' + error.message, 'err');
        return;
      }
      toast('Temuan dikirim ke Supervisor untuk persetujuan.', 'ok');
      setOpenId(null);
      setFindings('');
      setCctvNotes('');
      setEvidenceFile(null);
      load();
    } finally {
      setBusyId(null);
    }
  };

  const handleForward = async (issue: any) => {
    setBusyId(issue.id);
    try {
      const { error } = await forwardDecisionToCustomer({ issue, agentName: agent.name });
      if (error) {
        toast('Gagal meneruskan keputusan: ' + error.message, 'err');
        return;
      }
      toast('Keputusan Supervisor dikirim ke Room Chat Tiket Komplain.', 'ok');
      load();
    } finally {
      setBusyId(null);
    }
  };

  const handleResolveTicket = async (issue: any) => {
    if (!confirm('Tutup investigasi dan selesaikan tiket komplain ini? Room chat akan dihapus otomatis 24 jam kemudian.')) {
      return;
    }
    setBusyId(issue.id);
    try {
      const { error, ticket } = await resolveComplaintInvestigation({
        issue,
        ticket: tickets[issue.id],
        agentName: agent.name
      });
      if (error) {
        toast('Gagal menyelesaikan tiket: ' + error.message, 'err');
        return;
      }
      if (ticket) setTickets((prev) => ({ ...prev, [issue.id]: ticket }));
      toast('Tiket diselesaikan. Room chat hangus 24 jam lagi.', 'ok');
      load();
    } finally {
      setBusyId(null);
    }
  };

  if (!ready) return <div className="min-h-screen bg-[#f7f7f5]" />;

  return (
    <div className="min-h-screen bg-[#f7f7f5] text-slate-800" onPointerDown={() => unlockOpsAudio()}>
      <header className="bg-white border-b border-slate-200/80">
        <div className="max-w-5xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <Headphones className="w-5 h-5" strokeWidth={2.2} />
            </span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-rose-600">CS Care</p>
              <h1 className="text-lg font-black text-slate-900">Inbox Resolusi Komplain</h1>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-5 space-y-4">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTab('open')}
            className={`text-xs font-bold px-3 py-1.5 rounded-full ${tab === 'open' ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}
          >
            Terbuka ({issues.filter(isOpenIssue).length})
          </button>
          <button
            type="button"
            onClick={() => setTab('done')}
            className={`text-xs font-bold px-3 py-1.5 rounded-full ${tab === 'done' ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}
          >
            Selesai ({issues.filter((i) => !isOpenIssue(i)).length})
          </button>
        </div>

        {visible.length === 0 && (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-sm text-slate-400">
            Tidak ada komplain pada tab ini.
          </div>
        )}

        {visible.map((issue) => {
          const photos = issuePhotos(issue);
          const video = issueVideo(issue);
          const phone = issuePhone(issue);
          const resi = issueResi(issue);
          const expanded = openId === issue.id;
          const step = complaintStepOf(issue);
          const canInvestigate = step === 'pending_investigation' || step === 'appealed';
          const ticket = tickets[issue.id];
          return (
            <article key={issue.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider text-rose-600">Komplain Pesanan</p>
                  <p className="font-black text-slate-900 text-sm font-mono">{resi}</p>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 h-fit">
                  {stepLabel(issue)}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <p className="flex items-center gap-1.5 text-slate-700">
                  <User className="w-3.5 h-3.5 text-slate-400" /> {issueCustomerName(issue)}
                </p>
                <p className="flex items-center gap-1.5 text-slate-700">
                  <Phone className="w-3.5 h-3.5 text-slate-400" /> {phone || '—'}
                </p>
                <p className="flex items-center gap-1.5 text-slate-700 sm:col-span-2">
                  <Store className="w-3.5 h-3.5 text-slate-400" /> {issueOutletName(issue, outlets)}
                </p>
              </div>

              <p className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 whitespace-pre-wrap">
                {issueDescriptionPlain(issue)}
              </p>

              {video && (
                <video src={video} controls className="w-full max-h-48 rounded-xl border border-slate-200 bg-black" />
              )}

              {photos.length > 0 && (
                <div className="flex gap-1.5 overflow-x-auto">
                  {photos.map((src, i) => (
                    <button type="button" key={i} onClick={() => setLightbox(src)} className="shrink-0">
                      <img src={src} alt={`Bukti ${i + 1}`} className="h-16 w-20 object-cover rounded-lg border border-slate-200" />
                    </button>
                  ))}
                </div>
              )}

              {issue.findings && (
                <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2 text-[11px] text-indigo-800">
                  <p className="font-black uppercase text-[9px] tracking-wider mb-0.5">Temuan CS Care</p>
                  {issue.findings}
                  {issue.cctv_notes && <p className="mt-1">CCTV / log: {issue.cctv_notes}</p>}
                </div>
              )}

              {issue.supervisor_decision && (
                <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 text-[11px] text-amber-900">
                  <p className="font-black uppercase text-[9px] tracking-wider mb-0.5">Keputusan Supervisor</p>
                  {decisionLabelOf(issue.supervisor_decision)}
                  {issue.supervisor_note ? ` — ${issue.supervisor_note}` : ''}
                </div>
              )}

              {ticket && (
                <ComplaintTicketChat ticket={ticket} senderType="cs" senderName={agent.name || 'CS Care'} />
              )}

              {isOpenIssue(issue) && (
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    disabled={busyId === issue.id}
                    onClick={() => handleResolveTicket(issue)}
                    className="flex-1 text-xs font-black py-2.5 rounded-xl bg-rose-600 text-white disabled:opacity-50"
                  >
                    {busyId === issue.id ? 'Menyimpan…' : 'Tutup Investigasi / Selesaikan'}
                  </button>
                  {canInvestigate && (
                    <button
                      type="button"
                      onClick={() => {
                        setOpenId(expanded ? null : issue.id);
                        setFindings(issue.findings || '');
                        setCctvNotes(issue.cctv_notes || '');
                        setEvidenceFile(null);
                      }}
                      className="flex-1 text-xs font-bold py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50"
                    >
                      {expanded ? 'Tutup form temuan' : 'Isi temuan → Supervisor'}
                    </button>
                  )}
                  {step === 'decision_ready' && (
                    <button
                      type="button"
                      disabled={busyId === issue.id}
                      onClick={() => handleForward(issue)}
                      className="flex-1 bg-emerald-600 text-white font-black text-xs py-2.5 rounded-xl"
                    >
                      {busyId === issue.id ? 'Mengirim…' : 'Teruskan keputusan ke pelanggan'}
                    </button>
                  )}
                </div>
              )}

              {step === 'pending_supervisor' && (
                <p className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                  Temuan sudah dikirim. Menunggu Supervisor memilih Ganti Rugi Cash, Voucher, atau Tolak.
                </p>
              )}
              {step === 'awaiting_customer' && (
                <p className="text-[11px] font-bold text-sky-800 bg-sky-50 border border-sky-100 rounded-xl px-3 py-2">
                  Keputusan sudah dikirim ke {ticket ? ticketTitleOf(ticket) : 'Room Chat Tiket Komplain'}. Menunggu pelanggan Setuju atau Banding.
                </p>
              )}

              {expanded && canInvestigate && (
                <div className="border-t border-slate-100 pt-3 space-y-3">
                  <p className="text-[10px] text-slate-500 font-medium">
                    Kumpulkan bukti foto, cek CCTV / work log, lalu kirim temuan ke Supervisor. Jangan menutup tiket di tahap ini.
                  </p>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Temuan investigasi</label>
                    <textarea
                      value={findings}
                      onChange={(e) => setFindings(e.target.value)}
                      rows={3}
                      placeholder="Hasil cek fisik, foto, dan komunikasi dengan pelanggan"
                      className="w-full border border-slate-200 rounded-xl p-2.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Analisis CCTV / work log</label>
                    <textarea
                      value={cctvNotes}
                      onChange={(e) => setCctvNotes(e.target.value)}
                      rows={2}
                      placeholder="Cuplikan CCTV, jam sortir/packing, nama kru"
                      className="w-full border border-slate-200 rounded-xl p-2.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1 inline-flex items-center gap-1">
                      <Camera className="w-3 h-3" /> Foto bukti investigasi
                    </label>
                    <FileProofInput file={evidenceFile} onFile={setEvidenceFile} icon="upload" />
                  </div>
                  <button
                    type="button"
                    disabled={busyId === issue.id}
                    onClick={() => handleSubmitSupervisor(issue)}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs py-3 rounded-xl inline-flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {busyId === issue.id ? 'Mengirim…' : 'Kirim temuan ke Supervisor'}
                  </button>
                </div>
              )}

              {!isOpenIssue(issue) && issue.compensation_offer && (
                <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">
                  Selesai · {issue.compensation_offer}
                </p>
              )}
            </article>
          );
        })}
      </main>
      <PhotoLightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}
