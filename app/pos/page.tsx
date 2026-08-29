'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useRef, useState, Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';
import StageTimeline from '@/components/StageTimeline';
import { PAID_STAGE_KEYS, stageKeyOf } from '@/lib/stageTimeline';
import RequisitionForm from '@/components/RequisitionForm';
import OutletIssueForm from '@/components/OutletIssueForm';
import RoleTaskInbox from '@/components/RoleTaskInbox';
import KpiRoleMonitoring from '@/components/KpiRoleMonitoring';
import { updatePickupOrder, markPickupConvertedToPos } from '@/lib/pickupUpdates';
import { insertWithFallback, updateWithFallback } from '@/lib/safeWrite';
import { uploadProofFile } from '@/lib/uploadProof';
import { cartLineAmount } from '@/lib/kiloanPrice';
import FileProofInput from '@/components/FileProofInput';
import { createPaymentVerifyTask, isCsVerifiedPaid, isNonCashVerifyMethod, isPaymentLocked, PENDING_PAY_STATUS } from '@/lib/paymentVerify';
import {
  classifyQueueOrder,
  coalesceProsesCards,
  isExpressDuration,
  matchesQueueSearch,
  parseBagCount,
  parseOrderItems,
  rackDisplay,
  slaDueMs,
  slaRemainingLabel,
  sortProsesBySla
} from '@/lib/posQueue';

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

// Awalan "meng-" melebur dengan huruf k pada akar katanya (meng + kering ->
// mengeringkan), sehingga 'Mengeringkan' TIDAK mengandung substring 'kering'.
// Pencocokan tahap pengeringan memakai akar 'ering' supaya 'Kering',
// 'Pengeringan', dan 'Mengeringkan' sama-sama terdeteksi.
const isDryingStatus = (statusStr: string) =>
  String(statusStr || '').toLowerCase().trim().includes('ering');

// Peleburan yang sama terjadi pada 'Mengemas' (meng + kemas -> mengemas), jadi
// akar 'emas' dipakai agar 'Kemas', 'Mengemas', dan 'Pengemasan' ikut terdeteksi
// selain istilah Inggris 'Packing'.
const isPackingStatus = (statusStr: string) => {
  const s = String(statusStr || '').toLowerCase().trim();
  return s.includes('pack') || s.includes('emas');
};

// Pemetaan tahap dipusatkan di lib/stageTimeline agar POS, Owner, dan halaman
// pelacakan pelanggan tidak pernah lagi memakai aturan pencocokan yang berbeda.
const getStageKey = stageKeyOf;

// Aplikasi customer menyimpan durasi dengan label pendek ('Oneday', 'Express'),
// sedangkan dropdown POS memakai label panjang. Tanpa normalisasi, <select> POS
// tidak menemukan option yang cocok sehingga tampil kosong.
const normalizePosDuration = (raw: any) => {
  const d = String(raw || '').toLowerCase();
  if (d.includes('oneday') || d.includes('1 hari') || d.includes('24 jam')) return 'Oneday (1 Hari / 24 Jam)';
  if (d.includes('express') || d.includes('6 jam')) return 'Express (6 Jam)';
  if (d.includes('quick') || d.includes('3 jam')) return 'Quick (3 Jam)';
  return 'Reguler (3 Hari)';
};

