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

const cleanPhone = (phoneStr: string) => {
  if (!phoneStr) return '';
  let cleaned = phoneStr.trim().replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = '62' + cleaned.slice(1);
  return cleaned;
};

const getDistanceInMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371000;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const getStageKey = (stageStr: string) => {
  const s = (stageStr || '').toLowerCase();
  if (s.includes('sortir')) return 'sortir';
  if (s.includes('cuci') || s.includes('mencuci')) return 'cuci';
  if (s.includes('kering') || s.includes('pengeringan')) return 'kering';
  if (s.includes('setrika') || s.includes('gosok')) return 'setrika';
  if (s.includes('pack') || s.includes('packing')) return 'packing';
  return s;
};

const getEstDate = (createdDateStr: string, durationStr: string) => {
  const d = createdDateStr ? new Date(createdDateStr) : new Date();
  const dur = (durationStr || '').toLowerCase();
  
  if (dur.includes('3 jam') || dur.includes('quick')) {
    d.setHours(d.getHours() + 3);
  } else if (dur.includes('6 jam') || dur.includes('express')) {
    d.setHours(d.getHours() + 6);
  } else if (dur.includes('1 hari') || dur.includes('oneday') || dur.includes('24 jam')) {
    d.setDate(d.getDate() + 1);
  } else {
    d.setDate(d.getDate() + 3);
  }
  
  return d.toLocaleString('id-ID', { 
    day: 'numeric', 
    month: 'numeric', 
    year: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit' 
  });
};

export default function POSPage() {
  const [activeTab, setActiveTab] = useState<'pos' | 'workflow' | 'pickup' | 'member' | 'expense' | 'performance'>('pos');

  const [employeeId, setEmployeeId] = useState('');
  const [employeeName, setEmployeeName] = useState('Memuat...');
  const [employeeUsername, setEmployeeUsername] = useState('');
  const [employeeRole, setEmployeeRole] = useState('');
  const [empBasicSalary, setEmpBasicSalary] = useState(1500000);
  
  const [outletsList, setOutletsList] = useState<any[]>([]);
  const [selectedOutlet, setSelectedOutlet] = useState('');
  const [isMultiOutletUser, setIsMultiOutletUser] = useState(false);
  const [outletName, setOutletName] = useState('Memuat Outlet...');
  const [outletPhone, setOutletPhone] = useState('');
  
  const [tenureMonths, setTenureMonths] = useState(6);
  const [services, setServices] = useState<any[]>([]);
  const [outletOverrides, setOutletOverrides] = useState<any>({});
  const [receiptTerms, setReceiptTerms] = useState('');
  const [settings, setSettings] = useState<any>(null);
// State Fitur Setoran Cash via Digital Wallet & QRIS Meja Kasir
const [showDepositModal, setShowDepositModal] = useState(false);
const [depositAmount, setDepositAmount] = useState('');
const [depositMethod, setDepositMethod] = useState<'INDOMARET_ALFAMART' | 'MBANKING_PERSONAL'>('INDOMARET_ALFAMART');
const [adminFee, setAdminFee] = useState('');
const [proofUrl, setProofUrl] = useState('');

// Handler Submit Setoran Kasir
const handleSubmitDeposit = async () => {
  const amount = parseFloat(depositAmount) || 0;
  const fee = depositMethod === 'INDOMARET_ALFAMART' ? (parseFloat(adminFee) || 0) : 0;

  if (amount <= 0) return alert('⚠️ Masukkan nominal setoran cash yang valid!');

  const { error: depositErr } = await supabase.from('cash_deposits').insert([
    {
      outlet_id: selectedOutlet,
      cashier_id: employeeId || '00000000-0000-0000-0000-000000000000',
      amount_cash: amount,
      admin_fee: fee,
      deposit_method: depositMethod,
      qr_payment_status: 'pending',
      proof_url: proofUrl || 'Setor via QRIS Meja Kasir'
    }
  ]);

  if (depositErr) return alert('❌ Gagal menyimpan setoran: ' + depositErr.message);

  if (fee > 0) {
    await supabase.from('expenses').insert([
      {
        outlet_id: selectedOutlet,
        amount: fee,
        notes: `Biaya Admin Top-Up Setoran Cash (${depositMethod})`,
        category: 'Biaya Admin'
      }
    ]);
  }

  alert('✅ Setoran berhasil diajukan! Finance akan memverifikasi mutasi masuk pada QRIS.');
  setShowDepositModal(false);
  setDepositAmount('');
  setAdminFee('');
  setProofUrl('');
};
// State Kasbon Terintegrasi (Limit 60% Hari Kerja & Surat Piutang)
const [loanAmount, setLoanAmount] = useState('');
const [loanReason, setLoanReason] = useState('');
const [isSpecialLoan, setIsSpecialLoan] = useState(false);
const [piutangDocNo, setPiutangDocNo] = useState('');

const [incidentTitle, setIncidentTitle] = useState('');
const [incidentDesc, setIncidentDesc] = useState('');
const [coaList, setCoaList] = useState<any[]>([]);

// Hitung Limit Kasbon Otomatis berbasis Hari Kerja (26 Hari / Bulan & 60% Cap)
const daysWorked = 10; // Default fallback akumulasi hari masuk kerja bulan berjalan
const dailySalary = (empBasicSalary || 1300000) / 26;
const accumulatedSalary = dailySalary * daysWorked;
const maxAutoLoan = Math.floor(accumulatedSalary * 0.6);
// Load Master COA dari Supabase
useEffect(() => {
  const fetchCoa = async () => {
    const { data } = await supabase.from('chart_of_accounts').select('*');
    if (data) setCoaList(data);
  };
  fetchCoa();
}, []);

// Handler Pengajuan Kasbon Karyawan (Dengan Validasi 60% & Surat Piutang)
const handleApplyLoan = async (e: React.FormEvent) => {
  e.preventDefault();
  const amount = parseFloat(loanAmount) || 0;
  if (amount <= 0 || !loanReason.trim()) return alert('⚠️ Lengkapi nominal dan alasan kasbon!');

  if (amount > maxAutoLoan && !isSpecialLoan) {
    return alert(
      `⚠️ Nominal melebihi limit otomatis Anda (Maks: Rp ${maxAutoLoan.toLocaleString('id-ID')} berdasarkan ${daysWorked || 10} hari kerja).\n\nCentang 'Kasbon Khusus / Darurat' dan masukkan Nomor Surat Piutang yang disetujui SPV.`
    );
  }

  if (isSpecialLoan && !piutangDocNo.trim()) {
    return alert('⚠️ Wajib memasukkan Nomor Surat Piutang SPV untuk kasbon di atas limit!');
  }

  const { error } = await supabase.from('employee_loans').insert([
    {
      employee_id: employeeId || '00000000-0000-0000-0000-000000000000',
      outlet_id: selectedOutlet,
      amount: amount,
      reason: loanReason.trim(),
      status: 'pending',
      is_special_loan: isSpecialLoan,
      piutang_doc_number: isSpecialLoan ? piutangDocNo.trim() : null,
      max_allowed_at_submission: maxAutoLoan
    }
  ]);

  if (!error) {
    alert('✅ Pengajuan kasbon dikirim! Menunggu verifikasi dari Supervisor/Owner.');
    setLoanAmount('');
    setLoanReason('');
    setIsSpecialLoan(false);
    setPiutangDocNo('');
  } else {
    alert('❌ Gagal mengajukan kasbon: ' + error.message);
  }
};

// Handler Pengaduan Kendala Outlet ke Supervisor
const handleReportIncident = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!incidentTitle.trim() || !incidentDesc.trim()) return alert('⚠️ Lengkapi judul dan deskripsi kendala!');

  const { error } = await supabase.from('supervisor_incidents').insert([
    {
      outlet_id: selectedOutlet,
      reporter_id: employeeId || '00000000-0000-0000-0000-000000000000',
      supervisor_id: '00000000-0000-0000-0000-000000000000',
      title: incidentTitle.trim(),
      description: incidentDesc.trim(),
      resolution_status: 'open'
    }
  ]);

  if (!error) {
    alert('🚨 Kendala berhasil dilaporkan ke Supervisor!');
    setIncidentTitle('');
    setIncidentDesc('');
  } else {
    alert('❌ Gagal melaporkan kendala: ' + error.message);
  }
};
  // Form Transaksi Baru
  const [orderType, setOrderType] = useState('Offline');
  const [deliveryFee, setDeliveryFee] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerDeposit, setCustomerDeposit] = useState<number | null>(null);
  const [customerHistory, setCustomerHistory] = useState<any[]>([]);
  
  const [serviceType, setServiceType] = useState('');
  const [duration, setDuration] = useState('Reguler (3 Hari)');
  const [weightKg, setWeightKg] = useState('');
  const [pcsCount, setPcsCount] = useState('');

  // STATE KERANJANG MULTI-ITEM BARU
  const [cartItems, setCartItems] = useState<Array<{ id: string; name: string; type: 'kg' | 'pcs'; basePrice: number; price: number; qty: number; note: string }>>([]);
  const [selectedServiceInput, setSelectedServiceInput] = useState('');
  const [inputQtyKg, setInputQtyKg] = useState('');
  const [inputQtyPcs, setInputQtyPcs] = useState('');
  const [inputItemNote, setInputItemNote] = useState('');

  const [discountType, setDiscountType] = useState<'nominal' | 'percent'>('nominal');
  const [discountValue, setDiscountValue] = useState('');
  const [calculatedDiscount, setCalculatedDiscount] = useState(0);

  const [notes, setNotes] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('QRIS');

  // SPLIT PAYMENT STATES
  const [splitMethod1, setSplitMethod1] = useState('Deposit Saldo');
  const [splitAmount1, setSplitAmount1] = useState('');
  const [splitMethod2, setSplitMethod2] = useState('Cash');

  // Form Member
  const [memberPhone, setMemberPhone] = useState('');
  const [memberName, setMemberName] = useState('');
  const [memberPackage, setMemberPackage] = useState('Silver');
  const [memberOrderType, setMemberOrderType] = useState<'Offline' | 'Online'>('Offline');
