'use client';

import React, { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { createSupervisorIssueTask } from '@/lib/createOutletIssueTask';
import { insertWithFallback } from '@/lib/safeWrite';
import FileProofInput from '@/components/FileProofInput';

export default function OutletIssueForm({ selectedOutlet, employeeName }: { selectedOutlet: string; employeeName: string }) {
  const [issueCategory, setIssueCategory] = useState('Kerusakan Alat');
  const [issueTitle, setIssueTitle] = useState('');
  const [issueDescription, setIssueDescription] = useState('');
  const [issueUrgency, setIssueUrgency] = useState('Biasa');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [msg, setMsg] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);

  const handleIssueSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cashierName = String(employeeName || '').trim() || 'Kasir Outlet';
    const outletId = typeof selectedOutlet === 'object'
      ? String((selectedOutlet as { id?: string })?.id || '')
      : String(selectedOutlet || '').trim();

    if (!outletId || outletId === 'ALL') {
      alert('⚠️ Outlet kasir tidak terdeteksi. Pilih outlet aktif terlebih dahulu.');
      return;
    }
    if (!issueTitle.trim() || !issueDescription.trim()) {
      alert('⚠️ Lengkapi judul dan deskripsi kendala!');
      return;
    }

    setIsSubmitting(true);
    setMsg('');

    try {
      let mediaUrl = '';
      if (mediaFile) {
        const fileExt = mediaFile.name.split('.').pop();
        const fileName = `issue_${Date.now()}.${fileExt}`;
        try {
          const { error: uploadErr } = await supabase.storage
            .from('outlet-issues')
            .upload(fileName, mediaFile);
          if (!uploadErr) {
            const { data: urlData } = supabase.storage
              .from('outlet-issues')
              .getPublicUrl(fileName);
            mediaUrl = urlData.publicUrl;
          }
        } catch {
          // Lampiran opsional — laporan tetap dikirim tanpa media.
        }
      }

      const fullDescription = `${issueTitle.trim()}\n${issueDescription.trim()}`;

      const { data: inserted, error } = await insertWithFallback<{ id: string }>('outlet_issues', [
        {
          outlet_id: outletId,
          created_by_name: cashierName,
          reporter_name: cashierName,
          category: issueCategory,
          urgency: issueUrgency,
          title: issueTitle.trim(),
          description: fullDescription,
          status: 'Perlu Penanganan',
          media_url: mediaUrl || null
        },
        {
          outlet_id: outletId,
          created_by_name: cashierName,
          reporter_name: cashierName,
          category: issueCategory,
          urgency: issueUrgency,
          description: fullDescription,
          status: 'Perlu Penanganan'
        },
        {
          outlet_id: outletId,
          created_by_name: cashierName,
          reporter_name: cashierName,
          category: issueCategory,
          description: fullDescription,
          status: 'Perlu Penanganan'
        },
        {
          outlet_id: outletId,
          reporter_name: cashierName,
          category: issueCategory,
          description: fullDescription,
          status: 'Sedang Diproses'
        },
        {
          outlet_id: outletId,
          created_by_name: cashierName,
          description: fullDescription
        },
        {
          outlet_id: outletId,
          description: fullDescription
        }
      ], { select: 'id' });

      if (error) throw new Error(error.message);

      let issueId = inserted?.[0]?.id;
      if (!issueId) {
        try {
          const { data: latest } = await supabase
            .from('outlet_issues')
            .select('id')
            .eq('outlet_id', outletId)
            .order('created_at', { ascending: false })
            .limit(1);
          issueId = latest?.[0]?.id;
        } catch {
          issueId = undefined;
        }
      }

      if (issueId) {
        try {
          const taskRes = await createSupervisorIssueTask({
            id: issueId,
            category: issueCategory,
            description: fullDescription,
            reporter_name: cashierName,
            urgency: issueUrgency
          });
          if (taskRes.error) {
            console.error('Laporan tersimpan, tetapi task Supervisor gagal dibuat:', taskRes.error);
          }
        } catch (taskErr) {
          console.error('Laporan tersimpan, tetapi task Supervisor gagal dibuat:', taskErr);
        }
      }

      setIssueTitle('');
      setIssueDescription('');
      setMediaFile(null);
      setMsg('✅ Laporan kendala terkirim. Supervisor outlet menerima tugas secara otomatis.');
      setTimeout(() => setMsg(''), 4000);
    } catch (err: unknown) {
      const raw = err && typeof err === 'object' && 'message' in err
        ? String((err as { message?: unknown }).message || '')
        : String(err || '');
      const isFetch = /failed to fetch|networkerror|load failed/i.test(raw) || (err instanceof TypeError);
      alert(isFetch
        ? '❌ Gagal mengirim laporan: koneksi ke database terputus. Coba lagi beberapa saat.'
        : '❌ Gagal mengirim laporan: ' + (raw || 'Koneksi bermasalah'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleIssueSubmit} className="bg-white border border-rose-200 p-5 rounded-2xl space-y-3 shadow-sm">
      <h3 className="font-bold text-xs text-rose-900 flex items-center gap-1.5 border-b pb-2">
        <span>🚨 Lapor Kendala / Keluhan Outlet ke Supervisor</span>
      </h3>
      {msg && <p className="text-xs text-emerald-700 font-bold">{msg}</p>}

      <select
        value={issueCategory}
        onChange={(e) => setIssueCategory(e.target.value)}
        className="w-full border border-slate-300 rounded-xl p-2.5 text-xs font-bold text-slate-900 focus:outline-none bg-white"
      >
        <option value="Kerusakan Alat">Kerusakan Mesin / Alat Outlet</option>
        <option value="Ketersediaan Stok">Bahan Baku / Deterjen Habis</option>
        <option value="Komplain Pelanggan">Komplain Pelanggan Berat</option>
        <option value="Kendala Listrik/Air">Gangguan Listrik / Air</option>
        <option value="Lainnya">Masalah Lainnya</option>
      </select>

      <div>
        <p className="text-[10px] font-extrabold text-slate-500 uppercase mb-1">Tingkat Urgensi</p>
        <div className="grid grid-cols-3 gap-2">
          {['Biasa', 'Mendesak', 'Critical'].map((urg) => (
            <button
              key={urg}
              type="button"
              onClick={() => setIssueUrgency(urg)}
              className={`py-2 rounded-xl text-xs font-extrabold border transition ${
                issueUrgency === urg
                  ? urg === 'Critical' ? 'bg-rose-600 text-white border-rose-600' : urg === 'Mendesak' ? 'bg-amber-500 text-white border-amber-500' : 'bg-blue-600 text-white border-blue-600'
                  : 'bg-slate-50 text-slate-600 border-slate-200'
              }`}
            >
              {urg}
            </button>
          ))}
        </div>
      </div>

      <input
        type="text"
        placeholder="Judul Kendala (Contoh: Mesin Cuci No. 2 Bocor)"
        value={issueTitle}
        onChange={(e) => setIssueTitle(e.target.value)}
        className="w-full border border-slate-300 rounded-xl p-2.5 text-xs font-bold text-slate-900 focus:outline-none"
      />
      <textarea
        rows={3}
        placeholder="Rincian kendala secara detail..."
        value={issueDescription}
        onChange={(e) => setIssueDescription(e.target.value)}
        className="w-full border border-slate-300 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none"
      />
      <div>
        <label className="block text-[10px] font-bold text-slate-500 mb-1">
          Lampirkan Foto / Video Bukti Kendala (Opsional)
        </label>
        <FileProofInput file={mediaFile} onFile={setMediaFile} accept="image/*,video/*" icon="upload" />
      </div>
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-2.5 rounded-xl text-xs shadow transition"
      >
        {isSubmitting ? 'Mengirim...' : 'Kirim Laporan Kendala'}
      </button>
    </form>
  );
}
