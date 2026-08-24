'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';

const supabase = createClient(
  'https://qlgbjvzabnfqmfnjdkmo.supabase.co',
  'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs'
);

const safeParse = (data: any, fallback: any) => {
  if (!data) return fallback;
  if (typeof data === 'object') return data;
  try { return JSON.parse(data); } catch (e) { return fallback; }
};

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<'pnl' | 'settings' | 'employees' | 'delete_requests' | 'loans' | 'history'>('pnl');
  
  const [currentUserRole, setCurrentUserRole] = useState('kasir');
  const [currentUserName, setCurrentUserName] = useState('');

  const [outlets, setOutlets] = useState<any[]>([]);
  const [selectedOutlet, setSelectedOutlet] = useState('ALL');
  const [period, setPeriod] = useState('THIS_MONTH');

  const [stats, setStats] = useState({ income: 0, onlineIncome: 0, offlineIncome: 0, expense: 0, profit: 0 });
  const [tableData, setTableData] = useState<any[]>([]);
  const [rawExportData, setRawExportData] = useState({ txs: [] as any[], mems: [] as any[], exps: [] as any[] });
  
  const [outletLeaderboard, setOutletLeaderboard] = useState<any[]>([]);
  const [supervisorLeaderboard, setSupervisorLeaderboard] = useState<any[]>([]);
  const [supervisorMapping, setSupervisorMapping] = useState<any>({});

  const [deleteRequests, setDeleteRequests] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // States Settings & Dynamic Services
  const [basicSalary, setBasicSalary] = useState('1500000');
  const [coaList, setCoaList] = useState('');
  const [services, setServices] = useState<any[]>([]);
  const [serviceSearch, setServiceSearch] = useState('');
  const [receiptTerms, setReceiptTerms] = useState('');
  const [outletOverrides, setOutletOverrides] = useState<any>({});
  const [settingViewOutlet, setSettingViewOutlet] = useState('ALL');

  // States Tambah / Edit Outlet
  const [selectedOutletToEdit, setSelectedOutletToEdit] = useState('NEW');
  const [newOutletName, setNewOutletName] = useState('');
  const [newOutletCity, setNewOutletCity] = useState('');
  const [newOutletLat, setNewOutletLat] = useState('');
  const [newOutletLon, setNewOutletLon] = useState('');
  const [newOutletRadius, setNewOutletRadius] = useState('200');
  const [newOutletWA, setNewOutletWA] = useState(''); // STATE BARU UNTUK WA CABANG

  // States Karyawan & Absensi
  const [employees, setEmployees] = useState<any[]>([]);
  const [attendances, setAttendances] = useState<any[]>([]);
  const [newEmpName, setNewEmpName] = useState('');
  const [newEmpUsername, setNewEmpUsername] = useState('');
  const [newEmpPassword, setNewEmpPassword] = useState('');
  const [newEmpRole, setNewEmpRole] = useState<'kasir' | 'driver' | 'cs' | 'supervisor' | 'finance' | 'owner'>('kasir');
  const [newEmpSalary, setNewEmpSalary] = useState('');
  const [newEmpOutlet, setNewEmpOutlet] = useState('ALL');

  // States Kasbon & Dokumentasi
  const [loansList, setLoansList] = useState<any[]>([]);
  const [penaltiesList, setPenaltiesList] = useState<any[]>([]);
  const [targetEmpName, setTargetEmpName] = useState('');
  const [loanTotal, setLoanTotal] = useState('');
  const [loanMonthly, setLoanMonthly] = useState('');
  const [loanNotes, setLoanNotes] = useState('');
  const [loanApprovedBy, setLoanApprovedBy] = useState('');
  const [loanDocUrl, setLoanDocUrl] = useState('');
  const [penaltyAmount, setPenaltyAmount] = useState('');
  const [penaltyReason, setPenaltyReason] = useState('');

  // States Tab History 1 Tahun
  const [historyCategory, setHistoryCategory] = useState<'all' | 'transactions' | 'members' | 'expenses'>('all');
  const [historySearch, setHistorySearch] = useState('');
  const [historyOutletFilter, setHistoryOutletFilter] = useState('ALL');
  const [historyMonthFilter, setHistoryMonthFilter] = useState('ALL');
  const [historyDateFilter, setHistoryDateFilter] = useState('');
  const [fullYearHistory, setFullYearHistory] = useState<any[]>([]);
// State & Logic To-Do List Kendala Outlet (Real-Time)
const [outletIssues, setOutletIssues] = useState<any[]>([]);

const fetchOutletIssues = async () => {
  const { data } = await supabase
    .from('outlet_issues')
    .select('*, outlets(name)')
    .order('created_at', { ascending: false });
  if (data) setOutletIssues(data);
};

useEffect(() => {
  fetchOutletIssues();
  
  // Realtime listener untuk laporan baru dari Kasir
  const channel = supabase
    .channel('realtime_outlet_issues')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'outlet_issues' }, () => {
      fetchOutletIssues();
    })
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, []);