// service_type dari aplikasi customer berbentuk "Cuci Kering Gosok (Oneday)".
// Imbuhan durasi di dalam tanda kurung harus dibuang, kalau tidak nama layanan
// tidak akan cocok dengan daftar `services` dan harga jatuh ke tarif default.
const cleanServiceName = (raw: any) =>
  String(raw || '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();

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

interface CustomerOrder {
  id: string;
  customer_name: string;
  customer_phone: string;
  address: string;
  service_type: string;
  duration: string;
  bag_count: number | string;
  wash_process: string;
  has_fading: boolean;
  has_valuables: boolean;
  notes: string;
  phone_number?: string;
  items?: PickupItem[] | string;
  estimated_weight?: number | string;
  delivery_fee?: number | string;
  status?: string;
}

interface PickupItem {
  name: string;
  qty: number | string;
  price?: number | string;
  basePrice?: number | string;
  duration?: string;
  type?: 'kg' | 'pcs';
}

export function POSContent() {
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

  // State Closing Shift / Blind Cash Count
  const [showClosingModal, setShowClosingModal] = useState(false);
  const [physicalCashCount, setPhysicalCashCount] = useState('');
  const [closingNotes, setClosingNotes] = useState('');

  // Reset state penguncian tombol saat halaman dimuat
  useEffect(() => {
    setIsSubmitting(false);
  }, []);

  // --- AUTO-FILL PENJEMPUTAN DRIVER KE FORM POS ---
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const skipPickupPrefillRef = useRef(false);
  const [customerOrder, setCustomerOrder] = useState<CustomerOrder | null>(null);
  const [address, setAddress] = useState('');
  const [bagCount, setBagCount] = useState('1');
  const [washProcess, setWashProcess] = useState('Pisah');
  const [hasFading, setHasFading] = useState(false);
  const [hasValuables, setHasValuables] = useState(false);

  const applyPickupToForm = (data: CustomerOrder) => {
    setCustomerOrder(data);
    setOrderType('Online');
    setCustomerName(data.customer_name || 'Pelanggan Online');
    setCustomerPhone(data.customer_phone || data.phone_number || '');
    setAddress(data.address || '');
    setDuration(normalizePosDuration(data.duration));
    setBagCount(String(data.bag_count ?? '1'));
    setWashProcess(data.wash_process || 'Pisah');
    setHasFading(Boolean(data.has_fading));
    setHasValuables(Boolean(data.has_valuables));
    setNotes(data.notes || '');

    const serviceName = cleanServiceName(data.service_type);
    if (serviceName) {
      setServiceType(serviceName);
      setSelectedServiceInput(serviceName);
    }

    if (data.delivery_fee) setDeliveryFee(String(data.delivery_fee));

    // Hanya item satuan yang sudah punya harga asli yang masuk keranjang.
    // Entri tanpa harga sengaja dilewati supaya tidak muncul baris palsu
    // "1 x Rp 0"; layanan kiloan cukup mengisi form lalu kasir menekan
    // "Tambahkan ke Keranjang" agar harganya dihitung dari berat timbangan.
    const rawItems = safeParse(data.items, []);
    if (Array.isArray(rawItems) && rawItems.length > 0) {
      const mappedCart = rawItems
        .filter((it: any) => it && (it.name || it.service_name))
        .map((it: any, idx: number) => {
          const isKg = (it.type || it.unit || '').toLowerCase() === 'kg';
          const itemPrice = Number(it.price || it.unit_price || 0);
          const itemBase = Number(it.basePrice || it.base_price || itemPrice);
          const kgVal = Number(it.weight || it.kg) || 0;
          const pcsVal = Number(it.qty || it.quantity) || 0;
          const existingNote = String(it.notes || it.note || '').trim();
          const pcsNote = isKg && kgVal > 0 && pcsVal > 0 ? `${pcsVal} Pcs` : '';
          return {
            id: it.id || `pickup-${idx}-${Date.now()}`,
            name: String(it.name || it.service_name),
            type: isKg ? ('kg' as const) : ('pcs' as const),
            basePrice: itemBase,
            price: itemPrice,
            qty: isKg ? (kgVal || pcsVal || 1) : (pcsVal || 1),
            note: [existingNote, pcsNote].filter(Boolean).join(' · ')
          };
        })
        .filter((it) => it.price > 0);

      setCartItems(mappedCart);
    } else {
      setCartItems([]);
    }

    // Estimasi berat pelanggan diisi ke input Kg agar kasir tidak mengetik ulang.
    // Ini hanya nilai awal: kasir wajib menimbang di outlet dan bebas menimpanya.
    // Hanya `inputQtyKg` yang diisi (bukan weightKg) supaya field benar-benar
    // kosong ketika kasir menghapusnya — input memakai value={inputQtyKg || weightKg}.
    const estWeight = Number(data.estimated_weight) || 0;
    setWeightKg('');
    setInputQtyKg(estWeight > 0 ? String(estWeight) : '');
  };

  const clearPickupPrefill = () => {
    skipPickupPrefillRef.current = true;
    setCustomerOrder(null);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const keys = [
      'pickup_id',
      'name',
      'phone',
      'service',
      'notes',
      'delivery_fee',
      'order_type',
      'duration',
      'address',
      'estimated_weight',
      'weight'
    ];
    let changed = false;
    keys.forEach((k) => {
      if (url.searchParams.has(k)) {
        url.searchParams.delete(k);
        changed = true;
      }
    });
    if (!changed) return;
    const next = url.pathname + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : '');
    window.history.replaceState({}, '', next);
    router.replace(next || pathname || '/pos', { scroll: false });
  };

  useEffect(() => {
    if (skipPickupPrefillRef.current) {
      skipPickupPrefillRef.current = false;
      return;
    }
    const pickupId = searchParams.get('pickup_id');
    const urlName = searchParams.get('name');
    const urlPhone = searchParams.get('phone');
    const urlService = searchParams.get('service');
    const urlDeliveryFee = searchParams.get('delivery_fee');
    const urlOrderType = searchParams.get('order_type');
    const urlDuration = searchParams.get('duration');
    const urlAddress = searchParams.get('address');
    const urlWeight = searchParams.get('estimated_weight') || searchParams.get('weight');

    // Layer 1: isi instan dari query param
    if (urlName) setCustomerName(decodeURIComponent(urlName));
    if (urlPhone) setCustomerPhone(decodeURIComponent(urlPhone));
    if (urlAddress) setAddress(decodeURIComponent(urlAddress));
    if (urlService) {
      const svc = cleanServiceName(decodeURIComponent(urlService));
      setSelectedServiceInput(svc);
      setServiceType(svc);
    }
    if (urlDuration) setDuration(normalizePosDuration(decodeURIComponent(urlDuration)));
    if (urlWeight && Number(urlWeight) > 0) setInputQtyKg(String(Number(urlWeight)));
    if (urlDeliveryFee) setDeliveryFee(urlDeliveryFee);
    if (urlName || urlPhone || pickupId) setOrderType(urlOrderType || 'Online');
  
    if (!pickupId) return;
  
    // Layer 2: database sebagai sumber kebenaran
    let cancelled = false;
    const fetchFullPickupDetails = async () => {
      try {
        const { data, error } = await supabase
          .from('pickup_orders')
          .select('*')
          .eq('id', pickupId)
          .single();
  
        if (error) throw error;
        if (data && !cancelled) applyPickupToForm(data as CustomerOrder);
      } catch (err) {
        console.error('Gagal mengambil detail penjemputan:', err);
      }
    };
  
    fetchFullPickupDetails();
    return () => { cancelled = true; };
  }, [searchParams]);

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

// Handler Submit Closing Shift & Blind Cash Count
const handleSubmitClosingShift = async () => {
  const physicalAmount = parseFloat(physicalCashCount);
  if (isNaN(physicalAmount) || physicalAmount < 0) {
    return alert('⚠️ Masukkan jumlah fisik uang tunai di laci secara valid!');
  }

  // Hitung total penerimaan tunai sistem hari ini untuk outlet aktif
  const { data: cashOrders } = await supabase
    .from('transactions')
    .select('total_amount, amount_paid')
    .eq('outlet_id', selectedOutlet)
    .ilike('payment_method', '%cash%');

  const expectedSystemCash = (cashOrders || []).reduce((acc, curr) => acc + (Number(curr.amount_paid) || Number(curr.total_amount) || 0), 0);
  const cashDifference = physicalAmount - expectedSystemCash;

  // Catat data closing ke tabel cash_closings / expenses jika ada minus
  const { error } = await supabase.from('cash_closings').insert([
    {
      outlet_id: selectedOutlet,
      cashier_id: employeeId || '00000000-0000-0000-0000-000000000000',
      system_expected_cash: expectedSystemCash,
      physical_actual_cash: physicalAmount,
      cash_difference: cashDifference,
      notes: closingNotes.trim() || 'Closing Shift Kasir Regular'
    }
  ]);

  if (error) {
    return alert('❌ Gagal menyimpan closing shift: ' + error.message);
  }

  // Jika terjadi selisih kas (minus), catat otomatis ke laporan selisih kas
  if (cashDifference < 0) {
    await supabase.from('expenses').insert([
      {
        outlet_id: selectedOutlet,
        amount: Math.abs(cashDifference),
        notes: `Selisih Minus Kas Laci Shift Kasir (${employeeName || 'Kasir'})`,
        category: 'Selisih Kas'
      }
    ]);
  }

  alert(
    `✅ Closing Shift Berhasil!\n\n` +
    `• Fisik Kas: Rp ${physicalAmount.toLocaleString('id-ID')}\n` +
    `• Kas Sistem: Rp ${expectedSystemCash.toLocaleString('id-ID')}\n` +
    `• Status: ${cashDifference === 0 ? 'SEIMBANG (MATCH) ✨' : cashDifference > 0 ? `SURPLUS (+Rp ${cashDifference.toLocaleString('id-ID')})` : `MINUS (-Rp ${Math.abs(cashDifference).toLocaleString('id-ID')}) ⚠️`}`
  );

  setShowClosingModal(false);
  setPhysicalCashCount('');
  setClosingNotes('');
  
  // Jalankan Absen Pulang
  handleClockOut();
};

// State Kasbon Terintegrasi (Limit 60% Hari Kerja & Surat Piutang)
const [loanAmount, setLoanAmount] = useState('');
const [loanReason, setLoanReason] = useState('');
const [isSpecialLoan, setIsSpecialLoan] = useState(false);
const [piutangDocNo, setPiutangDocNo] = useState('');

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
  const [serviceQuery, setServiceQuery] = useState('');
  const [serviceCat, setServiceCat] = useState<'all' | 'kg' | 'pcs'>('all');
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
  const [rackNotes, setRackNotes] = useState('');
  const [rackPhotoFile, setRackPhotoFile] = useState<File | null>(null);
  const [stageProof, setStageProof] = useState<{ order: any; targetStatus: string } | null>(null);
  const [stageProofFile, setStageProofFile] = useState<File | null>(null);
  const [stageProofNotes, setStageProofNotes] = useState('');
  const [queueSearch, setQueueSearch] = useState('');
  const [completedPickups, setCompletedPickups] = useState<any[]>([]);
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
  // Kunci per-tombol (id transaksi + index item) supaya hanya tombol yang sedang
  // diproses yang nonaktif, bukan seluruh halaman POS.
  const [statusUpdatingKey, setStatusUpdatingKey] = useState<string | null>(null);
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

    const isPcs = activeSvc
      ? activeSvc.type === 'pcs'
      : !(Number(inputQtyKg) || Number(weightKg)) && (Number(inputQtyPcs) > 0 || Number(pcsCount) > 0);
    const qty = isPcs
      ? (Number(inputQtyPcs) || Number(pcsCount) || 1)
      : (Number(inputQtyKg) || Number(weightKg) || 0);
    const pcsNote = !isPcs && (Number(inputQtyPcs) || Number(pcsCount))
      ? `${Number(inputQtyPcs) || Number(pcsCount)} Pcs`
      : '';

    // Tanpa penjaga ini, berat kosong diam-diam dihitung sebagai 1 Kg sehingga
    // harga baris nota salah.
    if (!isPcs && qty <= 0) {
      return alert('⚠️ Isi berat (Kg) hasil timbangan terlebih dahulu sebelum menambahkan ke keranjang!');
    }

    const newItem = {
      id: Math.random().toString(),
      name: targetService,
      type: isPcs ? ('pcs' as const) : ('kg' as const),
      basePrice: basePrice,
      price: finalUnitPrice,
      qty: qty,
      note: [inputItemNote, pcsNote].filter(Boolean).join(' · ')
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
    applyPickupToForm(pickup as CustomerOrder);
    setActiveTab('pos');
    alert('✅ 10 Data lengkap penjemputan berhasil ditarik ke Form POS!');
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
        totalSubtotal += cartLineAmount(item, durationMultiplier);
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
      const qty = activeSvc && activeSvc.type === 'pcs' ? qtyPcs : qtyKg;

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

        const assignedOutlet = String(
          user.outlet_id || user.user_metadata?.outlet_id || user.raw_user_meta_data?.outlet_id || ''
        );
        const roleKey = String(user.role || 'kasir').toLowerCase().trim();
        const lockedToOutlet = ['kasir', 'pos'].includes(roleKey) && assignedOutlet && assignedOutlet !== 'ALL';

        try {
          localStorage.setItem('user_outlet_id', assignedOutlet);
          localStorage.setItem('userRole', roleKey);
          localStorage.setItem('outlet_id', assignedOutlet);
        } catch { /* ignore */ }

        if (lockedToOutlet || (assignedOutlet && assignedOutlet !== 'ALL')) {
          setIsMultiOutletUser(false);
          setSelectedOutlet(assignedOutlet);
          const found = (dbOutlets || []).find((o: any) => o.id === assignedOutlet);
          setOutletName(found?.name || user.outlets?.name || 'Cabang Outlet');
          setOutletPhone(found?.whatsapp_number || user.outlets?.whatsapp_number || '');
        } else if (!assignedOutlet || assignedOutlet === 'ALL') {
          if (['kasir', 'pos'].includes(roleKey)) {
            setIsMultiOutletUser(false);
          } else {
            setIsMultiOutletUser(true);
          }
          if (dbOutlets && dbOutlets.length > 0) {
            setSelectedOutlet(dbOutlets[0].id);
            setOutletName(dbOutlets[0].name);
            setOutletPhone(dbOutlets[0].whatsapp_number || '');
          }
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
        const row: any = payload.new;
        if (row?.outlet_id && selectedOutlet && row.outlet_id !== selectedOutlet) return;
        try {
          const audio = new Audio('/notification.mp3');
          audio.play().catch(() => {});
        } catch (e) {}
        alert(`🔔 ORDERAN ONLINE BARU MASUK!\nService: ${row?.service_type || 'Penjemputan Customer'}`);
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

    const since = new Date();
    since.setDate(since.getDate() - 30);

    const [{ data: openOrders }, { data: doneOrders }] = await Promise.all([
      supabase
        .from('transactions')
        .select('*, outlets(name, whatsapp_number)')
        .eq('outlet_id', selectedOutlet)
        .neq('status', 'Selesai')
        .order('created_at', { ascending: false }),
      supabase
        .from('transactions')
        .select('*, outlets(name, whatsapp_number)')
        .eq('outlet_id', selectedOutlet)
        .in('status', ['Selesai', 'Diambil', 'Diantar', 'Delivered', 'Terkirim'])
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false })
    ]);

    const merged = [...(openOrders || []), ...(doneOrders || [])];
    const seen = new Set<string>();
    const unique = merged.filter((o) => {
      if (!o?.id || seen.has(o.id)) return false;
      seen.add(o.id);
      return true;
    });

    setActiveOrders(unique.filter((o) => classifyQueueOrder(o) === 'proses'));
    setPickupOrders(unique.filter((o) => classifyQueueOrder(o) === 'ambil'));
    setCompletedPickups(unique.filter((o) => classifyQueueOrder(o) === 'selesai'));

    const { data: incomingPkps } = await supabase
    .from('pickup_orders')
    .select('*')
    .eq('outlet_id', selectedOutlet)
    .neq('status', 'Selesai')
    .neq('status', 'Batal');

  const stillIncoming = (incomingPkps || []).filter((p: any) => {
    const s = String(p.status || '').toLowerCase();
    if (s.includes('tiba') || s.includes('diterima') || s.includes('kasir')) return false;
    if (s.includes('sortir') || s.includes('cuci') || s.includes('ering') || s.includes('setrika') || s.includes('pack') || s.includes('siap')) return false;
    if (s.includes('selesai')) return false;
    return true;
  });
  setIncomingPickupsCount(stillIncoming.length);

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

        // Hanya tahap berupah yang masuk rincian harian. Log non-upah (mis.
        // penyerahan 'Selesai' yang dicatat untuk stempel waktu) tidak boleh
        // memunculkan baris tambahan di rincian.
        if (PAID_STAGE_KEYS.includes(stageKey)) {
          if (tBreakdown[stageKey]) {
            tBreakdown[stageKey].kg += kg;
            tBreakdown[stageKey].pcs += pcs;
          } else {
            tBreakdown[stageKey] = { kg, pcs };
          }
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
      customer_phone: normalizedPhone || customerPhone || null,
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
      items: cartItems.length > 0 ? cartItems : [{ name: primaryServiceLabel, qty: totalPcsSum || 1, weight: totalKgSum || 0 }],
      payment_method: finalPaymentMethodLabel,
      status: isNonCashVerifyMethod(finalPaymentMethodLabel) ? PENDING_PAY_STATUS : 'Diterima',
      by_sortir: employeeName
    };
    const needsPayVerify = isNonCashVerifyMethod(finalPaymentMethodLabel);

    let { data: newTx, error } = await supabase.from('transactions').insert([orderData]).select('*, outlets(name, whatsapp_number)').single();
    if (error && needsPayVerify) {
      const retry = await supabase
        .from('transactions')
        .insert([{ ...orderData, status: 'Diterima' }])
        .select('*, outlets(name, whatsapp_number)')
        .single();
      newTx = retry.data;
      error = retry.error;
    }
    if (!error && newTx) {
      if (needsPayVerify) {
        await updateWithFallback(
          'transactions',
          [
            { payment_status: 'pending', status: PENDING_PAY_STATUS },
            { status: PENDING_PAY_STATUS }
          ],
          { column: 'id', value: newTx.id }
        );
        await createPaymentVerifyTask({
          id: newTx.id,
          receipt_number: generatedResi,
          customer_name: orderData.customer_name,
          customer_phone: normalizedPhone || customerPhone || undefined,
          amount: totalPay,
          payment_method: finalPaymentMethodLabel,
          outlet_id: selectedOutlet
        });
      }
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

      // Nota POS = cucian diterima kasir. Pickup tetap aktif di Beranda pelanggan
      // (bukan Selesai) sampai diserahkan / diantar.
    const params = new URLSearchParams(window.location.search);
    const pickupId = params.get('pickup_id') || customerOrder?.id || '';

    if (pickupId) {
      await markPickupConvertedToPos(pickupId, newTx.id);
      const linked = await supabase.from('transactions').update({ pickup_id: pickupId }).eq('id', newTx.id);
      if (linked.error) console.warn('pickup_id pada transactions dilewati:', linked.error.message);
    }
      setCustomerOrder(null);
      clearPickupPrefill();
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

const statusKeyOf = (order: any) =>
  `${order?.id}-${typeof order?.item_index === 'number' ? order.item_index : 'main'}`;

// Kegagalan pencatatan work_logs hanya diberitahukan sekali per sesi supaya kasir
// tidak dibanjiri popup, tapi tetap tahu kalau upah tahap tidak ikut tercatat.
let workLogWarningShown = false;

const handleStatusChange = async (order: any, targetStatus: string, proof?: { photoUrl?: string; notes?: string }) => {
  if (!order?.id) {
    alert('Gagal mengubah status: data pesanan tidak valid.');
    return;
  }

  if (selectedOutlet && order.outlet_id && String(order.outlet_id) !== String(selectedOutlet)) {
    alert('Pesanan ini milik outlet lain. Kasir hanya dapat memproses pesanan cabang sendiri.');
    return;
  }

  if (isPaymentLocked(order)) {
    alert('⏳ Pembayaran belum dikonfirmasi CS. Produksi terkunci sampai pembayaran lunas.');
    return;
  }

  const targetKey = stageKeyOf(targetStatus);
  if ((targetKey === 'sortir' || targetKey === 'packing') && !proof?.photoUrl) {
    setStageProof({ order, targetStatus });
    setStageProofFile(null);
    setStageProofNotes('');
    return;
  }

  // Packing -> Siap Diambil wajib lewat modal rak (nomor rak + jumlah pack).
  if (targetKey === 'siap') {
    const item = typeof order.item_index === 'number'
      ? parseOrderItems(order.items)[order.item_index]
      : null;
    setSelectedOrderForRack(order);
    setRackInput(String(item?.rack_location || order.rack_location || order.rack_number || ''));
    setBagInput(String(item?.package_count || order.package_count || ''));
    setRackNotes(String(item?.rack_notes || order.rack_notes || ''));
    setRackPhotoFile(null);
    setShowRackModal(true);
    return;
  }

  const key = statusKeyOf(order);
  if (statusUpdatingKey === key) return;

  try {
    setStatusUpdatingKey(key);

    const isSubItem = typeof order.item_index === 'number';
    // `items` bisa datang sebagai array atau string JSON, jadi selalu diparse dulu.
    const currentItems = isSubItem ? safeParse(order.items, []) : [];
    const subItem =
      isSubItem && Array.isArray(currentItems) ? currentItems[order.item_index] : null;
    let updateError: any = null;

    if (isSubItem) {
      // 1. Item turunan Multi-Item: status disimpan di dalam elemen array `items`.
      if (!subItem) {
        alert('Gagal mengubah status: rincian item tidak ditemukan.');
        return;
      }

      const updatedItems = currentItems.map((it: any, idx: number) => {
        if (idx !== order.item_index) return it;
        const next = { ...it, status: targetStatus };
        if (proof?.photoUrl && targetKey === 'sortir') {
          next.sortir_photo_url = proof.photoUrl;
          next.photo_url = proof.photoUrl;
        }
        if (proof?.photoUrl && targetKey === 'packing') {
          next.packing_photo_url = proof.photoUrl;
        }
        return next;
      });

      const { error } = await supabase
        .from('transactions')
        .update({ items: updatedItems })
        .eq('id', order.id);
      updateError = error;
    } else {
      // 2. Transaksi tunggal biasa.
      const { error } = await supabase
        .from('transactions')
        .update({ status: targetStatus })
        .eq('id', order.id);
      updateError = error;
    }

    if (updateError) {
      console.error('Error updating transaction status:', updateError);
      alert('Gagal mengubah status: ' + (updateError.message || 'Koneksi bermasalah'));
      return;
    }

    // 3. Sinkronkan pickup_orders hanya bila transaksi benar-benar punya referensi
    // penjemputan. Tanpa penjaga ini, id transaksi ikut dikirim ke tabel lain.
    if (order.pickup_id) {
      const { error: pickupErr } = await supabase
        .from('pickup_orders')
        .update({ status: targetStatus })
        .eq('id', order.pickup_id);
      if (pickupErr) console.warn('Sinkronisasi pickup_orders dilewati:', pickupErr.message);
    }

    // 4. Catat work log untuk tahap yang BARU SAJA diselesaikan, yaitu status
    // sebelum perubahan. Contoh: menekan "Siap Diambil" saat status 'Packing'
    // berarti tahap packing selesai, sehingga upah packing yang dicatat.
    // Transisi 'Diterima' -> 'Sortir' tidak dicatat karena belum ada tahap selesai.
    const completedStage = String(order.status || '').trim();
    if (PAID_STAGE_KEYS.includes(getStageKey(completedStage))) {
      const { error: logErr } = await insertWithFallback('work_logs', [
        {
          transaction_id: order.id,
          employee_name: employeeName || 'Kasir',
          stage: completedStage,
          service_type: subItem?.name || order.service_type || '',
          weight_kg: Number(subItem?.weight ?? order.weight_kg) || 0,
          pcs_count: Number(subItem?.qty ?? order.pcs_count) || 0,
          created_at: new Date().toISOString()
        },
        {
          transaction_id: order.id,
          employee_name: employeeName || 'Kasir',
          stage: completedStage,
          service_type: subItem?.name || order.service_type || '',
          weight_kg: Number(subItem?.weight ?? order.weight_kg) || 0,
          pcs_count: Number(subItem?.qty ?? order.pcs_count) || 0
        }
      ]);

      if (logErr) {
        console.error('Gagal mencatat work_logs (upah tahap ini tidak terhitung):', logErr);
        if (!workLogWarningShown) {
          workLogWarningShown = true;
          alert(
            '⚠️ Status berhasil diubah, tetapi pencatatan upah tahap gagal:\n' +
              (logErr.message || 'Koneksi bermasalah') +
              '\n\nMinta admin memeriksa struktur tabel work_logs.'
          );
        }
      }
    }

    if ((targetKey === 'sortir' || targetKey === 'packing') && proof?.photoUrl) {
      await insertWithFallback('work_logs', [
        {
          transaction_id: order.id,
          employee_name: employeeName || 'Kasir',
          stage: targetStatus,
          service_type: subItem?.name || order.service_type || '',
          weight_kg: Number(subItem?.weight ?? order.weight_kg) || 0,
          pcs_count: Number(subItem?.qty ?? order.pcs_count) || 0,
          notes: proof.notes || undefined,
          photo_url: proof.photoUrl,
          created_at: new Date().toISOString()
        },
        {
          transaction_id: order.id,
          employee_name: employeeName || 'Kasir',
          stage: targetStatus,
          service_type: subItem?.name || order.service_type || '',
          weight_kg: Number(subItem?.weight ?? order.weight_kg) || 0,
          pcs_count: Number(subItem?.qty ?? order.pcs_count) || 0,
          notes: proof.notes || undefined,
          photo_url: proof.photoUrl
        }
      ]);
      if (targetKey === 'sortir') {
        await updateWithFallback(
          'transactions',
          [{ sortir_photo_url: proof.photoUrl }],
          { column: 'id', value: order.id }
        );
      }
    }

    // 5. Potong stok bahan kimia (best-effort, tidak boleh membatalkan perubahan status)
    try {
      if (typeof deductChemicalInventory === 'function') {
        const itemName = order.service_name || order.service_type || 'Laundry';
        const qty = Number(order.weight_kg || order.quantity || 1);
        const outlet = order.outlet_name || selectedOutlet || 'Main Outlet';
        await deductChemicalInventory(itemName, qty, outlet);
      }
    } catch (chemErr) {
      console.warn('Inventory deduction skipped:', chemErr);
    }

    // 6. Perbarui state lokal lebih dulu agar kartu langsung berubah,
    // lalu tarik data terbaru dari server.
    setActiveOrders((prev) =>
      prev.map((o) => {
        if (o.id !== order.id) return o;
        if (!isSubItem) return { ...o, status: targetStatus };
        const parsed = safeParse(o.items, []);
        if (!Array.isArray(parsed)) return o;
        return {
          ...o,
          items: parsed.map((it: any, idx: number) => {
            if (idx !== order.item_index) return it;
            const next = { ...it, status: targetStatus };
            if (proof?.photoUrl && targetKey === 'sortir') {
              next.sortir_photo_url = proof.photoUrl;
              next.photo_url = proof.photoUrl;
            }
            if (proof?.photoUrl && targetKey === 'packing') {
              next.packing_photo_url = proof.photoUrl;
            }
            return next;
          })
        };
      })
    );

    if (typeof refreshData === 'function') {
      await refreshData();
    }
  } catch (err: any) {
    console.error('Error in handleStatusChange:', err);
    alert('Gagal mengubah status: ' + (err?.message || 'Terjadi kesalahan'));
  } finally {
    setStatusUpdatingKey(null);
  }
};

  const handleSubmitRack = async () => {
    const order = selectedOrderForRack;
    if (!order?.id) return;
    if (selectedOutlet && order.outlet_id && String(order.outlet_id) !== String(selectedOutlet)) {
      alert('Pesanan ini milik outlet lain. Kasir hanya dapat memproses pesanan cabang sendiri.');
      return;
    }

    const rack = rackInput.trim();
    const pkg = bagInput.trim();
    const notes = rackNotes.trim();
    if (!rack || !pkg) {
      alert('⚠️ Nomor/kode rak dan jumlah kantong/pack wajib diisi.');
      return;
    }
    const photoFile = rackPhotoFile;
    if (!photoFile) {
      alert('⚠️ Foto bukti penyimpanan rak wajib diunggah.');
      return;
    }

    const key = statusKeyOf(order);
    setIsSubmitting(true);
    setStatusUpdatingKey(key);

    try {
      const isSubItem = typeof order.item_index === 'number';
      const currentItems = parseOrderItems(order.items);
      let nextItems = currentItems;
      if (isSubItem) {
        if (!currentItems[order.item_index]) {
          alert('Gagal menyimpan rak: rincian item tidak ditemukan.');
          return;
        }
        nextItems = currentItems.map((it: any, idx: number) =>
          idx === order.item_index
            ? { ...it, status: 'Siap Diambil', rack_location: rack, package_count: pkg, rack_notes: notes || undefined }
            : it
        );
      }

      const allReady = !isSubItem || nextItems.every((it: any) => {
        const k = stageKeyOf(it?.status);
        return k === 'siap' || k === 'selesai';
      });

      const combinedLoc = isSubItem
        ? Array.from(new Set(nextItems.map((it: any) => it.rack_location).filter(Boolean))).join(', ') || rack
        : rack;
      const combinedPkg = isSubItem
        ? nextItems.map((it: any) => it.package_count).filter(Boolean).join(' + ') || pkg
        : pkg;
      const combinedNotes = isSubItem
        ? nextItems.map((it: any) => it.rack_notes).filter(Boolean).join(' · ') || notes
        : notes;

      const parentStatus = allReady ? 'Siap Diambil' : (order.status || 'Dikemas');
      const bagCount = parseBagCount(pkg);
      const subItem = isSubItem ? currentItems[order.item_index] : null;
      const rackPhotoUrl = await uploadProofFile(photoFile, `rack_${order.id}`);

      const txFull: Record<string, unknown> = {
        status: parentStatus,
        rack_location: combinedLoc,
        package_count: combinedPkg,
        rack_number: combinedLoc,
        bag_count: bagCount,
        rack_photo_url: rackPhotoUrl
      };
      if (notes || combinedNotes) txFull.rack_notes = combinedNotes || notes;
      if (isSubItem) txFull.items = nextItems;

      const { error: txErr } = await updateWithFallback('transactions', [
        txFull,
        {
          status: parentStatus,
          rack_number: combinedLoc,
          bag_count: bagCount,
          ...(isSubItem ? { items: nextItems } : {})
        },
        {
          status: parentStatus,
          ...(isSubItem ? { items: nextItems } : {})
        }
      ], { column: 'id', value: order.id });

      if (txErr) {
        alert('❌ Gagal menyimpan rak: ' + txErr.message);
        return;
      }

      if (order.pickup_id && allReady) {
        await updateWithFallback('pickup_orders', [
          {
            status: 'Siap Diambil',
            rack_location: combinedLoc,
            package_count: combinedPkg,
            rack_notes: combinedNotes || undefined
          },
          { status: 'Siap Diambil' }
        ], { column: 'id', value: order.pickup_id });
      } else if (allReady) {
        await updateWithFallback('pickup_orders', [
          { status: 'Siap Diambil', rack_location: combinedLoc, package_count: combinedPkg },
          { status: 'Siap Diambil' }
        ], { column: 'transaction_id', value: order.id });
      }

      const completedStage = String(order.status || 'Dikemas').trim();
      if (PAID_STAGE_KEYS.includes(getStageKey(completedStage))) {
        await insertWithFallback('work_logs', [
          {
            transaction_id: order.id,
            employee_name: employeeName || 'Kasir',
            stage: completedStage,
            service_type: subItem?.name || order.service_type || '',
            weight_kg: Number(subItem?.weight ?? order.weight_kg) || 0,
            pcs_count: Number(subItem?.qty ?? order.pcs_count) || 0,
            created_at: new Date().toISOString()
          },
          {
            transaction_id: order.id,
            employee_name: employeeName || 'Kasir',
            stage: completedStage,
            service_type: subItem?.name || order.service_type || '',
            weight_kg: Number(subItem?.weight ?? order.weight_kg) || 0,
            pcs_count: Number(subItem?.qty ?? order.pcs_count) || 0
          }
        ]);
      }

      const rackAudit = `Penyimpanan Rak: ${rack} | ${pkg}${notes ? ` | ${notes}` : ''}`;
      await insertWithFallback('work_logs', [
        {
          transaction_id: order.id,
          employee_name: employeeName || 'Kasir',
          stage: 'Penyimpanan Rak',
          service_type: subItem?.name || order.service_type || '',
          notes: rackAudit,
          photo_url: rackPhotoUrl,
          weight_kg: 0,
          pcs_count: bagCount,
          created_at: new Date().toISOString()
        },
        {
          transaction_id: order.id,
          employee_name: employeeName || 'Kasir',
          stage: rackAudit,
          service_type: subItem?.name || order.service_type || '',
          weight_kg: 0,
          pcs_count: 0
        }
      ]);

      setShowRackModal(false);
      setSelectedOrderForRack(null);
      setRackInput('');
      setBagInput('');
      setRackNotes('');
      setRackPhotoFile(null);
      setSuccessMsg(allReady
        ? '✅ Racking selesai. Pesanan pindah ke tab Ambil.'
        : '✅ Item disimpan di rak. Selesaikan dikemas item lain untuk pindah ke Ambil.');
      await refreshData();
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err: any) {
      alert('❌ Gagal menyimpan rak: ' + (err?.message || 'Terjadi kesalahan'));
    } finally {
      setIsSubmitting(false);
      setStatusUpdatingKey(null);
    }
  };

  const handleSubmitStageProof = async () => {
    if (!stageProof) return;
    if (!stageProofFile) {
      alert('⚠️ Foto tahap Sortir/Dikemas wajib diunggah.');
      return;
    }
    setIsSubmitting(true);
    try {
      const key = stageKeyOf(stageProof.targetStatus);
      const url = await uploadProofFile(stageProofFile, `stage_${key}_${stageProof.order?.id || 'tx'}`);
      const { order, targetStatus } = stageProof;
      setStageProof(null);
      setStageProofFile(null);
      await handleStatusChange(order, targetStatus, {
        photoUrl: url,
        notes: stageProofNotes.trim() || undefined
      });
      setStageProofNotes('');
    } catch (err: any) {
      alert('❌ Gagal unggah foto tahap: ' + (err?.message || 'Terjadi kesalahan'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePickupFinish = async (order: any) => {
    if (selectedOutlet && order.outlet_id && String(order.outlet_id) !== String(selectedOutlet)) {
      alert('Pesanan ini milik outlet lain. Kasir hanya dapat memproses pesanan cabang sendiri.');
      return;
    }
    if (!confirm(`Serahkan cucian ${order.customer_name}?`)) return;
    setIsSubmitting(true);

    const { error } = await supabase.from('transactions').update({ status: 'Selesai' }).eq('id', order.id);

    if (error) {
      console.error('Gagal menyerahkan cucian:', error);
      alert('❌ Gagal menyerahkan cucian: ' + (error.message || 'Koneksi bermasalah'));
      setIsSubmitting(false);
      return;
    }

    // Stempel waktu penyerahan. Tabel transactions tidak punya kolom waktu selain
    // created_at, jadi work_logs dipakai sebagai riwayat waktu. Berat/pcs sengaja 0
    // supaya baris ini tidak pernah dihitung sebagai upah produksi.
    const { error: logErr } = await supabase.from('work_logs').insert([
      {
        transaction_id: order.id,
        employee_name: employeeName || 'Kasir',
        stage: 'Selesai',
        service_type: order.service_type || '',
        weight_kg: 0,
        pcs_count: 0,
        created_at: new Date().toISOString()
      }
    ]);

    if (logErr) console.error('Gagal mencatat waktu penyerahan:', logErr);

    if (order.pickup_id) {
      await updatePickupOrder(order.pickup_id, { status: 'Selesai' });
    } else {
      await supabase.from('pickup_orders').update({ status: 'Selesai' }).eq('transaction_id', order.id);
    }

    setPickupOrders((prev) => prev.filter((o) => o.id !== order.id));
    setCompletedPickups((prev) => [{ ...order, status: 'Selesai' }, ...prev.filter((o) => o.id !== order.id)]);
    setSuccessMsg('✅ Diserahkan!'); refreshData(); setTimeout(() => setSuccessMsg(''), 3000); setIsSubmitting(false);
  };

  const handleRequestDelete = async (order: any) => {
    const reason = prompt(`Alasan hapus resi ${order.receipt_number || order.id}:`);
    if (!reason?.trim()) return alert('⚠️ Mohon tulis alasan!');
    
    setIsSubmitting(true);
    try {
      // 1. Simpan pengajuan ke tabel delete_requests (untuk dashboard Owner)
      await supabase.from('delete_requests').insert([{
        transaction_id: order.id,
        customer_name: order.customer_name || 'Pelanggan',
        reason: reason.trim(),
        requested_by: employeeName || 'Kasir'
      }]);

      // 2. Tandai transaksi sebagai delete_requested agar tampil tanda 'Menunggu Approval'
      await supabase.from('transactions').update({ 
        delete_requested: true, 
        delete_reason: reason.trim() 
      }).eq('id', order.id);

      alert('✅ Permintaan hapus berhasil dikirim ke Owner!');
      await refreshData();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderNextStepButton = (order: any) => {
    const s = String(order?.status || '').toLowerCase().trim();
    const isBusy = statusUpdatingKey === statusKeyOf(order);

    // Pembungkus wajib: kartu induk punya onClick pembuka modal detail, sehingga klik
    // tombol harus dihentikan di sini agar tidak menembus ke atas.
    const wrap = (child: React.ReactNode) => (
      <div onClick={(e) => e.stopPropagation()} className="relative z-30 pointer-events-auto">
        {child}
      </div>
    );

    const stepButton = (label: string, targetStatus: string, color: string) =>
      wrap(
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleStatusChange(order, targetStatus);
          }}
          disabled={isBusy}
          className={`w-full ${color} text-white text-xs font-black py-2.5 rounded-xl shadow transition active:scale-[0.98] disabled:opacity-60 disabled:cursor-wait`}
        >
          {isBusy ? '⏳ Menyimpan...' : label}
        </button>
      );

    if (isPaymentLocked(order)) {
      return wrap(
        <div className="w-full bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-bold py-2.5 px-3 rounded-xl text-center animate-pulse">
          ⏳ Menunggu Konfirmasi Pembayaran CS
        </div>
      );
    }

    if (isCsVerifiedPaid(order) && (
      s.includes('diterima') ||
      s.includes('baru') ||
      s.includes('tiba') ||
      s.includes('disetujui') ||
      s.includes('dikonfirmasi') ||
      s === 'paid' ||
      s.includes('lunas') ||
      !s
    )) {
      return (
        <div className="space-y-2">
          <div className="w-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-bold py-2 px-3 rounded-xl text-center">
            ✅ Lunas - Siap Masuk Sortir
          </div>
          {stepButton('🔍 Sortir / Mulai Proses', 'Sortir', 'bg-slate-700 hover:bg-slate-800')}
        </div>
      );
    }

    // 1. Jika sedang menunggu persetujuan CS -> Tampilkan Badge Peringatan
    if (s.includes('menunggu konfirmasi')) {
      return (
        <div className="w-full bg-amber-50 border border-amber-200 text-amber-700 text-[11px] font-bold py-2 px-3 rounded-xl text-center flex items-center justify-center gap-1.5 animate-pulse">
          <span>⏳</span> Menunggu Persetujuan CS / Admin
        </div>
      );
    }

    // 2. TAHAP 1: Diterima / Baru / Telah Tiba di Outlet / Disetujui CS / Penjemputan -> Lanjut ke SORTIR
    if (
      s.includes('diterima') ||
      s.includes('baru') ||
      s.includes('penjemputan') ||
      s.includes('tiba') ||
      s.includes('disetujui') ||
      s.includes('dikonfirmasi') ||
      s.includes('menunggu cuci') ||
      !s
    ) {
      return stepButton('🔍 Mulai Sortir', 'Sortir', 'bg-slate-700 hover:bg-slate-800');
    }

    // 3. TAHAP 2: Sortir -> Lanjut ke MENCUCI.
    // Status 'Proses' (hasil verifikasi ulang kasir/CS) ikut di sini supaya cucian
    // melanjutkan ke tahap mencuci, bukan mundur lagi ke sortir.
    if (s.includes('sortir') || s.includes('proses')) {
      return stepButton('🧼 Mulai Mencuci', 'Mencuci', 'bg-cyan-500 hover:bg-cyan-600');
    }

    // 4. TAHAP 3: Mencuci / Cuci -> Lanjut ke MENGERINGKAN
    if (s.includes('cuci') || s.includes('mencuci')) {
      return stepButton('🌀 Mulai Mengeringkan', 'Mengeringkan', 'bg-sky-500 hover:bg-sky-600');
    }

    // 5. TAHAP 4: Mengeringkan / Kering / Pengeringan -> Lanjut ke SETRIKA
    if (isDryingStatus(s)) {
      return stepButton('👔 Mulai Setrika', 'Setrika', 'bg-amber-500 hover:bg-amber-600');
    }

    // 6. TAHAP 5: Setrika / Gosok -> Lanjut ke PACKING
    if (s.includes('setrika') || s.includes('gosok')) {
      return stepButton('🎁 Mulai Dikemas', 'Dikemas', 'bg-violet-500 hover:bg-violet-600');
    }

    // 7. TAHAP 6: Packing / Kemas -> modal rak wajib, lalu SIAP DIAMBIL (pindah ke tab Ambil).
    if (isPackingStatus(s)) {
      return stepButton('📦 Simpan ke Rak / Siap Diambil', 'Siap Diambil', 'bg-emerald-600 hover:bg-emerald-700');
    }

    // 8. TAHAP AKHIR: sudah siap diambil. Tanpa cabang ini status 'Siap Ambil'/'Siap Diambil'
    // jatuh ke fallback dan justru dikembalikan ke 'Sortir'.
    if (s.includes('siap')) {
      return (
        <div className="w-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-bold py-2 px-3 rounded-xl text-center">
          ✅ Siap Diambil — proses pengerjaan selesai
        </div>
      );
    }

    // 9. Sudah diserahkan / dibatalkan: tidak ada langkah lanjutan.
    if (s.includes('selesai') || s.includes('diambil') || s.includes('batal')) {
      return (
        <div className="w-full bg-slate-50 border border-slate-200 text-slate-500 text-[11px] font-bold py-2 px-3 rounded-xl text-center">
          {s.includes('batal') ? '🚫 Pesanan dibatalkan' : '🎉 Pesanan sudah diserahkan'}
        </div>
      );
    }

    // Fallback jika status tidak dikenal
    return stepButton('🔄 Lanjutkan Pengerjaan', 'Sortir', 'bg-indigo-600 hover:bg-indigo-700');
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

  const visibleProses = useMemo(
    () =>
      coalesceProsesCards(sortProsesBySla(activeOrders.filter((o) => matchesQueueSearch(o, queueSearch)))),
    [activeOrders, queueSearch]
  );
  const visibleAmbil = useMemo(
    () => pickupOrders.filter((o) => matchesQueueSearch(o, queueSearch)),
    [pickupOrders, queueSearch]
  );
  const visibleAmbilDone = useMemo(
    () => completedPickups.filter((o) => matchesQueueSearch(o, queueSearch)),
    [completedPickups, queueSearch]
  );

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
                      <span className="text-[8px]">{item.type === 'kg' ? `${item.qty} Kg` : `${item.qty} Pcs`} x Rp {Number(item.price).toLocaleString('id-ID')}</span>
                      {item.note && <span className="block text-[8px] italic">({item.note})</span>}
                    </div>
                    <span className="font-bold">Rp {cartLineAmount(item).toLocaleString('id-ID')}</span>
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
            <h3 className="text-lg font-black mb-1 text-slate-800">📦 Penyimpanan Rak</h3>
            <p className="text-xs text-slate-500 mb-4">
              Milik: <span className="font-bold text-emerald-600">{selectedOrderForRack?.customer_name}</span>
              {selectedOrderForRack?.receipt_number && (
                <span className="font-mono text-slate-600"> · {selectedOrderForRack.receipt_number}</span>
              )}
            </p>
            <div className="space-y-3 mb-6">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Nomor / Kode Rak <span className="text-rose-500">*</span></label>
                <input
                  type="text"
                  value={rackInput}
                  onChange={(e) => setRackInput(e.target.value)}
                  placeholder='Contoh: Rak A-02'
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-sm font-bold text-slate-800 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Jumlah Kantong / Pack <span className="text-rose-500">*</span></label>
                <input
                  type="text"
                  value={bagInput}
                  onChange={(e) => setBagInput(e.target.value)}
                  placeholder="Contoh: 2 Pack  atau  1 Plastik + 1 Hanger"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-sm font-bold text-slate-800 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Catatan Penyimpanan <span className="text-slate-400 font-semibold">(opsional)</span></label>
                <input
                  type="text"
                  value={rackNotes}
                  onChange={(e) => setRackNotes(e.target.value)}
                  placeholder="Contoh: Gantung di Hanger C-01"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-sm text-slate-800 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Foto Bukti Rak <span className="text-rose-500">*</span></label>
                <FileProofInput file={rackPhotoFile} onFile={setRackPhotoFile} capture="environment" />
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setShowRackModal(false); setSelectedOrderForRack(null); setRackPhotoFile(null); }} className="flex-1 bg-slate-100 font-bold py-3 rounded-xl text-slate-600 text-sm">Kembali</button>
              <button type="button" onClick={handleSubmitRack} disabled={isSubmitting || !rackInput.trim() || !bagInput.trim() || !rackPhotoFile} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl text-sm disabled:opacity-50">Simpan ke Rak</button>
            </div>
          </div>
        </div>
      )}

      {stageProof && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-black mb-1 text-slate-800">
              📸 Foto {stageKeyOf(stageProof.targetStatus) === 'sortir' ? 'Sortir' : 'Dikemas'}
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Milik: <span className="font-bold text-emerald-600">{stageProof.order?.customer_name}</span>
            </p>
            <div className="space-y-3 mb-6">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Foto tahap <span className="text-rose-500">*</span></label>
                <FileProofInput file={stageProofFile} onFile={setStageProofFile} capture="environment" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Catatan staf <span className="text-slate-400 font-semibold">(opsional)</span></label>
                <input
                  type="text"
                  value={stageProofNotes}
                  onChange={(e) => setStageProofNotes(e.target.value)}
                  placeholder="Contoh: Noda kerah, 2 hanger terpisah"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-sm text-slate-800 focus:outline-none"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setStageProof(null); setStageProofFile(null); setStageProofNotes(''); }}
                className="flex-1 bg-slate-100 font-bold py-3 rounded-xl text-slate-600 text-sm"
              >
                Kembali
              </button>
              <button
                type="button"
                onClick={handleSubmitStageProof}
                disabled={isSubmitting || !stageProofFile}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl text-sm disabled:opacity-50"
              >
                {isSubmitting ? 'Mengunggah…' : 'Lanjut'}
              </button>
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

            <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
              <StageTimeline logs={txWorkLogs} transaction={selectedTxDetail} />
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

<div className="print:hidden min-h-screen bg-slate-50 text-slate-900 p-3 md:p-6 pb-24 md:pb-8 font-sans">
      <div className="w-full max-w-7xl mx-auto bg-white border border-slate-200/80 rounded-2xl p-4 md:p-5 mb-5 shadow-sm hover:shadow-md transition-all flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-emerald-500 rounded-2xl flex items-center justify-center text-xl text-white shadow-sm shrink-0">
            🛒
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg md:text-xl font-black tracking-tight text-slate-900">Kasir POS</h1>
              <span className="bg-emerald-50 text-emerald-700 text-[9px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider">Live</span>
            </div>
            <p className="text-xs text-slate-400 font-medium mt-0.5">
              {employeeName || 'Kasir'} <span className="text-slate-500">@{employeeUsername}</span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {isMultiOutletUser && outletsList.length > 0 && (
            <select 
              value={selectedOutlet} 
              onChange={(e) => handleOutletChange(e.target.value)} 
              className="flex-1 md:flex-initial bg-slate-50 border border-slate-200 text-slate-800 text-xs rounded-xl px-3 py-2.5 font-bold focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              {outletsList.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          )}
          <button 
            onClick={handleLogout} 
            className="bg-rose-50 hover:bg-rose-500 border border-rose-200 text-rose-600 hover:text-white active:scale-95 text-xs font-bold px-4 py-2.5 rounded-xl transition-all"
          >
            Keluar
          </button>
        </div>
      </div>

        {/* DESKTOP NAV BAR */}
        <div className="hidden md:grid w-full max-w-7xl mx-auto grid-cols-7 gap-1 p-1.5 bg-white border border-slate-200/80 rounded-xl mb-5 shadow-sm">
          <button onClick={() => setActiveTab('pos')} className={`py-2 rounded-lg text-[10px] font-bold ${activeTab === 'pos' ? 'bg-emerald-600 text-white shadow' : 'text-slate-500 hover:bg-slate-100'}`}>🛒 POS</button>
          
          <Link href="/admin/pickups" className="py-2 rounded-lg text-[10px] font-bold text-center bg-blue-50 text-blue-800 border border-blue-200 hover:bg-blue-100 flex items-center justify-center gap-0.5 relative transition">
            <span>🛵 Online</span>
            {incomingPickupsCount > 0 && (
              <span className="bg-rose-500 text-white text-[8px] font-black px-1.5 py-0.2 rounded-full ml-0.5 animate-pulse">
                {incomingPickupsCount}
              </span>
            )}
          </Link>

          <button onClick={() => setActiveTab('workflow')} className={`py-2 rounded-lg text-[10px] font-bold ${activeTab === 'workflow' ? 'bg-amber-500 text-white shadow' : 'text-slate-500 hover:bg-slate-100'}`}>⚙️ Proses ({activeOrders.length})</button>
          <button onClick={() => setActiveTab('pickup')} className={`py-2 rounded-lg text-[10px] font-bold ${activeTab === 'pickup' ? 'bg-blue-600 text-white shadow' : 'text-slate-500 hover:bg-slate-100'}`}>🛍️ Ambil ({pickupOrders.length})</button>
          <button onClick={() => setActiveTab('member')} className={`py-2 rounded-lg text-[10px] font-bold ${activeTab === 'member' ? 'bg-purple-600 text-white shadow' : 'text-slate-500 hover:bg-slate-100'}`}>💳 Membership</button>
          <button onClick={() => setActiveTab('expense')} className={`py-2 rounded-lg text-[10px] font-bold ${activeTab === 'expense' ? 'bg-rose-500 text-white shadow' : 'text-slate-500 hover:bg-slate-100'}`}>💸 Pengajuan</button>
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
            <span className="text-[9px] font-bold mt-1">Online</span>
          </Link>

          <button onClick={() => setActiveTab('workflow')} className={`flex flex-col items-center flex-1 p-1 ${activeTab === 'workflow' ? 'text-amber-500' : 'text-slate-400'}`}><span className="text-xl relative">⚙️<span className="absolute -top-1 -right-2 bg-rose-500 text-white text-[8px] rounded-full px-1">{activeOrders.length}</span></span><span className="text-[9px] font-bold mt-1">Proses</span></button>
          <button onClick={() => setActiveTab('pickup')} className={`flex flex-col items-center flex-1 p-1 ${activeTab === 'pickup' ? 'text-blue-600' : 'text-slate-400'}`}><span className="text-xl relative">🛍️<span className="absolute -top-1 -right-2 bg-rose-500 text-white text-[8px] rounded-full px-1">{pickupOrders.length}</span></span><span className="text-[9px] font-bold mt-1">Ambil</span></button>
          <button onClick={() => setActiveTab('member')} className={`flex flex-col items-center flex-1 p-1 ${activeTab === 'member' ? 'text-purple-600' : 'text-slate-400'}`}><span className="text-xl">💳</span><span className="text-[9px] font-bold mt-1">Membership</span></button>
          <button onClick={() => setActiveTab('expense')} className={`flex flex-col items-center flex-1 p-1 ${activeTab === 'expense' ? 'text-rose-500' : 'text-slate-400'}`}><span className="text-xl">💸</span><span className="text-[9px] font-bold mt-1">Pengajuan</span></button>
          <button onClick={() => setActiveTab('performance')} className={`flex flex-col items-center flex-1 p-1 ${activeTab === 'performance' ? 'text-indigo-600' : 'text-slate-400'}`}><span className="text-xl">📊</span><span className="text-[9px] font-bold mt-1">Gaji</span></button>
        </div>

        <div className="w-full max-w-7xl mx-auto bg-white border border-slate-200/80 rounded-2xl p-4 md:p-6 shadow-sm">
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
              
              {customerOrder && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 space-y-2">
                  <div className="flex justify-between items-center">
                    <p className="text-[10px] font-bold text-indigo-800 uppercase">
                      🛺 Data Penjemputan Terisi Otomatis
                    </p>
                    <button
                      type="button"
                      onClick={() => setCustomerOrder(null)}
                      className="text-[10px] font-bold text-indigo-400 hover:text-indigo-700"
                    >
                      Tutup
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px] text-slate-700">
                    <div>
                      <span className="block text-slate-400 font-bold uppercase text-[8px]">Nama</span>
                      <span className="font-bold">{customerOrder.customer_name || '-'}</span>
                    </div>
                    <div>
                      <span className="block text-slate-400 font-bold uppercase text-[8px]">WhatsApp</span>
                      <span className="font-bold font-mono">{customerOrder.customer_phone || customerOrder.phone_number || '-'}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="block text-slate-400 font-bold uppercase text-[8px]">Alamat Penjemputan</span>
                      <span className="font-semibold">{customerOrder.address || '-'}</span>
                    </div>
                    <div>
                      <span className="block text-slate-400 font-bold uppercase text-[8px]">Layanan</span>
                      <span className="font-bold">{customerOrder.service_type || '-'}</span>
                    </div>
                    <div>
                      <span className="block text-slate-400 font-bold uppercase text-[8px]">Durasi</span>
                      <span className="font-bold text-amber-700">{customerOrder.duration || '-'}</span>
                    </div>
                    <div>
                      <span className="block text-slate-400 font-bold uppercase text-[8px]">Jumlah Kantong</span>
                      <span className="font-bold">{customerOrder.bag_count ?? '-'}</span>
                    </div>
                    <div>
                      <span className="block text-slate-400 font-bold uppercase text-[8px]">Proses Cuci</span>
                      <span className="font-bold">{customerOrder.wash_process || '-'}</span>
                    </div>
                    <div>
                      <span className="block text-slate-400 font-bold uppercase text-[8px]">Risiko Luntur</span>
                      <span className={`font-bold ${customerOrder.has_fading ? 'text-rose-600' : 'text-emerald-600'}`}>
                        {customerOrder.has_fading ? '⚠️ Ya' : 'Tidak'}
                      </span>
                    </div>
                    <div>
                      <span className="block text-slate-400 font-bold uppercase text-[8px]">Barang Berharga</span>
                      <span className={`font-bold ${customerOrder.has_valuables ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {customerOrder.has_valuables ? '⚠️ Ada' : 'Tidak Ada'}
                      </span>
                    </div>
                    <div className="col-span-2 border-t border-indigo-200 pt-1.5">
                      <span className="block text-slate-400 font-bold uppercase text-[8px]">Catatan Pelanggan</span>
                      <span className="font-semibold italic">{customerOrder.notes || 'Tidak ada catatan'}</span>
                    </div>
                  </div>

                  {Number(customerOrder.estimated_weight) > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-[10px] text-amber-800">
                      <span className="font-extrabold">⚖️ Estimasi pelanggan: {customerOrder.estimated_weight} Kg</span>
                      <span className="block text-[9px] font-semibold mt-0.5">
                        Hanya acuan. Timbang cucian di outlet lalu isi berat aslinya di input Kg.
                      </span>
                    </div>
                  )}
                </div>
              )}


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

              <div className="lg:grid lg:grid-cols-12 lg:gap-5 lg:items-start">
              <div className="lg:col-span-7 space-y-3">
              {/* KOTAK INPUT ITEM / LAYANAN */}
          <div className="bg-slate-50 border border-slate-200/80 p-4 rounded-2xl space-y-3">
            <div className="flex justify-between items-center pb-2 border-b border-slate-200">
              <span className="text-xs font-black tracking-wider uppercase text-slate-900">
                Layanan
              </span>
              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full">
                Multi-item
              </span>
            </div>

            <input
              type="search"
              placeholder="Cari layanan…"
              value={serviceQuery}
              onChange={(e) => setServiceQuery(e.target.value)}
              className="w-full bg-white border border-slate-200 text-slate-900 text-sm font-semibold rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <div className="flex gap-1.5">
              {(['all', 'kg', 'pcs'] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setServiceCat(cat)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold ${
                    serviceCat === cat ? 'bg-sky-500 text-white' : 'bg-white border border-slate-200 text-slate-600'
                  }`}
                >
                  {cat === 'all' ? 'Semua' : cat === 'kg' ? 'Kiloan' : 'Satuan'}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto pr-1">
              {services
                .filter((s) => {
                  const name = String(s.name || '');
                  const q = serviceQuery.trim().toLowerCase();
                  if (q && !name.toLowerCase().includes(q)) return false;
                  if (serviceCat !== 'all' && String(s.type || 'kg') !== serviceCat) return false;
                  return true;
                })
                .map((s, i) => {
                  const selected = (selectedServiceInput || serviceType) === s.name;
                  return (
                    <button
                      key={s.id || i}
                      type="button"
                      onClick={() => {
                        setSelectedServiceInput(s.name);
                        setServiceType(s.name);
                      }}
                      className={`min-h-[72px] text-left p-3 rounded-xl border shadow-sm hover:shadow-md transition-all ${
                        selected
                          ? 'border-sky-400 bg-sky-50 ring-2 ring-sky-200'
                          : 'border-slate-200/80 bg-white'
                      }`}
                    >
                      <p className="text-xs font-black text-slate-900 leading-tight">{s.name}</p>
                      <p className="text-[10px] text-slate-400 mt-1">
                        {s.type === 'pcs' ? 'Satuan / Pcs' : 'Kiloan / Kg'}
                      </p>
                    </button>
                  );
                })}
            </div>

            <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  step="0.1"
                  placeholder="Berat (Kg)"
                  value={inputQtyKg || weightKg}
                  onChange={(e) => setInputQtyKg(e.target.value)}
                  className="w-full bg-white border border-slate-200 text-slate-900 text-sm font-bold rounded-xl p-3 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <input
                  type="number"
                  placeholder="Jumlah (Pcs)"
                  value={inputQtyPcs || pcsCount}
                  onChange={(e) => setInputQtyPcs(e.target.value)}
                  className="w-full bg-white border border-slate-200 text-slate-900 text-sm font-bold rounded-xl p-3 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <input
                type="text"
                placeholder="Catatan khusus item ini (misal: Kantong A / Kemeja Putih)"
                value={inputItemNote}
                onChange={(e) => setInputItemNote(e.target.value)}
                className="w-full bg-white border border-slate-200 text-slate-900 text-xs font-bold rounded-xl p-3 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />

              <button
                type="button"
                onClick={handleAddToCart}
                className="w-full bg-sky-500 hover:bg-sky-600 active:scale-[0.99] text-white font-black py-3.5 rounded-xl text-xs shadow-sm transition-all"
              >
                Tambahkan ke Nota
              </button>
            </div>
              </div>

              <div className="lg:col-span-5 mt-4 lg:mt-0 lg:sticky lg:top-4 space-y-3">
                <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-black text-slate-900 uppercase">Nota</p>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${typeof navigator !== 'undefined' && navigator.onLine ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                      {typeof navigator !== 'undefined' && navigator.onLine ? 'Online · Printer siap' : 'Offline'}
                    </span>
                  </div>
          {cartItems.length > 0 ? (
            <div className="space-y-1.5">
              {cartItems.map((item, idx) => {
                const durationMultiplier = (() => {
                  if (duration.includes('Oneday') || duration.includes('1 Hari')) return 1.5;
                  if (duration.includes('Express') || duration.includes('6 Jam')) return 2.0;
                  if (duration.includes('Quick') || duration.includes('3 Jam')) return 3.0;
                  return 1.0;
                })();
                const activeUnitPrice = Math.round((item.basePrice || item.price) * durationMultiplier);
                const itemSubtotal = cartLineAmount(item, durationMultiplier);

                return (
                  <div key={idx} className="bg-slate-50 p-2.5 rounded-xl border border-slate-200/80 flex justify-between items-center text-xs">
                    <div>
                      <p className="font-bold text-slate-900">{item.name}</p>
                      <p className="text-[10px] text-slate-400">
                        {item.type === 'kg'
                          ? `${item.qty} Kg x Rp ${activeUnitPrice.toLocaleString('id-ID')}`
                          : `${item.qty} Pcs x Rp ${activeUnitPrice.toLocaleString('id-ID')}`}
                        {item.note && <span className="italic text-emerald-600 ml-1">({item.note})</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-black text-emerald-600">Rp {itemSubtotal.toLocaleString('id-ID')}</span>
                      <button
                        type="button"
                        onClick={() => setCartItems(cartItems.filter((_, i) => i !== idx))}
                        className="text-rose-600 hover:text-rose-700 text-xs font-bold px-1.5 py-0.5 rounded bg-rose-50"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic py-6 text-center">Keranjang kosong — pilih layanan di kiri.</p>
          )}

          {orderType === 'Online' && (
            <input
              type="number"
              placeholder="Biaya Ongkir (Rp)"
              value={deliveryFee}
              onChange={(e) => setDeliveryFee(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-xs font-bold rounded-xl p-3 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          )}

          <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl flex items-center gap-2">
            <span className="text-xs font-bold text-amber-700 whitespace-nowrap">
              Diskon
            </span>
            <select
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value as any)}
              className="bg-white border border-amber-200 text-slate-800 text-xs font-bold rounded-xl p-2 focus:outline-none"
            >
              <option value="rp">Rp</option>
              <option value="percent">%</option>
            </select>
            <input
              type="number"
              placeholder={discountType === 'percent' ? '10 (%)' : '5000 (Rp)'}
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              className="w-full bg-white border border-amber-200 text-slate-900 text-xs font-bold rounded-xl p-2 focus:outline-none"
            />
          </div>
              <input type="text" placeholder="Catatan umum nota (noda, dll)" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full border border-slate-200 rounded-xl px-4 py-3 text-xs" />
              
              <div><label className="block text-[10px] font-bold text-slate-400 mb-1 uppercase">Total Bayar</label><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5 text-2xl font-black text-emerald-600 text-center" required /></div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Metode Pembayaran</label>
                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold bg-white">
                  <option value="QRIS">QRIS</option>
                  <option value="Cash">Cash (Tunai)</option>
                  <option value="Deposit Saldo">Deposit Member</option>
                  <option value="Transfer">Transfer Bank</option>
                  <option value="Split Payment">Split Payment (Kombinasi 2 Metode)</option>
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

              <button type="submit" disabled={isSubmitting} className="w-full mt-1 bg-emerald-500 hover:bg-emerald-600 text-white font-black py-4 rounded-xl text-sm shadow-sm">Bayar & Simpan Transaksi</button>
                </div>
              </div>
              </div>
            </form>
          )}

          {activeTab === 'workflow' && (
            <div className="space-y-3">
              <div className="flex justify-between items-center border-b pb-2">
                <h3 className="text-[10px] md:text-xs font-black text-slate-800 uppercase tracking-wider">📋 Sedang Diproses ({activeOrders.length})</h3>
                <span className="text-[10px] text-slate-400">Klik kartu untuk detail & edit</span>
              </div>
              <input
                type="search"
                value={queueSearch}
                onChange={(e) => setQueueSearch(e.target.value)}
                placeholder="Cari nama, WA, resi (TRX-...), atau layanan..."
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-800 focus:outline-none focus:border-amber-500"
              />
              {visibleProses.map((order) => {
                const sla = slaRemainingLabel(slaDueMs(order));
                const express = isExpressDuration(order.duration);
                return (
                <div key={order.receipt_number || order.id} className={`rounded-xl p-4 space-y-3 shadow-sm hover:border-indigo-300 transition border ${sla.overdue ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200 bg-white'}`}>
                  <div onClick={() => handleOpenDetailModal(order)} className="flex justify-between items-start pb-2.5 cursor-pointer group">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-bold text-sm text-slate-800 group-hover:text-blue-600 transition">
                          {(order.customer_name && order.customer_name !== 'Pelanggan') ? order.customer_name : (order.customer_phone || order.phone_number || 'Pelanggan Online')}
                        </h4>
                        <span className="text-[10px] font-mono font-bold bg-slate-100 border border-slate-200 text-slate-700 px-2 py-0.5 rounded-md">{order.receipt_number || 'TRX-POS'}</span>
                        {isPaymentLocked(order) && <span className="text-[9px] font-black uppercase bg-amber-100 text-amber-800 border border-amber-200 px-2 py-0.5 rounded-md animate-pulse">⏳ Bayar CS</span>}
                        {isCsVerifiedPaid(order) && <span className="text-[9px] font-black uppercase bg-emerald-100 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-md">✅ Lunas</span>}
                        {express && <span className="text-[9px] font-black uppercase bg-violet-100 text-violet-800 border border-violet-200 px-2 py-0.5 rounded-md">Express</span>}
                        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md border ${sla.overdue ? 'bg-rose-100 text-rose-800 border-rose-300 animate-pulse' : 'bg-sky-50 text-sky-800 border-sky-200'}`}>{sla.label}</span>
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
                 {/* 📸 FOTO BUKTI SERAH TERIMA DRIVER DI OUTLET */}
                 {order.photo_outlet_url && (
                    <div className="p-2 bg-purple-50 border border-purple-200 rounded-xl my-2">
                      <p className="text-[10px] font-bold text-purple-700 mb-1 flex items-center gap-1">
                        📸 Bukti Driver Tiba di Outlet
                      </p>
                      <a href={order.photo_outlet_url} target="_blank" rel="noreferrer">
                        <img 
                          src={order.photo_outlet_url} 
                          alt="Foto Tiba di Outlet"
                          className="w-full h-28 object-cover rounded-lg hover:opacity-90 transition-opacity cursor-pointer" 
                        />
                      </a>
                    </div>
                  )}

                  {(() => {
              const orderItems = parseOrderItems(order.items);
              const hasItems = orderItems.length > 1;
              if (!hasItems) {
                return (
                  <div className="pt-2 border-t border-slate-100">
                    {renderNextStepButton(order)}
                  </div>
                );
              }
              return (
                <div className="space-y-2 mt-2 pt-2 border-t border-slate-100">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Item dalam transaksi</p>
                  {orderItems.map((item: any, idx: number) => {
                    const itemTask = {
                      ...order,
                      id: order.id,
                      items: orderItems,
                      item_index: idx,
                      service_type: item.name || item.service_type || 'Item Cucian',
                      status: item.status || order.status || 'Diterima'
                    };
                    return (
                      <div key={`${order.id}-item-${idx}`} className="bg-slate-50 px-3 py-2 rounded-xl border border-slate-200">
                        <div className="flex justify-between items-center gap-2">
                          <div className="min-w-0">
                            <span className="font-bold text-slate-800 text-xs block truncate">
                              {item.name || item.service_type}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              {item.weight || item.kg ? `${item.weight || item.kg} Kg` : ''}
                              {item.qty ? ` · ${item.qty} Pcs` : ''}
                            </span>
                          </div>
                          <span className="shrink-0 px-2 py-0.5 bg-indigo-50 text-indigo-600 font-bold text-[10px] rounded-md border border-indigo-100">
                            {item.status || order.status || 'Diterima'}
                          </span>
                        </div>
                        <div onClick={(e) => e.stopPropagation()} className="mt-1.5">
                          {renderNextStepButton(itemTask)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
                </div>
              );
              })}
              {activeOrders.length === 0 && <p className="text-xs text-slate-400 text-center py-8">Tidak ada antrean cucian saat ini.</p>}
              {activeOrders.length > 0 && visibleProses.length === 0 && <p className="text-xs text-slate-400 text-center py-8">Tidak ada pesanan yang cocok dengan pencarian.</p>}
            </div>
          )}

          {activeTab === 'pickup' && (
            <div className="space-y-3">
              <h3 className="text-[10px] md:text-xs font-bold text-slate-500 uppercase">🛍️ Siap Diambil ({pickupOrders.length})</h3>
              <input
                type="search"
                value={queueSearch}
                onChange={(e) => setQueueSearch(e.target.value)}
                placeholder="Cari nama, WA, resi (TRX-...), atau layanan..."
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-800 focus:outline-none focus:border-blue-500"
              />
              <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl text-amber-900 text-[10px] md:text-xs"><p className="font-bold mb-1">⚠️ Komplain 1x24 Jam dengan nota resmi.</p></div>
              {visibleAmbil.map((order) => {
                const rack = rackDisplay(order);
                return (
                <div key={order.id} className="bg-amber-100 text-amber-800 border border-amber-300 rounded-xl p-4 space-y-3">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-bold text-amber-950 text-sm">{order.customer_name}</h4>
                        <span className="text-[10px] font-mono font-bold bg-amber-50 border border-amber-300 text-amber-900 px-2 py-0.5 rounded-md">{order.receipt_number}</span>
                      </div>
                      <p className="text-[10px] text-amber-800 mt-1">{order.service_type}</p>
                      <p className="text-[10px] font-black uppercase tracking-wide text-amber-900 mt-1.5">Siap Diambil - Belum Diambil Customer</p>
                    </div>
                  </div>
                  <div className="bg-white/80 border border-amber-300 rounded-xl px-3 py-2 text-[11px] font-black text-amber-950">
                    📍 Lokasi: {rack.loc} | 📦 Total: {rack.pkg}
                    {rack.notes ? <p className="text-[10px] font-semibold text-amber-800 mt-0.5">📝 {rack.notes}</p> : null}
                  </div>
                  <button onClick={() => handlePickupFinish(order)} disabled={isSubmitting} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3.5 rounded-xl text-xs shadow-md transition">✅ Serahkan / Mark Taken</button>
                </div>
                );
              })}
              {visibleAmbilDone.map((order) => {
                const rack = rackDisplay(order);
                return (
                <div key={order.id} className="bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-xl p-4 space-y-3">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-bold text-emerald-950 text-sm">{order.customer_name}</h4>
                        <span className="text-[10px] font-mono font-bold bg-emerald-50 border border-emerald-300 text-emerald-900 px-2 py-0.5 rounded-md">{order.receipt_number}</span>
                      </div>
                      <p className="text-[10px] text-emerald-800 mt-1">{order.service_type}</p>
                      <p className="text-[10px] font-black uppercase tracking-wide text-emerald-900 mt-1.5">Selesai - Sudah Diambil / Diantar</p>
                    </div>
                  </div>
                  <div className="bg-white/80 border border-emerald-300 rounded-xl px-3 py-2 text-[11px] font-black text-emerald-950">
                    📍 Lokasi: {rack.loc} | 📦 Total: {rack.pkg}
                    {rack.notes ? <p className="text-[10px] font-semibold text-emerald-800 mt-0.5">📝 {rack.notes}</p> : null}
                  </div>
                </div>
                );
              })}
              {pickupOrders.length === 0 && completedPickups.length === 0 && <p className="text-xs text-slate-400 text-center py-8">Tidak ada cucian di rak pengambilan.</p>}
              {(pickupOrders.length > 0 || completedPickups.length > 0) && visibleAmbil.length === 0 && visibleAmbilDone.length === 0 && <p className="text-xs text-slate-400 text-center py-8">Tidak ada pesanan yang cocok dengan pencarian.</p>}
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
              <RequisitionForm
                selectedOutlet={selectedOutlet}
                employeeName={employeeName || 'Kasir'}
                role="kasir"
              />
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
              <OutletIssueForm
                selectedOutlet={selectedOutlet}
                employeeName={employeeName || 'Kasir Outlet'}
              />
              <KpiRoleMonitoring />
              <RoleTaskInbox role="kasir" />
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
                    <button 
                  type="button" 
                  onClick={() => setShowClosingModal(true)} 
                  disabled={isSubmitting} 
                  className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold py-2.5 rounded-xl text-xs shadow transition flex justify-center items-center gap-1.5"
                >
                  <span>🏃‍♂️ CLOSING SHIFT & ABSEN PULANG</span>
                </button>
                  </div>
                ) : (
                  <div className="bg-slate-100 text-slate-700 px-3 py-2 rounded-lg text-xs font-bold border border-slate-200 text-center">
                    Shift Selesai! (Masuk: {new Date(todayAttendance.check_in).toLocaleTimeString('id-ID')} | Pulang: {new Date(todayAttendance.check_out).toLocaleTimeString('id-ID')})
                  </div>
                )}
              </div>
              {/* MODAL BLIND CASH COUNT CLOSING SHIFT */}
      {showClosingModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-200 w-full max-w-md rounded-3xl p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="font-black text-slate-900 text-sm flex items-center gap-2">
                <span>🔐 Closing Shift & Hitung Uang Laci</span>
              </h3>
              <button type="button" onClick={() => setShowClosingModal(false)} className="text-slate-400 font-bold text-sm">✖</button>
            </div>

            <div className="space-y-3">
              <div className="bg-blue-50 border border-blue-200 p-3 rounded-xl text-[10px] text-blue-900">
                <p className="font-bold">⚠️ Ketentuan Blind Cash Count:</p>
                <p>Hitung dan masukkan total uang fisiknya yang ada di laci kasir saat ini. Sistem akan mencocokkan secara otomatis dengan catatan omset tunai harian.</p>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Total Fisik Uang Tunai di Laci (Rp)</label>
                <input
                  type="number"
                  placeholder="Contoh: 450000"
                  value={physicalCashCount}
                  onChange={(e) => setPhysicalCashCount(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl p-2.5 text-xs font-bold text-slate-900 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Catatan Shift / Serah Terima (Opsional)</label>
                <input
                  type="text"
                  placeholder="Contoh: Uang pecahan Rp 2.000 tersisa sedikit"
                  value={closingNotes}
                  onChange={(e) => setClosingNotes(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowClosingModal(false)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 rounded-xl text-xs transition"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSubmitClosingShift}
                className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-bold py-2.5 rounded-xl text-xs shadow transition"
              >
                Selesaikan Shift
              </button>
            </div>
          </div>
        </div>
      )}
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
                    <span className="opacity-80 block font-semibold">📦 Dikemas</span>
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
export default function POSPage() {
  return (
    <Suspense fallback={<div className="p-4 text-center text-xs">Loading POS...</div>}>
      <POSContent />
    </Suspense>
  );
}