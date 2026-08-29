'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Camera, CheckCircle2, Headphones, MessageSquare, Phone, Store, User } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { getStaffSession, homePathForRole } from '@/lib/staffSession';
import { toast } from '@/lib/toast';
import { uploadProofFile } from '@/lib/uploadProof';
import FileProofInput from '@/components/FileProofInput';
import PhotoLightbox from '@/components/PhotoLightbox';
import {
  COMPENSATION_OPTIONS,
  issueCustomerName,
  issueDescriptionPlain,
  issueOutletName,
  issuePhone,
  issuePhotos,
  issueResi,
  loadCareComplaints,
  resolveCareComplaint
} from '@/lib/csCare';
import { canonicalPhone } from '@/lib/csChat';

const canAccessCare = (role: string) =>
  ['cs_care', 'cs', 'head_cs', 'owner', 'supervisor'].includes(String(role || '').toLowerCase());

const isOpenIssue = (row: any) => {
  const s = String(row?.status || '').toLowerCase();
  return !s.includes('selesai') && !s.includes('resolved') && !s.includes('done');
};

export default function CsCarePage() {
  const agent = useMemo(() => getStaffSession(), []);
  const [ready, setReady] = useState(false);
  const [issues, setIssues] = useState<any[]>([]);
  const [outlets, setOutlets] = useState<any[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [offerType, setOfferType] = useState('voucher');
  const [offerDetail, setOfferDetail] = useState('');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [tab, setTab] = useState<'open' | 'done'>('open');

  const load = async () => {
    const [{ data }, outs] = await Promise.all([
      loadCareComplaints(),
      supabase.from('outlets').select('id, name')
    ]);
    setIssues(data || []);
    setOutlets(outs.data || []);
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
    const ch = supabase
      .channel('cs_care_issues')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'outlet_issues' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const visible = issues.filter((i) => (tab === 'open' ? isOpenIssue(i) : !isOpenIssue(i)));

  const handleResolve = async (issue: any) => {
    if (!offerType) return toast('Pilih tawaran ganti rugi.', 'warn');
    setBusyId(issue.id);
    try {
      let evidenceUrl = '';
      if (evidenceFile) {
        evidenceUrl = await uploadProofFile(evidenceFile, `care_${issue.id}`);
      }
      const { error } = await resolveCareComplaint({
        issue,
        compensationType: offerType,
        compensationDetail: offerDetail,
        evidenceUrl,
        agentName: agent.name
      });
      if (error) {
        toast('Gagal menyelesaikan: ' + error.message, 'err');
        return;
      }
      toast('Komplain diselesaikan. Pelanggan sudah diberi tahu.', 'ok');
      setOpenId(null);
      setOfferDetail('');
      setEvidenceFile(null);
      load();
    } finally {
      setBusyId(null);
    }
  };

  if (!ready) return <div className="min-h-screen bg-[#f7f7f5]" />;

  return (
    <div className="min-h-screen bg-[#f7f7f5] text-slate-800">
      <header className="bg-white border-b border-slate-200/80">
        <div className="max-w-5xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <Headphones className="w-5 h-5" strokeWidth={2.2} />
            </span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-rose-600">Customer Service Care</p>
              <h1 className="text-lg font-black text-slate-900">Inbox Resolusi Komplain</h1>
            </div>
          </div>
          <div className="flex gap-2">
            <Link href="/cs" className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-sky-600 text-white">
              Live Chat
            </Link>
            <button
              type="button"
              onClick={() => {
                localStorage.removeItem('laundry_user');
                localStorage.removeItem('laundry_owner_user');
                window.location.href = '/login';
              }}
              className="text-[11px] font-semibold px-3 py-1.5 rounded-lg text-rose-600 border border-rose-100"
            >
              Keluar
            </button>
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
          const phone = issuePhone(issue);
          const resi = issueResi(issue);
          const expanded = openId === issue.id;
          const chatHref = phone ? `/cs?phone=${encodeURIComponent(canonicalPhone(phone) || phone)}` : '/cs';
          return (
            <article key={issue.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider text-rose-600">Komplain Pesanan</p>
                  <p className="font-black text-slate-900 text-sm font-mono">{resi}</p>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 h-fit">
                  {issue.status || 'pending'}
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

              {photos.length > 0 && (
                <div className="flex gap-1.5 overflow-x-auto">
                  {photos.map((src, i) => (
                    <button type="button" key={i} onClick={() => setLightbox(src)} className="shrink-0">
                      <img src={src} alt={`Bukti ${i + 1}`} className="h-16 w-20 object-cover rounded-lg border border-slate-200" />
                    </button>
                  ))}
                </div>
              )}

              {isOpenIssue(issue) && (
                <button
                  type="button"
                  onClick={() => {
                    setOpenId(expanded ? null : issue.id);
                    setOfferType('voucher');
                    setOfferDetail('');
                    setEvidenceFile(null);
                  }}
                  className="w-full text-xs font-bold py-2 rounded-xl border border-slate-200 hover:bg-slate-50"
                >
                  {expanded ? 'Tutup panel resolusi' : 'Buka panel resolusi'}
                </button>
              )}

              {expanded && isOpenIssue(issue) && (
                <div className="border-t border-slate-100 pt-3 space-y-3">
                  <Link
                    href={chatHref}
                    className="flex items-center justify-center gap-2 w-full text-xs font-bold py-2.5 rounded-xl bg-sky-50 border border-sky-100 text-sky-800"
                  >
                    <MessageSquare className="w-4 h-4" /> Chat langsung dengan pelanggan
                  </Link>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Tawaran Ganti Rugi</label>
                    <select
                      value={offerType}
                      onChange={(e) => setOfferType(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl p-2.5 text-xs font-bold"
                    >
                      {COMPENSATION_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <input
                      value={offerDetail}
                      onChange={(e) => setOfferDetail(e.target.value)}
                      placeholder="Contoh: Voucher 1x cuci 3 Kg / Refund Rp 25.000"
                      className="mt-1.5 w-full border border-slate-200 rounded-xl p-2.5 text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1 inline-flex items-center gap-1">
                      <Camera className="w-3 h-3" /> Media / bukti resolusi
                    </label>
                    <FileProofInput file={evidenceFile} onFile={setEvidenceFile} icon="upload" />
                  </div>

                  <button
                    type="button"
                    disabled={busyId === issue.id}
                    onClick={() => handleResolve(issue)}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs py-3 rounded-xl inline-flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {busyId === issue.id ? 'Menyimpan…' : 'Setujui & Selesaikan Komplain'}
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
