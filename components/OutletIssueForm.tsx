import React, { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function OutletIssueForm({ selectedOutlet, employeeName }: { selectedOutlet: string; employeeName: string }) {
  const [issueCategory, setIssueCategory] = useState('Kerusakan Alat');
  const [issueDescription, setIssueDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [msg, setMsg] = useState('');

  const handleIssueSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOutlet || !issueDescription) return;
    setIsSubmitting(true);
    
    const { error } = await supabase.from('outlet_issues').insert([{
      outlet_id: selectedOutlet,
      category: issueCategory,
      description: issueDescription,
      reporter_name: employeeName || 'Kasir',
      status: 'Sedang Diproses',
      created_at: new Date().toISOString()
    }]);

    if (!error) {
      setIssueDescription('');
      setMsg('✅ Laporan kendala berhasil dikirim!');
      setTimeout(() => setMsg(''), 3000);
    } else {
      alert('❌ Gagal mengirim: ' + error.message);
    }
    setIsSubmitting(false);
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