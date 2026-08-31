'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';
import StageTimeline from '@/components/StageTimeline';
import WasherBatchTimeline from '@/components/pos/WasherBatchTimeline';
import { isVoidTransaction } from '@/lib/voidTx';
import MetricCard from '@/components/ui/MetricCard';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { canAccessSettings, homePathForRole, isOwnerRole, isWorkspaceRole } from '@/lib/staffSession';
import { isMultiOutletRole, staffRolesForForm } from '@/lib/staffRoles';
import OwnerExecNav from '@/components/OwnerExecNav';
import FinanceAlertListener from '@/components/FinanceAlertListener';
import WasherFraudAlertListener from '@/components/WasherFraudAlertListener';
import AICopilotCard from '@/components/analytics/AICopilotCard';

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
  
  const [currentUserRole, setCurrentUserRole] = useState('');
  const [currentUserName, setCurrentUserName] = useState('');

  const [outlets, setOutlets] = useState<any[]>([]);
  const [selectedOutlet, setSelectedOutlet] = useState('ALL');
  const [period, setPeriod] = useState('THIS_MONTH');

  const [stats, setStats] = useState({ income: 0, onlineIncome: 0, offlineIncome: 0, expense: 0, profit: 0 });
  const [prevStats, setPrevStats] = useState({ income: 0, profit: 0 });
  const [tableData, setTableData] = useState<any[]>([]);
  const [rawExportData, setRawExportData] = useState({ txs: [] as any[], mems: [] as any[], exps: [] as any[] });
  
  const [outletLeaderboard, setOutletLeaderboard] = useState<any[]>([]);
  const [supervisorLeaderboard, setSupervisorLeaderboard] = useState<any[]>([]);
  const [supervisorMapping, setSupervisorMapping] = useState<any>({});
  const [supervisorSearch, setSupervisorSearch] = useState('');

  const [deleteRequests, setDeleteRequests] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // States Settings & Dynamic Services
  const [basicSalary, setBasicSalary] = useState('1500000');
  const [coaList, setCoaList] = useState('');
  const [services, setServices] = useState<any[]>([]);
  const [serviceSearch, setServiceSearch] = useState('');
  const [showAllServices, setShowAllServices] = useState(false);
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
  const [newOutletWA, setNewOutletWA] = useState('');
  const [newOutletMayarKey, setNewOutletMayarKey] = useState('');
  const [newOutletMayarPayout, setNewOutletMayarPayout] = useState('');

  // States Karyawan & Absensi
  const [editingEmp, setEditingEmp] = useState<any>(null);
  const [editEmpRole, setEditEmpRole] = useState('');
  const [editEmpPassword, setEditEmpPassword] = useState('');
  const [editEmpOutlet, setEditEmpOutlet] = useState('ALL');
  const [employees, setEmployees] = useState<any[]>([]);
  const [attendances, setAttendances] = useState<any[]>([]);
  const [newEmpName, setNewEmpName] = useState('');
  const [newEmpUsername, setNewEmpUsername] = useState('');
  const [newEmpPassword, setNewEmpPassword] = useState('');
  const [newEmpRole, setNewEmpRole] = useState('kasir');
  const [newEmpSalary, setNewEmpSalary] = useState('');
  const [newEmpOutlet, setNewEmpOutlet] = useState('ALL');
  const [newEmpAccessOutlets, setNewEmpAccessOutlets] = useState<string[]>([]);

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

  // States Tab History & Modal Detail Transaksi
  const [historyCategory, setHistoryCategory] = useState<'all' | 'transactions' | 'members' | 'expenses'>('all');
  const [historySearch, setHistorySearch] = useState('');
  const [historyOutletFilter, setHistoryOutletFilter] = useState('ALL');
  const [historyMonthFilter, setHistoryMonthFilter] = useState('ALL');
  const [historyDateFilter, setHistoryDateFilter] = useState('');
  const [fullYearHistory, setFullYearHistory] = useState<any[]>([]);
  const [selectedTxDetail, setSelectedTxDetail] = useState<any>(null);
  const [txWorkLogs, setTxWorkLogs] = useState<any[]>([]);
  const [txWasherCycles, setTxWasherCycles] = useState<any[]>([]);

  // Nama crew per tahap. Kolom by_* hanya sebagian yang ada di schema, jadi
  // work_logs dipakai sebagai sumber cadangan. Kegagalan kueri sengaja
  // ditelan agar modal detail tetap tampil (nilai jatuh ke '-').
  useEffect(() => {
    if (!selectedTxDetail?.id) {
      setTxWorkLogs([]);
      setTxWasherCycles([]);
      return;
    }

    let cancelled = false;
    supabase
      .from('work_logs')
      .select('stage, employee_name, created_at')
      .eq('transaction_id', selectedTxDetail.id)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn('work_logs tidak dapat dibaca:', error.message);
          setTxWorkLogs([]);
          return;
        }
        setTxWorkLogs(data || []);
      });
    supabase
      .from('washer_cycle_logs')
      .select('*')
      .eq('order_id', selectedTxDetail.id)
      .order('batch_index', { ascending: true })
      .then(({ data }) => {
        if (!cancelled) setTxWasherCycles(data || []);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTxDetail?.id]);

  useEffect(() => {
    const ownerStr = localStorage.getItem('laundry_owner_user');
    if (!ownerStr) { window.location.href = '/login'; return; }
    const user = JSON.parse(ownerStr);
    const role = String(user.role || '').toLowerCase();
    if (isWorkspaceRole(role) && !canAccessSettings(role)) {
      window.location.href = '/workspace';
      return;
    }
    if (!canAccessSettings(role) && !isOwnerRole(role)) {
      window.location.href = homePathForRole(role);
      return;
    }
    setCurrentUserRole(role);
    setCurrentUserName(user.name);
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (tab === 'history' || tab === 'transaksi') setActiveTab('history');
    if (tab === 'settings') setActiveTab('settings');
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

      let txQuery = supabase.from('transactions').select('*, outlets(name)');
      let memQuery = supabase.from('membership_logs').select('*, outlets(name)');
      let expQuery = supabase.from('expenses').select('*');

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

      const periodTxs = (allTxs?.filter(checkPeriod) || []).filter((t) => !isVoidTransaction(t));
      const periodMems = allMems?.filter(checkPeriod) || [];
      const periodExps = allExps?.filter(checkPeriod) || [];

      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

      let historyCombined: any[] = [];
      allTxs?.filter(t => new Date(t.created_at) >= oneYearAgo).forEach(t => historyCombined.push({ 
        id: t.id, 
        date: t.created_at, 
        category: 'transactions', 
        title: `${t.receipt_number || 'TRX'} - ${t.customer_name || 'Pelanggan'}`, 
        desc: `${t.service_type || 'Layanan'} (${t.order_type || 'Offline'})`, 
        amount: Number(t.amount) || 0, 
        outlet: t.outlet_id,
        rawData: t
      }));

      allMems?.filter(m => new Date(m.created_at) >= oneYearAgo).forEach(m => historyCombined.push({ 
        id: m.id, 
        date: m.created_at, 
        category: 'members', 
        title: String(m.package_name || '').toLowerCase().includes('top up')
          ? String(m.package_name)
          : `Member ${m.package_name || ''}`, 
        desc: String(m.package_name || '').toLowerCase().includes('top up')
          ? `QRIS Mayar · ${m.customer_phone || '-'} · LUNAS`
          : `No. WA: ${m.customer_phone || '-'} (${m.order_type || 'Offline'})`, 
        amount: Number(m.price) || 0, 
        outlet: m.outlet_id 
      }));

      allExps?.filter(e => new Date(e.created_at) >= oneYearAgo).forEach(e => historyCombined.push({ 
        id: e.id, 
        date: e.created_at, 
        category: 'expenses', 
        title: `Pengeluaran: ${e.category || 'Kas'}`, 
        desc: e.description || '-', 
        amount: -Number(e.amount || 0), 
        outlet: e.outlet_id 
      }));

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
        combinedData.push({ date: t.created_at, type: 'Income', category: 'Laundry', desc: `${t.service_type} (${t.customer_name})`, amount: amt, rawData: t }); 
      });

      filteredMems.forEach((m) => { 
        const amt = Number(m.price) || 0; inc += amt;
        if (m.order_type === 'Online') onlineInc += amt; else offlineInc += amt;
        combinedData.push({
          date: m.created_at,
          type: 'Income',
          category: String(m.package_name || '').toLowerCase().includes('top up') ? 'Top Up Deposit' : 'Membership',
          desc: String(m.package_name || '').toLowerCase().includes('top up')
            ? `${m.package_name} · QRIS Mayar (${m.customer_phone})`
            : `Paket ${m.package_name} (${m.customer_phone}) - ${m.order_type || 'Offline'}`,
          amount: amt
        }); 
      });

      filteredExps.forEach((e) => { 
        const amt = Number(e.amount) || 0; exp += amt; 
        combinedData.push({ date: e.created_at, type: 'Expense', category: e.category, desc: e.description || '-', amount: -amt }); 
      });

      combinedData.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setStats({ income: inc, onlineIncome: onlineInc, offlineIncome: offlineInc, expense: exp, profit: inc - exp }); 
      setTableData(combinedData);

      const prevOf = (item: any) => {
        const d = new Date(item.created_at);
        if (period === 'THIS_YEAR') {
          const two = new Date();
          two.setFullYear(two.getFullYear() - 2);
          const one = new Date();
          one.setFullYear(one.getFullYear() - 1);
          return d >= two && d < one;
        }
        const lastMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
        const lastYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
        if (period === 'LAST_MONTH') {
          const prevM = lastMonth === 0 ? 11 : lastMonth - 1;
          const prevY = lastMonth === 0 ? lastYear - 1 : lastYear;
          return d.getMonth() === prevM && d.getFullYear() === prevY;
        }
        return d.getMonth() === lastMonth && d.getFullYear() === lastYear;
      };
      const prevTxs = (allTxs || []).filter(prevOf).filter((t: any) => selectedOutlet === 'ALL' || t.outlet_id === selectedOutlet);
      const prevMems = (allMems || []).filter(prevOf).filter((m: any) => selectedOutlet === 'ALL' || m.outlet_id === selectedOutlet);
      const prevExps = (allExps || []).filter(prevOf).filter((e: any) => selectedOutlet === 'ALL' || e.outlet_id === selectedOutlet);
      const prevInc =
        prevTxs.reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0) +
        prevMems.reduce((s: number, m: any) => s + (Number(m.price) || 0), 0);
      const prevExp = prevExps.reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);
      setPrevStats({ income: prevInc, profit: prevInc - prevExp });

      setIsLoading(false);
    }
    loadData();
    // LISTEN REALTIME SYNC UNTUK DASHBOARD OWNER
    const channel = supabase
      .channel('owner_realtime_dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'membership_logs' }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, () => loadData())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedOutlet, period, activeTab]);

  useEffect(() => {
    if (selectedOutletToEdit === 'NEW') {
      setNewOutletName(''); setNewOutletCity(''); setNewOutletLat(''); setNewOutletLon(''); setNewOutletRadius('200'); setNewOutletWA(''); setNewOutletMayarKey(''); setNewOutletMayarPayout('');
    } else {
      const targetOutlet = outlets.find(o => o.id === selectedOutletToEdit);
      if (targetOutlet) {
        setNewOutletName(targetOutlet.name || '');
        setNewOutletCity(targetOutlet.city || '');
        setNewOutletLat(targetOutlet.latitude ? String(targetOutlet.latitude) : '');
        setNewOutletLon(targetOutlet.longitude ? String(targetOutlet.longitude) : '');
        setNewOutletRadius(targetOutlet.radius_meters ? String(targetOutlet.radius_meters) : '200');
        setNewOutletWA(targetOutlet.whatsapp_number || '');
        setNewOutletMayarKey(targetOutlet.mayar_api_key || '');
        setNewOutletMayarPayout(targetOutlet.mayar_payout_account_id || '');
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
      whatsapp_number: newOutletWA.trim(),
      mayar_api_key: newOutletMayarKey.trim() || null,
      mayar_payout_account_id: newOutletMayarPayout.trim() || null
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

    if (error && String(error.message || '').toLowerCase().includes('mayar_')) {
      delete payload.mayar_api_key;
      delete payload.mayar_payout_account_id;
      if (selectedOutletToEdit === 'NEW') {
        const res = await supabase.from('outlets').insert([payload]);
        error = res.error;
      } else {
        const res = await supabase.from('outlets').update(payload).eq('id', selectedOutletToEdit);
        error = res.error;
      }
      if (!error) {
        alert('Outlet disimpan. Jalankan migrasi Mayar SQL agar API key cabang ikut tersimpan.');
      }
    }

    if (!error) {
      alert(`✅ ${selectedOutletToEdit === 'NEW' ? 'Outlet Cabang Baru Berhasil Ditambahkan!' : 'Data Outlet Berhasil Diperbarui!'}`);
      setSelectedOutletToEdit('NEW');
      setNewOutletName(''); setNewOutletCity(''); setNewOutletLat(''); setNewOutletLon(''); setNewOutletRadius('200'); setNewOutletWA(''); setNewOutletMayarKey(''); setNewOutletMayarPayout('');
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

  const handleToggleInvestorOutlet = (outletId: string) => {
    setNewEmpAccessOutlets(prev => 
      prev.includes(outletId) ? prev.filter(id => id !== outletId) : [...prev, outletId]
    );
  };

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault(); if (!newEmpName || !newEmpUsername || !newEmpPassword) return alert('Semua data wajib diisi!'); setIsSaving(true);
    const { data: checkUser } = await supabase.from('employees').select('id').eq('username', newEmpUsername).single();
    if (checkUser) { alert('❌ Username sudah digunakan!'); setIsSaving(false); return; }
    
    const singleOutletValue = isMultiOutletRole(newEmpRole) ? null : (newEmpOutlet === 'ALL' ? null : newEmpOutlet);
    const multiOutletValue = newEmpRole === 'investor' ? JSON.stringify(newEmpAccessOutlets) : '[]';

    const { error } = await supabase.from('employees').insert([{ 
      name: newEmpName, 
      outlet_id: singleOutletValue, 
      username: newEmpUsername, 
      password: newEmpPassword, 
      role: newEmpRole, 
      basic_salary: Number(newEmpSalary), 
      access_outlets: multiOutletValue 
    }]);

    if (!error) { 
      alert('✅ Karyawan/User ditambahkan!'); 
      setNewEmpName(''); setNewEmpUsername(''); setNewEmpPassword(''); setNewEmpAccessOutlets([]);
      const { data } = await supabase.from('employees').select('*, outlets(name)').order('created_at', { ascending: false }); 
      if (data) setEmployees(data); 
    } else alert('❌ Gagal: ' + error.message);
    setIsSaving(false);
  };
  const handleSaveEditEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmp) return;
    setIsSaving(true);

    const payload: any = {
      role: editEmpRole,
      outlet_id: editEmpOutlet === 'ALL' ? null : editEmpOutlet
    };

    if (editEmpPassword.trim()) {
      payload.password = editEmpPassword.trim();
    }

    const { error } = await supabase.from('employees').update(payload).eq('id', editingEmp.id);

    if (!error) {
      alert('✅ Data karyawan berhasil diperbarui!');
      setEditingEmp(null);
      setEditEmpPassword('');
      const { data } = await supabase.from('employees').select('*, outlets(name)').order('created_at', { ascending: false });
      if (data) setEmployees(data);
    } else {
      alert('❌ Gagal memperbarui karyawan: ' + error.message);
    }
    setIsSaving(false);
  };
  const handleDeleteEmployee = async (id: string) => {
    if (!confirm('Yakin ingin menghapus karyawan ini?')) return; setIsSaving(true);
    const { error } = await supabase.from('employees').delete().eq('id', id);
    if (!error) { setEmployees(employees.filter((emp) => emp.id !== id)); alert('✅ Karyawan dihapus!'); } else alert('❌ Gagal: ' + error.message);
    setIsSaving(false);
  };

  const handleSaveSettings = async () => {
    setIsSaving(true); const coaArray = coaList.split('\n').map((item) => item.trim()).filter((item) => item !== '');
    const updatePayload: any = {
      basic_salary: Number(basicSalary), receipt_terms: receiptTerms, coa_categories: JSON.stringify(coaArray),
      dynamic_services: JSON.stringify(services), outlet_overrides: JSON.stringify(outletOverrides), supervisor_mapping: JSON.stringify(supervisorMapping)
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
    if (settingViewOutlet === 'ALL') {
      setServices(services.map((s) => {
        if (s.id === svcId) return { ...s, commissions: { ...s.commissions, [commField]: value } };
        return s;
      }));
    } else {
      setOutletOverrides((prev: any) => {
        const currentOutlet = prev[settingViewOutlet] || {};
        const currentSvc = currentOutlet[svcId] || { commissions: {} };
        return {
          ...prev,
          [settingViewOutlet]: {
            ...currentOutlet,
            [svcId]: { ...currentSvc, commissions: { ...(currentSvc.commissions || {}), [commField]: value } }
          }
        };
      });
    }
  };

  const filteredServices = services.filter((svc) => 
    (svc.name || '').toLowerCase().includes(serviceSearch.toLowerCase())
  );

  const displayedServices = serviceSearch.trim() !== '' || showAllServices 
    ? filteredServices 
    : filteredServices.slice(0, 5);

    const exportCSV = () => {
      const currentMonthName = new Date().toLocaleString('id-ID', { month: 'long' }).toUpperCase();
      const outletNameStr = selectedOutlet === 'ALL' ? 'SEMUA CABANG' : outlets.find((o) => o.id === selectedOutlet)?.name?.toUpperCase() || 'OUTLET';
  
      let csv = `LAPORAN LABA RUGI - ${outletNameStr}\n`;
      csv += `"Periode", "${period.replace('_', ' ')}"\n`;
      csv += `"Tanggal Cetak", "${new Date().toLocaleString('id-ID')}"\n\n`;
      
      csv += `"KATEGORI FINANCIAL","NOMINAL (RP)"\n`;
      csv += `"Pendapatan Offline",${stats.offlineIncome}\n`;
      csv += `"Pendapatan Online",${stats.onlineIncome}\n`;
      csv += `"TOTAL OMSET (GROSS REVENUE)",${stats.income}\n`;
      csv += `"TOTAL PENGELUARAN (OPEX)",${stats.expense}\n`;
      csv += `"NET PROFIT (LABA BERSIH)",${stats.profit}\n\n`;
  
      csv += `"RINCIAN AUDIT TRANSAKSI"\n`;
      csv += `"Tanggal & Waktu","Kategori","Deskripsi / Pelanggan","Nominal (Rp)"\n`;
      
      tableData.forEach((row) => {
        const dateStr = new Date(row.date).toLocaleString('id-ID');
        csv += `"${dateStr}","${row.category}","${row.desc.replace(/"/g, '""')}",${row.amount}\n`;
      });
  
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Laporan_PnL_${outletNameStr.replace(/ /g, '_')}_${currentMonthName}.csv`;
      link.click();
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

  const isManagementAdmin = canAccessSettings(currentUserRole);
  const trendPct = (curr: number, prev: number) => {
    if (!prev) return curr > 0 ? 100 : 0;
    return Math.round(((curr - prev) / Math.abs(prev)) * 100);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-3 md:p-8">
      <div className="max-w-6xl mx-auto space-y-4 md:space-y-6">
        
        {/* MODAL POP-UP DETAIL TRANSAKSI HISTORY */}
        {selectedTxDetail && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white rounded-3xl p-5 md:p-6 max-w-lg w-full space-y-4 shadow-2xl border border-slate-200">
              <div className="flex justify-between items-start border-b pb-3">
                <div>
                  <span className="text-[10px] font-mono font-bold bg-indigo-100 text-indigo-800 px-2.5 py-0.5 rounded-full uppercase">
                    Detail Transaksi
                  </span>
                  <h3 className="text-lg font-black text-slate-900 mt-1">
                    {selectedTxDetail.receipt_number || 'TRX-UNKNOWN'}
                  </h3>
                </div>
                <button
                  onClick={() => setSelectedTxDetail(null)}
                  className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold flex items-center justify-center text-xs"
                >
                  ✕
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                  <span className="text-[9px] text-slate-400 font-bold block uppercase">Pelanggan</span>
                  <p className="font-bold text-slate-800">{selectedTxDetail.customer_name || '-'}</p>
                  <p className="text-[10px] font-mono text-slate-500">{selectedTxDetail.customer_phone || '-'}</p>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                  <span className="text-[9px] text-slate-400 font-bold block uppercase">Cabang & Tipe</span>
                  <p className="font-bold text-slate-800">{selectedTxDetail.outlets?.name || 'Cabang'}</p>
                  <p className="text-[10px] font-bold text-indigo-600">{selectedTxDetail.order_type || 'Offline'}</p>
                </div>
              </div>

              <div className="bg-indigo-50/60 p-3 rounded-2xl border border-indigo-100 space-y-2 text-xs">
                <div className="flex justify-between border-b border-indigo-100 pb-1.5">
                  <span className="font-bold text-indigo-950">Layanan:</span>
                  <span className="font-extrabold text-indigo-900">{selectedTxDetail.service_type || '-'}</span>
                </div>
                <div className="flex justify-between border-b border-indigo-100 pb-1.5">
                  <span className="font-bold text-indigo-950">Jumlah / Berat Validasi:</span>
                  <span className="font-black text-indigo-900">
                    {selectedTxDetail.weight_kg ? `${selectedTxDetail.weight_kg} Kg` : ''} 
                    {selectedTxDetail.pcs_count ? ` ${selectedTxDetail.pcs_count} Pcs` : ''}
                    {!selectedTxDetail.weight_kg && !selectedTxDetail.pcs_count ? '-' : ''}
                  </span>
                </div>
                <div>
                  <span className="font-bold text-indigo-950 block mb-0.5">📝 Catatan Khusus Cucian:</span>
                  <p className="text-[11px] text-slate-600 italic bg-white p-2 rounded-xl border border-indigo-100">
                    "{selectedTxDetail.notes || 'Tidak ada catatan'}"
                  </p>
                </div>
              </div>

              {/* TIM CREW & WAKTU PENGERJAAN */}
              <WasherBatchTimeline cycles={txWasherCycles} />
              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                <StageTimeline
                  logs={txWorkLogs}
                  transaction={selectedTxDetail}
                  title="Tim Crew & Waktu Pengerjaan"
                />
              </div>

              <div className="bg-slate-900 text-white p-3.5 rounded-2xl flex justify-between items-center text-xs">
                <div>
                  <span className="text-[9px] text-slate-400 block font-bold uppercase">Total Tagihan</span>
                  <span className="text-emerald-400 font-black text-sm">Rp {Number(selectedTxDetail.amount || 0).toLocaleString('id-ID')}</span>
                </div>
                <span className="bg-emerald-600 text-white text-[10px] font-extrabold px-3 py-1 rounded-full uppercase">
                  {selectedTxDetail.status || 'Selesai'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* NAV HEADER */}
        <div className="bg-white border border-slate-200/80 p-5 md:p-6 rounded-2xl shadow-sm hover:shadow-md transition-all flex flex-col md:flex-row justify-between items-start md:items-center gap-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-sky-600">Owner Analytics</p>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight text-slate-900 mt-0.5">
              Laundrivery ERP
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {currentUserName || 'Owner'} · <span className="font-bold text-slate-600 uppercase">{currentUserRole || '…'}</span>
            </p>
          </div>

          <div className="flex flex-col items-stretch md:items-end gap-2 w-full md:w-auto">
          <OwnerExecNav active="main" />
          <div className="flex w-full md:w-auto overflow-x-auto pb-1 md:pb-0 gap-1.5 hide-scrollbar">
            <button onClick={() => setActiveTab('pnl')} className={`whitespace-nowrap px-3.5 py-2 font-bold text-xs rounded-xl transition-all ${activeTab === 'pnl' ? 'bg-sky-500 text-white shadow-sm' : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-white'}`}>PnL</button>
            <button onClick={() => setActiveTab('history')} className={`whitespace-nowrap px-3.5 py-2 font-bold text-xs rounded-xl transition-all ${activeTab === 'history' ? 'bg-sky-500 text-white shadow-sm' : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-white'}`}>Transaksi</button>
            <button onClick={() => setActiveTab('loans')} className={`whitespace-nowrap px-3.5 py-2 font-bold text-xs rounded-xl transition-all ${activeTab === 'loans' ? 'bg-amber-500 text-white shadow-sm' : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-white'}`}>Kasbon</button>
            {isOwnerRole(currentUserRole) && (
              <Link href="/owner/kpi-settings" className="whitespace-nowrap bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-500 hover:text-white text-xs px-3.5 py-2 rounded-xl font-bold transition-all">KPI Settings</Link>
            )}
            {isManagementAdmin && (
              <>
                <button onClick={() => setActiveTab('settings')} className={`whitespace-nowrap px-3.5 py-2 font-bold text-xs rounded-xl transition-all ${activeTab === 'settings' ? 'bg-sky-500 text-white shadow-sm' : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-white'}`}>Settings</button>
                <button onClick={() => setActiveTab('employees')} className={`whitespace-nowrap px-3.5 py-2 font-bold text-xs rounded-xl transition-all ${activeTab === 'employees' ? 'bg-sky-500 text-white shadow-sm' : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-white'}`}>Karyawan</button>
              </>
            )}
            <button onClick={handleLogout} className="whitespace-nowrap bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-500 hover:text-white font-bold text-xs px-3 py-2 rounded-xl transition-all">Keluar</button>
          </div>
          </div>
        </div>

        {isOwnerRole(currentUserRole) && <FinanceAlertListener />}
        {(isOwnerRole(currentUserRole) || currentUserRole === 'supervisor') && <WasherFraudAlertListener />}

        {/* TAB 1: PNL & LEADERBOARD RANKING */}
        {activeTab === 'pnl' && (
          <div className="space-y-4 md:space-y-6">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 md:p-6 shadow-sm flex flex-col md:flex-row gap-3 md:gap-4 items-end">
              <div className="w-full md:w-1/3">
                <label className="block text-xs font-bold text-slate-500 mb-1">Filter Outlet</label>
                <select value={selectedOutlet} onChange={(e) => setSelectedOutlet(e.target.value)} className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-xs font-bold focus:outline-none focus:border-emerald-500">
                  <option value="ALL">Semua Cabang (Pusat)</option>
                  {outlets.map((o) => (<option key={o.id} value={o.id}>{o.name}</option>))}
                </select>
              </div>
              <div className="w-full md:w-1/3">
                <label className="block text-xs font-bold text-slate-500 mb-1">Periode Transaksi</label>
                <select value={period} onChange={(e) => setPeriod(e.target.value)} className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-xs font-bold focus:outline-none focus:border-emerald-500">
                  <option value="THIS_MONTH">Bulan Ini</option><option value="LAST_MONTH">Bulan Lalu</option><option value="THIS_YEAR">1 Tahun Terakhir (365 Hari)</option><option value="ALL">Semua Waktu (All Time)</option>
                </select>
              </div>
              <button onClick={exportCSV} className="w-full md:w-auto mt-auto bg-blue-600 text-white font-bold text-xs px-6 py-3 rounded-xl shadow-md">📥 EXPORT CSV</button>
            </div>

            {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4 pt-2">
            {Array.from({ length: 2 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4 pt-2">
          <MetricCard
            label="Total Omset (Gross Revenue)"
            value={`Rp ${stats.income.toLocaleString('id-ID')}`}
            hint={`Off ${stats.offlineIncome.toLocaleString('id-ID')} · On ${stats.onlineIncome.toLocaleString('id-ID')}`}
            trend={trendPct(stats.income, prevStats.income)}
            accent="sky"
          />
          <MetricCard
            label="Total Net Profit"
            value={`Rp ${stats.profit.toLocaleString('id-ID')}`}
            hint={`OPEX Rp ${stats.expense.toLocaleString('id-ID')}`}
            trend={trendPct(stats.profit, prevStats.profit)}
            accent={stats.profit >= 0 ? 'emerald' : 'rose'}
          />
        </div>
        )}

            <AICopilotCard
              scope="owner"
              outletId={selectedOutlet}
              period={period as 'THIS_MONTH' | 'LAST_MONTH' | 'THIS_YEAR' | 'ALL'}
            />

            {/* TABEL LEADERBOARD SUPERVISOR & RANKING OUTLET */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-6 pt-2">
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

              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="bg-emerald-600 text-white p-4 flex justify-between items-center">
                  <h3 className="font-black text-sm">🏆 Ranking Omset Outlet</h3>
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
            </div>

          </div>
        )}

        {/* 📜 TAB: HISTORY 1 TAHUN KE BELAKANG */}
        {activeTab === 'history' && (
          <div className="bg-white border border-slate-200 p-4 md:p-6 rounded-2xl shadow-sm space-y-4">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 border-b pb-4">
              <div>
                <h3 className="font-bold text-indigo-700 text-base">📜 History Omset & Transaksi (1 Tahun Terakhir)</h3>
                <p className="text-xs text-slate-500 mt-0.5">Klik baris <span className="font-bold text-emerald-700">TRANSACTIONS</span> untuk melihat detail tim crew pengerjaan, pcs, dan catatan.</p>
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
                    <tr 
                      key={idx} 
                      onClick={() => item.rawData && setSelectedTxDetail(item.rawData)}
                      className={`border-b border-slate-100 transition ${item.category === 'transactions' ? 'cursor-pointer hover:bg-indigo-50/70 font-semibold' : 'hover:bg-slate-50'}`}
                    >
                      <td className="p-3 font-mono text-slate-500">{new Date(item.date).toLocaleString('id-ID')}</td>
                      <td className="p-3"><span className={`px-2 py-0.5 rounded text-[9px] font-bold ${item.category === 'transactions' ? 'bg-emerald-100 text-emerald-700' : item.category === 'members' ? 'bg-purple-100 text-purple-700' : 'bg-rose-100 text-rose-700'}`}>{item.category.toUpperCase()}</span></td>
                      <td className="p-3 font-bold text-slate-800 flex items-center gap-1.5">
                        <span>{item.title}</span>
                        {item.category === 'transactions' && <span className="text-[10px] text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">🔍 Detail</span>}
                      </td>
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

        {/* TAB KHUSUS OWNER & SUPERVISOR */}
        {isManagementAdmin && (
          <>
            {activeTab === 'settings' && (
              <div className="flex flex-col gap-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Link href="/owner/settings/outlets" className="bg-white border border-sky-200 rounded-2xl p-4 shadow-sm hover:border-sky-400 transition">
                    <p className="text-sm font-black text-slate-900">Profil Outlet & Google</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">Foto, jam buka, Coming Soon, Place ID, dan rating fallback.</p>
                  </Link>
                  <Link href="/owner/machines" className="bg-white border border-cyan-200 rounded-2xl p-4 shadow-sm hover:border-cyan-400 transition">
                    <p className="text-sm font-black text-slate-900">Manajemen Mesin Cuci</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">Nama, kapasitas 15/24kg, payload, ThinQ ID. Mesin aktif dipakai POS.</p>
                  </Link>
                  <Link href="/owner/settings/promos" className="bg-white border border-amber-200 rounded-2xl p-4 shadow-sm hover:border-amber-400 transition">
                    <p className="text-sm font-black text-slate-900">Banner Promo Customer</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">Carousel pengumuman di beranda aplikasi pelanggan.</p>
                  </Link>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  
                  {/* MODUL DYNAMIC SERVICES + SEARCH & LIMIT MAX 5 */}
                  <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-4 md:p-6 shadow-sm">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-100 pb-4 mb-4 gap-3">
                      <div>
                        <h3 className="font-bold text-slate-800">⚙️ Dynamic Services</h3>
                        <p className="text-[10px] text-slate-400">Total {services.length} layanan terdaftar.</p>
                      </div>
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

                    {/* DAFTAR DENGAN BATAS 5 ITEM PERTAMA */}
                    <div className="space-y-4 max-h-[600px] overflow-y-auto pr-1">
                      {displayedServices.map((svc) => {
                        const isGlobal = settingViewOutlet === 'ALL';
                        const svcPrice = isGlobal ? svc.price : outletOverrides[settingViewOutlet]?.[svc.id]?.price ?? svc.price;
                        const svcComms = isGlobal ? svc.commissions : outletOverrides[settingViewOutlet]?.[svc.id]?.commissions || svc.commissions;
                        return (
                          <div key={svc.id} className={'border rounded-xl p-3 md:p-4 ' + (isGlobal ? 'bg-slate-50 border-slate-200' : 'bg-indigo-50/30 border-indigo-200')}>
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
                                <div><span className="text-[8px] md:text-[10px] text-slate-500 block">Dikemas</span><input type="number" value={svcComms?.packing ?? 0} onChange={(e) => updateCommission(svc.id, 'packing', Number(e.target.value))} className="w-full border rounded p-1 text-xs text-center" /></div>
                              </div>
                            </div>
                            {isGlobal && (<button onClick={() => handleRemoveService(svc.id)} className="w-full mt-2 bg-rose-50 text-rose-600 text-xs py-1 rounded font-bold">Hapus Layanan</button>)}
                          </div>
                        );
                      })}

                      {/* TOMBOL TOGGLE TAMPILKAN SEMUA LAYANAN */}
                      {serviceSearch.trim() === '' && filteredServices.length > 5 && (
                        <button
                          type="button"
                          onClick={() => setShowAllServices(!showAllServices)}
                          className="w-full py-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-2xl border border-indigo-200 transition shadow-sm"
                        >
                          {showAllServices 
                            ? '🔼 Sembunyikan Layanan Lanjutan' 
                            : `🔽 Tampilkan Semua Layanan (${filteredServices.length} Layanan)`}
                        </button>
                      )}

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
                      <div>
                        <label className="text-[10px] font-bold text-emerald-900 block mb-1">Mayar API Key (QRIS)</label>
                        <input type="password" placeholder="Kosongkan = mode mock hingga KYC aktif" value={newOutletMayarKey} onChange={(e) => setNewOutletMayarKey(e.target.value)} className="w-full border border-emerald-300 rounded-xl p-2.5 text-xs font-mono text-slate-800 bg-white" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-emerald-900 block mb-1">Mayar Payout Account ID</label>
                        <input type="text" placeholder="ID rekening pencairan Mayar" value={newOutletMayarPayout} onChange={(e) => setNewOutletMayarPayout(e.target.value)} className="w-full border border-emerald-300 rounded-xl p-2.5 text-xs font-mono text-slate-800 bg-white" />
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

                    {/* SUPERVISOR CABANG (DENGAN CARI & LIST SCROLLABLE KOMPAK 100+ OUTLET) */}
                    <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 md:p-6 shadow-sm space-y-3">
                      <div>
                        <h3 className="font-black text-indigo-800 text-sm">👔 Supervisor Cabang</h3>
                        <p className="text-[10px] text-slate-500 mt-0.5">Tentukan SPV penanggung jawab tiap cabang untuk data Leaderboard.</p>
                      </div>

                      <input
                        type="text"
                        placeholder="🔍 Cari nama outlet cabang..."
                        value={supervisorSearch}
                        onChange={(e) => setSupervisorSearch(e.target.value)}
                        className="w-full border border-indigo-200 rounded-xl px-3 py-2 text-xs bg-white focus:outline-none focus:border-indigo-500 font-bold shadow-sm"
                      />

                      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                        {outlets
                          .filter(o => (o.name || '').toLowerCase().includes(supervisorSearch.toLowerCase()))
                          .map((o) => (
                            <div key={o.id} className="flex justify-between items-center bg-white p-2.5 rounded-xl border border-indigo-100 shadow-sm gap-2">
                              <span className="text-xs font-bold text-slate-800 truncate w-1/2">{o.name}</span>
                              <select 
                                value={supervisorMapping[o.id] || ''} 
                                onChange={(e) => setSupervisorMapping({ ...supervisorMapping, [o.id]: e.target.value })} 
                                className="w-1/2 border border-slate-200 rounded-lg text-[10px] p-1.5 text-indigo-700 font-bold bg-slate-50 focus:outline-none cursor-pointer"
                              >
                                <option value="">-- Tanpa SPV --</option>
                                {employees.filter((e) => e.role === 'supervisor' || e.role === 'owner').map((emp) => (
                                  <option key={emp.id} value={emp.name}>{emp.name}</option>
                                ))}
                              </select>
                            </div>
                          ))}
                        {outlets.filter(o => (o.name || '').toLowerCase().includes(supervisorSearch.toLowerCase())).length === 0 && (
                          <p className="text-[10px] text-slate-400 text-center py-4 font-medium">Outlet tidak ditemukan.</p>
                        )}
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

            {/* TAB KARYAWAN & ABSENSI (TERMASUK ROLE DRIVER, CS, DAN INVESTOR MULTI-OUTLET) */}
            {activeTab === 'employees' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <form onSubmit={handleAddEmployee} className="bg-white p-4 md:p-6 rounded-2xl border space-y-4">
                  <h3 className="font-bold text-sm border-b pb-2">👤 Buat Akun / Karyawan Baru</h3>
                  <input type="text" placeholder="Nama Lengkap" value={newEmpName} onChange={(e) => setNewEmpName(e.target.value)} className="w-full border rounded-xl px-3 py-2 text-sm" required />
                  <div className="bg-purple-50 p-3 rounded-xl border border-purple-100 space-y-2">
                    <input type="text" placeholder="Username Login" value={newEmpUsername} onChange={(e) => setNewEmpUsername(e.target.value.toLowerCase().replace(/\s/g, ''))} className="w-full border rounded-lg px-3 py-2 text-sm" required />
                    <input type="text" placeholder="Password Login" value={newEmpPassword} onChange={(e) => setNewEmpPassword(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" required />
                    
                    <select value={newEmpRole} onChange={(e) => setNewEmpRole(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-xs font-bold text-purple-900 bg-white">
                      {staffRolesForForm(currentUserRole === 'owner').map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* JIKA INVESTOR: TAMPILKAN CHECKBOX MULTI-OUTLET */}
                  {newEmpRole === 'investor' ? (
                    <div className="border border-indigo-200 bg-indigo-50 p-3 rounded-xl space-y-2">
                      <p className="text-[10px] font-bold text-indigo-900">✅ Beri Akses Cabang Ke Investor Ini:</p>
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {outlets.map(o => (
                          <label key={o.id} className="flex items-center gap-2 text-xs text-indigo-800 font-medium bg-white p-2 rounded border border-indigo-100 cursor-pointer">
                            <input 
                              type="checkbox" 
                              checked={newEmpAccessOutlets.includes(o.id)} 
                              onChange={() => handleToggleInvestorOutlet(o.id)} 
                              className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500" 
                            />
                            {o.name}
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <select value={newEmpOutlet} onChange={(e) => setNewEmpOutlet(e.target.value)} className="w-full border rounded-xl px-3 py-2 text-sm">
                      <option value="ALL">🌐 Semua Cabang (Pusat)</option>
                      {outlets.map((o) => (<option key={o.id} value={o.id}>{o.name}</option>))}
                    </select>
                  )}

                  {newEmpRole !== 'investor' && (
                    <input type="number" placeholder="Gaji Pokok" value={newEmpSalary} onChange={(e) => setNewEmpSalary(e.target.value)} className="w-full border rounded-xl px-3 py-2 text-sm text-emerald-600 font-bold" />
                  )}

                  <button type="submit" disabled={isSaving} className="w-full bg-purple-600 text-white font-bold py-3 rounded-xl text-sm shadow">➕ BUAT AKUN</button>
                </form>

                <div className="lg:col-span-2 space-y-6">
                  {/* TABEL DAFTAR KARYAWAN / USER */}
                  <div className="bg-white p-4 md:p-6 rounded-2xl border overflow-x-auto">
                    <h3 className="font-bold text-slate-800 text-sm mb-4 border-b pb-2">📋 Daftar Pengguna Sistem & Karyawan</h3>
                    <table className="w-full text-left text-[10px] md:text-xs whitespace-nowrap">
                      <thead className="bg-slate-50 border-b"><tr><th className="p-3">Info Karyawan</th><th className="p-3">Role / Peran</th><th className="p-3">Penempatan Cabang</th><th className="p-3 text-right">Aksi</th></tr></thead>
                      <tbody>
                        {employees.map((emp) => {
                          let invCount = 0;
                          if (emp.role === 'investor' && emp.access_outlets) {
                            try { invCount = typeof emp.access_outlets === 'string' ? JSON.parse(emp.access_outlets).length : emp.access_outlets.length; } catch(e){}
                          }

                          return (
                            <tr key={emp.id} className="border-b hover:bg-slate-50">
                              <td className="p-3"><b className="text-slate-800 text-xs">{emp.name}</b><br /><span className="text-[9px] text-purple-600 font-mono">@{emp.username}</span></td>
                              <td className="p-3 uppercase text-[10px] font-black text-slate-600">{emp.role}</td>
                              <td className="p-3">
                                {emp.role === 'investor' ? (
                                  <span className="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-[10px] font-bold">👔 {invCount} Cabang</span>
                                ) : (
                                  <span className="text-slate-600 text-[10px] font-medium">{emp.outlets?.name || 'Pusat/Global'}</span>
                                )}
                              </td>
                              <td className="p-3 text-right flex gap-1 justify-end">
  <button 
    onClick={() => {
      setEditingEmp(emp);
      setEditEmpRole(emp.role);
      setEditEmpOutlet(emp.outlet_id || 'ALL');
      setEditEmpPassword('');
    }} 
    className="bg-indigo-100 text-indigo-700 hover:bg-indigo-200 px-2.5 py-1 rounded text-[10px] font-bold transition"
  >
    ✏️ Edit
  </button>
  <button 
    onClick={() => handleDeleteEmployee(emp.id)} 
    className="bg-rose-100 text-rose-600 hover:bg-rose-200 px-2.5 py-1 rounded text-[10px] font-bold transition"
  >
    Hapus
  </button>
</td>
                            </tr>
                          );
                        })}
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
                {deleteRequests.length === 0 && (
                  <p className="text-xs text-slate-400 text-center py-6 font-medium">Tidak ada permintaan hapus transaksi saat ini.</p>
                )}
              </div>
            )}
          </>
        )}

        {editingEmp && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <form onSubmit={handleSaveEditEmployee} className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-3 shadow-xl">
              <p className="text-sm font-black">Edit {editingEmp.name}</p>
              <select value={editEmpRole} onChange={(e) => setEditEmpRole(e.target.value)} className="w-full border rounded-xl px-3 py-2 text-xs font-bold">
                {staffRolesForForm(currentUserRole === 'owner').map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              <select value={editEmpOutlet} onChange={(e) => setEditEmpOutlet(e.target.value)} className="w-full border rounded-xl px-3 py-2 text-xs">
                <option value="ALL">🌐 Semua Cabang (Pusat)</option>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Password baru (opsional)"
                value={editEmpPassword}
                onChange={(e) => setEditEmpPassword(e.target.value)}
                className="w-full border rounded-xl px-3 py-2 text-xs"
              />
              <div className="flex gap-2">
                <button type="button" onClick={() => setEditingEmp(null)} className="flex-1 border rounded-xl py-2 text-xs font-bold">Batal</button>
                <button type="submit" disabled={isSaving} className="flex-1 bg-indigo-600 text-white rounded-xl py-2 text-xs font-bold">Simpan</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}