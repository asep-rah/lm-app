'use client';

import React, { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { getStaffSession } from '@/lib/staffSession';

export default function HeadTaskDelegator() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [role, setRole] = useState('supervisor');
  const [slaHours, setSlaHours] = useState(24);
  const [penaltyPoints, setPenaltyPoints] = useState(10);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const dueDate = new Date();
    dueDate.setHours(dueDate.getHours() + Number(slaHours));
    const session = getStaffSession();

    const payload: Record<string, any> = {
      title,
      description,
      assigned_to_role: role,
      sla_hours: Number(slaHours),
      due_date: dueDate.toISOString(),
      kpi_penalty_points: Number(penaltyPoints),
      created_by_name: session.name || 'Head of Laundry Management',
      status: 'pending'
    };

    let { error } = await supabase.from('system_tasks').insert([payload]);
    if (error) {
      const withoutName = { ...payload };
      delete withoutName.created_by_name;
      const retry = await supabase.from('system_tasks').insert([withoutName]);
      error = retry.error;
    }

    if (!error) {
      alert('🚀 Task & SLA berhasil dikirim ke Dashboard ' + role.toUpperCase());
      setTitle('');
      setDescription('');
    } else {
      alert('❌ Gagal membuat task: ' + error.message);
    }
    setIsSubmitting(false);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
      <h3 className="font-bold text-slate-800 text-sm md:text-base flex items-center gap-2">
        🎯 Delegasi Tugas & Control SLA (Head Management)
      </h3>
      <form onSubmit={handleCreateTask} className="space-y-3">
        <div>
          <label className="block text-[10px] font-bold text-slate-500 mb-1">Judul Tugas</label>
          <input
            type="text"
            placeholder="Misal: Audit Kelayakan Mesin Dryer Gas Outlet Sampangan"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full border rounded-xl p-2.5 text-xs"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Tujuan Divisi / Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full border rounded-xl p-2.5 text-xs bg-white"
            >
              <option value="kasir">🛒 Kasir / POS</option>
              <option value="cs">🛵 Kurir & CS</option>
              <option value="driver">🛵 Kurir (Driver)</option>
              <option value="courier">🛵 Kurir (Courier)</option>
              <option value="supervisor">🛡️ Supervisor Operasional</option>
              <option value="admin_ops">📦 Admin Ops</option>
              <option value="digital_marketing">🚀 Digital Marketing</option>
              <option value="finance">💰 Finance</option>
              <option value="owner_relation">🤝 Owner Relation</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Batas Waktu SLA (Jam)</label>
            <input
              type="number"
              value={slaHours}
              onChange={(e) => setSlaHours(Number(e.target.value))}
              className="w-full border rounded-xl p-2.5 text-xs font-bold text-indigo-600"
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Penalti KPI jika Overdue (Poin)</label>
            <input
              type="number"
              value={penaltyPoints}
              onChange={(e) => setPenaltyPoints(Number(e.target.value))}
              className="w-full border rounded-xl p-2.5 text-xs font-bold text-rose-600"
              required
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Detail Instruksi</label>
            <input
              type="text"
              placeholder="Detail pekerjaan..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full border rounded-xl p-2.5 text-xs"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-slate-900 hover:bg-black text-white font-bold py-3 rounded-xl text-xs shadow-md"
        >
          {isSubmitting ? 'Mengirim Tugas...' : 'KIRIM INTRUKSI & AKTIFKAN SLA'}
        </button>
      </form>
    </div>
  );
}