// AUTO-FILL POS FORM DARI URL QUERY PARAMS (ANTREAN PENJEMPUTAN)
useEffect(() => {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const name = params.get('name');
  const phone = params.get('phone');
  const service = params.get('service');
  const deliveryFeeParam = params.get('delivery_fee');
  const orderTypeParam = params.get('order_type');

  if (name && typeof setCustomerName === 'function') setCustomerName(name);
  if (phone && typeof setCustomerPhone === 'function') setCustomerPhone(phone);

  // 🌐 PAKSA MODE ONLINE / WHATSAPP: Agar masuk statistik Omset Online di PnL Owner
  if (typeof setOrderType === 'function') {
    setOrderType(orderTypeParam || 'WhatsApp');
  }

  // 🚚 Auto-fill Biaya Ongkir ke Input Ongkir POS
  if (deliveryFeeParam && typeof setDeliveryFee === 'function') {
    setDeliveryFee(deliveryFeeParam.toString());
  }

  // 🛒 Auto-fill Layanan Langsung Masuk ke Input Layanan POS
  if (service && typeof setSelectedServiceInput === 'function') {
    setSelectedServiceInput(service);
  }
}, []);
  const [expCategory, setExpCategory] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expDesc, setExpDesc] = useState('');
  const [stockItem, setStockItem] = useState('Detergen Premium (ml)');
  const [stockAddAmount, setStockAddAmount] = useState('');

  // Modal & Print
  const [showRackModal, setShowRackModal] = useState(false);
  const [selectedOrderForRack, setSelectedOrderForRack] = useState<any>(null);
  const [rackInput, setRackInput] = useState('');
  const [bagInput, setBagInput] = useState('');
  const [printMode, setPrintMode] = useState<'receipt'|'payslip'>('receipt');

  // MODAL DETAIL TRANSAKSI & FORM EDIT KASIR
  const [selectedTxDetail, setSelectedTxDetail] = useState<any>(null);
  const [createdTxSuccess, setCreatedTxSuccess] = useState<any>(null);
  const [txWorkLogs, setTxWorkLogs] = useState<any[]>([]);

  // STATES FORM EDIT DALAM MODAL
  const [editCustomerName, setEditCustomerName] = useState('');
  const [editCustomerPhone, setEditCustomerPhone] = useState('');
  const [editServiceType, setEditServiceType] = useState('');
  const [editDuration, setEditDuration] = useState('Reguler (3 Hari)');
  const [editWeightKg, setEditWeightKg] = useState('');
  const [editPcsCount, setEditPcsCount] = useState('');
  const [editDeliveryFee, setEditDeliveryFee] = useState('');
  const [editSatuanFee, setEditSatuanFee] = useState('0');
  const [editNotes, setEditNotes] = useState('');
  const [editAmount, setEditAmount] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [lastOrderInfo, setLastOrderInfo] = useState<any>(null);

  const [activeOrders, setActiveOrders] = useState<any[]>([]);
  const [pickupOrders, setPickupOrders] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const [incomingPickupsCount, setIncomingPickupsCount] = useState(0);

  // Payroll & Attendance States
  const [empLoansDeduction, setEmpLoansDeduction] = useState(0);
  const [empPenaltiesDeduction, setEmpPenaltiesDeduction] = useState(0);
  const [todayAttendance, setTodayAttendance] = useState<any>(null);

  const [calcStats, setCalculatedStats] = useState({ totalKg: 0, totalPcs: 0, productionPay: 0, membershipBonus: 0 });
  const [todayStats, setTodayStats] = useState({ kg: 0, pcs: 0, pay: 0 });
  
  const [todayBreakdown, setTodayBreakdown] = useState<Record<string, { kg: number; pcs: number }>>({
    sortir: { kg: 0, pcs: 0 },
    cuci: { kg: 0, pcs: 0 },
    kering: { kg: 0, pcs: 0 },
    setrika: { kg: 0, pcs: 0 },
    packing: { kg: 0, pcs: 0 },
  });

  const [monthlyRevenue, setMonthlyRevenue] = useState(0);

  // TAMBAH ITEM KE KERANJANG
  const handleAddToCart = () => {
    const targetService = selectedServiceInput || serviceType;
    if (!targetService) return alert('⚠️ Pilih jenis layanan terlebih dahulu!');

    const activeSvc = services.find(
      (s) => (s.name || '').trim().toLowerCase() === targetService.trim().toLowerCase()
    );

    let basePrice = 0;
    if (activeSvc) {
      const localPrice = outletOverrides?.[selectedOutlet]?.[activeSvc.id]?.price;
      basePrice = localPrice !== undefined ? Number(localPrice) : Number(activeSvc.price || 0);
    } else {
      const sName = targetService.toLowerCase();
      if (sName.includes('bedcover double')) basePrice = 35000;
      else if (sName.includes('bedcover single')) basePrice = 25000;
      else if (sName.includes('sprei')) basePrice = 15000;
      else if (sName.includes('setrika')) basePrice = 5000;
      else basePrice = 7000;
    }

    let durationMultiplier = 1.0;
    if (duration.includes('Oneday') || duration.includes('1 Hari')) durationMultiplier = 1.5;
    if (duration.includes('Express') || duration.includes('6 Jam')) durationMultiplier = 2.0;
    if (duration.includes('Quick') || duration.includes('3 Jam')) durationMultiplier = 3.0;

    const finalUnitPrice = Math.round(basePrice * durationMultiplier);

    const isPcs = activeSvc ? activeSvc.type === 'pcs' : (Number(inputQtyPcs) > 0 || Number(pcsCount) > 0);
    const qty = isPcs 
      ? (Number(inputQtyPcs) || Number(pcsCount) || 1) 
      : (Number(inputQtyKg) || Number(weightKg) || 1);

    const newItem = {
      id: Math.random().toString(),
      name: targetService,
      type: isPcs ? ('pcs' as const) : ('kg' as const),
      basePrice: basePrice,
      price: finalUnitPrice,
      qty: qty,
      note: inputItemNote
    };

    setCartItems(prev => [...prev, newItem]);
    setInputQtyKg('');
    setInputQtyPcs('');
    setWeightKg('');
    setPcsCount('');
    setInputItemNote('');
  };

  const handleRemoveFromCart = (id: string) => {
    setCartItems(cartItems.filter(item => item.id !== id));
  };
  // FITUR C: TARIK DATA PENJEMPUTAN DRIVER LANGSUNG KE FORM POS
  const handleImportPickupOrder = (pickup: any) => {
    setCustomerName(pickup.customer_name || 'Pelanggan Online');
    setCustomerPhone(pickup.customer_phone || pickup.phone_number || '');
    setOrderType('Online');
    setServiceType(pickup.service_type || 'Cuci Kering Gosok');
    setWeightKg(pickup.estimated_weight ? String(pickup.estimated_weight) : '3');
    setDeliveryFee(pickup.delivery_fee ? String(pickup.delivery_fee) : '0');
    setNotes(pickup.notes || '');
    setActiveTab('pos');
    alert('✅ Data penjemputan driver berhasil ditarik ke Form POS!');
  };

  const handleOpenDetailModal = async (tx: any) => {
    setSelectedTxDetail(tx);
    setOrderType('Online');

    const phoneVal = tx.customer_phone || tx.phone_number || '';
    let realName = tx.customer_name;

    if (phoneVal && (!realName || realName === 'Pelanggan' || realName === phoneVal)) {
      const { data: custData } = await supabase
        .from('customers')
        .select('name')
        .eq('phone', cleanPhone(phoneVal))
        .limit(1);

      if (custData && custData.length > 0 && custData[0].name) {
        realName = custData[0].name;
      }
    }

    setEditCustomerName(realName && realName !== 'Pelanggan' ? realName : 'Pelanggan Online');
    setEditCustomerPhone(phoneVal);
    setEditServiceType(tx.service_type || (services[0]?.name || 'Cuci Kering Gosok'));
    setEditDuration(tx.duration || 'Reguler (3 Hari)');
    setEditWeightKg(tx.weight_kg !== undefined && tx.weight_kg !== null ? String(tx.weight_kg) : '3');
    setEditPcsCount(tx.pcs_count !== undefined && tx.pcs_count !== null ? String(tx.pcs_count) : '0');
    setEditDeliveryFee(tx.delivery_fee !== undefined && tx.delivery_fee !== null ? String(tx.delivery_fee) : '0');
    setEditSatuanFee('0');
    setEditNotes(tx.notes || tx.service_detail || '');

    const basePrice = 7000;
    const kg = Number(tx.weight_kg) > 0 ? Number(tx.weight_kg) : 3;
    const fee = Number(tx.delivery_fee) || 0;
    const computedAmt = (kg * basePrice) + fee;

    setEditAmount(tx.amount && Number(tx.amount) > 0 ? String(tx.amount) : String(computedAmt));
  };

  useEffect(() => {
    if (!selectedTxDetail) return;

    const activeSvc = services.find(
      (s) => (s.name || '').trim().toLowerCase() === editServiceType.trim().toLowerCase()
    );

    let unitPrice = 0;
    if (activeSvc) {
      const localPrice = outletOverrides?.[selectedOutlet]?.[activeSvc.id]?.price;
      unitPrice = localPrice !== undefined ? Number(localPrice) : Number(activeSvc.price || 0);
    } else {
      unitPrice = editServiceType.includes('Setrika') ? 5000 : 7000;
    }

    let durationMultiplier = 1.0;
    if (editDuration.includes('Oneday') || editDuration.includes('1 Hari')) durationMultiplier = 1.5;
    if (editDuration.includes('Express') || editDuration.includes('6 Jam')) durationMultiplier = 2.0;
    if (editDuration.includes('Quick') || editDuration.includes('3 Jam')) durationMultiplier = 3.0;

    let qty = activeSvc && activeSvc.type === 'pcs' ? Number(editPcsCount) || 0 : Number(editWeightKg) || 0;
    
    const kiloanSubtotal = Math.round(unitPrice * qty * durationMultiplier);
    const ongkir = Number(editDeliveryFee) || 0;
    const biayaSatuan = Number(editSatuanFee) || 0;

    const grandTotal = kiloanSubtotal + ongkir + biayaSatuan;
    setEditAmount(grandTotal.toString());
  }, [editServiceType, editDuration, editWeightKg, editPcsCount, editDeliveryFee, editSatuanFee]);

  // KALKULASI OTOMATIS REALTIME FORM UTAMA POS
  useEffect(() => {
    let durationMultiplier = 1.0;
    if (duration.includes('Oneday') || duration.includes('1 Hari')) durationMultiplier = 1.5;
    if (duration.includes('Express') || duration.includes('6 Jam')) durationMultiplier = 2.0;
    if (duration.includes('Quick') || duration.includes('3 Jam')) durationMultiplier = 3.0;

    let totalSubtotal = 0;

    if (cartItems.length > 0) {
      cartItems.forEach(item => {
        const itemBasePrice = item.basePrice || item.price;
        const currentUnitPrice = Math.round(itemBasePrice * durationMultiplier);
        totalSubtotal += currentUnitPrice * item.qty;
      });
    } else {
      const targetSvcName = selectedServiceInput || serviceType;
      const activeSvc = services.find(
        (s) => (s.name || '').trim().toLowerCase() === (targetSvcName || '').trim().toLowerCase()
      );

      let baseUnitPrice = 0;
      if (activeSvc) {
        const localPrice = outletOverrides?.[selectedOutlet]?.[activeSvc.id]?.price;
        baseUnitPrice = localPrice !== undefined ? Number(localPrice) : Number(activeSvc.price || 0);
      } else {
        const sName = (targetSvcName || '').toLowerCase();
        if (sName.includes('bedcover double')) baseUnitPrice = 35000;
        else if (sName.includes('bedcover single')) baseUnitPrice = 25000;
        else if (sName.includes('setrika')) baseUnitPrice = 5000;
        else baseUnitPrice = 7000;
      }

      const qtyPcs = Number(pcsCount) || Number(inputQtyPcs) || 0;
      const qtyKg = Number(weightKg) || Number(inputQtyKg) || 0;
      let qty = (activeSvc && activeSvc.type === 'pcs') ? qtyPcs : (qtyPcs > 0 && qtyKg === 0 ? qtyPcs : qtyKg);

      totalSubtotal = Math.round(baseUnitPrice * qty * durationMultiplier);
    }

    let discVal = Number(discountValue) || 0;
    let computedDiscount = 0;
    if (discountType === 'percent') {
      computedDiscount = Math.round((totalSubtotal * discVal) / 100);
    } else {
      computedDiscount = discVal;
    }
    setCalculatedDiscount(computedDiscount);

    const feeOngkir = Number(deliveryFee) || 0;
    const grandTotal = Math.max(0, totalSubtotal - computedDiscount + feeOngkir);

    setAmount(grandTotal > 0 ? grandTotal.toString() : '');
  }, [cartItems, duration, serviceType, selectedServiceInput, weightKg, pcsCount, inputQtyKg, inputQtyPcs, discountType, discountValue, deliveryFee, selectedOutlet, services]);

  useEffect(() => {
    if (selectedTxDetail?.id) {
      supabase.from('work_logs')
        .select('*')
        .eq('transaction_id', selectedTxDetail.id)
        .order('created_at', { ascending: true })
        .then(({ data }) => {
          if (data) setTxWorkLogs(data);
        });
    } else {
      setTxWorkLogs([]);
    }
  }, [selectedTxDetail]);

  const getStaffForStage = (stageName: string) => {
    if (!selectedTxDetail) return '-';
    const key = 'by_' + stageName;
    if (selectedTxDetail[key]) return selectedTxDetail[key];
    const match = [...txWorkLogs].reverse().find(w => getStageKey(w.stage) === stageName);
    if (match) return match.employee_name;
    return '-';
  };

  useEffect(() => {
    async function loadInit() {
      const { data: dbOutlets } = await supabase.from('outlets').select('*');
      if (dbOutlets && dbOutlets.length > 0) setOutletsList(dbOutlets);

      const userStr = localStorage.getItem('laundry_user');
      if (userStr) {
        const user = JSON.parse(userStr);
        setEmployeeId(user.id); setEmployeeName(user.name); setEmployeeUsername(user.username); setEmployeeRole(user.role || 'Kasir'); setEmpBasicSalary(Number(user.basic_salary) || 1500000);

        if (user.created_at) {
          const createdAt = new Date(user.created_at);
          const now = new Date();
          const monthsDiff = (now.getFullYear() - createdAt.getFullYear()) * 12 + (now.getMonth() - createdAt.getMonth());
          setTenureMonths(Math.max(1, monthsDiff || 1));
        }

        if (!user.outlet_id || user.outlet_id === 'ALL') {
          setIsMultiOutletUser(true);
          if (dbOutlets && dbOutlets.length > 0) { 
            setSelectedOutlet(dbOutlets[0].id); 
            setOutletName(dbOutlets[0].name); 
            setOutletPhone(dbOutlets[0].whatsapp_number || '');
          }
        } else {
          setSelectedOutlet(user.outlet_id); 
          setOutletName(user.outlets?.name || 'Cabang Outlet');
          setOutletPhone(user.outlets?.whatsapp_number || '');
        }
      } else { window.location.href = '/login'; return; }

      const { data: dbSettings } = await supabase.from('app_settings').select('*').eq('id', 1).single();
      if (dbSettings) {
        const svcs = safeParse(dbSettings.dynamic_services, []);
        setServices(svcs); 
        if (svcs.length > 0) {
          setServiceType(svcs[0].name);
          setSelectedServiceInput(svcs[0].name);
        }
        setOutletOverrides(safeParse(dbSettings.outlet_overrides, {}));
        setReceiptTerms(dbSettings.receipt_terms || 'Komplain maksimal 1x24 jam.');
        const coas = safeParse(dbSettings.coa_categories, ['Lain-lain']); setSettings({ coas }); if (coas.length > 0) setExpCategory(coas[0]);
      }
    }
    loadInit();
  }, []);

  useEffect(() => {
    if (!selectedOutlet) return;

    const subscription = supabase
      .channel('pos_realtime_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pickup_orders' }, (payload) => {
        try {
          const audio = new Audio('/notification.mp3');
          audio.play().catch(() => {});
        } catch (e) {}
        alert(`🔔 ORDERAN ONLINE BARU MASUK!\nService: ${(payload.new as any)?.service_type || 'Penjemputan Customer'}`);
        refreshData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => {
        refreshData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [selectedOutlet]);

  useEffect(() => {
    async function checkCustDeposit() {
      const normalizedPhone = cleanPhone(customerPhone);
      if (!normalizedPhone || normalizedPhone.length < 8) {
        setCustomerDeposit(null); setCustomerHistory([]); return;
      }
      const { data: custData } = await supabase.from('customers').select('name, deposit_balance').eq('phone', normalizedPhone).limit(1);
      let foundName = ''; let currentDeposit = 0;
      if (custData && custData.length > 0) {
        currentDeposit = Number(custData[0].deposit_balance) || 0;
        foundName = custData[0].name || '';
        setCustomerDeposit(currentDeposit);
        if (foundName) setCustomerName(foundName);
      } else {
        const { data: memLogs } = await supabase.from('membership_logs').select('balance_added').eq('customer_phone', normalizedPhone);
        if (memLogs && memLogs.length > 0) {
          const totalFromLogs = memLogs.reduce((acc, curr) => acc + (Number(curr.balance_added) || 0), 0);
          setCustomerDeposit(totalFromLogs);
        } else setCustomerDeposit(0);
      }

      if (currentDeposit > 0) {
        setSplitAmount1(currentDeposit.toString());
      }

      const oneYearAgo = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      const [{ data: txHist }, { data: memHist }] = await Promise.all([
        foundName ? supabase.from('transactions').select('receipt_number, created_at, amount, service_type, status').eq('customer_name', foundName).gte('created_at', oneYearAgo.toISOString()).order('created_at', { ascending: false }).limit(10) : Promise.resolve({ data: [] }),
        supabase.from('membership_logs').select('package_name, created_at, price, balance_added').eq('customer_phone', normalizedPhone).gte('created_at', oneYearAgo.toISOString()).order('created_at', { ascending: false }).limit(10)
      ]);
      let combinedHistory: any[] = [];
      txHist?.forEach((t: any) => combinedHistory.push({ type: 'Cucian', title: `${t.service_type} (${t.receipt_number})`, amount: t.amount, date: t.created_at, status: t.status }));
      memHist?.forEach((m: any) => combinedHistory.push({ type: 'Top-Up Member', title: `Paket ${m.package_name} (+Rp ${Number(m.balance_added).toLocaleString('id-ID')})`, amount: m.price, date: m.created_at, status: 'Berhasil' }));
      combinedHistory.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setCustomerHistory(combinedHistory);
    }
    const timer = setTimeout(() => { checkCustDeposit(); }, 300);
    return () => clearTimeout(timer);
  }, [customerPhone]);

  const handleOutletChange = (outletId: string) => {
    setSelectedOutlet(outletId); 
    const found = outletsList.find((o) => o.id === outletId); 
    if (found) {
      setOutletName(found.name);
      setOutletPhone(found.whatsapp_number || '');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('laundry_user'); localStorage.removeItem('laundry_owner_user'); window.location.href = '/login';
  };

  useEffect(() => {
    if (orderType === 'Online' && !deliveryFee) setDeliveryFee('20000'); else if (orderType === 'Offline') setDeliveryFee('');
  }, [orderType]);

  const refreshData = async () => {
    if (!selectedOutlet || !employeeName) return;
    const now = new Date(); const currentMonth = now.getMonth(); const currentYear = now.getFullYear();
    const todayStr = new Date().toLocaleDateString('en-CA');

    const { data: attData } = await supabase.from('attendance_logs').select('*').eq('employee_name', employeeName).eq('log_date', todayStr).limit(1);
    setTodayAttendance(attData && attData.length > 0 ? attData[0] : null);

    const { data: orders } = await supabase.from('transactions').select('*, outlets(name, whatsapp_number)').eq('outlet_id', selectedOutlet).neq('status', 'Selesai').order('created_at', { ascending: false });
    setActiveOrders(orders?.filter((o) => o.status !== 'Siap Diambil') || []); setPickupOrders(orders?.filter((o) => o.status === 'Siap Diambil') || []);

    const { data: incomingPkps } = await supabase
    .from('pickup_orders')
    .select('*')
    .neq('status', 'Selesai')
    .neq('status', 'Batal');

  setIncomingPickupsCount(incomingPkps?.length || 0);

    const { data: txData } = await supabase.from('transactions').select('amount, order_type, created_at').eq('outlet_id', selectedOutlet);
    const { data: memLogsAll } = await supabase.from('membership_logs').select('price, order_type, created_at').eq('outlet_id', selectedOutlet);

    let totalRev = 0;
    txData?.forEach((tx) => {
      const d = new Date(tx.created_at);
      if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) { totalRev += Number(tx.amount) || 0; }
    });

    memLogsAll?.forEach((ml) => {
      const d = new Date(ml.created_at);
      if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) { totalRev += Number(ml.price) || 0; }
    });
    setMonthlyRevenue(totalRev);

    const { data: invData } = await supabase.from('inventory').select('*').eq('outlet_id', selectedOutlet); setInventory(invData || []);
    const { data: logs } = await supabase.from('work_logs').select('*').eq('employee_name', employeeName);
    const { data: myMemberLogs } = await supabase.from('membership_logs').select('commission, created_at').eq('commission_owner', employeeName);

    const { data: myLoans } = await supabase.from('employee_loans').select('monthly_deduction').eq('employee_name', employeeName).eq('status', 'Active');
    let loanDed = 0; myLoans?.forEach(l => loanDed += Number(l.monthly_deduction) || 0); setEmpLoansDeduction(loanDed);

    const { data: myPenalties } = await supabase.from('employee_penalties').select('penalty_amount').eq('employee_name', employeeName);
    let penDed = 0; myPenalties?.forEach(p => penDed += Number(p.penalty_amount) || 0); setEmpPenaltiesDeduction(penDed);

    let kgTot = 0; let pcsTot = 0; let payTot = 0; let memBonus = 0; let tKg = 0; let tPcs = 0; let tPay = 0;
    
    let tBreakdown: Record<string, { kg: number; pcs: number }> = {
      sortir: { kg: 0, pcs: 0 },
      cuci: { kg: 0, pcs: 0 },
      kering: { kg: 0, pcs: 0 },
      setrika: { kg: 0, pcs: 0 },
      packing: { kg: 0, pcs: 0 },
    };

    myMemberLogs?.forEach((m) => { const d = new Date(m.created_at); if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) memBonus += Number(m.commission) || 0; });

    const processedTxIds = new Set(); const processedTxIdsToday = new Set();
    logs?.forEach((log) => {
      const kg = Number(log.weight_kg) || 0; const pcs = Number(log.pcs_count) || 0;
      const stageKey = getStageKey(log.stage || ''); const svcDef = services.find((s) => (s.name || '').trim().toLowerCase() === (log.service_type || '').trim().toLowerCase());
      let itemPay = 0;
      if (svcDef) {
        const activeCommissions = outletOverrides?.[selectedOutlet]?.[svcDef.id]?.commissions || svcDef.commissions;
        if (activeCommissions) {
          const matchedCommKey = Object.keys(activeCommissions).find((k) => k.toLowerCase() === stageKey);
          if (matchedCommKey) { const commVal = Number(activeCommissions[matchedCommKey]) || 0; itemPay = (svcDef.type === 'pcs' ? pcs : kg) * commVal; }
        }
      }

      const d = new Date(log.created_at); const isThisMonth = d.getMonth() === currentMonth && d.getFullYear() === currentYear; const isToday = d.getDate() === now.getDate() && isThisMonth;
      if (isThisMonth) { if (!processedTxIds.has(log.transaction_id)) { processedTxIds.add(log.transaction_id); if (svcDef?.type === 'pcs') pcsTot += pcs; else kgTot += kg; } payTot += itemPay; }
      if (isToday) { 
        if (!processedTxIdsToday.has(log.transaction_id)) { processedTxIdsToday.add(log.transaction_id); if (svcDef?.type === 'pcs') tPcs += pcs; else tKg += kg; } 
        tPay += itemPay; 

        if (tBreakdown[stageKey]) {
          tBreakdown[stageKey].kg += kg;
          tBreakdown[stageKey].pcs += pcs;
        } else {
          tBreakdown[stageKey] = { kg, pcs };
        }
      }
    });
    setCalculatedStats({ totalKg: kgTot, totalPcs: pcsTot, productionPay: payTot, membershipBonus: memBonus }); 
    setTodayStats({ kg: tKg, pcs: tPcs, pay: tPay });
    setTodayBreakdown(tBreakdown);
  };

  useEffect(() => { refreshData(); }, [selectedOutlet, employeeName, activeTab, services, outletOverrides]);

  const verifyOutletGPS = async (): Promise<boolean> => {
    if (!navigator.geolocation) {
      alert('⚠️ Browser/HP Anda tidak mendukung verifikasi GPS!');
      return false;
    }

    const currentOutletObj = outletsList.find(o => o.id === selectedOutlet);
    if (!currentOutletObj || !currentOutletObj.latitude || !currentOutletObj.longitude) {
      return true;
    }

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const userLat = position.coords.latitude;
          const userLon = position.coords.longitude;
          const targetLat = Number(currentOutletObj.latitude);
          const targetLon = Number(currentOutletObj.longitude);
          const maxRadius = Number(currentOutletObj.radius_meters) || 200;

          const distanceMeters = getDistanceInMeters(userLat, userLon, targetLat, targetLon);

          if (distanceMeters <= maxRadius) {
            resolve(true);
          } else {
            alert(`❌ Absen Ditolak!\nJarak Anda saat ini: ${Math.round(distanceMeters)} meter (Maksimal: ${maxRadius} meter).`);
            resolve(false);
          }
        },
        (error) => {
          alert('⚠️ Gagal mengambil lokasi GPS! Pastikan GPS HP Anda aktif.');
          resolve(false);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
  };

  const handleClockIn = async () => {
    setIsSubmitting(true);
    const isValidGPS = await verifyOutletGPS();
    if (!isValidGPS) { setIsSubmitting(false); return; }

    const todayStr = new Date().toLocaleDateString('en-CA');
    const { error } = await supabase.from('attendance_logs').insert([{
      employee_name: employeeName,
      outlet_id: selectedOutlet === 'ALL' ? null : selectedOutlet,
      log_date: todayStr,
      check_in: new Date().toISOString()
    }]);

    if (!error) { alert('✅ Absen Masuk Berhasil!'); refreshData(); } else alert('❌ Gagal: ' + error.message);
    setIsSubmitting(false);
  };

  const handleClockOut = async () => {
    setIsSubmitting(true);
    const isValidGPS = await verifyOutletGPS();
    if (!isValidGPS) { setIsSubmitting(false); return; }

    const { error } = await supabase.from('attendance_logs').update({
      check_out: new Date().toISOString()
    }).eq('id', todayAttendance.id);

    if (!error) { alert('✅ Absen Pulang Berhasil!'); refreshData(); } else alert('❌ Gagal: ' + error.message);
    setIsSubmitting(false);
  };

  const handleTransactionSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); 
    if (!selectedOutlet || !amount) return;

    const totalPay = Number(amount) || 0;
    const normalizedPhone = cleanPhone(customerPhone);

    let finalPaymentMethodLabel = paymentMethod;
    let depositDeductionAmount = 0;

    if (paymentMethod === 'Deposit Saldo') {
      if (!normalizedPhone) return alert('⚠️ Nomor WA Pelanggan wajib diisi!');
      const { data: custData } = await supabase.from('customers').select('deposit_balance').eq('phone', normalizedPhone).limit(1);
      if (!custData || custData.length === 0) return alert('❌ Pelanggan belum terdaftar!');
      const currentBal = Number(custData[0].deposit_balance) || 0;

      if (currentBal < totalPay) return alert(`❌ Saldo Deposit Kurang! (Sisa: Rp ${currentBal.toLocaleString('id-ID')}).`);
      
      depositDeductionAmount = totalPay;
      finalPaymentMethodLabel = 'Deposit Member';
    }

    if (paymentMethod === 'Split Payment') {
      const amt1 = Number(splitAmount1) || 0;
      const amt2 = Math.max(0, totalPay - amt1);

      if (amt1 <= 0 || amt1 >= totalPay) return alert('⚠️ Nominal Metode 1 tidak valid!');

      if (splitMethod1 === 'Deposit Saldo' || splitMethod2 === 'Deposit Saldo') {
        if (!normalizedPhone) return alert('⚠️ Nomor WA Pelanggan wajib diisi!');
        const { data: custData } = await supabase.from('customers').select('deposit_balance').eq('phone', normalizedPhone).limit(1);
        if (!custData || custData.length === 0) return alert('❌ Pelanggan belum terdaftar!');
        const currentBal = Number(custData[0].deposit_balance) || 0;

        const neededDeposit = splitMethod1 === 'Deposit Saldo' ? amt1 : amt2;
        if (currentBal < neededDeposit) return alert(`❌ Saldo Deposit Kurang! Sisa: Rp ${currentBal.toLocaleString('id-ID')}`);
        depositDeductionAmount = neededDeposit;
      }

      finalPaymentMethodLabel = `${splitMethod1} (Rp ${amt1.toLocaleString('id-ID')}) + ${splitMethod2} (Rp ${amt2.toLocaleString('id-ID')})`;
    }

    setIsSubmitting(true);

    if (depositDeductionAmount > 0 && normalizedPhone) {
      const { data: custData } = await supabase.from('customers').select('deposit_balance').eq('phone', normalizedPhone).limit(1);
      const currentBal = Number(custData?.[0]?.deposit_balance) || 0;
      const updatedBalance = currentBal - depositDeductionAmount;

      await supabase.from('customers').update({ deposit_balance: updatedBalance }).eq('phone', normalizedPhone);
      setCustomerDeposit(updatedBalance);
    }

    const generatedResi = 'TRX-' + Math.floor(100000 + Math.random() * 900000);

    let primaryServiceLabel = selectedServiceInput || serviceType || 'Cuci Kering Gosok';
    let totalKgSum = Number(weightKg) || Number(inputQtyKg) || 0;
    let totalPcsSum = Number(pcsCount) || Number(inputQtyPcs) || 0;
    let combinedNotes = notes || '';

    if (cartItems.length > 0) {
      primaryServiceLabel = cartItems.length === 1 
        ? cartItems[0].name 
        : `Multi-Item (${cartItems.length} Layanan)`;

      totalKgSum = 0;
      totalPcsSum = 0;
      const cartSummaryArr: string[] = [];

      cartItems.forEach(item => {
        if (item.type === 'kg') totalKgSum += item.qty;
        else totalPcsSum += item.qty;
        cartSummaryArr.push(`${item.name} x${item.qty} ${item.type.toUpperCase()}${item.note ? ` (${item.note})` : ''}`);
      });

      combinedNotes = `[Rincian Items]: ${cartSummaryArr.join(' | ')}${notes ? ` | Note: ${notes}` : ''}`;
    }

    const orderData = {
      receipt_number: generatedResi, 
      outlet_id: selectedOutlet, 
      customer_name: customerName || 'Pelanggan', 
      order_type: orderType,
      delivery_fee: Number(deliveryFee) || 0, 
      service_type: primaryServiceLabel, 
      duration: duration, 
      weight_kg: totalKgSum,
      pcs_count: totalPcsSum, 
      discount_type: discountType, 
      discount_value: Number(discountValue) || 0, 
      discount_amount: calculatedDiscount,
      notes: combinedNotes, 
      amount: totalPay, 
      payment_method: finalPaymentMethodLabel, 
      status: 'Diterima',
      by_sortir: employeeName
    };

    const { data: newTx, error } = await supabase.from('transactions').insert([orderData]).select('*, outlets(name, whatsapp_number)').single();
    if (!error && newTx) {
      const curOutletPhone = newTx.outlets?.whatsapp_number || outletPhone || '';
      setLastOrderInfo({ 
        ...orderData, 
        cartItems: cartItems.length > 0 ? cartItems : null,
        customer_phone: customerPhone || null,
        outletName: outletName, 
        outletPhone: curOutletPhone,
        remainingDeposit: depositDeductionAmount > 0 ? (customerDeposit! - depositDeductionAmount) : null, 
        created_at: newTx.created_at 
      });
      
      setCreatedTxSuccess({
        ...newTx,
        customer_phone: customerPhone || null,
        outletPhone: curOutletPhone
      });

      // OTOMATIS HAPUS/UPDATE ANTREAN KANBAN AGAR HILANG DARI PORTAL POS
    const params = new URLSearchParams(window.location.search);
    const pickupId = params.get('pickup_id');

    if (pickupId) {
      await supabase
        .from('pickup_orders')
        .update({ status: 'Selesai' })
        .eq('id', pickupId);
    }
      setAmount(''); setCustomerName(''); setCustomerPhone(''); setWeightKg(''); setPcsCount(''); setNotes(''); setDiscountValue(''); setCartItems([]); setDeliveryFee(orderType === 'Online' ? '20000' : '');
      refreshData();
    } else alert('❌ Gagal: ' + error?.message);
    setIsSubmitting(false);
  };

  const handleSaveTxChanges = async (needsCustomerApproval: boolean) => {
    if (!selectedTxDetail) return;
    setIsSubmitting(true);

    const nextStatus = needsCustomerApproval 
      ? 'Menunggu Konfirmasi Customer' 
      : (selectedTxDetail.status === 'Pending Verifikasi Kasir' ? 'Proses' : selectedTxDetail.status);

    const payload = {
      customer_name: editCustomerName || selectedTxDetail.customer_name,
      customer_phone: editCustomerPhone || selectedTxDetail.customer_phone,
      order_type: 'Online',
      service_type: editServiceType,
      duration: editDuration,
      weight_kg: Number(editWeightKg) || 0,
      pcs_count: Number(editPcsCount) || 0,
      delivery_fee: Number(editDeliveryFee) || 0,
      notes: editNotes,
      amount: Number(editAmount) || 0,
      status: nextStatus
    };

    const { error } = await supabase.from('transactions').update(payload).eq('id', selectedTxDetail.id);

    if (!error) {
      const updatedTx = { ...selectedTxDetail, ...payload };
      setSelectedTxDetail(updatedTx);
      alert(needsCustomerApproval ? '⚠️ Disimpan & dikirim ke CS!' : '✅ Transaksi diperbarui!');
      refreshData();
    } else alert('❌ Gagal memperbarui: ' + error.message);
    setIsSubmitting(false);
  };

  const handleAddMembership = async (e: React.FormEvent) => {
    e.preventDefault(); if (!selectedOutlet || !memberPhone || !memberName) return alert('Lengkapi data!'); setIsSubmitting(true);
    const normalizedPhone = cleanPhone(memberPhone);
    let price = 0; let balanceAdded = 0; let commission = 0;
    if (memberPackage === 'Silver') { price = 300000; balanceAdded = 320000; commission = 5000; }
    else if (memberPackage === 'Gold') { price = 500000; balanceAdded = 550000; commission = 10000; }
    else if (memberPackage === 'Platinum') { price = 900000; balanceAdded = 1000000; commission = 20000; }

    const { data: existingCust } = await supabase.from('customers').select('*').eq('phone', normalizedPhone).limit(1);
    let commissionOwner = employeeName; let newBalance = balanceAdded;

    if (existingCust && existingCust.length > 0) {
      commissionOwner = existingCust[0].registered_by || employeeName;
      newBalance = (Number(existingCust[0].deposit_balance) || 0) + balanceAdded;
      await supabase.from('customers').update({ deposit_balance: newBalance, name: memberName.trim() }).eq('phone', normalizedPhone);
    } else {
      await supabase.from('customers').insert([{ phone: normalizedPhone, name: memberName.trim(), deposit_balance: newBalance, registered_by: employeeName }]);
    }

    const { error: logErr } = await supabase.from('membership_logs').insert([{ outlet_id: selectedOutlet, processed_by: employeeName, commission_owner: commissionOwner, customer_phone: normalizedPhone, package_name: memberPackage, price: price, balance_added: balanceAdded, commission: commission, order_type: memberOrderType }]);
    if (!logErr) {
      setMemberPhone(''); setMemberName(''); setSuccessMsg(`✅ Top-Up Berhasil! Saldo: Rp ${newBalance.toLocaleString('id-ID')}`); refreshData(); setTimeout(() => setSuccessMsg(''), 5000); 
    } else alert('❌ Gagal: ' + logErr.message);
    setIsSubmitting(false);
  };

  const handleExpenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!selectedOutlet || !expAmount) return; setIsSubmitting(true);
    await supabase.from('expenses').insert([{ outlet_id: selectedOutlet, category: expCategory, amount: Number(expAmount), description: expDesc }]);
    setExpAmount(''); setExpDesc(''); setSuccessMsg('✅ Pengeluaran Dicatat!'); refreshData(); setTimeout(() => setSuccessMsg(''), 3000); setIsSubmitting(false);
  };

  const handleAddStock = async (e: React.FormEvent) => {
    e.preventDefault(); if (!selectedOutlet || !stockAddAmount) return; setIsSubmitting(true);
    const { data: invData } = await supabase.from('inventory').select('*').eq('outlet_id', selectedOutlet).eq('item_name', stockItem).single();
    if (invData) await supabase.from('inventory').update({ stock_ml_gram: Number(invData.stock_ml_gram) + Number(stockAddAmount) * 1000 }).eq('id', invData.id); else await supabase.from('inventory').insert([{ outlet_id: selectedOutlet, item_name: stockItem, stock_ml_gram: Number(stockAddAmount) * 1000 }]);
    setStockAddAmount(''); setSuccessMsg(`✅ Stok Ditambah!`); refreshData(); setTimeout(() => setSuccessMsg(''), 3000); setIsSubmitting(false);
  };
