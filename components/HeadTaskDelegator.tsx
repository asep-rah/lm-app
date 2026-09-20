'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { getStaffSession } from '@/lib/staffSession';
import { DELEGATABLE_ROLES } from '@/lib/staffRoles';
import { inboxRolesFor } from '@/lib/taskRoles';
import { insertWithFallback } from '@/lib/safeWrite';

type StaffOption = { id: string; name: string; role: string };

export default function HeadTaskDelegator() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [role, setRole] = useState('supervisor');
  const [assigneeId, setAssigneeId] = useState('');
  const [slaHours, setSlaHours] = useState(24);
  const [penaltyPoints, setPenaltyPoints] = useState(10);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    supabase
      .from('employees')
      .select('id, name, role')
      .then(({ data }) => setStaff((data as StaffOption[]) || []));
  }, []);

  // Orang yang relevan untuk role terpilih -- pakai alias yang sama dengan inbox
  // supaya daftar nama di sini cocok dengan siapa yang benar-benar melihat task.
  const aliases = inboxRolesFor(role);
  const candidates = staff.filter((s) =>
    aliases.includes(String(s.role || '').toLowerCase().trim())
  );

  // Ganti role -> nama yang sudah dipilih bisa jadi tidak relevan lagi.
  // Diturunkan saat render, bukan lewat effect, supaya tidak memicu render berantai.
  const selectedAssigneeId = candidates.some((c) => c.id === assigneeId) ? assigneeId : '';

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const dueDate = new Date();
    dueDate.setHours(dueDate.getHours() + Number(slaHours));
    const session = getStaffSession();
    const assignee = candidates.find((c) => c.id === selectedAssigneeId);

    const base: Record<string, any> = {
      title,
      description,
      assigned_to_role: role,
      sla_hours: Number(slaHours),
      due_date: dueDate.toISOString(),
      kpi_penalty_points: Number(penaltyPoints),
      status: 'pending'
    };

    // Dari lengkap ke minimal: kolom baru yang belum termigrasi tidak boleh
    // menggagalkan pembuatan task sama sekali.
    const { error } = await insertWithFallback('system_tasks', [
      {
        ...base,
        created_by_name: session.name || 'Head Management',
        assigned_to_employee_id: assignee?.id || null,
        assigned_to_name: assignee?.name || null
      },
      { ...base, created_by_name: session.name || 'Head Management' },
      base
    ]);

    if (!error) {
      const tujuan = assignee?.name || role.toUpperCase();
      alert('🚀 Tugas & SLA berhasil dikirim ke ' + tujuan);
      setTitle('');
      setDescription('');
      setAssigneeId('');
    } else {
      alert('❌ Gagal membuat task: ' + error.message);
    }
    setIsSubmitting(false);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
      <h3 className="font-bold text-slate-800 text-sm md:text-base flex items-center gap-2">
        🎯 Delegasi Tugas &amp; Control SLA (Head Management)
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
              {DELEGATABLE_ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">
              Tugaskan ke Orang <span className="font-normal text-slate-400">(opsional)</span>
            </label>
            <select
              value={selectedAssigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="w-full border rounded-xl p-2.5 text-xs bg-white"
            >
              <option value="">Seluruh tim {role}</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="text-[10px] text-slate-400 leading-relaxed">
          {selectedAssigneeId
            ? 'Tugas ini hanya muncul di inbox orang tersebut.'
            : 'Tanpa memilih nama, tugas muncul di inbox seluruh tim tersebut.'}
        </p>

        <div className="grid grid-cols-2 gap-2">
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
        </div>

        <div>
          <label className="block text-[10px] font-bold text-slate-500 mb-1">Detail Instruksi</label>
          <textarea
            placeholder="Detail pekerjaan..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full border rounded-xl p-2.5 text-xs"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-slate-900 hover:bg-black text-white font-bold py-3 rounded-xl text-xs shadow-md disabled:opacity-60"
        >
          {isSubmitting ? 'Mengirim Tugas...' : 'KIRIM INSTRUKSI & AKTIFKAN SLA'}
        </button>
      </form>
    </div>
  );
}
