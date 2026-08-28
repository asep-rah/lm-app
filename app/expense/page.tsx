'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';
import RequisitionForm from '@/components/RequisitionForm';
import RoleTaskInbox from '@/components/RoleTaskInbox';
import { getStaffSession, isAdminOpsRole, isOwnerRole } from '@/lib/staffSession';
import { toast } from '@/lib/toast';

const supabase = createClient(
  'https://qlgbjvzabnfqmfnjdkmo.supabase.co',
  'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs'
);

export default function ExpensePage() {
  const [session, setSession] = useState({ name: 'Karyawan', role: 'kasir', outletId: '' });
  const canDirect = isOwnerRole(session.role) || isAdminOpsRole(session.role);

  const [outlets, setOutlets] = useState<any[]>([]);
  const [selectedOutlet, setSelectedOutlet] = useState('');
  const [category, setCategory] = useState('Detergen & Parfum');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDirect, setShowDirect] = useState(false);

  useEffect(() => {
    const s = getStaffSession();
    setSession(s);
    if (s.outletId) setSelectedOutlet(s.outletId);

    async function loadOutlets() {
      const { data } = await supabase.from('outlets').select('*');
      if (data) setOutlets(data);
    }
    loadOutlets();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOutlet || !amount) return;

    setIsSubmitting(true);
    const { error } = await supabase.from('expenses').insert([
      {
        outlet_id: selectedOutlet,
        category: category,
        amount: Number(amount),
        description: description,
        created_at: new Date().toISOString()
      }
    ]);
    if (error) {
      const retry = await supabase.from('expenses').insert([
        { outlet_id: selectedOutlet, category, amount: Number(amount), description }
      ]);
      if (retry.error) {
        toast('Gagal simpan pengeluaran: ' + retry.error.message, 'err');
        setIsSubmitting(false);
        return;
      }
    }
    setAmount('');
    setDescription('');
    toast('Pengeluaran langsung tercatat di laporan pusat', 'ok');
    setIsSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-4 md:p-8">
      <div className="w-full max-w-6xl mx-auto space-y-5">
        <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm flex flex-col md:flex-row justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-sky-600">Admin Ops · CMS</p>
            <h1 className="text-2xl font-black text-slate-900">Purchase Requisition</h1>
            <p className="text-xs text-slate-400 mt-0.5">Pending → Approved → Paid (otomatis ke expenses)</p>
          </div>
          <Link href="/owner" className="self-start text-xs text-slate-600 hover:text-slate-900 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
            ← Dashboard
          </Link>
        </div>

        <RoleTaskInbox role={session.role} />
        <RequisitionForm
          selectedOutlet={selectedOutlet || session.outletId}
          employeeName={session.name}
          role={session.role}
        />

        {canDirect && (
          <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm">
            <button
              type="button"
              onClick={() => setShowDirect(!showDirect)}
              className="w-full text-left text-xs font-bold text-slate-600"
            >
              {showDirect ? '▾' : '▸'} Catat pengeluaran langsung (tanpa alur PR)
            </button>

            {showDirect && (
              <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <select
                  value={selectedOutlet}
                  onChange={(e) => setSelectedOutlet(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold"
                  required
                >
                  <option value="">-- Pilih Outlet --</option>
                  {outlets.map((o) => (
                    <option key={o.id} value={o.id}>{o.name} ({o.city})</option>
                  ))}
                </select>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm"
                >
                  <option value="Detergen & Parfum">Detergen & Parfum</option>
                  <option value="Tagihan Listrik & Air">Tagihan Listrik & Air</option>
                  <option value="Sewa Tempat">Sewa Tempat</option>
                  <option value="Gaji Karyawan">Gaji Karyawan</option>
                  <option value="Maintenance & Servis">Maintenance & Servis</option>
                  <option value="Lain-lain">Lain-lain</option>
                </select>
                <input
                  type="number"
                  placeholder="Nominal (Rp)"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-lg font-bold text-slate-900"
                  required
                />
                <input
                  type="text"
                  placeholder="Deskripsi / bukti"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm"
                  required
                />
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="md:col-span-2 bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 rounded-xl text-sm"
                >
                  {isSubmitting ? 'Menyimpan…' : 'Simpan pengeluaran langsung'}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