// Helper Hitung & Deduct Stok Bahan Baku (Deterjen & Parfum)
const deductChemicalInventory = async (orderItemName: string, qtyKgOrPcs: number, outletId: string) => {
  let detergentMl = 0;
  let perfumeMl = 0;
  const name = (orderItemName || '').toLowerCase();
  const qty = qtyKgOrPcs || 1;

  if (name.includes('bedcover')) {
    detergentMl = 30 * qty;
    perfumeMl = 15 * qty;
  } else if (name.includes('sprei') || name.includes('spree')) {
    detergentMl = 15 * qty;
    perfumeMl = 8 * qty;
  } else if (name.includes('kemeja') || name.includes('jaket')) {
    detergentMl = 10 * qty;
    perfumeMl = 5 * qty;
  } else {
    // Default Kiloan / Layanan Umum
    detergentMl = 5 * qty;
    perfumeMl = 3 * qty;
  }

  // Update langsung ke tabel inventory di Supabase
  if (detergentMl > 0) {
    const { data: detData } = await supabase.from('inventory').select('*').eq('outlet_id', outletId).ilike('item_name', '%Deterjen%').single();
    if (detData) {
      await supabase.from('inventory').update({ stock_ml_gram: Math.max(0, Number(detData.stock_ml_gram || 0) - detergentMl) }).eq('id', detData.id);
    }
  }

  if (perfumeMl > 0) {
    const { data: parfData } = await supabase.from('inventory').select('*').eq('outlet_id', outletId).ilike('item_name', '%Parfum%').single();
    if (parfData) {
      await supabase.from('inventory').update({ stock_ml_gram: Math.max(0, Number(parfData.stock_ml_gram || 0) - perfumeMl) }).eq('id', parfData.id);
    }
  }
};
  const handleUpdateStatus = async (order: any, nextStatus: string) => {
    setIsSubmitting(true);
    const updateObj: any = { status: nextStatus };
    const s = (nextStatus || '').toLowerCase();
    if (s.includes('cuci')) {
      updateObj.by_cuci = employeeName;
      // Otomatis potong stok Deterjen & Parfum berdasarkan takaran layanan
      deductChemicalInventory(order.service_type || order.item_name || '', parseFloat(order.weight_kg || order.qty || 1), selectedOutlet);
    }
    if (s.includes('sortir')) updateObj.by_sortir = employeeName;
    else if (s.includes('cuci')) updateObj.by_cuci = employeeName;
    else if (s.includes('kering')) updateObj.by_kering = employeeName;
    else if (s.includes('setrika')) updateObj.by_setrika = employeeName;
    else if (s.includes('pack')) updateObj.by_packing = employeeName;

    await supabase.from('transactions').update(updateObj).eq('id', order.id);

    if (nextStatus !== 'Siap Diambil' && nextStatus !== 'Selesai') {
      await supabase.from('work_logs').insert([{
        transaction_id: order.id,
        employee_name: employeeName,
        stage: nextStatus,
        weight_kg: Number(order.weight_kg) || 0,
        pcs_count: Number(order.pcs_count) || 0,
        service_type: order.service_type || ''
      }]);
    }

    setSuccessMsg(`✅ Update ke: ${nextStatus}`);
    await refreshData();
    setTimeout(() => setSuccessMsg(''), 2000);
    setIsSubmitting(false);
  };

  const handleSubmitRack = async () => {
    if (!selectedOrderForRack) return; setIsSubmitting(true);
    await supabase.from('transactions').update({ status: 'Siap Diambil', rack_number: rackInput || '1', bag_count: Number(bagInput) || 1 }).eq('id', selectedOrderForRack.id);
    setSuccessMsg(`✅ Disimpan di Rak`); setShowRackModal(false); setRackInput(''); setBagInput(''); refreshData(); setTimeout(() => setSuccessMsg(''), 4000); setIsSubmitting(false);
  };

  const handlePickupFinish = async (order: any) => {
    if (!confirm(`Serahkan cucian ${order.customer_name}?`)) return;
    setIsSubmitting(true); await supabase.from('transactions').update({ status: 'Selesai' }).eq('id', order.id);
    setSuccessMsg('✅ Diserahkan!'); refreshData(); setTimeout(() => setSuccessMsg(''), 3000); setIsSubmitting(false);
  };

  const handleRequestDelete = async (order: any) => {
    const reason = prompt(`Alasan hapus resi ${order.receipt_number}:`);
    if (!reason?.trim()) return alert('⚠️ Mohon tulis alasan!');
    setIsSubmitting(true);
    await supabase.from('transactions').update({ delete_requested: true, delete_reason: reason }).eq('id', order.id);
    alert('✅ Permintaan hapus dikirim!'); refreshData(); setIsSubmitting(false);
  };

  const renderNextStepButton = (order: any) => {
    const currentStatus = order.status || 'Diterima';

    if (currentStatus === 'Diterima' || currentStatus === 'Baru') {
      return (
        <button
          onClick={() => handleUpdateStatus(order, 'Sortir')}
          className="w-full bg-purple-600 hover:bg-purple-700 text-white text-xs font-black py-2.5 rounded-xl shadow-md transition"
        >
          🔍 Mulai Sortir
        </button>
      );
    }

    if (currentStatus === 'Sortir') {
      return (
        <button
          onClick={() => handleUpdateStatus(order, 'Mencuci')}
          className="w-full bg-cyan-500 hover:bg-cyan-600 text-white text-xs font-black py-2.5 rounded-xl shadow-md transition"
        >
          🧼 Mulai Cuci
        </button>
      );
    }

    if (currentStatus === 'Mencuci') {
      return (
        <button
          onClick={() => handleUpdateStatus(order, 'Pengeringan')}
          className="w-full bg-amber-500 hover:bg-amber-600 text-white text-xs font-black py-2.5 rounded-xl shadow-md transition"
        >
          🔥 Mulai Pengeringan
        </button>
      );
    }

    if (currentStatus === 'Pengeringan') {
      return (
        <button
          onClick={() => handleUpdateStatus(order, 'Setrika')}
          className="w-full bg-orange-500 hover:bg-orange-600 text-white text-xs font-black py-2.5 rounded-xl shadow-md transition"
        >
          👔 Mulai Setrika
        </button>
      );
    }

    if (currentStatus === 'Setrika') {
      return (
        <button
          onClick={() => {
            setSelectedOrderForRack(order);
            setShowRackModal(true);
          }}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black py-2.5 rounded-xl shadow-md transition"
        >
          📦 Mulai Packing & Simpan di Rak
        </button>
      );
    }

    return null;
  };

  const baseSalaryUsed = Math.max(empBasicSalary, calcStats.productionPay);
  let tenureBonusRate = 0; let tenureBonusLabel = '0%';
  if (calcStats.productionPay >= 1000000) { if (tenureMonths >= 13) { tenureBonusRate = 0.20; tenureBonusLabel = '20%'; } else if (tenureMonths >= 7) { tenureBonusRate = 0.10; tenureBonusLabel = '10%'; } else if (tenureMonths >= 4) { tenureBonusRate = 0.05; tenureBonusLabel = '5%'; } }
  const tenureBonusAmount = Math.round(calcStats.productionPay * tenureBonusRate);
  const totalTakeHomePay = Math.max(0, baseSalaryUsed + tenureBonusAmount + calcStats.membershipBonus - empLoansDeduction - empPenaltiesDeduction);

  const handlePrintReceiptAuto = () => { setPrintMode('receipt'); setTimeout(() => window.print(), 100); };
  const handlePrintPayslip = () => { setPrintMode('payslip'); setTimeout(() => window.print(), 100); };

  const handlePrintReceiptFromTx = (tx: any) => {
    setLastOrderInfo({
      ...tx,
      customer_name: editCustomerName || tx.customer_name,
      customer_phone: editCustomerPhone || tx.customer_phone || customerPhone || null,
      outletName: tx.outlets?.name || outletName,
      outletPhone: tx.outlets?.whatsapp_number || outletPhone || '',
      discount_amount: tx.discount_amount || 0,
      delivery_fee: Number(editDeliveryFee) || tx.delivery_fee || 0,
      remainingDeposit: null
    });
    setPrintMode('receipt');
    setTimeout(() => window.print(), 100);
  };

  const totalPayNum = Number(amount) || 0;
  const split1Num = Number(splitAmount1) || 0;
  const split2Num = Math.max(0, totalPayNum - split1Num);

  return (
    <>
      {/* TAMPILAN PRINT STRUK THERMAL HASIL CETAK */}
      <div className="hidden print:block text-black bg-white">
        {printMode === 'receipt' && lastOrderInfo && (
          <div className="p-2 w-[58mm] text-[10px] font-mono leading-tight mx-auto">
            <div className="text-center font-bold text-[14px] mb-0.5">{lastOrderInfo.outletName}</div>
            <div className="text-center text-[9px] mb-1">
              Spesialis Laundry Profesional
              {lastOrderInfo.outletPhone && <div className="font-bold">CS: {lastOrderInfo.outletPhone}</div>}
            </div>
            <div className="border-b border-black border-dashed mb-2"></div>

            <div className="mb-0.5">Tgl Masuk: {new Date(lastOrderInfo.created_at || new Date()).toLocaleDateString('id-ID')}</div>
            <div className="mb-0.5 font-bold">Est. Selesai: {getEstDate(lastOrderInfo.created_at, lastOrderInfo.duration)}</div>
            <div className="mb-1 font-bold">Resi: {lastOrderInfo.receipt_number}</div>
            <div className="border-b border-black border-dashed mb-1"></div>

            <div className="mb-0.5">Nama: <b>{lastOrderInfo.customer_name}</b> {lastOrderInfo.order_type === 'Online' ? '(WA)' : ''}</div>
            <div className="mb-2">No. HP: <b>{lastOrderInfo.customer_phone || customerPhone || '-'}</b></div>
            
            <div className="border-b border-black border-dashed mb-2"></div>
            
            {/* RINCIAN CART ATAU SINGLE ITEM STRUK */}
            {lastOrderInfo.cartItems && lastOrderInfo.cartItems.length > 0 ? (
              <div className="mb-2 space-y-1">
                {lastOrderInfo.cartItems.map((item: any, idx: number) => (
                  <div key={idx} className="flex justify-between items-start">
                    <div>
                      <span className="font-bold block">{item.name}</span>
                      <span className="text-[8px]">{item.qty} {item.type.toUpperCase()} x Rp {Number(item.price).toLocaleString('id-ID')}</span>
                      {item.note && <span className="block text-[8px] italic">({item.note})</span>}
                    </div>
                    <span className="font-bold">Rp {(item.price * item.qty).toLocaleString('id-ID')}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mb-2">
                <div className="font-bold">{lastOrderInfo.service_type}</div>
                <div className="mb-1">{lastOrderInfo.duration}</div>
                <div className="mb-2 flex justify-between">
                  <span>{lastOrderInfo.weight_kg > 0 ? `${lastOrderInfo.weight_kg} Kg` : ''} {lastOrderInfo.pcs_count > 0 ? `${lastOrderInfo.pcs_count} Pcs` : ''}</span>
                  <span>Rp {(Number(lastOrderInfo.amount) + Number(lastOrderInfo.discount_amount || 0) - Number(lastOrderInfo.delivery_fee || 0)).toLocaleString('id-ID')}</span>
                </div>
              </div>
            )}
            
            {lastOrderInfo.discount_amount > 0 && <div className="mb-1 flex justify-between text-rose-700 font-bold"><span>Diskon</span><span>- Rp {Number(lastOrderInfo.discount_amount).toLocaleString('id-ID')}</span></div>}
            {lastOrderInfo.delivery_fee > 0 && <div className="mb-2 flex justify-between"><span>Ongkir</span><span>Rp {Number(lastOrderInfo.delivery_fee).toLocaleString('id-ID')}</span></div>}
            {lastOrderInfo.notes && <div className="mb-2 text-[9px] italic">Note: {lastOrderInfo.notes}</div>}
            
            <div className="border-b border-black border-dashed mb-2"></div>
            <div className="flex justify-between font-bold mb-1"><span>TOTAL</span><span>Rp {Number(lastOrderInfo.amount).toLocaleString('id-ID')}</span></div>
            <div className="flex justify-between mb-2"><span>BAYAR</span><span>{lastOrderInfo.payment_method}</span></div>
            {lastOrderInfo.remainingDeposit !== null && <div className="mb-3 flex justify-between font-bold text-[9px] bg-slate-100 p-1"><span>Sisa Saldo Deposit:</span><span>Rp {Number(lastOrderInfo.remainingDeposit).toLocaleString('id-ID')}</span></div>}
            
            <div className="border-t border-black border-dashed pt-2 text-[8px] leading-tight space-y-1">
              <div className="font-bold text-center">SYARAT & KETENTUAN:</div>
              <div className="whitespace-pre-line">{receiptTerms}</div>
            </div>
            <div className="text-center text-[8px] mt-2 font-bold">Cek Cucian: lm-coral.vercel.app/track</div>
          </div>
        )}

        {printMode === 'payslip' && (
          <div className="p-8 w-full max-w-2xl mx-auto border border-slate-300">
            <div className="text-center mb-8 border-b-2 border-slate-800 pb-4">
              <h1 className="text-2xl font-black uppercase tracking-wider">SLIP GAJI KARYAWAN</h1>
              <p className="text-sm font-semibold mt-1">{outletName} - Laundry ERP</p>
            </div>
            
            <div className="grid grid-cols-2 gap-4 mb-8 text-sm">
              <div><p className="text-slate-500">Nama Karyawan:</p><p className="font-bold text-lg">{employeeName}</p></div>
              <div className="text-right"><p className="text-slate-500">Periode Bulan:</p><p className="font-bold text-lg">{new Date().toLocaleString('id-ID', { month: 'long', year: 'numeric' })}</p></div>
              <div><p className="text-slate-500">Posisi / Role:</p><p className="font-bold">{employeeRole.toUpperCase()}</p></div>
              <div className="text-right"><p className="text-slate-500">Lama Bekerja:</p><p className="font-bold">{tenureMonths} Bulan</p></div>
            </div>

            <table className="w-full text-sm border-collapse mb-8">
              <thead><tr className="bg-slate-100"><th className="border p-2 text-left">Keterangan</th><th className="border p-2 text-right">Penambahan (Rp)</th><th className="border p-2 text-right">Potongan (Rp)</th></tr></thead>
              <tbody>
                <tr><td className="border p-2 font-semibold">Gaji Pokok / Upah Borongan Minimal</td><td className="border p-2 text-right">{baseSalaryUsed.toLocaleString('id-ID')}</td><td className="border p-2 text-right">-</td></tr>
                <tr><td className="border p-2 font-semibold">Bonus Loyalitas ({tenureBonusLabel}) - {tenureMonths} Bulan Kerja</td><td className="border p-2 text-right">{tenureBonusAmount.toLocaleString('id-ID')}</td><td className="border p-2 text-right">-</td></tr>
                <tr><td className="border p-2 font-semibold">Komisi Penjualan Member</td><td className="border p-2 text-right">{calcStats.membershipBonus.toLocaleString('id-ID')}</td><td className="border p-2 text-right">-</td></tr>
                <tr><td className="border p-2 text-rose-600">Cicilan Kasbon Bulan Ini</td><td className="border p-2 text-right">-</td><td className="border p-2 text-right text-rose-600">{empLoansDeduction.toLocaleString('id-ID')}</td></tr>
                <tr><td className="border p-2 text-rose-600">Denda / Potongan Kesalahan Kerja</td><td className="border p-2 text-right">-</td><td className="border p-2 text-right text-rose-600">{empPenaltiesDeduction.toLocaleString('id-ID')}</td></tr>
              </tbody>
              <tfoot>
                <tr className="bg-slate-100 font-black text-base">
                  <td className="border p-3 text-right">TOTAL TAKE HOME PAY (THP) :</td>
                  <td colSpan={2} className="border p-3 text-center text-emerald-700 bg-emerald-50">Rp {totalTakeHomePay.toLocaleString('id-ID')}</td>
                </tr>
              </tfoot>
            </table>

            <div className="grid grid-cols-2 mt-16 text-center text-sm">
              <div><p className="mb-16">Penerima,</p><p className="font-bold underline">{employeeName}</p></div>
              <div><p className="mb-16">Disetujui Oleh (Management),</p><p className="font-bold underline">_________________________</p></div>
            </div>
            <p className="text-center text-[10px] text-slate-400 mt-8 italic">Dokumen ini dicetak otomatis oleh Sistem Laundry ERP dan sah secara digital.</p>
          </div>
        )}
      </div>

      {showRackModal && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-bold mb-1 text-slate-800">Simpan ke Rak</h3>
            <p className="text-xs text-slate-500 mb-4">Milik: <span className="font-bold text-emerald-600">{selectedOrderForRack?.customer_name}</span></p>
            <div className="space-y-3 mb-6">
              <div><label className="block text-xs font-bold text-slate-700 mb-1">Total Kantong</label><input type="number" value={bagInput} onChange={(e) => setBagInput(e.target.value)} className="w-full bg-slate-50 border rounded-xl px-4 py-3 text-sm" required /></div>
              <div><label className="block text-xs font-bold text-slate-700 mb-1">Nomor Rak</label><input type="text" value={rackInput} onChange={(e) => setRackInput(e.target.value)} className="w-full bg-slate-50 border rounded-xl px-4 py-3 text-sm" required /></div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowRackModal(false)} className="flex-1 bg-slate-100 font-bold py-3 rounded-xl text-slate-600 text-sm">Batal</button>
              <button onClick={handleSubmitRack} disabled={isSubmitting || !rackInput || !bagInput} className="flex-1 bg-blue-600 text-white font-bold py-3 rounded-xl text-sm">Simpan</button>
            </div>
          </div>
        </div>
      )}

      {/* POP-UP STRUK SETELAH TRANSAKSI MASUK */}
      {createdTxSuccess && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full text-center space-y-4 shadow-2xl border border-slate-200">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center text-3xl mx-auto font-black">
              ✅
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-900">Orderan Berhasil Dibuat!</h3>
              <p className="text-xs text-slate-500 mt-1">No. Resi: <b className="text-indigo-600 font-mono">{createdTxSuccess.receipt_number}</b></p>
            </div>
            <div className="bg-slate-50 p-3 rounded-2xl border text-xs text-left space-y-1">
              <p><b>Pelanggan:</b> {createdTxSuccess.customer_name} ({createdTxSuccess.customer_phone || customerPhone || '-'})</p>
              <p><b>Est. Selesai:</b> {getEstDate(createdTxSuccess.created_at, createdTxSuccess.duration)}</p>
              <p><b>Layanan:</b> {createdTxSuccess.service_type}</p>
              <p><b>Total:</b> Rp {Number(createdTxSuccess.amount).toLocaleString('id-ID')}</p>
            </div>
            <div className="space-y-2 pt-2">
              <button
                onClick={() => { handlePrintReceiptAuto(); setCreatedTxSuccess(null); }}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl text-xs shadow-md transition flex items-center justify-center gap-2"
              >
                🖨️ CETAK STRUK / NOTA
              </button>
              <button
                onClick={() => setCreatedTxSuccess(null)}
                className="w-full bg-slate-200 text-slate-700 font-bold py-2.5 rounded-xl text-xs hover:bg-slate-300 transition"
              >
                Tutup Saja
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL EDIT & DETAIL TRANSAKSI POS */}
      {selectedTxDetail && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-3 md:p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl p-5 max-w-lg w-full space-y-4 shadow-2xl border border-slate-200 my-auto max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b pb-3 sticky top-0 bg-white z-10">
              <div>
                <span className="text-[10px] font-mono font-bold bg-indigo-100 text-indigo-800 px-2.5 py-0.5 rounded-full uppercase">
                  Detail & Edit Transaksi
                </span>
                <h3 className="text-base font-black text-slate-900 mt-1">
                  {selectedTxDetail.receipt_number || 'TRX-POS'}
                </h3>
              </div>
              <button
                onClick={() => setSelectedTxDetail(null)}
                className="w-9 h-9 rounded-full bg-rose-100 hover:bg-rose-200 text-rose-700 font-extrabold flex items-center justify-center text-sm shadow-sm"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                <span className="text-[9px] text-slate-400 font-bold block uppercase mb-1">Nama Pelanggan</span>
                <input
                  type="text"
                  value={editCustomerName}
                  onChange={(e) => setEditCustomerName(e.target.value)}
                  className="w-full border rounded-lg p-1.5 font-bold text-slate-800 bg-white text-xs"
                />
              </div>
              <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                <span className="text-[9px] text-slate-400 font-bold block uppercase mb-1">No. WhatsApp</span>
                <input
                  type="text"
                  value={editCustomerPhone}
                  onChange={(e) => setEditCustomerPhone(e.target.value)}
                  placeholder="08..."
                  className="w-full border rounded-lg p-1.5 font-mono text-slate-700 bg-white text-xs"
                />
              </div>
            </div>

            <div className="bg-indigo-50/60 p-3.5 rounded-2xl border border-indigo-100 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-indigo-950 block mb-1">Layanan Cucian</label>
                  <select
                    value={editServiceType}
                    onChange={(e) => setEditServiceType(e.target.value)}
                    className="w-full border rounded-xl p-2 text-xs font-bold text-indigo-900 bg-white"
                  >
                    {services.map((svc, i) => (
                      <option key={i} value={svc.name}>{svc.name}</option>
                    ))}
                    <option value="Bedcover Double">Bedcover Double</option>
                    <option value="Bedcover Single">Bedcover Single</option>
                    <option value="Sprei Single">Sprei Single</option>
                  </select>
                </div>
                <div>
                  <label className="font-bold text-indigo-950 block mb-1">Durasi Pengerjaan</label>
                  <select
                    value={editDuration}
                    onChange={(e) => setEditDuration(e.target.value)}
                    className="w-full border rounded-xl p-2 text-xs font-bold text-amber-700 bg-white"
                  >
                    <option value="Reguler (3 Hari)">Reguler (3 Hari)</option>
                    <option value="Oneday (1 Hari / 24 Jam)">Oneday (+50%)</option>
                    <option value="Express (6 Jam)">Express (+100%)</option>
                    <option value="Quick (3 Jam)">Quick (+200%)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-indigo-950 block mb-1">Berat (Kg)</label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="0.0"
                    value={editWeightKg}
                    onChange={(e) => setEditWeightKg(e.target.value)}
                    className="w-full border rounded-xl p-2 text-xs font-bold bg-white text-indigo-900"
                  />
                </div>
                <div>
                  <label className="font-bold text-indigo-950 block mb-1">Jumlah (Pcs)</label>
                  <input
                    type="number"
                    placeholder="0"
                    value={editPcsCount}
                    onChange={(e) => setEditPcsCount(e.target.value)}
                    className="w-full border rounded-xl p-2 text-xs font-bold bg-white text-indigo-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-indigo-950 block mb-1">Biaya Ongkir (Rp)</label>
                  <input
                    type="number"
                    placeholder="0"
                    value={editDeliveryFee}
                    onChange={(e) => setEditDeliveryFee(e.target.value)}
                    className="w-full border rounded-xl p-2 text-xs font-bold bg-white text-emerald-700 border-emerald-300"
                  />
                </div>
                <div>
                  <label className="font-bold text-indigo-950 block mb-1">Biaya Tambahan (Rp)</label>
                  <input
                    type="number"
                    placeholder="0"
                    value={editSatuanFee}
                    onChange={(e) => setEditSatuanFee(e.target.value)}
                    className="w-full border rounded-xl p-2 text-xs font-bold bg-white text-purple-700 border-purple-300"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-indigo-950 block mb-1">Catatan Cucian</label>
                <input
                  type="text"
                  placeholder="Contoh: Ada luntur, kemeja putih 1 pcs"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full border rounded-xl p-2 text-xs bg-white"
                />
              </div>

              <div>
                <label className="font-bold text-indigo-950 block mb-1">Total Tagihan Final (Otomatis Kalkulasi)</label>
                <input
                  type="number"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  className="w-full border rounded-xl p-2.5 text-base font-black text-emerald-700 bg-emerald-50"
                  required
                />
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t">
              <button
                onClick={() => handleSaveTxChanges(true)}
                disabled={isSubmitting}
                className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold py-2.5 rounded-xl text-xs shadow transition"
              >
                ⚠️ Kirim Konfirmasi Perubahan (Ke CS & Customer)
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => handleSaveTxChanges(false)}
                  disabled={isSubmitting}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl text-xs shadow transition"
                >
                  💾 Simpan
                </button>
                <button
                  onClick={() => handlePrintReceiptFromTx({ ...selectedTxDetail, customer_name: editCustomerName, customer_phone: editCustomerPhone, service_type: editServiceType, duration: editDuration, weight_kg: Number(editWeightKg), pcs_count: Number(editPcsCount), delivery_fee: Number(editDeliveryFee), notes: editNotes, amount: Number(editAmount) })}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl text-xs shadow transition"
                >
                  🖨️ Cetak Struk
                </button>
              </div>

              <button
                onClick={() => setSelectedTxDetail(null)}
                className="w-full bg-slate-200 hover:bg-slate-300 text-slate-800 font-black py-2.5 rounded-xl text-xs mt-2 transition"
              >
                ✕ TUTUP MODAL
              </button>
            </div>
          </div>
        </div>
      )}