const handleUpdateIssueStatus = async (id: string, newStatus: string) => {
  const updates: any = { status: newStatus };
  if (newStatus === 'Selesai') updates.resolved_at = new Date().toISOString();

  const { error } = await supabase.from('outlet_issues').update(updates).eq('id', id);
  if (!error) fetchOutletIssues();
};
// Fungsi Supervisor Menyetujui Pengajuan Pengeluaran
const handleApproveExpense = async (expenseId: string) => {
  const { error } = await supabase
    .from('expenses')
    .update({ 
      status: 'APPROVED_SUPERVISOR'
    })
    .eq('id', expenseId);

  if (!error) {
    alert('✅ Pengajuan disetujui! Data otomatis diteruskan ke Admin Ops untuk pembayaran via CMS BRI.');
  }
};
  useEffect(() => {
    const ownerStr = localStorage.getItem('laundry_owner_user');
    if (!ownerStr) { window.location.href = '/login'; return; }
    const user = JSON.parse(ownerStr);
    
    if (!['owner', 'supervisor', 'finance'].includes(user.role)) {
      alert('⚠️ Akses ditolak! Halaman ini khusus Management.');
      window.location.href = '/login';
    }
    setCurrentUserRole(user.role);
    setCurrentUserName(user.name);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('laundry_owner_user');
    localStorage.removeItem('laundry_user');
    window.location.href = '/login';
  };

  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      const { data: outletData } = await supabase.from('outlets').select('*');
      if (outletData && outletData.length > 0) setOutlets(outletData);

      const { data: empData } = await supabase.from('employees').select('*, outlets(name)').order('created_at', { ascending: false });
      if (empData) {
        setEmployees(empData);
        if (empData.length > 0 && !targetEmpName) setTargetEmpName(empData[0].name);
      }

      const { data: attLogs } = await supabase.from('attendance_logs').select('*').order('created_at', { ascending: false }).limit(200);
      if (attLogs) setAttendances(attLogs);

      let loadedSupMap = {};
      const { data: settings } = await supabase.from('app_settings').select('*').eq('id', 1).single();
      if (settings) {
        setBasicSalary(settings.basic_salary?.toString() || '1500000');
        setNewEmpSalary(settings.basic_salary?.toString() || '1500000');
        setReceiptTerms(settings.receipt_terms || '');
        if (settings.coa_categories) setCoaList(safeParse(settings.coa_categories, []).join('\n'));
        if (settings.dynamic_services) setServices(safeParse(settings.dynamic_services, []));
        if (settings.outlet_overrides) setOutletOverrides(safeParse(settings.outlet_overrides, {}));
        if (settings.promos_data) setPromosList(safeParse(settings.promos_data, promosList));
        if (settings.supervisor_mapping) {
          loadedSupMap = safeParse(settings.supervisor_mapping, {});
          setSupervisorMapping(loadedSupMap);
        }
      }

      const { data: loansData } = await supabase.from('employee_loans').select('*').order('created_at', { ascending: false });
      if (loansData) setLoansList(loansData);

      const { data: penData } = await supabase.from('employee_penalties').select('*').order('created_at', { ascending: false });
      if (penData) setPenaltiesList(penData);

      const { data: delReqs } = await supabase.from('transactions').select('*, outlets(name)').eq('delete_requested', true).order('created_at', { ascending: false });
      if (delReqs) setDeleteRequests(delReqs);

      let txQuery = supabase.from('transactions').select('id, created_at, amount, delivery_fee, service_type, customer_name, outlet_id, order_type, receipt_number');
      let memQuery = supabase.from('membership_logs').select('id, created_at, price, package_name, customer_phone, outlet_id, order_type');
      let expQuery = supabase.from('expenses').select('id, created_at, amount, category, description, outlet_id');

      const [{ data: allTxs }, { data: allMems }, { data: allExps }] = await Promise.all([txQuery, memQuery, expQuery]);

      const now = new Date();
      const checkPeriod = (item: any) => {
        if (period === 'ALL') return true;
        const d = new Date(item.created_at);
        if (period === 'THIS_MONTH') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        if (period === 'LAST_MONTH') {
          const lastMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
          const lastYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
          return d.getMonth() === lastMonth && d.getFullYear() === lastYear;
        }
        if (period === 'THIS_YEAR') {
          const oneYearAgo = new Date();
          oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
          return d >= oneYearAgo;
        }
        return true;
      };

      const periodTxs = allTxs?.filter(checkPeriod) || [];
      const periodMems = allMems?.filter(checkPeriod) || [];
      const periodExps = allExps?.filter(checkPeriod) || [];

      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

      let historyCombined: any[] = [];
      allTxs?.filter(t => new Date(t.created_at) >= oneYearAgo).forEach(t => historyCombined.push({ id: t.id, date: t.created_at, category: 'transactions', title: `${t.receipt_number || 'TRX'} - ${t.customer_name}`, desc: `${t.service_type} (${t.order_type || 'Offline'})`, amount: t.amount, outlet: t.outlet_id }));
      allMems?.filter(m => new Date(m.created_at) >= oneYearAgo).forEach(m => historyCombined.push({ id: m.id, date: m.created_at, category: 'members', title: `Member ${m.package_name}`, desc: `No. WA: ${m.customer_phone} (${m.order_type || 'Offline'})`, amount: m.price, outlet: m.outlet_id }));
      allExps?.filter(e => new Date(e.created_at) >= oneYearAgo).forEach(e => historyCombined.push({ id: e.id, date: e.created_at, category: 'expenses', title: `Pengeluaran: ${e.category}`, desc: e.description || '-', amount: -Number(e.amount), outlet: e.outlet_id }));

      historyCombined.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setFullYearHistory(historyCombined);

      const outStats: Record<string, any> = {};
      (outletData || []).forEach((o: any) => { 
        const supName = (loadedSupMap as any)[o.id] || '-';
        outStats[o.id] = { name: o.name, supervisor: supName, rev: 0, online_rev: 0, offline_rev: 0, exp: 0, profit: 0 }; 
      });

      periodTxs.forEach((t: any) => { 
        if(outStats[t.outlet_id]) {
          const amt = Number(t.amount) || 0; outStats[t.outlet_id].rev += amt;
          if (t.order_type === 'Online') outStats[t.outlet_id].online_rev += amt;
          else outStats[t.outlet_id].offline_rev += amt;
        } 
      });
      periodMems.forEach((m: any) => { 
        if(outStats[m.outlet_id]) {
          const amt = Number(m.price) || 0; outStats[m.outlet_id].rev += amt;
          if (m.order_type === 'Online') outStats[m.outlet_id].online_rev += amt;
          else outStats[m.outlet_id].offline_rev += amt;
        } 
      });
      periodExps.forEach((e: any) => { if(outStats[e.outlet_id]) outStats[e.outlet_id].exp += Number(e.amount) || 0; });

      Object.values(outStats).forEach((s: any) => s.profit = s.rev - s.exp);
      const sortedOutlets = Object.values(outStats).sort((a: any, b: any) => b.rev - a.rev);
      setOutletLeaderboard(sortedOutlets);

      const supStats: Record<string, any> = {};
      (outletData || []).forEach((o: any) => {
        const supName = (loadedSupMap as any)[o.id] || 'Belum Diatur';
        if(!supStats[supName]) supStats[supName] = { name: supName, outlets: 0, rev: 0, online_rev: 0, offline_rev: 0, profit: 0 };
        supStats[supName].outlets += 1;
        supStats[supName].rev += outStats[o.id].rev;
        supStats[supName].online_rev += outStats[o.id].online_rev;
        supStats[supName].offline_rev += outStats[o.id].offline_rev;
        supStats[supName].profit += outStats[o.id].profit;
      });
      const sortedSupervisors = Object.values(supStats).sort((a: any, b: any) => b.rev - a.rev);
      setSupervisorLeaderboard(sortedSupervisors);

      const filteredTxs = selectedOutlet === 'ALL' ? periodTxs : periodTxs.filter(t => t.outlet_id === selectedOutlet);
      const filteredMems = selectedOutlet === 'ALL' ? periodMems : periodMems.filter(m => m.outlet_id === selectedOutlet);
      const filteredExps = selectedOutlet === 'ALL' ? periodExps : periodExps.filter(e => e.outlet_id === selectedOutlet);

      setRawExportData({ txs: filteredTxs, mems: filteredMems, exps: filteredExps });

      let combinedData: any[] = []; let inc = 0; let onlineInc = 0; let offlineInc = 0; let exp = 0;
      filteredTxs.forEach((t) => { 
        const amt = Number(t.amount) || 0; inc += amt;
        if (t.order_type === 'Online') onlineInc += amt; else offlineInc += amt;
        combinedData.push({ date: t.created_at, type: 'Income', category: 'Laundry', desc: `${t.service_type} (${t.customer_name})`, amount: amt }); 
      });

      filteredMems.forEach((m) => { 
        const amt = Number(m.price) || 0; inc += amt;
        if (m.order_type === 'Online') onlineInc += amt; else offlineInc += amt;
        combinedData.push({ date: m.created_at, type: 'Income', category: 'Membership', desc: `Paket ${m.package_name} (${m.customer_phone}) - ${m.order_type || 'Offline'}`, amount: amt }); 
      });

      filteredExps.forEach((e) => { 
        const amt = Number(e.amount) || 0; exp += amt; 
        combinedData.push({ date: e.created_at, type: 'Expense', category: e.category, desc: e.description || '-', amount: -amt }); 
      });

      combinedData.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setStats({ income: inc, onlineIncome: onlineInc, offlineIncome: offlineInc, expense: exp, profit: inc - exp }); 
      setTableData(combinedData); 
      setIsLoading(false);
    }
    loadData();
  }, [selectedOutlet, period, activeTab]);

  useEffect(() => {
    if (selectedOutletToEdit === 'NEW') {
      setNewOutletName(''); setNewOutletCity(''); setNewOutletLat(''); setNewOutletLon(''); setNewOutletRadius('200'); setNewOutletWA('');
    } else {
      const targetOutlet = outlets.find(o => o.id === selectedOutletToEdit);
      if (targetOutlet) {
        setNewOutletName(targetOutlet.name || '');
        setNewOutletCity(targetOutlet.city || '');
        setNewOutletLat(targetOutlet.latitude ? String(targetOutlet.latitude) : '');
        setNewOutletLon(targetOutlet.longitude ? String(targetOutlet.longitude) : '');
        setNewOutletRadius(targetOutlet.radius_meters ? String(targetOutlet.radius_meters) : '200');
        setNewOutletWA(targetOutlet.whatsapp_number || '');
      }
    }
  }, [selectedOutletToEdit, outlets]);

  const handleSaveOutlet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOutletName.trim()) return alert('Nama outlet wajib diisi!');
    setIsSaving(true);

    const payload: any = { 
      name: newOutletName.trim(),
      city: newOutletCity.trim() || '-',
      whatsapp_number: newOutletWA.trim()
    };
    
    if (newOutletLat) payload.latitude = Number(newOutletLat);
    if (newOutletLon) payload.longitude = Number(newOutletLon);
    if (newOutletRadius) payload.radius_meters = Number(newOutletRadius);

    let error: any = null;

    if (selectedOutletToEdit === 'NEW') {
      const res = await supabase.from('outlets').insert([payload]);
      error = res.error;
    } else {
      const res = await supabase.from('outlets').update(payload).eq('id', selectedOutletToEdit);
      error = res.error;
    }

    if (!error) {
      alert(`✅ ${selectedOutletToEdit === 'NEW' ? 'Outlet Cabang Baru Berhasil Ditambahkan!' : 'Data Outlet Berhasil Diperbarui!'}`);
      setSelectedOutletToEdit('NEW');
      setNewOutletName(''); setNewOutletCity(''); setNewOutletLat(''); setNewOutletLon(''); setNewOutletRadius('200'); setNewOutletWA('');
      const { data: outletData } = await supabase.from('outlets').select('*');
      if (outletData) setOutlets(outletData);
    } else alert('❌ Gagal menyimpan outlet: ' + error.message);
    
    setIsSaving(false);
  };

  const handleUpdateEmployeeOutlet = async (empId: string, newOutletVal: string) => {
    const outletValue = newOutletVal === 'ALL' ? null : newOutletVal;
    const { error } = await supabase.from('employees').update({ outlet_id: outletValue }).eq('id', empId);
    if (!error) {
      setEmployees(employees.map(emp => {
        if (emp.id === empId) {
          const matchedOutlet = outlets.find(o => o.id === newOutletVal);
          return { ...emp, outlet_id: outletValue, outlets: matchedOutlet ? { name: matchedOutlet.name } : null };
        }
        return emp;
      }));
      alert('✅ Penempatan cabang karyawan berhasil diperbarui!');
    } else alert('❌ Gagal: ' + error.message);
  };

  const handleUpdateEmployeeRole = async (empId: string, newRole: string) => {
    const { error } = await supabase.from('employees').update({ role: newRole }).eq('id', empId);
    if (!error) {
      setEmployees(employees.map(emp => emp.id === empId ? { ...emp, role: newRole } : emp));
      alert('✅ Role/peran karyawan diperbarui!');
    } else alert('❌ Gagal: ' + error.message);
  };

  const handleAddLoan = async (e: React.FormEvent) => {
    e.preventDefault(); 
    if (!targetEmpName || !loanTotal || !loanMonthly) return alert('Mohon lengkapi data!');
    setIsSaving(true);

    const loanPayload: any = {
      employee_name: targetEmpName,
      total_loan: Number(loanTotal),
      monthly_deduction: Number(loanMonthly),
      notes: loanNotes || 'Kasbon Crew',
      status: 'Active',
      approved_by: loanApprovedBy || currentUserName || 'Supervisor',
      document_url: loanDocUrl || null
    };

    let { error } = await supabase.from('employee_loans').insert([loanPayload]);

    if (error && (error.message?.includes('approved_by') || error.message?.includes('document_url'))) {
      delete loanPayload.approved_by;
      delete loanPayload.document_url;
      const retryRes = await supabase.from('employee_loans').insert([loanPayload]);
      error = retryRes.error;
    }

    if (!error) { 
      alert('✅ Kasbon & Dokumentasi Persetujuan Berhasil Dicatat!'); 
      setLoanTotal(''); setLoanMonthly(''); setLoanNotes(''); setLoanApprovedBy(''); setLoanDocUrl('');
      const { data } = await supabase.from('employee_loans').select('*').order('created_at', { ascending: false }); 
      if (data) setLoansList(data); 
    } else alert('❌ Gagal mencatat kasbon: ' + error.message);
    
    setIsSaving(false);
  };

  const handleAddPenalty = async (e: React.FormEvent) => {
    e.preventDefault(); 
    if (!targetEmpName || !penaltyAmount || !penaltyReason) return alert('Mohon lengkapi data!');
    setIsSaving(true);
    const { error } = await supabase.from('employee_penalties').insert([{ employee_name: targetEmpName, penalty_amount: Number(penaltyAmount), reason: penaltyReason }]);
    if (!error) { 
      alert('✅ Potongan kesalahan dicatat!'); 
      setPenaltyAmount(''); setPenaltyReason(''); 
      const { data } = await supabase.from('employee_penalties').select('*').order('created_at', { ascending: false }); 
      if (data) setPenaltiesList(data); 
    } else alert('❌ Gagal mencatat potongan: ' + error.message);
    setIsSaving(false);
  };

  const handleDeleteLoan = async (id: string) => { if (!confirm('Hapus/Lunaskan data kasbon ini?')) return; await supabase.from('employee_loans').delete().eq('id', id); setLoansList(loansList.filter(l => l.id !== id)); };
  const handleDeletePenalty = async (id: string) => { if (!confirm('Hapus catatan kesalahan ini?')) return; await supabase.from('employee_penalties').delete().eq('id', id); setPenaltiesList(penaltiesList.filter(p => p.id !== id)); };

  const handleApproveDelete = async (txId: string) => {
    if (!confirm('Yakin menyetujui penghapusan transaksi ini?')) return; setIsSaving(true);
    const { error } = await supabase.from('transactions').delete().eq('id', txId);
    if (!error) { alert('✅ Transaksi dihapus!'); setDeleteRequests(deleteRequests.filter((r) => r.id !== txId)); } else alert('❌ Gagal: ' + error.message);
    setIsSaving(false);
  };

  const handleRejectDelete = async (txId: string) => {
    setIsSaving(true); const { error } = await supabase.from('transactions').update({ delete_requested: false, delete_reason: null }).eq('id', txId);
    if (!error) { alert('✅ Permintaan hapus ditolak.'); setDeleteRequests(deleteRequests.filter((r) => r.id !== txId)); } else alert('❌ Gagal: ' + error.message);
    setIsSaving(false);
  };

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault(); if (!newEmpName || !newEmpUsername || !newEmpPassword) return alert('Semua data wajib diisi!'); setIsSaving(true);
    const { data: checkUser } = await supabase.from('employees').select('id').eq('username', newEmpUsername).single();
    if (checkUser) { alert('❌ Username sudah digunakan!'); setIsSaving(false); return; }
    const outletValue = newEmpOutlet === 'ALL' ? null : newEmpOutlet;
    const { error } = await supabase.from('employees').insert([{ name: newEmpName, outlet_id: outletValue, username: newEmpUsername, password: newEmpPassword, role: newEmpRole, basic_salary: Number(newEmpSalary) }]);
    if (!error) { alert('✅ Karyawan ditambahkan!'); setNewEmpName(''); setNewEmpUsername(''); setNewEmpPassword(''); const { data } = await supabase.from('employees').select('*, outlets(name)').order('created_at', { ascending: false }); if (data) setEmployees(data); } else alert('❌ Gagal: ' + error.message);
    setIsSaving(false);
  };

  const handleDeleteEmployee = async (id: string) => {
    if (!confirm('Yakin ingin menghapus karyawan ini?')) return; setIsSaving(true);
    const { error } = await supabase.from('employees').delete().eq('id', id);
    if (!error) { setEmployees(employees.filter((emp) => emp.id !== id)); alert('✅ Karyawan dihapus!'); } else alert('❌ Gagal: ' + error.message);
    setIsSaving(false);
  };
  const [promosList, setPromosList] = useState<any[]>([
    { id: 'ONGKIRFREE', title: '🚚 Gratis Ongkir Antar-Jemput', desc: 'Potongan ongkir hingga Rp 15.000', type: 'ongkir', value: 15000, minTx: 30000 },
    { id: 'DISC10', title: '🏷️ Diskon 10% Spesial Online', desc: 'Potongan 10% untuk transaksi penjemputan', type: 'percent', value: 10, minTx: 40000 },
    { id: 'HEMAT10K', title: '💰 Voucher Hemat Rp 10.000', desc: 'Potongan Rp 10.000 untuk paket Kiloan & Satuan', type: 'nominal', value: 10000, minTx: 50000 }
  ]);

  const handleAddPromo = () => {
    setPromosList([
      ...promosList,
      { id: `PROMO_${Date.now()}`, title: '🎁 Promo Baru', desc: 'Deskripsi promo', type: 'nominal', value: 5000, minTx: 20000 }
    ]);
  };

  const handleRemovePromo = (id: string) => {
    if (confirm('Yakin ingin menghapus promo ini?')) {
      setPromosList(promosList.filter(p => p.id !== id));
    }
  };

  const handleUpdatePromo = (id: string, field: string, value: any) => {
    setPromosList(promosList.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const handleSaveSettings = async () => {
    setIsSaving(true);
    const coaArray = coaList.split('\n').map((item) => item.trim()).filter((item) => item !== '');
    const updatePayload: any = {
      basic_salary: Number(basicSalary), receipt_terms: receiptTerms, coa_categories: JSON.stringify(coaArray),
      dynamic_services: JSON.stringify(services), outlet_overrides: JSON.stringify(outletOverrides), supervisor_mapping: JSON.stringify(supervisorMapping),
      promos_data: JSON.stringify(promosList)
    };
    let { error } = await supabase.from('app_settings').update(updatePayload).eq('id', 1);
    if (error && error.message?.includes('supervisor_mapping')) {
      delete updatePayload.supervisor_mapping;
      const fallbackRes = await supabase.from('app_settings').update(updatePayload).eq('id', 1);
      error = fallbackRes.error;
      if (!error) { alert('⚠️ Pengaturan Umum Disimpan!\n\n(Catatan: Untuk menyimpan mapping supervisor, jalankan skrip SQL di Supabase).'); setIsSaving(false); return; }
    }
    if (!error) alert('✅ Pengaturan Berhasil Disimpan!'); else alert('❌ Gagal: ' + error.message);
    setIsSaving(false);
  };

  const handleAddService = () => { setServices([...services, { id: `svc_${Date.now()}`, name: 'Layanan Baru', type: 'kg', price: 0, commissions: { sortir: 0, cuci: 0, kering: 0, setrika: 0, packing: 0 } }]); };
  const handleRemoveService = (idToRemove: string) => { if (confirm('Yakin hapus?')) setServices(services.filter((s) => s.id !== idToRemove)); };

  const updateService = (id: string, field: string, value: any) => {
    if (settingViewOutlet === 'ALL') { setServices(services.map((s) => (s.id === id ? { ...s, [field]: value } : s))); }
    else { setOutletOverrides((prev: any) => { const currentOutlet = prev[settingViewOutlet] || {}; return { ...prev, [settingViewOutlet]: { ...currentOutlet, [id]: { ...(currentOutlet[id] || {}), [field]: value } } }; }); }
  };

  const updateCommission = (svcId: string, commField: string, value: number) => {
    if (settingViewOutlet === 'ALL') { setServices(services.map((s) => { if (s.id === svcId) { return { ...s, commissions: { ...s.commissions, [commField]: value } }; } return s; })); }
    else { setOutletOverrides((prev: any) => { const currentOutlet = prev[settingViewOutlet] || {}; const currentSvc = currentOutlet[svcId] || { commissions: {} }; return { ...prev, [settingViewOutlet]: { ...currentOutlet, [svcId]: { ...currentSvc, commissions: { ...(currentSvc.commissions || {}), [commField]: value } } } }; }); }
  };

  const filteredServices = services.filter((svc) => 
    (svc.name || '').toLowerCase().includes(serviceSearch.toLowerCase())
  );

  const exportCSV = () => {
    const currentMonthName = new Date().toLocaleString('id-ID', { month: 'long' }).toUpperCase();
    const outletNameStr = selectedOutlet === 'ALL' ? 'SEMUA CABANG' : outlets.find((o) => o.id === selectedOutlet)?.name?.toUpperCase() || 'OUTLET';
    let offlineRev = 0; let onlineRev = 0; let ongkirRev = 0;
    rawExportData.txs.forEach((tx: any) => { const amt = Number(tx.amount) || 0; const fee = Number(tx.delivery_fee) || 0; if (tx.order_type === 'Online') onlineRev += (amt - fee); else offlineRev += (amt - fee); ongkirRev += fee; });
    rawExportData.mems.forEach((m: any) => { const prc = Number(m.price) || 0; if (m.order_type === 'Online') onlineRev += prc; else offlineRev += prc; });
    const totalPendapatan = offlineRev + onlineRev + ongkirRev;

    const expMap: Record<string, number> = {}; rawExportData.exps.forEach((ex: any) => { const cat = ex.category; expMap[cat] = (expMap[cat] || 0) + Number(ex.amount); });
    const bppList = ['5201 - Detergent', '5202 - Gas', '5203 - Parfume', '5204 - Plastik', '5205 - Solasi & Thermal Paper', '5206 - Hanger'];
    const opexList = ['600001 - Beban Subscribe Apps', '600019 - Beban Sewa Ruko', '600009 - Beban Gaji Crew', '600003 - Beban Listrik'];
    const depList = ['Depresiasi Machine', 'Depresiasi Furniture'];

    let totalBPP = 0; let totalOpex = 0; let totalDep = 0;
    bppList.forEach((c) => (totalBPP += expMap[c] || 0)); opexList.forEach((c) => (totalOpex += expMap[c] || 0)); depList.forEach((c) => (totalDep += expMap[c] || 0));
    let otherOpexStr = ''; const knownCats = new Set([...bppList, ...opexList, ...depList]);
    Object.keys(expMap).forEach((k) => { if (!knownCats.has(k)) { totalOpex += expMap[k]; otherOpexStr += `"${k}",${expMap[k]}\n`; } });

    const labaBersih = totalPendapatan - totalBPP - totalOpex; const labaSetelahDepresiasi = labaBersih - totalDep;
    let csv = `LAPORAN LABA RUGI ${outletNameStr},,\n"Pendapatan Offline",${offlineRev}\n"Pendapatan Online",${onlineRev}\n"Total Pendapatan",${totalPendapatan}\n"Total BPP",${totalBPP}\n"Total Opex",${totalOpex}\n"LABA BERSIH",${labaBersih}\n"LABA SETELAH DEPRESIASI",${labaSetelahDepresiasi}\n`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `Laporan_PnL_${outletNameStr.replace(/ /g, '_')}_${currentMonthName}.csv`; link.click();
  };

  const filteredHistory = fullYearHistory.filter((item) => {
    const itemDate = new Date(item.date);
    const matchCat = historyCategory === 'all' || item.category === historyCategory;
    const matchOutlet = historyOutletFilter === 'ALL' || item.outlet === historyOutletFilter;
    const matchSearch = !historySearch || item.title.toLowerCase().includes(historySearch.toLowerCase()) || item.desc.toLowerCase().includes(historySearch.toLowerCase());
    
    const itemMonthStr = (itemDate.getMonth() + 1).toString().padStart(2, '0');
    const matchMonth = historyMonthFilter === 'ALL' || itemMonthStr === historyMonthFilter;

    const itemDateISO = itemDate.toLocaleDateString('en-CA');
    const matchDate = !historyDateFilter || itemDateISO === historyDateFilter;

    return matchCat && matchOutlet && matchSearch && matchMonth && matchDate;
  });

  const exportHistoryCSV = () => {
    let csv = `"Tanggal & Waktu","Cabang Outlet","Tipe","Judul / Resi / Pelanggan","Detail Keterangan","Nominal (Rp)"\n`;
    filteredHistory.forEach((item) => {
      const dateStr = new Date(item.date).toLocaleString('id-ID');
      const outletObj = outlets.find(o => o.id === item.outlet);
      const outletNameStr = outletObj ? outletObj.name : 'Pusat/Global';
      csv += `"${dateStr}","${outletNameStr}","${item.category.toUpperCase()}","${item.title.replace(/"/g, '""')}","${item.desc.replace(/"/g, '""')}",${item.amount}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `History_Transaksi_1Tahun_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-3 md:p-8">
      <div className="max-w-6xl mx-auto space-y-4 md:space-y-6">
        
        {/* NAV HEADER */}
        <div className="bg-white border border-slate-200 p-4 md:p-6 rounded-2xl shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-xl md:text-2xl font-black text-emerald-600">Laundry ERP 🏛️</h1>
            <p className="text-[10px] md:text-xs text-slate-500 mt-1">
              Management <span className="font-bold text-indigo-600">({currentUserRole.toUpperCase()})</span>
            </p>
          </div>
          <div className="flex w-full md:w-auto overflow-x-auto pb-2 md:pb-0 gap-2 hide-scrollbar items-center">
          <button onClick={() => setActiveTab('pnl')} className={`whitespace-nowrap px-4 py-2 font-bold text-xs rounded-xl transition ${activeTab === 'pnl' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>📊 Laporan PnL</button>
          <button onClick={() => setActiveTab('history')} className={`whitespace-nowrap px-4 py-2 font-bold text-xs rounded-xl transition ${activeTab === 'history' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>📦 History 1 Thn</button>
          <button onClick={() => setActiveTab('loans')} className={`whitespace-nowrap px-4 py-2 font-bold text-xs rounded-xl transition ${activeTab === 'loans' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>💸 Kasbon Crew</button>

          {currentUserRole === 'owner' && (
            <>
              <button onClick={() => setActiveTab('settings')} className={`whitespace-nowrap px-4 py-2 font-bold text-xs rounded-xl transition ${activeTab === 'settings' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>⚙️ Settings</button>
              <button onClick={() => setActiveTab('employees')} className={`whitespace-nowrap px-4 py-2 font-bold text-xs rounded-xl transition ${activeTab === 'employees' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>👥 Karyawan</button>
            </>
          )}

          {/* 🔔 ICON LONCENG NOTIFIKASI REQUEST HAPUS (PENGGANTI PORTAL KASIR) */}
          <button
            onClick={() => setActiveTab('delete_requests')}
            className="relative p-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition flex items-center justify-center cursor-pointer border border-slate-700 ml-1"
            title="Pengajuan Hapus Transaksi"
          >
            🔔
            {deleteRequests.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center animate-bounce shadow-md">
                {deleteRequests.length}
              </span>
            )}
          </button>

          <button onClick={handleLogout} className="whitespace-nowrap bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold text-xs px-3 py-2 rounded-xl transition ml-1">Keluar</button>
        </div>
        {/* WIDGET TO-DO LIST KELUHAN & KENDALA OUTLET */}
      <div className="bg-white border border-slate-200 rounded-3xl p-5 space-y-4 shadow-sm my-4">
        <div className="flex justify-between items-center border-b pb-3">
          <div>
            <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              📋 To-Do List Keluhan & Kendala Outlet
            </h3>
            <p className="text-[11px] text-slate-500">Laporan realtime dari Kasir yang memerlukan tindakan Supervisor/Owner</p>
          </div>
          <span className="bg-rose-100 text-rose-700 font-black text-xs px-3 py-1 rounded-full">
            {outletIssues.filter(i => i.status !== 'Selesai').length} Belum Selesai
          </span>
        </div>

        <div className="space-y-3">
          {outletIssues.map((issue) => (
            <div key={issue.id} className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs space-y-2.5">
              <div className="flex justify-between items-start">
                <div>
                  <span className="bg-blue-100 text-blue-800 font-extrabold text-[10px] px-2.5 py-0.5 rounded-md mr-2">
                    📍 {issue.outlets?.name || 'Outlet'}
                  </span>
                  <span className={`font-extrabold text-[10px] px-2.5 py-0.5 rounded-md ${
                    issue.urgency === 'Critical' ? 'bg-rose-100 text-rose-700' : issue.urgency === 'Mendesak' ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-700'
                  }`}>
                    {issue.urgency}
                  </span>
                  <h4 className="font-extrabold text-slate-900 mt-1.5 text-sm">{issue.category}</h4>
                </div>
                <span className={`font-black text-[10px] px-3 py-1 rounded-full border ${
                  issue.status === 'Selesai' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}>
                  {issue.status}
                </span>
              </div>

              <p className="text-slate-700 font-medium bg-white p-3 rounded-xl border border-slate-200 leading-relaxed">
                {issue.description}
              </p>

              <div className="flex justify-between items-center pt-2 border-t border-slate-200 text-[10px]">
                <span className="text-slate-400 font-bold">Pelapor: {issue.reporter_name} • {new Date(issue.created_at).toLocaleString('id-ID')}</span>
                <div className="flex gap-2">
                  {issue.status !== 'Sedang Diproses' && issue.status !== 'Selesai' && (
                    <button
                      onClick={() => handleUpdateIssueStatus(issue.id, 'Sedang Diproses')}
                      className="bg-amber-500 hover:bg-amber-600 text-white font-bold px-3 py-1.5 rounded-lg shadow-sm transition"
                    >
                      Proses Task
                    </button>
                  )}
                  {issue.status !== 'Selesai' && (
                    <button
                      onClick={() => handleUpdateIssueStatus(issue.id, 'Selesai')}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg shadow-sm transition"
                    >
                      ✓ Tandai Selesai
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {outletIssues.length === 0 && (
            <div className="text-center py-6 text-slate-400 text-xs font-bold">
              🎉 Semua aman! Belum ada laporan kendala dari kasir.
            </div>
          )}
        </div>
      </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
              <div className="bg-white border border-slate-200 p-4 md:p-6 rounded-2xl shadow-sm">
                <p className="text-[10px] md:text-xs font-bold text-slate-500 uppercase">Gross Revenue (Total Omset)</p>
                <h2 className="text-xl md:text-2xl font-black text-emerald-600 mt-1">Rp {stats.income.toLocaleString('id-ID')}</h2>
                <div className="mt-2 pt-2 border-t flex justify-between text-[11px] font-semibold text-slate-500">
                  <span>🏪 Offline: <b>Rp {stats.offlineIncome.toLocaleString('id-ID')}</b></span>
                  <span>🌐 Online: <b className="text-indigo-600">Rp {stats.onlineIncome.toLocaleString('id-ID')}</b></span>
                </div>
              </div>
              <div className="bg-white border border-slate-200 p-4 md:p-6 rounded-2xl shadow-sm">
                <p className="text-[10px] md:text-xs font-bold text-slate-500 uppercase">Opex (Total Pengeluaran)</p>
                <h2 className="text-xl md:text-2xl font-black text-rose-600 mt-1">Rp {stats.expense.toLocaleString('id-ID')}</h2>
              </div>
              <div className={`p-4 md:p-6 rounded-2xl border shadow-sm ${stats.profit >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
                <p className={`text-[10px] md:text-xs font-bold uppercase ${stats.profit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>Net Profit (Laba Bersih)</p>
                <h2 className={`text-xl md:text-2xl font-black mt-1 ${stats.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>Rp {stats.profit.toLocaleString('id-ID')}</h2>
              </div>
            </div>

            {/* TABEL RANKING OUTLET & SUPERVISOR */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-6 pt-2">
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="bg-emerald-600 text-white p-4 flex justify-between items-center">
                  <h3 className="font-black text-sm">🏆 Ranking Omset Semua Outlet</h3>
                  <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded font-mono">{period.replace('_', ' ')}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left whitespace-nowrap">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                      <tr><th className="p-3">No / Outlet</th><th className="p-3">Supervisor</th><th className="p-3 text-right">Omset Offline</th><th className="p-3 text-right">Omset Online</th><th className="p-3 text-right">Total Omset</th><th className="p-3 text-right">Net Profit</th></tr>
                    </thead>
                    <tbody>
                      {outletLeaderboard.map((o, i) => (
                        <tr key={i} className={`border-b border-slate-100 hover:bg-slate-50 ${selectedOutlet === o.id ? 'bg-emerald-50/60 font-bold' : ''}`}>
                          <td className="p-3 font-bold text-slate-800"><span className="inline-block w-4 text-emerald-600">{i + 1}.</span> {o.name} {selectedOutlet === o.id && '(Terpilih)'}</td>
                          <td className="p-3 font-semibold text-indigo-600 text-[10px] uppercase">{o.supervisor}</td>
                          <td className="p-3 text-right font-medium text-slate-600">Rp {o.offline_rev.toLocaleString('id-ID')}</td>
                          <td className="p-3 text-right font-medium text-indigo-600">Rp {o.online_rev.toLocaleString('id-ID')}</td>
                          <td className="p-3 text-right font-black text-slate-900">Rp {o.rev.toLocaleString('id-ID')}</td>
                          <td className="p-3 text-right font-bold text-emerald-600">Rp {o.profit.toLocaleString('id-ID')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="bg-indigo-600 text-white p-4 flex justify-between items-center">
                  <h3 className="font-black text-sm">👔 Leaderboard Supervisor</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left whitespace-nowrap">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                      <tr><th className="p-3">Supervisor</th><th className="p-3 text-center">Cabang</th><th className="p-3 text-right">Omset Offline</th><th className="p-3 text-right">Omset Online</th><th className="p-3 text-right">Total Profit</th></tr>
                    </thead>
                    <tbody>
                      {supervisorLeaderboard.map((s, i) => (
                        <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="p-3 font-bold text-slate-800"><span className="inline-block w-4 text-indigo-600">{i + 1}.</span> {s.name}</td>
                          <td className="p-3 text-center font-medium text-slate-600">{s.outlets} Outlet</td>
                          <td className="p-3 text-right font-medium text-slate-600">Rp {s.offline_rev.toLocaleString('id-ID')}</td>
                          <td className="p-3 text-right font-medium text-indigo-600">Rp {s.online_rev.toLocaleString('id-ID')}</td>
                          <td className="p-3 text-right font-black text-indigo-600">Rp {s.profit.toLocaleString('id-ID')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden mt-4">
              <div className="p-4 md:p-5 border-b border-slate-100 flex justify-between"><h3 className="font-bold text-slate-800 text-sm">Audit Transaksi Periode Ini</h3><span className="text-xs text-slate-400 font-medium">{tableData.length} Data</span></div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-[10px] md:text-xs whitespace-nowrap">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                    <tr><th className="p-3 md:p-4">Tanggal</th><th className="p-3 md:p-4">Kategori</th><th className="p-3 md:p-4">Deskripsi</th><th className="p-3 md:p-4 text-right">Nominal (Rp)</th></tr>
                  </thead>
                  <tbody>
                    {tableData.map((row, idx) => (
                      <tr key={idx} className="border-b border-slate-100">
                        <td className="p-3 md:p-4 text-slate-600 font-mono">{new Date(row.date).toLocaleString('id-ID')}</td>
                        <td className="p-3 md:p-4"><span className={`px-2 py-1 rounded text-[9px] md:text-[10px] font-bold ${row.type === 'Income' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{row.category}</span></td>
                        <td className="p-3 md:p-4 text-slate-800 font-medium">{row.desc}</td>
                        <td className={`p-3 md:p-4 text-right font-bold ${row.type === 'Income' ? 'text-emerald-600' : 'text-rose-600'}`}>{row.type === 'Income' ? '+' : ''} Rp {Math.abs(row.amount).toLocaleString('id-ID')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

        {/* 📜 TAB: HISTORY 1 TAHUN KE BELAKANG */}
        {activeTab === 'history' && (
          <div className="bg-white border border-slate-200 p-4 md:p-6 rounded-2xl shadow-sm space-y-4">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 border-b pb-4">
              <div>
                <h3 className="font-bold text-indigo-700 text-base">📜 History Omset & Transaksi (1 Tahun Terakhir)</h3>
                <p className="text-xs text-slate-500 mt-0.5">Filter data transaksi resi, member, dan kas berdasarkan Cabang, Bulan, & Tanggal spesifik.</p>
              </div>
              <button onClick={exportHistoryCSV} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow transition">
                📥 EXPORT HISTORY CSV
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">🔍 Cari Resi/Pelanggan</label>
                <input
                  type="text"
                  placeholder="Ketik Nama / Resi..."
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  className="w-full border rounded-lg px-2.5 py-1.5 text-xs font-bold bg-white"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">🏢 Filter Cabang Outlet</label>
                <select value={historyOutletFilter} onChange={(e) => setHistoryOutletFilter(e.target.value)} className="w-full border rounded-lg px-2.5 py-1.5 text-xs font-bold bg-white text-indigo-700">
                  <option value="ALL">🌐 Semua Cabang</option>
                  {outlets.map((o) => (<option key={o.id} value={o.id}>📍 {o.name}</option>))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">📅 Filter Bulan</label>
                <select value={historyMonthFilter} onChange={(e) => setHistoryMonthFilter(e.target.value)} className="w-full border rounded-lg px-2.5 py-1.5 text-xs font-bold bg-white">
                  <option value="ALL">Semua Bulan</option>
                  <option value="01">Januari</option>
                  <option value="02">Februari</option>
                  <option value="03">Maret</option>
                  <option value="04">April</option>
                  <option value="05">Mei</option>
                  <option value="06">Juni</option>
                  <option value="07">Juli</option>
                  <option value="08">Agustus</option>
                  <option value="09">September</option>
                  <option value="10">Oktober</option>
                  <option value="11">November</option>
                  <option value="12">Desember</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">📆 Filter Tanggal Spesifik</label>
                <input
                  type="date"
                  value={historyDateFilter}
                  onChange={(e) => setHistoryDateFilter(e.target.value)}
                  className="w-full border rounded-lg px-2 py-1.5 text-xs font-bold bg-white"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">🏷️ Tipe Kategori</label>
                <select value={historyCategory} onChange={(e) => setHistoryCategory(e.target.value as any)} className="w-full border rounded-lg px-2.5 py-1.5 text-xs font-bold bg-white text-indigo-700">
                  <option value="all">Semua Kategori</option>
                  <option value="transactions">🧺 Transaksi Cucian</option>
                  <option value="members">💳 Top-Up Member</option>
                  <option value="expenses">💸 Pengeluaran Kas</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                  <tr><th className="p-3">Tanggal & Waktu</th><th className="p-3">Tipe</th><th className="p-3">Judul / Resi / Pelanggan</th><th className="p-3">Detail Keterangan</th><th className="p-3 text-right">Nominal (Rp)</th></tr>
                </thead>
                <tbody>
                  {filteredHistory.map((item, idx) => (
                    <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="p-3 font-mono text-slate-500">{new Date(item.date).toLocaleString('id-ID')}</td>
                      <td className="p-3"><span className={`px-2 py-0.5 rounded text-[9px] font-bold ${item.category === 'transactions' ? 'bg-emerald-100 text-emerald-700' : item.category === 'members' ? 'bg-purple-100 text-purple-700' : 'bg-rose-100 text-rose-700'}`}>{item.category.toUpperCase()}</span></td>
                      <td className="p-3 font-bold text-slate-800">{item.title}</td>
                      <td className="p-3 text-slate-600">{item.desc}</td>
                      <td className={`p-3 text-right font-bold ${item.amount >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{item.amount >= 0 ? '+' : ''} Rp {Math.abs(item.amount).toLocaleString('id-ID')}</td>
                    </tr>
                  ))}
                  {filteredHistory.length === 0 && (<tr><td colSpan={5} className="text-center py-8 text-slate-400 font-medium">Tidak ada data history yang cocok dengan filter.</td></tr>)}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB KASBON & POTONGAN KESALAHAN */}
        {activeTab === 'loans' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 p-4 md:p-6 rounded-2xl shadow-sm space-y-4">
              <h3 className="font-bold text-amber-700 border-b pb-2">💸 Catat Kasbon Crew Baru & Dokumentasi</h3>
              <form onSubmit={handleAddLoan} className="space-y-3">
                <div><label className="text-xs font-semibold text-slate-500 block mb-1">Pilih Karyawan</label><select value={targetEmpName} onChange={(e) => setTargetEmpName(e.target.value)} className="w-full border rounded-xl p-2.5 text-xs font-bold">{employees.map((e) => (<option key={e.id} value={e.name}>{e.name} (@{e.username})</option>))}</select></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="text-xs font-semibold text-slate-500 block mb-1">Total Kasbon (Rp)</label><input type="number" placeholder="Contoh: 500000" value={loanTotal} onChange={(e) => setLoanTotal(e.target.value)} className="w-full border rounded-xl p-2.5 text-xs font-bold text-amber-600" required /></div>
                  <div><label className="text-xs font-semibold text-slate-500 block mb-1">Cicilan / Bln (Rp)</label><input type="number" placeholder="Contoh: 100000" value={loanMonthly} onChange={(e) => setLoanMonthly(e.target.value)} className="w-full border rounded-xl p-2.5 text-xs font-bold text-amber-600" required /></div>
                </div>
                <div><label className="text-xs font-semibold text-slate-500 block mb-1">Catatan / Alasan Kasbon</label><input type="text" placeholder="Contoh: Keperluan Darurat Keluarga" value={loanNotes} onChange={(e) => setLoanNotes(e.target.value)} className="w-full border rounded-xl p-2.5 text-xs" /></div>
                
                <div className="bg-amber-50/60 p-3 rounded-xl border border-amber-200 space-y-2">
                  <div>
                    <label className="text-[10px] font-bold text-amber-900 block mb-1">👔 Supervisor yang Menyetujui</label>
                    <input type="text" placeholder="Nama SPV / Owner" value={loanApprovedBy} onChange={(e) => setLoanApprovedBy(e.target.value)} className="w-full border rounded-lg p-2 text-xs font-bold text-amber-800 bg-white" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-amber-900 block mb-1">📄 No. Surat / Link Bukti TTD Surat Pernyataan Kasbon</label>
                    <input type="text" placeholder="Contoh: SP/KASBON/001 atau URL Dokumen" value={loanDocUrl} onChange={(e) => setLoanDocUrl(e.target.value)} className="w-full border rounded-lg p-2 text-xs bg-white" />
                  </div>
                </div>

                <button type="submit" disabled={isSaving} className="w-full bg-amber-600 text-white font-bold py-3 rounded-xl text-xs shadow">➕ SIMPAN KASBON & DOKUMEN</button>
              </form>

              <div className="pt-4 border-t">
                <h4 className="font-bold text-xs text-slate-500 mb-3 uppercase">📋 Daftar Kasbon Aktif & Dokumentasi Surat</h4>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {loansList.map((loan) => (
                    <div key={loan.id} className="border p-3 rounded-xl flex justify-between items-center text-xs bg-amber-50/40 border-amber-200">
                      <div>
                        <p className="font-bold text-slate-800">{loan.employee_name}</p>
                        <p className="text-[10px] text-amber-800">Total: Rp {Number(loan.total_loan).toLocaleString('id-ID')} | Cicilan/Bln: <b>Rp {Number(loan.monthly_deduction).toLocaleString('id-ID')}</b></p>
                        <p className="text-[9px] text-slate-500 italic">"{loan.notes}"</p>
                        {loan.approved_by && <p className="text-[9px] text-indigo-700 font-bold mt-0.5">Disetujui: {loan.approved_by}</p>}
                        {loan.document_url && <p className="text-[9px] text-slate-400 font-mono">Dokumen/SP: {loan.document_url}</p>}
                      </div>
                      <button onClick={() => handleDeleteLoan(loan.id)} className="bg-rose-100 text-rose-600 font-bold text-[10px] px-2 py-1 rounded">Lunas/Hapus</button>
                    </div>
                  ))}
                  {loansList.length === 0 && <p className="text-xs text-slate-400 text-center py-4">Belum ada data kasbon aktif.</p>}
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-4 md:p-6 rounded-2xl shadow-sm space-y-4">
              <h3 className="font-bold text-rose-700 border-b pb-2">⚠️ Catat Potongan Kesalahan Crew</h3>
              <form onSubmit={handleAddPenalty} className="space-y-3">
                <div><label className="text-xs font-semibold text-slate-500 block mb-1">Pilih Karyawan</label><select value={targetEmpName} onChange={(e) => setTargetEmpName(e.target.value)} className="w-full border rounded-xl p-2.5 text-xs font-bold">{employees.map((e) => (<option key={e.id} value={e.name}>{e.name} (@{e.username})</option>))}</select></div>
                <div><label className="text-xs font-semibold text-slate-500 block mb-1">Nominal Denda / Potongan (Rp)</label><input type="number" placeholder="Contoh: 50000" value={penaltyAmount} onChange={(e) => setPenaltyAmount(e.target.value)} className="w-full border rounded-xl p-2.5 text-xs font-bold text-rose-600" required /></div>
                <div><label className="text-xs font-semibold text-slate-500 block mb-1">Deskripsi Kesalahan</label><input type="text" placeholder="Contoh: Baju Customer Hilang / Luntur Saat Cuci" value={penaltyReason} onChange={(e) => setPenaltyReason(e.target.value)} className="w-full border rounded-xl p-2.5 text-xs" required /></div>
                <button type="submit" disabled={isSaving} className="w-full bg-rose-600 text-white font-bold py-3 rounded-xl text-xs shadow">⚠️ CATAT POTONGAN KESALAHAN</button>
              </form>
              <div className="pt-4 border-t">
                <h4 className="font-bold text-xs text-slate-500 mb-3 uppercase">📋 Rekap Kesalahan Bulan Ini</h4>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {penaltiesList.map((pen) => (
                    <div key={pen.id} className="border p-3 rounded-xl flex justify-between items-center text-xs bg-rose-50/40 border-rose-200">
                      <div><p className="font-bold text-slate-800">{pen.employee_name}</p><p className="text-[10px] text-rose-700 font-bold">Potongan: Rp {Number(pen.penalty_amount).toLocaleString('id-ID')}</p><p className="text-[9px] text-slate-500 italic">"{pen.reason}"</p></div>
                      <button onClick={() => handleDeletePenalty(pen.id)} className="bg-slate-200 text-slate-700 font-bold text-[10px] px-2 py-1 rounded">Hapus</button>
                    </div>
                  ))}
                  {penaltiesList.length === 0 && <p className="text-xs text-slate-400 text-center py-4">Tidak ada catatan kesalahan kerja.</p>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB OWNER ONLY */}
        {currentUserRole === 'owner' && (
          <>
            {activeTab === 'settings' && (
              <div className="flex flex-col gap-6">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  
                  {/* MODUL DYNAMIC SERVICES + SEARCH */}
                  <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-4 md:p-6 shadow-sm">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-100 pb-4 mb-4 gap-3">
                      <div><h3 className="font-bold text-slate-800">⚙️ Dynamic Services</h3></div>
                      <div className="flex w-full md:w-auto items-center gap-2">
                        <select value={settingViewOutlet} onChange={(e) => setSettingViewOutlet(e.target.value)} className="w-full md:w-auto border border-indigo-200 rounded-xl px-3 py-2 text-[10px] md:text-xs font-bold text-indigo-700 bg-indigo-50">
                          <option value="ALL">🌐 GLOBAL</option>{outlets.map((o) => (<option key={o.id} value={o.id}>📍 {o.name}</option>))}
                        </select>
                        {settingViewOutlet === 'ALL' && (<button onClick={handleAddService} className="bg-emerald-100 text-emerald-700 font-bold px-3 py-2 rounded-lg text-[10px] whitespace-nowrap">+ Tambah</button>)}
                      </div>
                    </div>

                    <div className="mb-4">
                      <input
                        type="text"
                        placeholder="🔍 Cari nama layanan (misal: Bedcover, Karpet, Jas)..."
                        value={serviceSearch}
                        onChange={(e) => setServiceSearch(e.target.value)}
                        className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-xs font-bold bg-slate-50 focus:outline-none focus:border-indigo-500 shadow-sm"
                      />
                    </div>

                    <div className="space-y-4 max-h-[600px] overflow-y-auto pr-1">
                      {filteredServices.map((svc) => {
                        const isGlobal = settingViewOutlet === 'ALL';
                        const svcPrice = isGlobal ? svc.price : outletOverrides[settingViewOutlet]?.[svc.id]?.price ?? svc.price;
                        const svcComms = isGlobal ? svc.commissions : outletOverrides[settingViewOutlet]?.[svc.id]?.commissions || svc.commissions;
                        return (
                          <div key={svc.id} className={`border rounded-xl p-3 md:p-4 ${isGlobal ? 'bg-slate-50' : 'bg-indigo-50'}`}>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                              <div><label className="text-[10px] md:text-xs font-semibold text-slate-500 mb-1 block">Nama Layanan</label><input type="text" value={svc.name} onChange={(e) => updateService(svc.id, 'name', e.target.value)} disabled={!isGlobal} className="w-full border rounded-lg p-2 text-xs md:text-sm font-bold" /></div>
                              <div className="grid grid-cols-2 md:grid-cols-2 gap-2 md:col-span-2">
                                <div><label className="text-[10px] md:text-xs font-semibold text-slate-500 mb-1 block">Tipe</label><select value={svc.type} onChange={(e) => updateService(svc.id, 'type', e.target.value)} disabled={!isGlobal} className="w-full border rounded-lg p-2 text-xs md:text-sm"><option value="kg">Per Kilo (Kg)</option><option value="pcs">Per Satuan (Pcs)</option></select></div>
                                <div><label className="text-[10px] md:text-xs font-semibold text-slate-500 mb-1 block">Harga {!isGlobal && '(Khusus)'}</label><input type="number" value={svcPrice} onChange={(e) => updateService(svc.id, 'price', Number(e.target.value))} className="w-full border rounded-lg p-2 text-xs md:text-sm font-bold" /></div>
                              </div>
                            </div>
                            <div className="bg-white p-2 md:p-3 rounded-lg border">
                              <label className="text-[10px] md:text-xs font-bold text-slate-700 mb-2 block border-b pb-1">Upah Borongan Karyawan Per {svc.type?.toUpperCase()}</label>
                              <div className="grid grid-cols-5 gap-1 md:gap-2">
                                <div><span className="text-[8px] md:text-[10px] text-slate-500 block">Sortir</span><input type="number" value={svcComms?.sortir ?? 0} onChange={(e) => updateCommission(svc.id, 'sortir', Number(e.target.value))} className="w-full border rounded p-1 text-xs text-center" /></div>
                                <div><span className="text-[8px] md:text-[10px] text-slate-500 block">Cuci</span><input type="number" value={svcComms?.cuci ?? 0} onChange={(e) => updateCommission(svc.id, 'cuci', Number(e.target.value))} className="w-full border rounded p-1 text-xs text-center" /></div>
                                <div><span className="text-[8px] md:text-[10px] text-slate-500 block">Kering</span><input type="number" value={svcComms?.kering ?? 0} onChange={(e) => updateCommission(svc.id, 'kering', Number(e.target.value))} className="w-full border rounded p-1 text-xs text-center" /></div>
                                <div><span className="text-[8px] md:text-[10px] text-slate-500 block">Setrika</span><input type="number" value={svcComms?.setrika ?? 0} onChange={(e) => updateCommission(svc.id, 'setrika', Number(e.target.value))} className="w-full border rounded p-1 text-xs text-center" /></div>
                                <div><span className="text-[8px] md:text-[10px] text-slate-500 block">Packing</span><input type="number" value={svcComms?.packing ?? 0} onChange={(e) => updateCommission(svc.id, 'packing', Number(e.target.value))} className="w-full border rounded p-1 text-xs text-center" /></div>
                              </div>
                            </div>
                            {isGlobal && (<button onClick={() => handleRemoveService(svc.id)} className="w-full mt-2 bg-rose-50 text-rose-600 text-xs py-1 rounded">Hapus Layanan</button>)}
                          </div>
                        );
                      })}
                      {filteredServices.length === 0 && (
                        <p className="text-xs text-slate-400 text-center py-6 font-medium">Layanan "{serviceSearch}" tidak ditemukan.</p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4 md:space-y-6">
                    <form onSubmit={handleSaveOutlet} className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 md:p-6 shadow-sm space-y-3">
                      <div className="flex justify-between items-center border-b border-emerald-200 pb-2">
                        <h3 className="font-black text-emerald-800 text-sm">🏪 Kelola Outlet Cabang</h3>
                        <select 
                          value={selectedOutletToEdit} 
                          onChange={(e) => setSelectedOutletToEdit(e.target.value)} 
                          className="text-[10px] font-bold border border-emerald-300 rounded-lg px-2 py-1 text-emerald-900 bg-white cursor-pointer shadow-sm"
                        >
                          <option value="NEW">✨ + Tambah Baru</option>
                          {outlets.map((o) => (
                            <option key={o.id} value={o.id}>✏️ Edit: {o.name}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-emerald-900 block mb-1">Nama Outlet Cabang</label>
                        <input type="text" placeholder="Contoh: Briwash Pasirkaliki" value={newOutletName} onChange={(e) => setNewOutletName(e.target.value)} className="w-full border rounded-xl p-2.5 text-xs font-bold text-slate-800 bg-white" required />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-emerald-900 block mb-1">Kota / Wilayah (Opsional)</label>
                        <input type="text" placeholder="Contoh: Bandung" value={newOutletCity} onChange={(e) => setNewOutletCity(e.target.value)} className="w-full border rounded-xl p-2.5 text-xs text-slate-800 bg-white" />
                      </div>
                      
                      {/* INPUT WA CABANG */}
                      <div>
                        <label className="text-[10px] font-bold text-emerald-900 block mb-1">Nomor WhatsApp Cabang / CS</label>
                        <input type="text" placeholder="Contoh: 628123456789" value={newOutletWA} onChange={(e) => setNewOutletWA(e.target.value)} className="w-full border border-emerald-300 rounded-xl p-2.5 text-xs font-bold text-slate-800 bg-white" />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[9px] font-bold text-emerald-800 block mb-1">Latitude (GPS)</label>
                          <input type="text" placeholder="-6.9056" value={newOutletLat} onChange={(e) => setNewOutletLat(e.target.value)} className="w-full border rounded-lg p-2 text-xs bg-white font-mono" />
                        </div>
                        <div>
                          <label className="text-[9px] font-bold text-emerald-800 block mb-1">Longitude (GPS)</label>
                          <input type="text" placeholder="107.5956" value={newOutletLon} onChange={(e) => setNewOutletLon(e.target.value)} className="w-full border rounded-lg p-2 text-xs bg-white font-mono" />
                        </div>
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-emerald-800 block mb-1">Radius Max Absen (Meter)</label>
                        <input type="number" placeholder="200" value={newOutletRadius} onChange={(e) => setNewOutletRadius(e.target.value)} className="w-full border rounded-lg p-2 text-xs font-bold bg-white" />
                      </div>
                      
                      <button type="submit" disabled={isSaving} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl text-xs shadow transition">
                        {selectedOutletToEdit === 'NEW' ? '➕ TAMBAH OUTLET CABANG' : '💾 PERBARUI DATA OUTLET'}
                      </button>
                    </form>

                    <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 md:p-6 shadow-sm">
                      <h3 className="font-black text-indigo-800 text-sm mb-2">👔 Supervisor Cabang</h3>
                      <p className="text-[10px] text-slate-500 mb-4">Tentukan Supervisor penanggung jawab tiap cabang untuk data Leaderboard.</p>
                      <div className="space-y-3">
                        {outlets.map((o) => (
                          <div key={o.id} className="flex flex-col bg-white p-2 rounded-lg border border-indigo-100">
                            <span className="text-xs font-bold text-slate-700 mb-1">{o.name}</span>
                            <select value={supervisorMapping[o.id] || ''} onChange={(e) => setSupervisorMapping({ ...supervisorMapping, [o.id]: e.target.value })} className="border border-slate-200 rounded text-xs p-2 text-indigo-700 font-bold focus:outline-none focus:border-indigo-400 cursor-pointer">
                              <option value="">-- Tanpa Supervisor --</option>
                              {employees.filter((e) => e.role === 'supervisor' || e.role === 'owner').map((emp) => (<option key={emp.id} value={emp.name}>{emp.name}</option>))}
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bg-white border rounded-2xl p-4 md:p-6"><h3 className="font-bold text-sm mb-2">📜 Syarat Nota</h3><textarea value={receiptTerms} onChange={(e) => setReceiptTerms(e.target.value)} rows={4} className="w-full border rounded-xl p-2 text-xs font-mono"></textarea></div>
                    <div className="bg-white border rounded-2xl p-4 md:p-6"><h3 className="font-bold text-sm mb-2">💰 Gaji Pokok Default</h3><input type="number" value={basicSalary} onChange={(e) => setBasicSalary(e.target.value)} className="w-full border rounded-xl p-2 font-bold text-emerald-600" /></div>
                    <div className="bg-white border rounded-2xl p-4 md:p-6"><h3 className="font-bold text-sm mb-2">📋 COA</h3><textarea value={coaList} onChange={(e) => setCoaList(e.target.value)} rows={5} className="w-full border rounded-xl p-2 text-xs font-mono"></textarea></div>
                  </div>
                </div>
                <button onClick={handleSaveSettings} disabled={isSaving} className="w-full bg-indigo-600 text-white font-black py-4 rounded-xl shadow-lg mt-4">{isSaving ? 'Menyimpan...' : '💾 SIMPAN SEMUA PENGATURAN'}</button>
              </div>
            )}

            {/* TAB KARYAWAN & ABSENSI (TERMASUK ROLE DRIVER DAN CS) */}
            {activeTab === 'employees' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <form onSubmit={handleAddEmployee} className="bg-white p-4 md:p-6 rounded-2xl border space-y-4">
                  <h3 className="font-bold text-sm border-b pb-2">👤 Karyawan / Staf Baru</h3>
                  <input type="text" placeholder="Nama Lengkap" value={newEmpName} onChange={(e) => setNewEmpName(e.target.value)} className="w-full border rounded-xl px-3 py-2 text-sm" required />
                  <div className="bg-purple-50 p-3 rounded-xl border border-purple-100 space-y-2">
                    <input type="text" placeholder="Username" value={newEmpUsername} onChange={(e) => setNewEmpUsername(e.target.value.toLowerCase().replace(/\s/g, ''))} className="w-full border rounded-lg px-3 py-2 text-sm" required />
                    <input type="text" placeholder="Password" value={newEmpPassword} onChange={(e) => setNewEmpPassword(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" required />
                    
                    {/* DROPDOWN PERAN DENGAN DRIVER & CS */}
                    <select value={newEmpRole} onChange={(e) => setNewEmpRole(e.target.value as any)} className="w-full border rounded-lg px-3 py-2 text-xs font-bold text-purple-900 bg-white">
                      <option value="kasir">Kasir (1 Outlet)</option>
                      <option value="driver">Driver / Kurir (Aplikasi Kurir)</option>
                      <option value="cs">Customer Service (CS Pusat)</option>
                      <option value="supervisor">Supervisor (Multi-Outlet)</option>
                      <option value="finance">Finance (Multi-Outlet)</option>
                      <option value="owner">Owner (Full Akses)</option>
                    </select>
                  </div>
                  <input type="number" placeholder="Gaji Pokok" value={newEmpSalary} onChange={(e) => setNewEmpSalary(e.target.value)} className="w-full border rounded-xl px-3 py-2 text-sm text-emerald-600 font-bold" required />
                  <select value={newEmpOutlet} onChange={(e) => setNewEmpOutlet(e.target.value)} className="w-full border rounded-xl px-3 py-2 text-sm"><option value="ALL">🌐 Semua Cabang (Pusat)</option>{outlets.map((o) => (<option key={o.id} value={o.id}>{o.name}</option>))}</select>
                  <button type="submit" disabled={isSaving} className="w-full bg-purple-600 text-white font-bold py-3 rounded-xl text-sm">➕ DAFTAR AKUN STAF</button>
                </form>

                <div className="lg:col-span-2 space-y-6">
                  {/* TABEL DAFTAR KARYAWAN */}
                  <div className="bg-white p-4 md:p-6 rounded-2xl border overflow-x-auto">
                    <h3 className="font-bold text-slate-800 text-sm mb-4 border-b pb-2">📋 Daftar Karyawan & Staf Aktif</h3>
                    <table className="w-full text-left text-[10px] md:text-xs whitespace-nowrap">
                      <thead className="bg-slate-50 border-b"><tr><th className="p-3">Info Karyawan</th><th className="p-3">Role / Peran</th><th className="p-3">Penempatan Cabang</th><th className="p-3 text-right">Aksi</th></tr></thead>
                      <tbody>
                        {employees.map((emp) => (
                          <tr key={emp.id} className="border-b hover:bg-slate-50">
                            <td className="p-3"><b className="text-slate-800 text-xs">{emp.name}</b><br /><span className="text-[9px] text-purple-600 font-mono">@{emp.username}</span></td>
                            <td className="p-3">
                              {/* EDIT DROPDOWN ROLE DENGAN PILIHAN LENGKAP */}
                              <select value={emp.role || 'kasir'} onChange={(e) => handleUpdateEmployeeRole(emp.id, e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-[10px] font-bold text-slate-700 bg-white focus:outline-none focus:border-purple-500 cursor-pointer shadow-sm">
                                <option value="kasir">KASIR</option>
                                <option value="driver">DRIVER / KURIR</option>
                                <option value="cs">CUSTOMER SERVICE</option>
                                <option value="supervisor">SUPERVISOR</option>
                                <option value="finance">FINANCE</option>
                                <option value="owner">OWNER</option>
                              </select>
                            </td>
                            <td className="p-3">
                              <select value={emp.outlet_id || 'ALL'} onChange={(e) => handleUpdateEmployeeOutlet(emp.id, e.target.value)} className="border border-slate-300 rounded-lg px-2.5 py-1 text-[10px] font-bold text-slate-800 bg-white focus:outline-none focus:border-purple-500 cursor-pointer shadow-sm">
                                <option value="ALL">🌐 Semua Cabang (Pusat)</option>
                                {outlets.map((o) => (<option key={o.id} value={o.id}>📍 {o.name}</option>))}
                              </select>
                            </td>
                            <td className="p-3 text-right"><button onClick={() => handleDeleteEmployee(emp.id)} className="bg-rose-100 text-rose-600 hover:bg-rose-200 px-2.5 py-1 rounded text-[10px] font-bold transition">Hapus</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* TABEL RIWAYAT ABSENSI */}
                  <div className="bg-white p-4 md:p-6 rounded-2xl border overflow-x-auto">
                    <h3 className="font-bold text-slate-800 text-sm mb-1">📅 Riwayat Absensi Karyawan</h3>
                    <p className="text-[10px] text-slate-500 mb-4 border-b pb-2">Log absensi masuk dan pulang karyawan (terbaru).</p>
                    <table className="w-full text-left text-[10px] md:text-xs whitespace-nowrap">
                      <thead className="bg-slate-50 border-b"><tr><th className="p-3">Tanggal</th><th className="p-3">Nama Karyawan</th><th className="p-3">Jam Masuk</th><th className="p-3">Jam Pulang</th></tr></thead>
                      <tbody>
                        {attendances.map((att) => (
                          <tr key={att.id} className="border-b hover:bg-slate-50">
                            <td className="p-3 font-bold text-slate-700">{new Date(att.log_date).toLocaleDateString('id-ID')}</td>
                            <td className="p-3 font-bold text-indigo-700">{att.employee_name}</td>
                            <td className="p-3"><span className="bg-emerald-100 text-emerald-700 px-2 py-1 rounded font-bold">{att.check_in ? new Date(att.check_in).toLocaleTimeString('id-ID') : '-'}</span></td>
                            <td className="p-3"><span className="bg-amber-100 text-amber-700 px-2 py-1 rounded font-bold">{att.check_out ? new Date(att.check_out).toLocaleTimeString('id-ID') : 'Belum Pulang'}</span></td>
                          </tr>
                        ))}
                        {attendances.length === 0 && (<tr><td colSpan={4} className="text-center py-4 text-slate-400">Belum ada data absensi.</td></tr>)}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
{/* WIDGET APPROVAL PENGELUARAN SUPERVISOR */}
<div className="bg-white border rounded-2xl p-4 md:p-6 space-y-4 mb-6">
        <h3 className="font-bold text-slate-800 text-sm md:text-lg flex items-center gap-2">
          💸 Pengajuan Pengeluaran Ops (Menunggu Approval)
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[10px] md:text-xs whitespace-nowrap">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="p-3">Tanggal</th>
                <th className="p-3">Kategori</th>
                <th className="p-3">Deskripsi</th>
                <th className="p-3">Nominal</th>
                <th className="p-3">Rekening Tujuan</th>
                <th className="p-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {fullYearHistory
                .filter((item: any) => item.status === 'PENDING_SUPERVISOR' || item.beneficiary_account_no)
                .map((exp: any) => (
                  <tr key={exp.id} className="border-b hover:bg-slate-50">
                    <td className="p-3">{new Date(exp.created_at).toLocaleDateString('id-ID')}</td>
                    <td className="p-3 font-bold">{exp.category}</td>
                    <td className="p-3">{exp.description}</td>
                    <td className="p-3 font-bold text-rose-600">Rp {Number(exp.amount).toLocaleString('id-ID')}</td>
                    <td className="p-3">
                      {exp.beneficiary_bank} - {exp.beneficiary_account_no} a.n {exp.beneficiary_account_name}
                    </td>
                    <td className="p-3 text-right">
                      {exp.status === 'PENDING_SUPERVISOR' ? (
                        <button
                          onClick={() => handleApproveExpense(exp.id)}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs"
                        >
                          ✓ Setujui Pengajuan
                        </button>
                      ) : (
                        <span className="text-slate-400 italic">{exp.status}</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
            {activeTab === 'delete_requests' && (
              <div className="bg-white border rounded-2xl p-4 md:p-6 space-y-4">
                <h3 className="font-bold text-rose-600 text-sm md:text-lg">🗑️ Permintaan Hapus Transaksi</h3>
                {deleteRequests.map((req) => (
                  <div key={req.id} className="border border-rose-200 bg-rose-50/50 rounded-xl p-3 md:p-4 flex flex-col md:flex-row justify-between gap-3">
                    <div>
                      <p className="font-bold text-sm">
                        {req.customer_name} <span className="text-[10px] bg-slate-200 px-2 py-0.5 rounded ml-1">{req.receipt_number}</span>
                      </p>
                      <p className="text-xs text-rose-700 italic mt-1">Alasan: "{req.delete_reason}"</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleRejectDelete(req.id)} disabled={isSaving} className="flex-1 bg-slate-200 px-3 py-2 rounded-lg text-xs font-bold">Tolak</button>
                      <button onClick={() => handleApproveDelete(req.id)} disabled={isSaving} className="flex-1 bg-rose-600 text-white px-3 py-2 rounded-lg text-xs font-bold">Hapus Permanen</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}