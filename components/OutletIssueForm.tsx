'use client';

import React, { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { createSupervisorIssueTask } from '@/lib/createOutletIssueTask';
import { insertWithFallback } from '@/lib/safeWrite';

export default function OutletIssueForm({ selectedOutlet, employeeName }: { selectedOutlet: string; employeeName: string }) {
  const [issueCategory, setIssueCategory] = useState('Kerusakan Alat');
  const [issueDescription, setIssueDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [msg, setMsg] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);

  const handleIssueSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOutlet || !issueDescription) return;
    setIsSubmitting(true);

    try {
      let mediaUrl = '';
      // Upload media ke Supabase Storage jika ada file terpilih
      if (mediaFile) {
        const fileExt = mediaFile.name.split('.').pop();
        const fileName = `issue_${Date.now()}.${fileExt}`;
        const { error: uploadErr } = await supabase.storage
          .from('outlet-issues')
          .upload(fileName, mediaFile);

        if (!uploadErr) {
          const { data: urlData } = supabase.storage
            .from('outlet-issues')
            .getPublicUrl(fileName);
          mediaUrl = urlData.publicUrl;
        }
      }

      const outletId = typeof selectedOutlet === 'object' ? (selectedOutlet as any).id : selectedOutlet;
      const { data: inserted, error } = await insertWithFallback<{ id: string }>('outlet_issues', [
        {
          outlet_id: outletId,
          category: issueCategory,
          description: issueDescription,
          reporter_name: employeeName || 'Kasir',
          status: 'Sedang Diproses',
          media_url: mediaUrl || null,
          created_at: new Date().toISOString()
        },
        {
          outlet_id: outletId,
          category: issueCategory,
          description: issueDescription,
          reporter_name: employeeName || 'Kasir',
          status: 'Sedang Diproses'
        },
        { outlet_id: outletId, category: issueCategory, description: issueDescription }
      ], { select: 'id' });

      if (error || !inserted?.[0]?.id) throw error || new Error('Insert gagal');

      if (inserted?.[0]?.id) {
        const taskRes = await createSupervisorIssueTask({
          id: inserted[0].id,
          category: issueCategory,
          description: issueDescription,
          reporter_name: employeeName || 'Kasir'
        });
        if (taskRes.error) {
          console.error('Laporan tersimpan, tetapi task Supervisor gagal dibuat:', taskRes.error);
        }
      }

      setIssueDescription('');
      setMediaFile(null);
      setMsg('✅ Laporan kendala terkirim & tugas Supervisor otomatis dibuat.');
      setTimeout(() => setMsg(''), 3000);
    } catch (error: any) {
      alert('❌ Gagal mengirim: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white border rounded-2xl p-4 shadow-sm space-y-3 mt-4">
      <h3 className="text-xs font-bold text-amber-600 border-b pb-2">🚨 Laporkan Kendala Outlet</h3>
      {msg && <p className="text-xs text-emerald-600 font-bold">{msg}</p>}
      <form onSubmit={handleIssueSubmit} className="space-y-3">
        <div>
          <label className="block text-[10px] font-bold text-slate-500 mb-1">Kategori Kendala</label>
          <select
            value={issueCategory}
            onChange={(e) => setIssueCategory(e.target.value)}
            className="w-full border border-slate-300 rounded-xl p-2.5 text-xs bg-white"
          >
            <option value="Kerusakan Alat">Kerusakan Mesin / Alat Outlet</option>
            <option value="Ketersediaan Stok">Bahan Baku / Deterjen Habis</option>
            <option value="Komplain Pelanggan">Komplain Pelanggan Berat</option>
            <option value="Kendala Listrik/Air">Gangguan Listrik / Air</option>
            <option value="Lainnya">Masalah Lainnya</option>
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-bold text-slate-500 mb-1">Detail Kendala</label>
          <textarea
            rows={3}
            placeholder="Jelaskan detail masalah..."
            value={issueDescription}
            onChange={(e) => setIssueDescription(e.target.value)}
            className="w-full border border-slate-300 rounded-xl p-2.5 text-xs"
            required
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-500 mb-1">
            📸 Lampirkan Foto / Video Bukti Kendala (Opsional)
          </label>
          <input
            type="file"
            accept="image/*,video/*"
            onChange={(e) => setMediaFile(e.target.files?.[0] || null)}
            className="w-full text-xs text-slate-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-amber-50 file:text-amber-700 hover:file:bg-amber-100 cursor-pointer"
          />
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-3 rounded-xl text-xs shadow-md"
        >
          {isSubmitting ? 'Mengirim...' : 'KIRIM LAPORAN KENDALA'}
        </button>
      </form>
    </div>
  );
}