<div className="print:hidden min-h-screen bg-slate-950 text-slate-100 p-3 md:p-6 pb-24 md:pb-8 font-sans">
      {/* TOP HEADER GLASSMORPHISM (ANDROID & MOBILE FRIENDLY) */}
      <div className="w-full max-w-6xl mx-auto bg-slate-900/90 border border-slate-800 rounded-3xl p-4 md:p-5 mb-6 backdrop-blur-xl shadow-2xl flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-tr from-emerald-500 to-teal-400 rounded-2xl flex items-center justify-center text-2xl shadow-lg shadow-emerald-500/20 shrink-0">
            🛒
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg md:text-xl font-black tracking-tight text-white">Portal Kasir POS</h1>
              <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[9px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider">Active</span>
            </div>
            <p className="text-xs text-slate-400 font-medium mt-0.5">
              Kasir: <span className="text-indigo-400 font-bold">{employeeName || 'Kasir'}</span> (@{employeeUsername})
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {isMultiOutletUser && outletsList.length > 0 && (
            <select 
              value={selectedOutlet} 
              onChange={(e) => handleOutletChange(e.target.value)} 
              className="flex-1 md:flex-initial bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-2xl px-3 py-2.5 font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {outletsList.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          )}
          <button 
            onClick={handleLogout} 
            className="bg-rose-500/10 hover:bg-rose-600 border border-rose-500/30 text-rose-400 hover:text-white active:scale-95 text-xs font-bold px-4 py-2.5 rounded-2xl transition-all"
          >
            Keluar
          </button>
        </div>
      </div>

        {/* DESKTOP NAV BAR */}
        <div className="hidden md:grid w-full max-w-xl grid-cols-7 gap-1 p-1.5 bg-white border rounded-xl mb-6 shadow-sm">
          <button onClick={() => setActiveTab('pos')} className={`py-2 rounded-lg text-[10px] font-bold ${activeTab === 'pos' ? 'bg-emerald-600 text-white shadow' : 'text-slate-500 hover:bg-slate-100'}`}>🛒 POS</button>
          
          <Link href="/admin/pickups" className="py-2 rounded-lg text-[10px] font-bold text-center bg-blue-50 text-blue-800 border border-blue-200 hover:bg-blue-100 flex items-center justify-center gap-0.5 relative transition">
            <span>🛵 Jemput</span>
            {incomingPickupsCount > 0 && (
              <span className="bg-rose-500 text-white text-[8px] font-black px-1.5 py-0.2 rounded-full ml-0.5 animate-pulse">
                {incomingPickupsCount}
              </span>
            )}
          </Link>

          <button onClick={() => setActiveTab('workflow')} className={`py-2 rounded-lg text-[10px] font-bold ${activeTab === 'workflow' ? 'bg-amber-500 text-white shadow' : 'text-slate-500 hover:bg-slate-100'}`}>⚙️ Kerja ({activeOrders.length})</button>
          <button onClick={() => setActiveTab('pickup')} className={`py-2 rounded-lg text-[10px] font-bold ${activeTab === 'pickup' ? 'bg-blue-600 text-white shadow' : 'text-slate-500 hover:bg-slate-100'}`}>🛍️ Ambil ({pickupOrders.length})</button>
          <button onClick={() => setActiveTab('member')} className={`py-2 rounded-lg text-[10px] font-bold ${activeTab === 'member' ? 'bg-purple-600 text-white shadow' : 'text-slate-500 hover:bg-slate-100'}`}>💳 Member</button>
          <button onClick={() => setActiveTab('expense')} className={`py-2 rounded-lg text-[10px] font-bold ${activeTab === 'expense' ? 'bg-rose-500 text-white shadow' : 'text-slate-500 hover:bg-slate-100'}`}>💸 Keluar</button>
          <button onClick={() => setActiveTab('performance')} className={`py-2 rounded-lg text-[10px] font-bold ${activeTab === 'performance' ? 'bg-indigo-600 text-white shadow' : 'text-slate-500 hover:bg-slate-100'}`}>📊 Gaji</button>
        </div>

        {/* MOBILE BOTTOM NAV BAR */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex justify-around p-2 pb-5 z-50 shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
          <button onClick={() => setActiveTab('pos')} className={`flex flex-col items-center flex-1 p-1 ${activeTab === 'pos' ? 'text-emerald-600' : 'text-slate-400'}`}><span className="text-xl">🛒</span><span className="text-[9px] font-bold mt-1">POS</span></button>
          
          <Link href="/admin/pickups" className="flex flex-col items-center flex-1 p-1 text-blue-700">
            <span className="text-xl relative">
              🛵
              {incomingPickupsCount > 0 && (
                <span className="absolute -top-1 -right-2 bg-rose-500 text-white text-[8px] rounded-full px-1 font-bold animate-pulse">
                  {incomingPickupsCount}
                </span>
              )}
            </span>
            <span className="text-[9px] font-bold mt-1">Jemput</span>
          </Link>

          <button onClick={() => setActiveTab('workflow')} className={`flex flex-col items-center flex-1 p-1 ${activeTab === 'workflow' ? 'text-amber-500' : 'text-slate-400'}`}><span className="text-xl relative">⚙️<span className="absolute -top-1 -right-2 bg-rose-500 text-white text-[8px] rounded-full px-1">{activeOrders.length}</span></span><span className="text-[9px] font-bold mt-1">Kerja</span></button>
          <button onClick={() => setActiveTab('pickup')} className={`flex flex-col items-center flex-1 p-1 ${activeTab === 'pickup' ? 'text-blue-600' : 'text-slate-400'}`}><span className="text-xl relative">🛍️<span className="absolute -top-1 -right-2 bg-rose-500 text-white text-[8px] rounded-full px-1">{pickupOrders.length}</span></span><span className="text-[9px] font-bold mt-1">Ambil</span></button>
          <button onClick={() => setActiveTab('member')} className={`flex flex-col items-center flex-1 p-1 ${activeTab === 'member' ? 'text-purple-600' : 'text-slate-400'}`}><span className="text-xl">💳</span><span className="text-[9px] font-bold mt-1">Member</span></button>
          <button onClick={() => setActiveTab('expense')} className={`flex flex-col items-center flex-1 p-1 ${activeTab === 'expense' ? 'text-rose-500' : 'text-slate-400'}`}><span className="text-xl">💸</span><span className="text-[9px] font-bold mt-1">Kas</span></button>
          <button onClick={() => setActiveTab('performance')} className={`flex flex-col items-center flex-1 p-1 ${activeTab === 'performance' ? 'text-indigo-600' : 'text-slate-400'}`}><span className="text-xl">📊</span><span className="text-[9px] font-bold mt-1">Gaji</span></button>
        </div>

        <div className="w-full max-w-xl bg-white border border-slate-200 rounded-2xl p-4 md:p-6 shadow-sm">
          {successMsg && (
            <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
              <p className="text-xs text-center font-bold text-emerald-700">{successMsg}</p>
            </div>
          )}

          {activeTab === 'member' && (
            <form onSubmit={handleAddMembership} className="space-y-4">
              <h3 className="text-sm font-bold text-purple-700 border-b pb-2">💳 Top-Up & Member Baru</h3>
              <div className="flex bg-slate-100 rounded-xl p-1 mb-2">
                <button type="button" onClick={() => setMemberOrderType('Offline')} className={`flex-1 py-2 text-xs font-bold rounded-lg transition ${memberOrderType === 'Offline' ? 'bg-purple-600 text-white shadow' : 'text-slate-500'}`}>🏪 Offline (Datang)</button>
                <button type="button" onClick={() => setMemberOrderType('Online')} className={`flex-1 py-2 text-xs font-bold rounded-lg transition ${memberOrderType === 'Online' ? 'bg-indigo-600 text-white shadow' : 'text-slate-500'}`}>🌐 Online (Order WA)</button>
              </div>
              <input type="tel" placeholder="08123456789 (WA Pelanggan)" value={memberPhone} onChange={(e) => setMemberPhone(e.target.value)} className="w-full border rounded-xl px-4 py-3 text-sm" required />
              <input type="text" placeholder="Nama Lengkap Pelanggan" value={memberName} onChange={(e) => setMemberName(e.target.value)} className="w-full border rounded-xl px-4 py-3 text-sm" required />
              <select value={memberPackage} onChange={(e) => setMemberPackage(e.target.value)} className="w-full border rounded-xl px-4 py-3 text-sm"><option value="Silver">Silver (Bayar 300rb, Saldo 320rb)</option><option value="Gold">Gold (Bayar 500rb, Saldo 550rb)</option><option value="Platinum">Platinum (Bayar 900rb, Saldo 1 Jt)</option></select>
              <button type="submit" disabled={isSubmitting} className="w-full bg-purple-600 text-white font-bold py-4 rounded-xl text-sm shadow-md">💳 PROSES TOP-UP ({memberOrderType.toUpperCase()})</button>
            </form>
          )}

          {activeTab === 'pos' && (
            <form onSubmit={handleTransactionSubmit} className="space-y-3">
              <div className="flex bg-slate-100 rounded-xl p-1 mb-2">
                <button type="button" onClick={() => setOrderType('Offline')} className={`flex-1 py-2.5 text-[10px] md:text-xs font-bold rounded-lg ${orderType === 'Offline' ? 'bg-emerald-600 text-white shadow' : 'text-slate-500'}`}>🏪 Langsung</button>
                <button type="button" onClick={() => setOrderType('Online')} className={`flex-1 py-2.5 text-[10px] md:text-xs font-bold rounded-lg ${orderType === 'Online' ? 'bg-indigo-600 text-white shadow' : 'text-slate-500'}`}>🌐 WhatsApp</button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div><label className="block text-[10px] font-bold text-slate-500 mb-1">Nomor WhatsApp Pelanggan</label><input type="tel" placeholder="Ketik 08..." value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} className="w-full border border-indigo-200 bg-indigo-50 text-indigo-800 rounded-xl px-3 py-3 text-xs md:text-sm font-bold" /></div>
                <div><label className="block text-[10px] font-bold text-slate-500 mb-1">Nama Pelanggan (Otomatis)</label><input type="text" placeholder="Ketik Nama" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="w-full border rounded-xl px-3 py-3 text-xs md:text-sm" required /></div>
              </div>

              {customerDeposit !== null && (
                <div className={`p-2.5 rounded-xl text-xs font-bold flex justify-between border ${customerDeposit > 0 ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                  <span>💳 Saldo Deposit Member:</span><span>Rp {customerDeposit.toLocaleString('id-ID')}</span>
                </div>
              )}

              {customerHistory.length > 0 && (
                <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-3 space-y-2">
                  <p className="text-[10px] font-bold text-indigo-800 uppercase">📜 Riwayat Transaksi & Top-Up Pelanggan Ini (1 Tahun)</p>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                    {customerHistory.map((item, idx) => (
                      <div key={idx} className="bg-white p-2 rounded-lg border border-slate-100 flex justify-between items-center text-[10px]">
                        <div>
                          <span className={`font-bold px-1.5 py-0.5 rounded text-[8px] mr-1 ${item.type === 'Top-Up Member' ? 'bg-purple-100 text-purple-700' : 'bg-emerald-100 text-emerald-700'}`}>{item.type}</span>
                          <span className="font-semibold text-slate-700">{item.title}</span><span className="block text-[8px] text-slate-400">{new Date(item.date).toLocaleDateString('id-ID')}</span>
                        </div>
                        <span className="font-bold text-slate-800">Rp {Number(item.amount).toLocaleString('id-ID')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Durasi Pengerjaan Nota Ini</label>
                <select value={duration} onChange={(e) => setDuration(e.target.value)} className="w-full border rounded-xl px-3 py-2.5 text-xs font-bold text-amber-700 bg-amber-50/50">
                  <option value="Reguler (3 Hari)">Reguler (3 Hari)</option>
                  <option value="Oneday (1 Hari / 24 Jam)">Oneday 1 Hari (+50%)</option>
                  <option value="Express (6 Jam)">Express 6 Jam (+100%)</option>
                  <option value="Quick (3 Jam)">Quick 3 Jam (+200%)</option>
                </select>
              </div>

              {/* KOTAK INPUT ITEM / LAYANAN (DARK MODE GLASSMORPHISM) */}
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-3xl space-y-3 shadow-xl">
            <div className="flex justify-between items-center pb-2 border-b border-slate-800">
              <span className="text-xs font-black tracking-wider uppercase text-emerald-400">
                ➕ Input Layanan & Items
              </span>
              <span className="text-[10px] font-bold text-teal-300 bg-teal-500/10 px-2.5 py-0.5 rounded-full border border-teal-500/30">
                Bisa Multi-Item
              </span>
            </div>

            <div className="space-y-3">
              <select
                value={selectedServiceInput || serviceType}
                onChange={(e) => {
                  setSelectedServiceInput(e.target.value);
                  setServiceType(e.target.value);
                }}
                className="w-full bg-slate-800 border border-slate-700 text-slate-100 text-xs font-bold rounded-2xl p-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {services.map((s, i) => (
                  <option key={i} value={s.name}>
                    {s.name} ({s.type === 'pcs' ? 'Satuan/Pcs' : 'Kiloan/Kg'})
                  </option>
                ))}
                <option value="Bedcover Double">Bedcover Double (Satuan/Pcs)</option>
                <option value="Bedcover Single">Bedcover Single (Satuan/Pcs)</option>
                <option value="Sprei Single">Sprei Single (Satuan/Pcs)</option>
                <option value="Jaket / Jas / Sepatu">Jaket / Jas / Sepatu (Satuan/Pcs)</option>
              </select>

              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  step="0.1"
                  placeholder="Berat (Kg)"
                  value={inputQtyKg || weightKg}
                  onChange={(e) => setInputQtyKg(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-100 text-xs font-bold rounded-2xl p-3 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <input
                  type="number"
                  placeholder="Jumlah (Pcs)"
                  value={inputQtyPcs || pcsCount}
                  onChange={(e) => setInputQtyPcs(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-100 text-xs font-bold rounded-2xl p-3 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <input
                type="text"
                placeholder="Catatan khusus item ini (misal: Kantong A / Kemeja Putih)"
                value={inputItemNote}
                onChange={(e) => setInputItemNote(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 text-slate-100 text-xs font-bold rounded-2xl p-3 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />

              <button
                type="button"
                onClick={handleAddToCart}
                className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 active:scale-95 text-white font-black py-3 rounded-2xl text-xs shadow-lg shadow-emerald-500/20 transition-all"
              >
                ➕ TAMBAHKAN KE DAFTAR KERANJANG NOTA
              </button>
            </div>
          </div>
                {/* DAFTAR ITEM KERANJANG */}
          {cartItems.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-slate-800">
              <p className="text-[10px] font-bold text-slate-400 uppercase">
                Daftar Item Dalam Nota Ini ({cartItems.length}):
              </p>
              {cartItems.map((item, idx) => {
                let durationMultiplier = 1.0;
                if (duration.includes('Oneday') || duration.includes('1 Hari')) durationMultiplier = 1.5;
                if (duration.includes('Express') || duration.includes('6 Jam')) durationMultiplier = 2.0;
                if (duration.includes('Quick') || duration.includes('3 Jam')) durationMultiplier = 3.0;

                const activeUnitPrice = Math.round((item.basePrice || item.price) * durationMultiplier);
                const itemSubtotal = activeUnitPrice * item.qty;

                return (
                  <div key={idx} className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700 flex justify-between items-center text-xs shadow-sm">
                    <div>
                      <p className="font-bold text-slate-100">{item.name}</p>
                      <p className="text-[10px] text-slate-400">
                        {item.qty} x Rp {activeUnitPrice.toLocaleString('id-ID')}
                        {item.note && <span className="italic text-emerald-400 ml-1">({item.note})</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-black text-emerald-400">Rp {itemSubtotal.toLocaleString('id-ID')}</span>
                      <button
                        type="button"
                        onClick={() => setCartItems(cartItems.filter((_, i) => i !== idx))}
                        className="text-rose-400 hover:text-rose-300 text-xs font-bold px-1.5 py-0.5 rounded bg-rose-500/10"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* INPUT ONGKIR & DISKON (DARK MODE GLASSMORPHISM) */}
          {orderType === 'Online' && (
            <input
              type="number"
              placeholder="Biaya Ongkir (Rp)"
              value={deliveryFee}
              onChange={(e) => setDeliveryFee(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-slate-100 text-xs font-bold rounded-2xl p-3 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          )}

          <div className="bg-slate-800/60 border border-rose-500/30 p-3 rounded-2xl flex items-center gap-2">
            <span className="text-xs font-bold text-rose-400 whitespace-nowrap">
              🏷️ Diskon:
            </span>
            <select
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value as any)}
              className="bg-slate-900 border border-slate-700 text-slate-200 text-xs font-bold rounded-xl p-2 focus:outline-none"
            >
              <option value="rp">Rp</option>
              <option value="percent">%</option>
            </select>
            <input
              type="number"
              placeholder={discountType === 'percent' ? '10 (%)' : '5000 (Rp)'}
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 text-slate-100 text-xs font-bold rounded-xl p-2 focus:outline-none focus:ring-1 focus:ring-rose-500"
            />
          </div>
              <input type="text" placeholder="Catatan Umum Nota Ini (Noda, dll)" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full border rounded-xl px-4 py-3 text-xs" />
              
              <div><label className="block text-[10px] font-bold text-slate-400 mb-1 uppercase">Total Bayar Final (Rp) (Terhitung Otomatis)</label><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full bg-slate-50 border rounded-xl px-4 py-3.5 text-2xl font-black text-emerald-600 text-center" required /></div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Metode Pembayaran</label>
                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="w-full border rounded-xl px-4 py-3 text-sm font-bold bg-white">
                  <option value="QRIS">QRIS</option>
                  <option value="Cash">Cash (Tunai)</option>
                  <option value="Deposit Saldo">💳 Deposit Member</option>
                  <option value="Transfer">Transfer Bank</option>
                  <option value="Split Payment">🔀 Split Payment (Kombinasi 2 Metode)</option>
                </select>
              </div>

              {paymentMethod === 'Split Payment' && (
                <div className="bg-indigo-50/70 border border-indigo-200 rounded-2xl p-3 space-y-3">
                  <p className="text-[10px] font-bold text-indigo-900 uppercase flex items-center gap-1">
                    <span>🔀</span> Atur Kombinasi Pembayaran 2 Metode
                  </p>
                  
                  <div className="grid grid-cols-2 gap-2 bg-white p-2.5 rounded-xl border border-indigo-100">
                    <div>
                      <label className="block text-[9px] font-bold text-slate-500 mb-1">Metode ke-1</label>
                      <select value={splitMethod1} onChange={(e) => setSplitMethod1(e.target.value)} className="w-full border rounded-lg p-2 text-xs font-bold text-indigo-800">
                        <option value="Deposit Saldo">💳 Deposit Member</option>
                        <option value="Cash">Cash (Tunai)</option>
                        <option value="QRIS">QRIS</option>
                        <option value="Transfer">Transfer Bank</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-slate-500 mb-1">Nominal Metode 1 (Rp)</label>
                      <input 
                        type="number" 
                        placeholder="Contoh: 450000" 
                        value={splitAmount1} 
                        onChange={(e) => setSplitAmount1(e.target.value)} 
                        className="w-full border border-indigo-300 rounded-lg p-2 text-xs font-bold text-indigo-700 bg-white" 
                        required 
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 bg-white p-2.5 rounded-xl border border-indigo-100">
                    <div>
                      <label className="block text-[9px] font-bold text-slate-500 mb-1">Metode ke-2 (Pelunas Sisa)</label>
                      <select value={splitMethod2} onChange={(e) => setSplitMethod2(e.target.value)} className="w-full border rounded-lg p-2 text-xs font-bold text-emerald-800">
                        <option value="Cash">Cash (Tunai)</option>
                        <option value="QRIS">QRIS</option>
                        <option value="Transfer">Transfer Bank</option>
                        <option value="Deposit Saldo">💳 Deposit Member</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-slate-500 mb-1">Sisa Bayar Metode 2 (Otomatis)</label>
                      <div className="w-full bg-slate-100 border border-slate-200 rounded-lg p-2 text-xs font-black text-emerald-600">
                        Rp {split2Num.toLocaleString('id-ID')}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <button type="submit" disabled={isSubmitting} className="w-full mt-2 bg-emerald-600 text-white font-black py-4 rounded-xl text-sm shadow-md">⚡ SIMPAN TRANSAKSI</button>
            </form>
          )}

          {activeTab === 'workflow' && (
            <div className="space-y-3">
              <div className="flex justify-between items-center border-b pb-2">
                <h3 className="text-[10px] md:text-xs font-black text-slate-800 uppercase tracking-wider">📋 Sedang Diproses ({activeOrders.length})</h3>
                <span className="text-[10px] text-slate-400">Klik kartu untuk detail & edit</span>
              </div>
              {activeOrders.map((order) => (
                <div key={order.id} className="border rounded-xl p-4 space-y-3 bg-white shadow-sm hover:border-indigo-300 transition">
                  <div onClick={() => handleOpenDetailModal(order)} className="flex justify-between items-start pb-2.5 cursor-pointer group">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-bold text-sm text-slate-800 group-hover:text-blue-600 transition">
                          {(order.customer_name && order.customer_name !== 'Pelanggan') ? order.customer_name : (order.customer_phone || order.phone_number || 'Pelanggan Online')}
                        </h4>
                        <span className="text-[10px] font-mono font-bold bg-slate-100 border border-slate-200 text-slate-700 px-2 py-0.5 rounded-md">{order.receipt_number || 'TRX-POS'}</span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1">{order.service_type} • <b className="text-emerald-600">{order.weight_kg || 0} Kg</b> / <b className="text-amber-600">{order.pcs_count || 0} Pcs</b></p>
                      {order.delivery_fee > 0 && <p className="text-[10px] font-bold text-indigo-600 mt-0.5">🚚 Ongkir: Rp {Number(order.delivery_fee).toLocaleString('id-ID')}</p>}
                    </div>
                    <div className="flex flex-col gap-1 items-end">
                      {order.delete_requested 
                        ? <span className="text-[9px] font-bold bg-amber-100 text-amber-800 px-2 py-1 rounded">⏳ Hapus</span> 
                        : <button onClick={(e) => { e.stopPropagation(); handleRequestDelete(order); }} className="text-[10px] font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 px-2.5 py-1 rounded transition">🗑️ Hapus</button>
                      }
                      <button onClick={(e) => { e.stopPropagation(); handleOpenDetailModal(order); }} className="text-[10px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1 rounded-lg shadow-sm transition">
                        ⚡ Input POS Otomatis
                      </button>
                    </div>
                  </div>
                  <div className="pt-1 border-t">{renderNextStepButton(order)}</div>
                </div>
              ))}
              {activeOrders.length === 0 && <p className="text-xs text-slate-400 text-center py-8">Tidak ada antrean cucian saat ini.</p>}
            </div>
          )}

          {activeTab === 'pickup' && (
            <div className="space-y-3">
              <h3 className="text-[10px] md:text-xs font-bold text-slate-500 uppercase">🛍️ Siap Diambil ({pickupOrders.length})</h3>
              <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl text-amber-900 text-[10px] md:text-xs"><p className="font-bold mb-1">⚠️ Komplain 1x24 Jam dengan nota resmi.</p></div>
              {pickupOrders.map((order) => (
                <div key={order.id} className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap"><h4 className="font-bold text-blue-900 text-sm">{order.customer_name}</h4><span className="text-[10px] font-mono font-bold bg-blue-100 border border-blue-200 text-blue-800 px-2 py-0.5 rounded-md">{order.receipt_number}</span></div>
                      <p className="text-[10px] text-blue-700 mt-1">{order.service_type}</p>
                    </div>
                    <span className="text-[10px] font-bold bg-blue-600 text-white px-2 py-1 rounded shadow-sm">Rak: {order.rack_number}</span>
                  </div>
                  <button onClick={() => handlePickupFinish(order)} disabled={isSubmitting} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3.5 rounded-xl text-xs shadow-md transition">✅ SERAHKAN</button>
                </div>
              ))}
              {pickupOrders.length === 0 && <p className="text-xs text-slate-400 text-center py-8">Tidak ada cucian di rak pengambilan.</p>}
            </div>
          )}

          {activeTab === 'expense' && (
            <div className="space-y-6">
              {/* TOMBOL PEMICU SETORAN CASH */}
          <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl flex justify-between items-center mb-4">
            <div>
              <h4 className="font-bold text-xs text-emerald-900">📲 Setoran Cash Outlet via Wallet/QRIS</h4>
              <p className="text-[10px] text-emerald-700">Top-up cash via Indomaret/Alfamart/m-Banking lalu setor ke QRIS Meja Kasir</p>
            </div>
            <button
              onClick={() => setShowDepositModal(true)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-2 rounded-xl text-xs shadow transition whitespace-nowrap"
            >
              Setor Sekarang
            </button>
          </div>
              <form onSubmit={handleExpenseSubmit} className="space-y-3 border rounded-xl p-4 shadow-sm">
                <h3 className="text-xs font-bold text-rose-600 border-b pb-2">💸 Pengeluaran Kas</h3>
                <select value={expCategory} onChange={(e) => setExpCategory(e.target.value)} className="w-full border rounded-xl px-3 py-3 text-xs md:text-sm">{settings?.coas?.map((c: string, i: number) => <option key={i} value={c}>{c}</option>)}</select>
                <input type="number" placeholder="Nominal Rp" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} className="w-full border rounded-xl px-3 py-3 text-lg font-bold text-rose-600" required />
                <input type="text" placeholder="Catatan Beli" value={expDesc} onChange={(e) => setExpDesc(e.target.value)} className="w-full border rounded-xl px-3 py-3 text-xs md:text-sm" required />
                <button type="submit" disabled={isSubmitting} className="w-full bg-rose-600 text-white font-bold py-3.5 rounded-xl text-sm">SIMPAN</button>
              </form>
              <form onSubmit={handleAddStock} className="space-y-3 border rounded-xl p-4 shadow-sm">
                <h3 className="text-xs font-bold text-indigo-600 border-b pb-2">📦 Tambah Stok</h3>
                <select value={stockItem} onChange={(e) => setStockItem(e.target.value)} className="w-full border rounded-xl px-3 py-3 text-xs md:text-sm"><option value="Detergen Premium (ml)">Detergen Premium</option><option value="Parfum Lavender (ml)">Parfum Lavender</option></select>
                <input type="number" placeholder="Jumlah LITER" value={stockAddAmount} onChange={(e) => setStockAddAmount(e.target.value)} className="w-full border rounded-xl px-3 py-3 text-lg font-bold text-indigo-600" required />
                <button type="submit" disabled={isSubmitting} className="w-full bg-indigo-600 text-white font-bold py-3.5 rounded-xl text-sm">SIMPAN</button>
              </form>
            
            {/* MODAL SETORAN CASH KASIR */}
      {showDepositModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-200 w-full max-w-md rounded-3xl p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="font-black text-slate-900 text-sm flex items-center gap-2">
                <span>🏧 Setoran Uang Cash Outlet</span>
              </h3>
              <button onClick={() => setShowDepositModal(false)} className="text-slate-400 font-bold text-sm">✖</button>
            </div>

            <div className="space-y-3">
              {/* Pilihan Metode Top Up */}
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Metode Top-Up / Setor</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDepositMethod('INDOMARET_ALFAMART');
                      setAdminFee('2500');
                    }}
                    className={`p-2.5 rounded-xl border text-xs font-bold transition ${
                      depositMethod === 'INDOMARET_ALFAMART'
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-800'
                        : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                  >
                    🏪 Indomaret / Alfamart
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDepositMethod('MBANKING_PERSONAL');
                      setAdminFee('0');
                    }}
                    className={`p-2.5 rounded-xl border text-xs font-bold transition ${
                      depositMethod === 'MBANKING_PERSONAL'
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-800'
                        : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                  >
                    🏦 m-Banking Pribadi
                  </button>
                </div>
              </div>

              {/* Nominal Cash Ditransfer */}
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Nominal Cash Disetor (Rp)</label>
                <input
                  type="number"
                  placeholder="Contoh: 250000"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl p-2.5 text-xs font-bold text-slate-900 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Biaya Admin Top-Up */}
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Biaya Admin (Rp) {depositMethod === 'MBANKING_PERSONAL' && <span className="text-rose-500">(Wajib 0)</span>}
                </label>
                <input
                  type="number"
                  disabled={depositMethod === 'MBANKING_PERSONAL'}
                  placeholder="0"
                  value={adminFee}
                  onChange={(e) => setAdminFee(e.target.value)}
                  className="w-full border border-slate-300 bg-slate-50 rounded-xl p-2.5 text-xs font-bold text-slate-900 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
                />
                {depositMethod === 'INDOMARET_ALFAMART' && (
                  <p className="text-[10px] text-emerald-700 mt-1 font-semibold">
                    * Biaya admin ini akan otomatis dicatat pada Pengeluaran Outlet.
                  </p>
                )}
              </div>

              {/* Catatan / URL Bukti Transfer */}
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Catatan / Keterangan (Opsional)</label>
                <input
                  type="text"
                  placeholder="Contoh: Top-up ShopeePay via Indomaret lalu scan QRIS Meja"
                  value={proofUrl}
                  onChange={(e) => setProofUrl(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none"
                />
              </div>

              {/* Panduan Singkat */}
              <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl text-[10px] text-amber-900 space-y-1">
                <p className="font-bold">📍 Langkah Akhir Kasir:</p>
                <p>1. Lakukan Scan QRIS Meja Kasir menggunakan e-Wallet / M-Banking Anda sejumlah nominal setoran.</p>
                <p>2. Tekan tombol <b>Kirim Setoran</b> di bawah untuk diteruskan ke tim Finance.</p>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowDepositModal(false)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 rounded-xl text-xs transition"
              >
                Batal
              </button>
              <button
                onClick={handleSubmitDeposit}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl text-xs shadow transition"
              >
                Kirim Setoran
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )}
          {activeTab === 'performance' && (
            <div className="space-y-4">

              {/* FITUR ABSENSI */}
              <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
                <h4 className="font-bold text-slate-800 text-sm mb-3">📅 Absensi Kehadiran (Hari Ini)</h4>
                {!todayAttendance ? (
                  <button onClick={handleClockIn} disabled={isSubmitting} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-lg text-xs shadow-md transition">
                    📍 ABSEN MASUK KERJA
                  </button>
                ) : !todayAttendance.check_out ? (
                  <div className="flex flex-col gap-3">
                    <div className="bg-emerald-50 text-emerald-800 px-3 py-2 rounded-lg text-xs font-bold border border-emerald-200">✅ Sudah Absen Masuk: {new Date(todayAttendance.check_in).toLocaleTimeString('id-ID')} WIB</div>
                    <button onClick={handleClockOut} disabled={isSubmitting} className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold py-3 rounded-lg text-xs shadow-md transition">
                      🏠 ABSEN PULANG
                    </button>
                  </div>
                ) : (
                  <div className="bg-slate-100 text-slate-700 px-3 py-2 rounded-lg text-xs font-bold border border-slate-200 text-center">
                    Shift Selesai! (Masuk: {new Date(todayAttendance.check_in).toLocaleTimeString('id-ID')} | Pulang: {new Date(todayAttendance.check_out).toLocaleTimeString('id-ID')})
                  </div>
                )}
              </div>
{/* FORM PENGAJUAN KASBON KARYAWAN */}
<form onSubmit={handleApplyLoan} className="bg-white border border-slate-200 p-5 rounded-2xl space-y-3 shadow-sm">
              <h3 className="font-bold text-xs text-indigo-900 flex items-center gap-1.5 border-b pb-2">
                <span>💵 Form Pengajuan Kasbon Karyawan</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  type="number"
                  placeholder="Nominal Kasbon (Rp)"
                  value={loanAmount}
                  onChange={(e) => setLoanAmount(e.target.value)}
                  className="border border-slate-300 rounded-xl p-2.5 text-xs font-bold text-slate-900 focus:outline-none"
                />
                <input
                  type="text"
                  placeholder="Alasan Pengajuan Kasbon..."
                  value={loanReason}
                  onChange={(e) => setLoanReason(e.target.value)}
                  className="border border-slate-300 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none"
                />
              </div>
              <p className="text-[10px] text-slate-500 italic">* Kasbon yang disetujui Supervisor akan otomatis dipotong saat penggajian.</p>
              <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl text-xs shadow transition">
                Ajukan Kasbon Sekarang
              </button>
            </form>

            {/* FORM LAPOR KENDALA OUTLET (KPI SUPERVISOR) */}
            <form onSubmit={handleReportIncident} className="bg-white border border-rose-200 p-5 rounded-2xl space-y-3 shadow-sm">
              <h3 className="font-bold text-xs text-rose-900 flex items-center gap-1.5 border-b pb-2">
                <span>🚨 Lapor Kendala / Keluhan Outlet ke Supervisor</span>
              </h3>
              <input
                type="text"
                placeholder="Judul Kendala (Contoh: Mesin Cuci No. 2 Bocor)"
                value={incidentTitle}
                onChange={(e) => setIncidentTitle(e.target.value)}
                className="w-full border border-slate-300 rounded-xl p-2.5 text-xs font-bold text-slate-900 focus:outline-none"
              />
              <textarea
                rows={3}
                placeholder="Rincian kendala secara detail..."
                value={incidentDesc}
                onChange={(e) => setIncidentDesc(e.target.value)}
                className="w-full border border-slate-300 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none"
              ></textarea>
              <button type="submit" className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-2.5 rounded-xl text-xs shadow transition">
                Kirim Laporan Kendala
              </button>
            </form>
              {/* PRODUKSI HARI INI */}
              <div className="bg-gradient-to-r from-emerald-600 to-teal-600 rounded-2xl p-4 text-white shadow-md space-y-3">
                <div className="flex justify-between items-center border-b border-white/20 pb-2">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider opacity-80">Produksi Hari Ini (Rincian Tahapan)</p>
                    <p className="text-lg font-black">{todayStats.kg} <span className="text-xs font-normal">Kg Total</span> / {todayStats.pcs} <span className="text-xs font-normal">Pcs Total</span></p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wider opacity-80">Upah Harian</p>
                    <p className="text-xl font-black">Rp {todayStats.pay.toLocaleString('id-ID')}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-1.5 text-[10px]">
                  <div className="bg-white/10 rounded-lg p-2 backdrop-blur-sm border border-white/10">
                    <span className="opacity-80 block font-semibold">🔍 Sortir</span>
                    <span className="font-bold text-xs">{todayBreakdown.sortir?.kg || 0} Kg / {todayBreakdown.sortir?.pcs || 0} Pcs</span>
                  </div>
                  <div className="bg-white/10 rounded-lg p-2 backdrop-blur-sm border border-white/10">
                    <span className="opacity-80 block font-semibold">🧼 Mencuci</span>
                    <span className="font-bold text-xs">{todayBreakdown.cuci?.kg || 0} Kg / {todayBreakdown.cuci?.pcs || 0} Pcs</span>
                  </div>
                  <div className="bg-white/10 rounded-lg p-2 backdrop-blur-sm border border-white/10">
                    <span className="opacity-80 block font-semibold">🌀 Keringkan</span>
                    <span className="font-bold text-xs">{todayBreakdown.kering?.kg || 0} Kg / {todayBreakdown.kering?.pcs || 0} Pcs</span>
                  </div>
                  <div className="bg-white/10 rounded-lg p-2 backdrop-blur-sm border border-white/10">
                    <span className="opacity-80 block font-semibold">👔 Setrika</span>
                    <span className="font-bold text-xs">{todayBreakdown.setrika?.kg || 0} Kg / {todayBreakdown.setrika?.pcs || 0} Pcs</span>
                  </div>
                  <div className="bg-white/10 rounded-lg p-2 backdrop-blur-sm border border-white/10 col-span-2 md:col-span-1">
                    <span className="opacity-80 block font-semibold">📦 Packing</span>
                    <span className="font-bold text-xs">{todayBreakdown.packing?.kg || 0} Kg / {todayBreakdown.packing?.pcs || 0} Pcs</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {inventory.map((item, idx) => (
                  <div key={idx} className="bg-slate-50 p-2 rounded-lg border text-center">
                    <span className="text-[9px] text-slate-500 block">{item.item_name}</span>
                    <span className="text-sm font-black text-slate-800">{(item.stock_ml_gram / 1000).toFixed(1)} L</span>
                  </div>
                ))}
              </div>

              {/* RINCIAN GAJI AKHIR BULAN */}
              <div className="bg-white border rounded-xl p-4 space-y-2 text-xs relative">
                <h4 className="font-bold text-emerald-700 border-b pb-2 mb-2">🧮 Rincian Gaji Akhir Bulan (THP)</h4>
                
                <div className="flex justify-between items-center bg-indigo-50/60 p-2 rounded-xl border border-indigo-100 my-2">
                  <span className="font-bold text-indigo-900 text-[11px]">⏳ Masa Kerja / Lama Bekerja:</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="1"
                      value={tenureMonths}
                      onChange={(e) => setTenureMonths(Math.max(1, Number(e.target.value) || 1))}
                      className="w-16 border border-indigo-300 rounded-lg p-1 font-black text-center text-indigo-700 bg-white text-xs focus:outline-none focus:border-indigo-500 shadow-sm"
                    />
                    <span className="font-bold text-indigo-900 text-xs">Bulan</span>
                  </div>
                </div>

                <div className="flex justify-between"><span>Gaji Pokok:</span><b>Rp {empBasicSalary.toLocaleString('id-ID')}</b></div>
                <div className="flex justify-between"><span>Upah Borongan:</span><b>Rp {calcStats.productionPay.toLocaleString('id-ID')}</b></div>
                
                <div className="flex justify-between text-indigo-600">
                  <span>Bonus Loyalitas ({tenureBonusLabel}) - <span className="italic">{tenureMonths} Bln Kerja</span>:</span>
                  <b>+ Rp {tenureBonusAmount.toLocaleString('id-ID')}</b>
                </div>

                <div className="flex justify-between text-purple-600"><span>Bonus Jual Member:</span><b>+ Rp {calcStats.membershipBonus.toLocaleString('id-ID')}</b></div>
                
                {empLoansDeduction > 0 && (
                  <div className="flex justify-between text-amber-700 bg-amber-50 p-1.5 rounded font-bold">
                    <span>Cicilan Kasbon Bulan Ini:</span>
                    <span>- Rp {empLoansDeduction.toLocaleString('id-ID')}</span>
                  </div>
                )}

                {empPenaltiesDeduction > 0 && (
                  <div className="flex justify-between text-rose-700 bg-rose-50 p-1.5 rounded font-bold">
                    <span>Potongan Denda Kesalahan:</span>
                    <span>- Rp {empPenaltiesDeduction.toLocaleString('id-ID')}</span>
                  </div>
                )}

                <div className="flex justify-between border-t pt-2 mt-2 items-center">
                  <span className="font-bold text-emerald-700">Total Take Home Pay</span>
                  <span className="text-xl font-black text-emerald-600">Rp {totalTakeHomePay.toLocaleString('id-ID')}</span>
                </div>

                <button onClick={handlePrintPayslip} className="w-full mt-4 bg-slate-800 text-white font-bold py-3 rounded-lg text-xs shadow transition">
                  🖨️ Cetak / Download Slip Gaji (PDF)
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}