'use client';

import { isValidCustomerPhone, phoneLookupKeys, storedPhone } from '@/lib/phone';
import PhoneNumberInput from '@/components/PhoneNumberInput';
import dynamic from 'next/dynamic';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { fetchThreadMessages, insertChatMessage, isStaffOnlyMessage, phoneVariants, threadKeyOf } from '@/lib/csChat';
import { parseChatInvoice } from '@/lib/chatInvoice';
import { findPromoByCode, mapDbPromo, mapSettingsPromo, promoDiscountRp, promoIsClaimable, type CatalogPromo } from '@/lib/promoCatalog';
import { cashbackCopy, DEFAULT_CRM_SETTINGS, idr, type CrmProfile, type CrmSettings } from '@/lib/crm';
import { loadFreshCrmProfile } from '@/lib/crm-automation';
import { redeemLoyaltyPoints, redeemableAmounts } from '@/lib/loyaltyRedeem';
import { friendlyPickupOrderError, reportPickupOrderError, requestDriverDelivery } from '@/lib/pickupDispatch';
import { notifyStaffNewOrder } from '@/lib/notifications';
import { stageKeyOf, type WorkLogRow } from '@/lib/stageTimeline';
import { laundryFallbackReply } from '@/lib/laundryFaq';
import {
  confirmThirdPartyReceived,
  isThirdPartyDelivery,
  thirdPartyFromOrder
} from '@/lib/thirdPartyDelivery';
import { fileToCompressedDataUrl, uploadChatAttachment, uploadProofFile } from '@/lib/uploadProof';
import { kiloanLineTotal } from '@/lib/kiloanPrice';
import {
  bagCategoryCountsComplete,
  bagCategoryCountsValid,
  BAG_CATEGORY_LABELS,
  BAG_CATEGORY_ORDER,
  emptyBagCategoryCounts,
  KILOAN_MIN_ORDER_KG,
  kiloanOrderKgOf,
  MAX_KILOAN_BAGS,
  summarizeBagWeight,
  type BagCategoryCounts
} from '@/lib/kiloanBagWeights';
import {
  fetchSatuanPhotoConfig,
  satuanItemHasRequiredPhotos,
  uploadSatuanItemPhoto,
  type SatuanPhotoConfig
} from '@/lib/satuanItemPhoto';
import { formatEstSelesai, formatTrxId } from '@/lib/posQueue';
import { DEPOSIT_PACKAGES, depositBonusOf, depositPackageShort } from '@/lib/depositTopup';
import { requestMayarInvoice, simulateMayarAutoPay } from '@/lib/mayar';
import {
  complaintStepOf,
  customerRespondComplaint,
  decisionLabelOf,
  loadComplaintForOrder
} from '@/lib/csCare';
import { ensureComplaintTicketFromIssue, findComplaintTicket, ticketTitleOf } from '@/lib/complaintTicket';
import { nearestOpenOutlet, noOutletReason, pickNearestOpenOutlets } from '@/lib/outletCapacity';
import { toast } from '@/lib/toast';
import {
  showComplaintActions,
  markOrderConfirmed,
  submitOrderComplaint,
  submitOrderReview,
  maybeAutoConfirmOrder,
  readLocalFlag
} from '@/lib/orderFeedback';
import { IconBadge, StarRating, StatusPill, StepperBtn } from '@/components/customer/ui';
import { visibleChatText } from '@/components/ChatAttachment';
import PromoBannerCarousel from '@/components/customer/PromoBannerCarousel';
import NearbyOutlets from '@/components/customer/NearbyOutlets';
import BottomNavbar from '@/components/customer/BottomNavbar';
import LoyaltyProfileCard from '@/components/customer/LoyaltyProfileCard';
import CustomerHeader from '@/components/customer/CustomerHeader';
import { DEFAULT_RECEIPT_TERMS } from '@/components/ReceiptPreview';
import { parseReceiptLayout } from '@/lib/receiptLayout';
import {
  MAX_NEARBY_RADIUS_KM,
  bannerSlidesOf,
  inferCustomerCity,
  nearbyActiveOutlets,
  uniqueOutletCities,
  type BannerSlide,
  type ShowcasePromo
} from '@/lib/outletShowcase';
import {
  loadCustomerAddresses,
  primaryAddressOf,
  removeCustomerAddress,
  setPrimaryCustomerAddress,
  upsertCustomerAddress,
  type SavedAddress
} from '@/lib/customerAddresses';
import { reverseGeocodeAddress, reverseGeocodeCity } from '@/lib/reverseGeocode';
import { composePickupAddress, isValidHouseNumber, splitHouseNumber } from '@/lib/pickupAddress';
import { addressDisplayLabel } from '@/lib/customerAddressLabels';
import { fetchCustomerRoadKm, ongkirRoundTripFromOneWayKm } from '@/lib/roadDistance';
import { matchOutletFromQuery, persistCustomerOutlet, readStoredCustomerOutlet } from '@/lib/outletUuid';
import ActivitySegmentTabs from '@/components/customer/ActivitySegmentTabs';
import {
  formatScheduleLabel,
  isOngoingOrder,
  isOrderFinished,
  isScheduledOrder,
  localDateISO,
  parseActivityTab,
  scheduleAtOf,
  parsePickupSchedule,
  withScheduleNote,
  type ActivitySubTab
} from '@/lib/customerActivity';
import { updatePickupOrder } from '@/lib/pickupUpdates';
import { updateWithFallback } from '@/lib/safeWrite';
import { hasOnDutyDriverAtOutlet } from '@/lib/driverAttendance';
import { isPaymentLocked } from '@/lib/paymentVerify';
import CheckPaymentStatusButton from '@/components/payment/CheckPaymentStatusButton';
import { PaymentBadge, ProgressBar } from '@/components/customer/OrderStatusBadges';
import DriverChatSheet from '@/components/DriverChatSheet';
import { isDriverChatOpen } from '@/lib/driverChat';
import {
  customerPaymentOf,
  customerProgressOf,
  isTransactionRow,
  priceBreakdownOf,
  serviceSummaryOf
} from '@/lib/customerOrderView';
import {
  clearCustomerLocal,
  fetchCustomerAuthState,
  logoutCustomer,
  persistCustomerLocal,
  type CustomerAuthState
} from '@/lib/customerAuth/client';
import {
  AlertTriangle,
  ArrowLeft,
  Box,
  Calendar,
  Camera,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  FileText,
  Gift,
  Headphones,
  History,
  Info,
  ListTodo,
  Loader2,
  MapPin,
  Navigation,
  Package,
  Paperclip,
  Pencil,
  Phone,
  Search,
  Send,
  Star,
  Truck,
  MessageCircle,
  User,
  Wallet,
  X
} from 'lucide-react';

const StageTimeline = dynamic(() => import('@/components/StageTimeline'), { ssr: false });
const PhotoLightbox = dynamic(() => import('@/components/PhotoLightbox'), { ssr: false });
const ChatAttachment = dynamic(() => import('@/components/ChatAttachment'), { ssr: false });
const ChatInvoiceCard = dynamic(() => import('@/components/ChatInvoiceCard'), { ssr: false });
const ThirdPartyDeliveryCard = dynamic(() => import('@/components/ThirdPartyDeliveryCard'), { ssr: false });
const FileProofInput = dynamic(() => import('@/components/FileProofInput'), { ssr: false });
const ComplaintTicketChat = dynamic(() => import('@/components/ComplaintTicketChat'), { ssr: false });
const PromoVoucherModal = dynamic(() => import('@/components/customer/PromoVoucherModal'), { ssr: false });
const PromoBannerDetailModal = dynamic(() => import('@/components/customer/PromoBannerDetailModal'), { ssr: false });
const OutletProfileDrawer = dynamic(() => import('@/components/customer/OutletProfileDrawer'), { ssr: false });
const BackupEmailCard = dynamic(() => import('@/components/customer/BackupEmailCard'), { ssr: false });
const AddressManager = dynamic(() => import('@/components/customer/AddressManager'), { ssr: false });
const PickupLocationPicker = dynamic(() => import('@/components/customer/PickupLocationPicker'), { ssr: false });


const safeParse = (data: any, fallback: any) => {
  if (!data) return fallback;
  if (typeof data === 'object') return data;
  try { return JSON.parse(data); } catch (e) { return fallback; }
};

const isDeliveryInProgress = (order: any) => {
  const st = String(order?.status || '').toLowerCase();
  if (isThirdPartyDelivery(order) && !isOrderFinished(order)) return true;
  return st.includes('diantar') || st.includes('mengantar') || (st.includes('delivery') && !st.includes('delivered'));
};

const isReadyForPickupAlert = (order: any) => {
  const st = String(order?.status || '').toLowerCase();
  if (isOrderFinished(order) || isDeliveryInProgress(order)) return false;
  if (st.includes('siap diambil')) return true;
  if (st.includes('packing') && st.includes('selesai')) return true;
  return st.includes('siap') && st.includes('diambil');
};

const isSiapDiambil = (order: any) => isReadyForPickupAlert(order);

/** Nomor tersimpan (lib/phone): 08… untuk Indonesia, +<kode negara>… untuk luar negeri. */
const cleanPhone = (phoneStr: string) => {
  if (!phoneStr) return '';
  return storedPhone(phoneStr) || phoneStr.trim().replace(/\D/g, '');
};

const getAdminWaNumber = (outletName: string) => {
  const lower = (outletName || '').toLowerCase();
  if (lower.includes('briwash')) return '6281120081011';
  if (lower.includes('chingu')) return '6281120081012';
  if (lower.includes('sorcha')) return '6281111112731';
  if (lower.includes('hari ini')) return '6281111169689';
  if (lower.includes('mc')) return '6281120055575';
  return '6281120081011';
};

const getDurationMultiplier = (durStr: string) => {
  if (durStr.includes('Oneday') || durStr.includes('1 Hari')) return 1.5;
  if (durStr.includes('Express') || durStr.includes('6 Jam')) return 2.0;
  if (durStr.includes('Quick') || durStr.includes('3 Jam')) return 3.0;
  return 1.0;
};

const calculateDistanceKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/** Satu kantong kiloan: isian jumlah per kategori + layanan & durasi (dipakai per-kantong hanya saat mode "Pisah Perkantong"). */
type KiloanBagForm = { categories: BagCategoryCounts; serviceName: string; duration: string };
const emptyKiloanBagForm = (serviceName = '', duration = ''): KiloanBagForm => ({
  categories: emptyBagCategoryCounts(),
  serviceName,
  duration
});

/** Form satu potong item satuan sedang diisi — termasuk progres unggah foto wajibnya. */
type SatuanPieceForm = {
  merk: string;
  warna: string;
  corak: string;
  photoPath?: string;
  photoPreviewUrl?: string;
  photoUploading?: boolean;
  photoError?: string;
};
const SATUAN_PHOTO_NEEDS_VERIFIED_LOGIN =
  'Item satuan wajib disertai foto. Keluar lalu masuk lagi dengan verifikasi WhatsApp/email agar foto bisa diunggah dengan aman.';

/** Bentuk tersimpan (keranjang & payload) — hanya path foto, tanpa state progres UI. */
type SatuanPieceRecord = { merk: string; warna: string; corak: string; photo_path?: string };

const paymentMethod: any = "CASH";

const ensureOutletInList = (list: any[], all: any[], id: string) => {
  if (!id) return list;
  if ((list || []).some((o) => String(o.id) === String(id))) return list;
  const row = (all || []).find((o) => String(o.id) === String(id));
  return row ? [row, ...(list || [])] : list;
};

const readOutletQueryParam = () => {
  if (typeof window === 'undefined') return '';
  try {
    return String(new URLSearchParams(window.location.search).get('outlet') || '').trim();
  } catch {
    return '';
  }
};

function CustomerDashboardPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [detailOrder, setDetailOrder] = useState<any>(null);
  const [detailWorkLogs, setDetailWorkLogs] = useState<any[]>([]);
  const pathIsActivity =
    (pathname || '').includes('/customer/activity') ||
    (pathname || '').includes('/customer/history') ||
    (pathname || '').includes('/aktivitas');
  const pathIsProfile = (pathname || '').includes('/profil');
  const pathIsOrder =
    (pathname || '') === '/order' ||
    (pathname || '').startsWith('/order?') ||
    (pathname || '').includes('/customer/order');
  const urlActivityTab = parseActivityTab(searchParams.get('tab')) || (pathIsActivity ? 'berlangsung' : null);
  const [activeTab, setActiveTab] = useState<'home' | 'order' | 'deposit' | 'activity' | 'profile' | 'chat'>(
    pathIsActivity || urlActivityTab ? 'activity' : pathIsProfile ? 'profile' : pathIsOrder ? 'order' : 'home'
  );
  const [activitySub, setActivitySub] = useState<ActivitySubTab>(urlActivityTab || 'berlangsung');
  const [pickupLater, setPickupLater] = useState(false);
  const [pickupDate, setPickupDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return localDateISO(d);
  });
  const [pickupTime, setPickupTime] = useState('09:00');
  const [scheduleBusyId, setScheduleBusyId] = useState<string | null>(null);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [editScheduleDate, setEditScheduleDate] = useState('');
  const [editScheduleTime, setEditScheduleTime] = useState('09:00');
  const [activeSupportTab, setActiveSupportTab] = useState<'cs' | 'ai'>('cs');
  const [customerPhone, setCustomerPhone] = useState('');
  const [authState, setAuthState] = useState<CustomerAuthState | null>(null);
  // Form nomor-saja (tanpa verifikasi) hanya dipakai selama login lama masih aktif
  // dan login WhatsApp terverifikasi belum dikonfigurasi.
  const inlinePhoneLoginAllowed = Boolean(authState?.config.legacy && !authState?.config.whatsapp);
  const [customerData, setCustomerData] = useState<any>(null);
  const [outletsList, setOutletsList] = useState<any[]>([]);
  const [filteredOutlets, setFilteredOutlets] = useState<any[]>([]);
  const [selectedOutlet, setSelectedOutlet] = useState('');
  const qrOutletLockRef = useRef(false);
  const pickupPinLockedRef = useRef(false);
  const [pickupLandmark, setPickupLandmark] = useState('');
  const [houseNumber, setHouseNumber] = useState('');
  const outletQuery = String(searchParams.get('outlet') || '').trim();

  const chooseOutlet = (id: string, opts?: { fromQr?: boolean; clearQuery?: boolean }) => {
    const next = String(id || '').trim();
    if (!next) return;
    setSelectedOutlet(next);
    persistCustomerOutlet(next);
    if (opts?.fromQr) qrOutletLockRef.current = true;
    if (opts?.clearQuery && searchParams.get('outlet')) {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete('outlet');
      const q = nextParams.toString();
      router.replace(q ? `${pathname}?${q}` : pathname || '/customer/dashboard', { scroll: false });
    }
  };

  const [dynamicServices, setDynamicServices] = useState<any[]>([]);
  const [outletOverrides, setOutletOverrides] = useState<any>({});
  const [availablePromos, setAvailablePromos] = useState<any[]>([]);

  const [customerName, setCustomerName] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [addressBusy, setAddressBusy] = useState(false);
  const [selectedBanner, setSelectedBanner] = useState<BannerSlide | null>(null);
  const [userCoords, setUserCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [deviceCoords, setDeviceCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [gpsCity, setGpsCity] = useState('');
  const [cityOverride, setCityOverride] = useState<string | null>(null);
  const [showAllCities, setShowAllCities] = useState(false);
  const [showcasePromos, setShowcasePromos] = useState<ShowcasePromo[]>([]);
  const [profileOutlet, setProfileOutlet] = useState<any | null>(null);
  const [locatingGps, setLocatingGps] = useState(false);
  const [gpsHint, setGpsHint] = useState('');

  const [isKiloanChecked, setIsKiloanChecked] = useState(false);
  const [selectedKiloanSvc, setSelectedKiloanSvc] = useState('');
  // Semua pilihan layanan mulai KOSONG: customer memilih sendiri (tidak ada
  // nilai bawaan yang bisa terkirim tanpa sengaja).
  const [kiloanDuration, setKiloanDuration] = useState('');
  const [cartKiloan, setCartKiloan] = useState<
    Array<{ name: string; kg: number; qty: number; duration: string; price: number; bagDetail?: BagCategoryCounts; bags?: number }>
  >([]);
  // Kg & pcs kiloan SELALU dihitung otomatis dari isian per kategori pakaian
  // (lihat lib/kiloanBagWeights.ts) — tidak ada lagi input kg/pcs manual.
  const [kiloanBagForms, setKiloanBagForms] = useState<KiloanBagForm[]>([emptyKiloanBagForm()]);
  const [kiloanFormError, setKiloanFormError] = useState('');
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const [isSatuanChecked, setIsSatuanChecked] = useState(false);
  const [cartSatuan, setCartSatuan] = useState<
    Array<{ name: string; basePrice: number; price: number; qty: number; duration: string; pieces?: SatuanPieceRecord[] }>
  >([]);
  const [selectedSatuanSvc, setSelectedSatuanSvc] = useState('');
  const [inputSatuanQty, setInputSatuanQty] = useState('1');
  const [satuanInputDuration, setSatuanInputDuration] = useState('');
  const emptySatuanPiece = (): SatuanPieceForm => ({ merk: '', warna: '', corak: '' });
  const [satuanPieceNotes, setSatuanPieceNotes] = useState<SatuanPieceForm[]>([emptySatuanPiece()]);
  const [satuanNotesSame, setSatuanNotesSame] = useState(true);
  const [satuanFormError, setSatuanFormError] = useState('');
  // null = masih dimuat (diperlakukan wajib foto sampai server menjawab).
  const [satuanPhoto, setSatuanPhoto] = useState<SatuanPhotoConfig | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchSatuanPhotoConfig().then((cfg) => {
      if (alive) setSatuanPhoto(cfg);
    });
    return () => {
      alive = false;
    };
  }, []);
  const satuanPhotoRequired = satuanPhoto?.enabled !== false;
  const [agreedNoValuables, setAgreedNoValuables] = useState(false);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [receiptTerms, setReceiptTerms] = useState(DEFAULT_RECEIPT_TERMS);

  const [deliveryFee, setDeliveryFee] = useState<number | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [distanceLoading, setDistanceLoading] = useState(false);
  const [claimedPromo, setClaimedPromo] = useState<any>(null);
  const [loyaltyProfile, setLoyaltyProfile] = useState<CrmProfile | null>(null);
  const [loyaltySettings, setLoyaltySettings] = useState<CrmSettings>(DEFAULT_CRM_SETTINGS);
  const [loyaltyRedeem, setLoyaltyRedeem] = useState(0);
  const [showPromoModal, setShowPromoModal] = useState(false);
  const [showEstimateInfoModal, setShowEstimateInfoModal] = useState(false);
  const [latestCreatedOrder, setLatestCreatedOrder] = useState<any>(null);
  const [showOrderSuccessModal, setShowOrderSuccessModal] = useState(false);
  const [pendingCashierInvoice, setPendingCashierInvoice] = useState<any[]>([]);
  const [detailPayCharge, setDetailPayCharge] = useState<{
    qrisUrl?: string;
    invoiceUrl?: string;
    paymentId?: string;
    mock?: boolean;
  } | null>(null);
  const [detailPayBusy, setDetailPayBusy] = useState(false);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderStep, setOrderStep] = useState<1 | 2 | 3>(1);
  const [orderFormError, setOrderFormError] = useState('');
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const orderSubmitLockRef = useRef(false);
  const draftOrderNoRef = useRef('');

  const [depositCheckout, setDepositCheckout] = useState<any | null>(null);
  const [depositPayBusy, setDepositPayBusy] = useState(false);

  const handleTopupMayar = async (pkg: (typeof DEPOSIT_PACKAGES)[number]) => {
    const phone = cleanPhone(customerPhone);
    if (!phone) return alert('Masuk dulu dengan nomor WhatsApp Anda.');
    try {
      setIsSubmitting(true);
      const res = await fetch('/api/mayar/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: pkg.pay,
          name: `Top Up Deposit - ${pkg.key}`,
          description: `Top Up Deposit - ${pkg.key}`,
          mobile: phone,
          customerPhone: phone,
          customerName: customerData?.name || customerName || 'Pelanggan',
          outletId: selectedOutlet || undefined,
          type: 'deposit',
          packageName: pkg.key,
          balanceAdded: pkg.credit
        })
      });
      const data = await res.json().catch(() => ({}));
      if (data?.code === 'CUSTOMER_NOT_REGISTERED') return alert(data.error);
      if (!res.ok) throw new Error(data?.error || 'Gagal membuat QRIS Mayar');
      setDepositCheckout({
        ...data,
        packageName: pkg.key,
        packageLabel: pkg.label,
        amount: pkg.pay,
        balanceAdded: pkg.credit,
        bonus: depositBonusOf(pkg),
        openedAt: Date.now()
      });
    } catch (err: any) {
      alert('Gagal: ' + (err?.message || 'Terjadi kesalahan'));
    } finally {
      setIsSubmitting(false);
    }
  };
  const [bagCount, setBagCount] = useState('');
  const [washProcess, setWashProcess] = useState('');
  const [hasFading, setHasFading] = useState('');
  const [thirdPartyVendor, setThirdPartyVendor] = useState('');

  const [courierType, setCourierType] = useState<'INTERNAL' | 'THIRD_PARTY'>('INTERNAL');
  const [internalDriverOnDuty, setInternalDriverOnDuty] = useState(true);
  const [queueCount, setQueueCount] = useState<number>(0);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [inputChat, setInputChat] = useState<string>('');
  const [activeChatOrderId, setActiveChatOrderId] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchQueue = async () => {
      const { count } = await supabase
        .from('pickup_orders')
        .select('*', { count: 'exact', head: true })
        .in('status', ['Baru Masuk', 'Menunggu Kurir', 'Pickup Request', 'Driver Menuju Lokasi']);
      setQueueCount(count || 0);
    };
    fetchQueue();
  }, []);
  const [activeOrders, setActiveOrders] = useState<any[]>([]);
  // Chat dengan driver (per pesanan jemput/antar yang sedang berjalan).
  const [driverChat, setDriverChat] = useState<{ id: string; driverName: string; label: string } | null>(null);
  const [driverChatUnread, setDriverChatUnread] = useState<Record<string, number>>({});
  const openDriverChatIds = activeOrders
    .map((o: any) => o.driver_chat_id)
    .filter(Boolean)
    .join(',');
  useEffect(() => {
    // Tanpa chat terbuka tidak ada yang diambil; tombol chat juga tidak tampil.
    if (!openDriverChatIds || !customerPhone) return;
    let cancelled = false;
    const poll = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await fetch('/api/customer/driver-chat?unread=1', {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { 'x-customer-phone': customerPhone }
        });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) setDriverChatUnread(data.counts || {});
      } catch {
        /* coba lagi nanti */
      }
    };
    void poll();
    const t = window.setInterval(poll, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [openDriverChatIds, customerPhone]);
  // Log tahap produksi per transaksi aktif — agar progres di kartu Aktivitas sama
  // dengan timeline di detail pesanan.
  const [workLogsByTx, setWorkLogsByTx] = useState<Record<string, WorkLogRow[]>>({});
  const [completedOrders, setCompletedOrders] = useState<any[]>([]);
  const [depositLogs, setDepositLogs] = useState<any[]>([]);
  const [readyPopup, setReadyPopup] = useState<any>(null);
  const [requestingDeliveryId, setRequestingDeliveryId] = useState<string | null>(null);
  const [confirmDeliveryId, setConfirmDeliveryId] = useState<string | null>(null);
  const [complaintOpen, setComplaintOpen] = useState(false);
  const [complaintText, setComplaintText] = useState('');
  const [complaintFile, setComplaintFile] = useState<File | null>(null);
  const [complaintVideo, setComplaintVideo] = useState<File | null>(null);
  const [complaintBusy, setComplaintBusy] = useState(false);
  const [detailComplaint, setDetailComplaint] = useState<any | null>(null);
  const [complaintTicket, setComplaintTicket] = useState<any | null>(null);
  const [complaintTicketOpen, setComplaintTicketOpen] = useState(false);
  const [complaintRespondBusy, setComplaintRespondBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewStars, setReviewStars] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);

  const estimatedPickupMinutes = (queueCount * 30) + 15;

  const [aiMessages, setAiMessages] = useState<any[]>([
    { id: '1', sender_type: 'ai', message: 'Halo! Saya AI Assistant Laundrivery. Ada yang bisa saya bantu mengenai layanan laundry?' }
  ]);

  useEffect(() => {
    if (activeTab !== 'chat' && !activeChatOrderId) return;
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeTab, activeChatOrderId, activeSupportTab, chatMessages, aiMessages]);

  useEffect(() => {
    if (!complaintTicketOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [complaintTicketOpen]);

  useEffect(() => {
    const path = pathname || '';
    const parsed = parseActivityTab(searchParams.get('tab'));
    if (path.includes('/customer/history')) {
      setActiveTab('activity');
      setActivitySub('riwayat');
      return;
    }
    if (path.includes('/customer/activity') || path.includes('/aktivitas')) {
      setActiveTab('activity');
      if (parsed) setActivitySub(parsed);
      return;
    }
    if (path.includes('/profil')) {
      setActiveTab('profile');
      return;
    }
    if (path === '/order' || path.startsWith('/order?') || path.includes('/customer/order')) {
      setActiveTab('order');
      return;
    }
    if (path.includes('/beranda')) {
      setActiveTab('home');
      return;
    }
    if (searchParams.get('open') === 'chat' || searchParams.get('tab') === 'chat') {
      setActiveTab('chat');
      setActiveChatOrderId('GENERAL_CS');
      return;
    }
    if (parsed) {
      setActiveTab('activity');
      setActivitySub(parsed);
    }
  }, [pathname, searchParams]);

  useEffect(() => {
    const phone = String(customerPhone || '').trim();
    if (!phone) {
      setLoyaltyProfile(null);
      setLoyaltyRedeem(0);
      return;
    }
    let cancelled = false;
    loadFreshCrmProfile(phone)
      .then(({ profile, settings }) => {
        if (cancelled) return;
        setLoyaltySettings(settings);
        setLoyaltyProfile(profile);
        const pending = Math.round(Number(profile?.pending_loyalty_discount) || 0);
        if (pending > 0) setLoyaltyRedeem(pending);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [customerPhone]);

  const goActivity = (sub: ActivitySubTab = activitySub) => {
    setActivitySub(sub);
    setActiveTab('activity');
    const path = pathname || '';
    if (path.includes('/customer/activity') || path.includes('/customer/history') || path.includes('/aktivitas')) {
      router.replace(`${path.split('?')[0]}?tab=${sub}`, { scroll: false });
    } else {
      router.replace(`/customer/dashboard?tab=${sub}`, { scroll: false });
    }
  };

  const goHome = () => {
    setActiveTab('home');
    const path = pathname || '';
    const hasSpecialUrl =
      path.includes('/customer/activity') ||
      path.includes('/customer/history') ||
      path.includes('/aktivitas') ||
      path.includes('/profil') ||
      path === '/order' ||
      path.includes('/customer/order') ||
      !!parseActivityTab(searchParams.get('tab'));
    if (hasSpecialUrl) {
      router.replace('/customer/dashboard', { scroll: false });
    }
  };

  const openCustomerChat = (orderId: string = 'GENERAL_CS') => {
    setActiveChatOrderId(orderId || 'GENERAL_CS');
    setActiveTab('chat');
  };

  useEffect(() => {
    if (!depositCheckout || depositCheckout.paid) return;
    const phone = cleanPhone(customerPhone);
    const openedAt = Number(depositCheckout.openedAt || Date.now());
    const markPaid = () => {
      setDepositCheckout((c: any) => (c ? { ...c, paid: true } : c));
      if (phone) fetchCustomerProfile(phone);
      toast('Top up deposit berhasil. Saldo sudah ditambahkan.', 'ok');
    };
    const check = async () => {
      if (depositCheckout.topupId) {
        const { data } = await supabase.from('deposit_topups').select('status').eq('id', depositCheckout.topupId).maybeSingle();
        if (data && ['SUCCESS', 'LUNAS', 'PAID'].includes(String(data.status || '').toUpperCase())) {
          markPaid();
          return;
        }
      }
      if (!phone) return;
      const { data: logs } = await supabase
        .from('membership_logs')
        .select('id, created_at, package_name')
        .eq('customer_phone', phone)
        .gte('created_at', new Date(openedAt - 8000).toISOString())
        .limit(5);
      if (logs?.some((l: any) => String(l.package_name || '').includes(depositCheckout.packageName))) {
        markPaid();
      }
    };
    check();
    const t = window.setInterval(check, 4000);
    return () => window.clearInterval(t);
  }, [depositCheckout?.topupId, depositCheckout?.paid, depositCheckout?.packageName, customerPhone]);

  const handleSendChat = async (file?: File) => {
    const messageText = inputChat.trim() || (file ? (file.type.includes('pdf') ? 'Invoice / file terlampir' : 'Bukti pembayaran terlampir') : '');
    if (!messageText && !file) return;
    setInputChat('');

    if (activeSupportTab === 'cs') {
      const validOrderId = (activeChatOrderId && activeChatOrderId !== 'GENERAL_CS') ? activeChatOrderId : null;
      const chatOrder = validOrderId ? activeOrders.find((o) => o.id === validOrderId) : null;
      const pickupChatId = chatOrder?.pickup_id || (chatOrder && !chatOrder.receipt_number ? validOrderId : null);
      const txChatId = chatOrder?.receipt_number ? validOrderId : chatOrder?.transaction_id || null;
      let attachmentUrl = '';
      let attachmentType = '';
      if (file) {
        try {
          attachmentUrl =
            (await uploadChatAttachment(file, `chat_cust_${customerPhone || 'anon'}`).catch(() => '')) ||
            (await fileToCompressedDataUrl(file));
          attachmentType = file.type.includes('pdf') ? 'pdf' : 'image';
        } catch (err: any) {
          alert('Gagal unggah lampiran: ' + (err?.message || 'Coba lagi'));
          return;
        }
      }
      const newMsg = {
        id: Date.now().toString(),
        order_id: validOrderId,
        customer_phone: customerPhone || null,
        sender_type: 'customer',
        message: attachmentUrl ? `${messageText}\n${attachmentUrl}` : messageText,
        attachment_url: attachmentUrl || null,
        image_url: attachmentUrl || null,
        attachment_type: attachmentType || null,
        created_at: new Date().toISOString()
      };
      setChatMessages((prev) => [...prev, newMsg]);

      const { error } = await insertChatMessage({
        pickup_order_id: pickupChatId || null,
        transaction_id: txChatId || null,
        customer_phone: customerPhone || null,
        sender_type: 'customer',
        message: messageText,
        attachment_url: attachmentUrl || null,
        image_url: attachmentUrl || null,
        attachment_type: attachmentType || null
      });

      if (error) {
        console.error('Error insert chat Supabase:', error.message);
      } else if (customerPhone) {
        loadCustomerChats(customerPhone);
      }
    } else {
      const userMsg = {
        id: Date.now().toString(),
        sender_type: 'customer',
        message: messageText,
        created_at: new Date().toISOString()
      };
      setAiMessages((prev) => [...prev, userMsg]);

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            message: messageText,
            // Riwayat penuh (termasuk pesan yang baru ditambahkan) agar AI
            // mengingat konteks, bukan menjawab tiap pesan dari nol.
            messages: [...aiMessages, userMsg],
            customerPhone: customerPhone || '' // Kirim nomor HP customer ke API
          }),
        });
        const data = await res.json();

        const aiReply = {
          id: (Date.now() + 1).toString(),
          sender_type: 'ai',
            message: data.reply || laundryFallbackReply(messageText),
          created_at: new Date().toISOString()
        };
        setAiMessages((prev) => [...prev, aiReply]);
      } catch (err) {
        setAiMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            sender_type: 'ai',
            message: laundryFallbackReply(messageText),
            created_at: new Date().toISOString()
          }
        ]);
      }
    }
  };

  const loadCustomerChats = async (phone: string) => {
    const key = threadKeyOf({ customer_phone: phone });
    const data = await fetchThreadMessages(key, phone);
    const rows = (data || []).filter((m: any) => !isStaffOnlyMessage(m));
    setChatMessages(rows);
    try {
      sessionStorage.setItem('laundry_cs_chat_' + key, JSON.stringify(rows.slice(-80)));
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!customerPhone) return;
    const key = threadKeyOf({ customer_phone: customerPhone });
    try {
      const cached = sessionStorage.getItem('laundry_cs_chat_' + key);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length) setChatMessages(parsed);
      }
    } catch {
      /* ignore */
    }
    loadCustomerChats(customerPhone);

    const variants = new Set(phoneVariants(customerPhone).map((v) => cleanPhone(v)));
    const ingestIncoming = (newMsg: any, notify = true) => {
      if (isStaffOnlyMessage(newMsg)) return;
      const msgPhone = cleanPhone(newMsg.customer_phone);
      const sameThread = newMsg.thread_key === key || variants.has(msgPhone);
      if (!sameThread) return;
      const invoice = parseChatInvoice(newMsg);
      if (notify && invoice && String(newMsg.sender_type || '').toLowerCase() !== 'customer') {
        toast('Tagihan QRIS baru telah tersedia. Ketuk untuk melihat & membayar', 'warn', {
          persist: true,
          kind: 'qris',
          onClick: () => {
            setActiveSupportTab('cs');
            openCustomerChat('GENERAL_CS');
          }
        });
        setActiveSupportTab('cs');
        openCustomerChat('GENERAL_CS');
      }
      setChatMessages((prev) => {
        if (prev.some((m) => m.id === newMsg.id)) return prev;
        const withoutOptimistic = prev.filter((m) => !(String(m.id).length < 16 && m.message === newMsg.message));
        const next = [...withoutOptimistic, newMsg];
        try {
          sessionStorage.setItem('laundry_cs_chat_' + key, JSON.stringify(next.slice(-80)));
        } catch {
          /* ignore */
        }
        return next;
      });
    };

    const channel = supabase
      .channel('cust_cs_' + key)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_chats' }, (payload) =>
        ingestIncoming(payload.new, true)
      )
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_chat_messages' }, (payload) =>
        ingestIncoming(payload.new, false)
      )
      .subscribe();

    const onVisible = () => {
      if (document.visibilityState === 'visible') loadCustomerChats(customerPhone);
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
  }, [customerPhone]);

  // Sinkronisasi realtime: order baru & perubahan status driver langsung tampil
  // di Beranda tanpa perlu refresh manual.
  useEffect(() => {
    if (!customerPhone) return;

    const channel = supabase
      .channel('realtime_pickup_customer')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pickup_orders' }, () => {
        fetchCustomerProfile(customerPhone);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => {
        fetchCustomerProfile(customerPhone);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [customerPhone]);

  useEffect(() => {
    if (!selectedOutlet) {
      setInternalDriverOnDuty(true);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      const ok = await hasOnDutyDriverAtOutlet(selectedOutlet);
      if (cancelled) return;
      if (ok === 'unknown') {
        setInternalDriverOnDuty(true);
        return;
      }
      setInternalDriverOnDuty(ok);
      if (!ok) setCourierType((cur) => (cur === 'INTERNAL' ? 'THIRD_PARTY' : cur));
    };
    void refresh();
    const channel = supabase
      .channel('cust_driver_duty_' + selectedOutlet)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_attendance' }, () => {
        void refresh();
      })
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [selectedOutlet]);

  useEffect(() => {
    const ready = activeOrders.filter((o) => isReadyForPickupAlert(o));
    const unseen = ready.find((o) => {
      try {
        return !localStorage.getItem('laundry_ready_' + o.id);
      } catch {
        return true;
      }
    });
    if (unseen) setReadyPopup(unseen);
  }, [activeOrders]);

  const dismissReadyPopup = () => {
    if (readyPopup?.id) {
      try {
        localStorage.setItem('laundry_ready_' + readyPopup.id, '1');
      } catch {
        /* ignore */
      }
    }
    setReadyPopup(null);
  };

  const handleRequestDelivery = async (order: any, e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (!customerPhone) return alert('Login terlebih dahulu.');
    if (isDeliveryInProgress(order)) {
      alert('Permintaan pengantaran sudah dikirim. Driver outlet akan mengantar.');
      return;
    }
    setRequestingDeliveryId(order.id);
    try {
      const { error } = await requestDriverDelivery({
        order,
        customerName: customerName || order.customer_name,
        customerPhone,
        customerAddress: composePickupAddress(customerAddress, houseNumber, pickupLandmark),
        selectedOutlet
      });
      if (error) throw error;
      alert('Permintaan pengantaran terkirim ke Portal Driver. Kurir outlet akan mengantar cucian ke alamat Anda.');
      fetchCustomerProfile(customerPhone);
    } catch (err: any) {
      alert('Gagal minta pengantaran: ' + (err.message || 'Coba lagi'));
    } finally {
      setRequestingDeliveryId(null);
    }
  };

  const handleConfirmThirdParty = async (order: any, e?: { stopPropagation?: () => void }) => {
    e?.stopPropagation?.();
    if (!confirm('Konfirmasi cucian sudah diterima?')) return;
    setConfirmDeliveryId(order.id);
    try {
      const { error } = await confirmThirdPartyReceived(order);
      if (error) {
        toast('Gagal konfirmasi: ' + error.message, 'err');
        return;
      }
      toast('Terima kasih. Cucian ditandai selesai.', 'ok');
      setDetailOrder((prev: any) => (prev && prev.id === order.id ? { ...prev, status: 'Selesai' } : prev));
      fetchCustomerProfile(customerPhone);
    } finally {
      setConfirmDeliveryId(null);
    }
  };

  useEffect(() => {
    if (!detailOrder?.id || !isOrderFinished(detailOrder)) return;
    let cancelled = false;
    maybeAutoConfirmOrder(detailOrder).then((next) => {
      if (cancelled || !next) return;
      if (next.complaint_status && next.complaint_status !== detailOrder.complaint_status) {
        setDetailOrder(next);
      }
    });
    loadComplaintForOrder(detailOrder).then(async (row) => {
      if (cancelled) return;
      setDetailComplaint(row);
      if (!row) {
        setComplaintTicket(null);
        return;
      }
      const ticket =
        complaintStepOf(row) === 'resolved'
          ? await findComplaintTicket(row)
          : await ensureComplaintTicketFromIssue(row);
      if (!cancelled) setComplaintTicket(ticket);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailOrder?.id, detailOrder?.complaint_status]);

  const handleSudahSesuai = async () => {
    if (!detailOrder) return;
    const { error, order } = await markOrderConfirmed(detailOrder);
    if (error) {
      toast('Gagal mengunci konfirmasi: ' + error.message, 'warn');
    }
    setDetailOrder(order);
    if (!readLocalFlag('review', order.id)) {
      setReviewStars(0);
      setReviewText('');
      setReviewOpen(true);
    }
  };

  const handleSubmitComplaint = async () => {
    if (!detailOrder) return;
    if (!complaintText.trim()) return toast('Isi deskripsi kendala.', 'warn');
    if (!complaintVideo) return toast('Video unboxing wajib diunggah sebelum mengirim komplain.', 'warn');
    setComplaintBusy(true);
    try {
      let photoUrl = '';
      if (complaintFile) {
        photoUrl =
          (await uploadProofFile(complaintFile, `complaint_${detailOrder.id}`).catch(() => '')) ||
          (await fileToCompressedDataUrl(complaintFile));
      }
      const videoUrl = await uploadProofFile(complaintVideo, `unbox_${detailOrder.id}`);
      const { error, order } = await submitOrderComplaint({
        order: detailOrder,
        description: complaintText.trim(),
        photoUrl,
        videoUrl,
        customerName: customerName || customerData?.name,
        customerPhone,
        outletName: outletsList.find((o) => String(o.id) === String(detailOrder.outlet_id))?.name || currentOutletObj?.name
      });
      if (error) {
        toast('Gagal kirim komplain: ' + error.message, 'err');
        return;
      }
      setDetailOrder(order);
      setComplaintOpen(false);
      setComplaintText('');
      setComplaintFile(null);
      setComplaintVideo(null);
      const issue = await loadComplaintForOrder(order);
      setDetailComplaint(issue);
      const ticket = issue ? await ensureComplaintTicketFromIssue(issue) : null;
      setComplaintTicket(ticket);
      if (ticket) setComplaintTicketOpen(true);
      toast('Komplain terkirim. Room chat tiket sudah dibuka.', 'ok');
    } catch (err: any) {
      toast(err?.message || 'Gagal unggah video unboxing.', 'err');
    } finally {
      setComplaintBusy(false);
    }
  };

  const handleComplaintRespond = async (agree: boolean) => {
    if (!detailComplaint) return toast('Tiket komplain belum siap. Coba buka ulang detail.', 'warn');
    setComplaintRespondBusy(true);
    try {
      const { error } = await customerRespondComplaint({
        issue: detailComplaint,
        order: detailOrder,
        agree
      });
      if (error) {
        toast('Gagal mengirim tanggapan: ' + error.message, 'err');
        return;
      }
      const nextStatus = agree ? 'resolved' : 'appealed';
      setDetailOrder((prev: any) => (prev ? { ...prev, complaint_status: nextStatus } : prev));
      const refreshed = await loadComplaintForOrder(detailOrder);
      setDetailComplaint(refreshed);
      const ticket = refreshed
        ? agree
          ? await findComplaintTicket(refreshed)
          : await ensureComplaintTicketFromIssue(refreshed)
        : null;
      setComplaintTicket(ticket);
      if (ticket && !agree) setComplaintTicketOpen(true);
      toast(agree ? 'Terima kasih. Komplain diselesaikan.' : 'Banding terkirim. CS Care akan investigasi ulang.', 'ok');
    } finally {
      setComplaintRespondBusy(false);
    }
  };

  const handleSubmitReview = async () => {
    if (!detailOrder) return;
    if (reviewStars < 1) return toast('Pilih rating 1–5 bintang.', 'warn');
    setReviewBusy(true);
    try {
      const { error } = await submitOrderReview({
        order: detailOrder,
        rating: reviewStars,
        comment: reviewText,
        customerId: customerData?.id || null,
        customerPhone
      });
      if (error) {
        toast('Gagal simpan ulasan: ' + error.message, 'err');
        return;
      }
      setReviewOpen(false);
      toast('Terima kasih atas ulasan Anda!', 'ok');
    } finally {
      setReviewBusy(false);
    }
  };

  // Riwayat waktu tiap tahap untuk modal detail. Pesanan yang masih berupa
  // pickup_orders (belum jadi transaksi) tidak punya work_logs, sehingga timeline
  // tampil sebagai kerangka tahap yang belum dikerjakan.
  useEffect(() => {
    if (!detailOrder?.id) {
      setDetailWorkLogs([]);
      return;
    }

    let cancelled = false;
    supabase
      .from('work_logs')
      .select('stage, employee_name, created_at, notes, photo_url')
      .eq('transaction_id', detailOrder.id)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        setDetailWorkLogs(error ? [] : data || []);
      });

    return () => {
      cancelled = true;
    };
  }, [detailOrder?.id]);

  const loadChats = async (orderId: string | null) => {
    openCustomerChat(orderId || 'GENERAL_CS');
    if (customerPhone) await loadCustomerChats(customerPhone);
  };

  useEffect(() => {
    async function initPWA() {
      const { data: dbOutlets } = await supabase.from('outlets').select('*');
      if (dbOutlets && dbOutlets.length > 0) {
        // "Penuh" hanya dari tanda manual owner/supervisor (outlets.is_overcapacity).
        const open = dbOutlets.filter((o: any) => !o.is_coming_soon && !o.is_overcapacity);
        const visible = open.length ? open : dbOutlets;
        setOutletsList(dbOutlets);
        setFilteredOutlets(visible);
        const qrRaw = readOutletQueryParam();
        const fromQr = matchOutletFromQuery(dbOutlets, qrRaw);
        const fromStore = matchOutletFromQuery(dbOutlets, readStoredCustomerOutlet());
        if (fromQr) {
          qrOutletLockRef.current = true;
          persistCustomerOutlet(fromQr);
          setSelectedOutlet(fromQr);
          setFilteredOutlets(ensureOutletInList(visible, dbOutlets, fromQr));
        } else if (fromStore) {
          persistCustomerOutlet(fromStore);
          setSelectedOutlet(fromStore);
          setFilteredOutlets(ensureOutletInList(visible, dbOutlets, fromStore));
        } else {
          const pick = nearestOpenOutlet(visible, null, calculateDistanceKm);
          if (pick) setSelectedOutlet(pick.id);
        }
      }

      const { data: dbSettings } = await supabase.from('app_settings').select('*').eq('id', 1).single();
      if (dbSettings) {
        const svcs = safeParse(dbSettings.dynamic_services, []);
        setDynamicServices(svcs);
        setOutletOverrides(safeParse(dbSettings.outlet_overrides, {}));
        setReceiptTerms(String(dbSettings.receipt_terms || '').trim() || DEFAULT_RECEIPT_TERMS);
        const layout = parseReceiptLayout((dbSettings as any).receipt_layout, dbSettings.receipt_terms);
        if (layout.terms) setReceiptTerms(layout.terms);

        const { data: dbPromos } = await supabase.from('promos').select('*');
        const fromTable = (dbPromos || []).map((p: any) => mapDbPromo(p)).filter((p: CatalogPromo) => p.is_active);
        const fromSettings = safeParse(dbSettings.promos_data, []).map((p: any, i: number) => mapSettingsPromo(p, i));
        setAvailablePromos(fromTable.length ? fromTable : fromSettings);

      }

      const { data: bannerPromos } = await supabase.from('promotions').select('*').order('created_at', { ascending: false });
      if (bannerPromos) setShowcasePromos(bannerPromos);

      // Sesi terverifikasi (cookie HttpOnly) diutamakan. Nomor di localStorage tanpa
      // sesi hanya diterima selama login lama (CUSTOMER_LEGACY_LOGIN_ENABLED) aktif.
      const auth = await fetchCustomerAuthState();
      setAuthState(auth);
      let savedPhone = localStorage.getItem('laundry_customer_phone');
      if (auth.session?.phone) {
        savedPhone = auth.session.phone;
        persistCustomerLocal(savedPhone);
      } else if (!auth.config.legacy) {
        clearCustomerLocal();
        savedPhone = null;
      }
      const savedAddr = localStorage.getItem('laundry_customer_address');
      if (savedAddr) setCustomerAddress(savedAddr);

      if (savedPhone) {
        setCustomerPhone(savedPhone);
        fetchCustomerProfile(savedPhone);
        loadCustomerAddresses(savedPhone).then((rows) => {
          applySavedAddressRows(rows);
        });
      }

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          setDeviceCoords({ lat, lon });
          if (!pickupPinLockedRef.current) setUserCoords({ lat, lon });

          if (dbOutlets && dbOutlets.length > 0) {
            const nearby = dbOutlets.filter((o: any) => {
              if (o.is_coming_soon) return false;
              if (o.is_overcapacity) return false;
              if (!o.latitude || !o.longitude) return true;
              const dist = calculateDistanceKm(lat, lon, Number(o.latitude), Number(o.longitude));
              return dist <= MAX_NEARBY_RADIUS_KM;
            });
            const pool = nearby.length ? nearby : dbOutlets.filter((o: any) => !o.is_overcapacity && !o.is_coming_soon);
            const visible = pool.length ? pool : dbOutlets;
            const qrOrStored =
              matchOutletFromQuery(dbOutlets, readOutletQueryParam()) ||
              matchOutletFromQuery(dbOutlets, readStoredCustomerOutlet());
            if (qrOrStored || qrOutletLockRef.current) {
              const lockedId = qrOrStored || String(selectedOutlet || '').trim();
              if (lockedId) {
                setFilteredOutlets(ensureOutletInList(visible, dbOutlets, lockedId));
                setSelectedOutlet(lockedId);
                persistCustomerOutlet(lockedId);
              } else {
                setFilteredOutlets(visible);
              }
            } else {
              setFilteredOutlets(visible);
              const pick = nearestOpenOutlet(visible, { lat, lon }, calculateDistanceKm);
              if (pick) setSelectedOutlet(pick.id);
            }
          }
        }, () => {});
      }
    }
    initPWA();
  }, []);

  useEffect(() => {
    if (!outletQuery || !outletsList.length) return;
    const id = matchOutletFromQuery(outletsList, outletQuery);
    if (!id) return;
    qrOutletLockRef.current = true;
    persistCustomerOutlet(id);
    setSelectedOutlet(id);
    setFilteredOutlets((prev) => ensureOutletInList(prev, outletsList, id));
  }, [outletQuery, outletsList]);

  useEffect(() => {
    if (!customerAddress || customerAddress.trim().length < 5) {
      setDeliveryFee(null);
      setDistanceKm(null);
      setDistanceLoading(false);
      return;
    }

    const curOutlet = outletsList.find(o => o.id === selectedOutlet);
    if (!curOutlet || !userCoords || !curOutlet.latitude || !curOutlet.longitude) {
      setDistanceKm(null);
      setDeliveryFee(18000);
      setDistanceLoading(false);
      return;
    }

    let cancelled = false;
    setDistanceLoading(true);
    const from = { lat: userCoords.lat, lng: userCoords.lon };
    const to = { lat: Number(curOutlet.latitude), lng: Number(curOutlet.longitude) };
    fetchCustomerRoadKm(from, to).then((km) => {
      if (cancelled) return;
      setDistanceKm(km);
      setDeliveryFee(ongkirRoundTripFromOneWayKm(km));
      setDistanceLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [customerAddress, selectedOutlet, userCoords, outletsList]);

  useEffect(() => {
    const src = deviceCoords || userCoords;
    if (!src) return;
    let cancelled = false;
    reverseGeocodeCity(src.lat, src.lon).then((city) => {
      if (!cancelled && city) setGpsCity(city);
    });
    return () => {
      cancelled = true;
    };
  }, [deviceCoords, userCoords]);

  const inferredCity = useMemo(
    () => inferCustomerCity(outletsList, userCoords || deviceCoords, [customerAddress, gpsCity, cityOverride]),
    [outletsList, userCoords, deviceCoords, customerAddress, gpsCity, cityOverride]
  );
  const userCity = cityOverride || inferredCity || gpsCity;
  const nearbyCities = useMemo(() => uniqueOutletCities(outletsList), [outletsList]);
  const nearbyItems = useMemo(
    () =>
      nearbyActiveOutlets(outletsList, deviceCoords || userCoords, {
        city: showAllCities ? '' : userCity,
        ignoreCity: showAllCities || !userCity,
        maxKm: showAllCities ? Number.POSITIVE_INFINITY : MAX_NEARBY_RADIUS_KM
      }),
    [outletsList, deviceCoords, userCoords, userCity, showAllCities]
  );
  const orderOutlets = useMemo(() => {
    const rows = pickNearestOpenOutlets(outletsList, userCoords, 3);
    if (outletQuery && selectedOutlet) {
      return ensureOutletInList(rows, outletsList, selectedOutlet).slice(0, 3);
    }
    return rows;
  }, [outletsList, userCoords, outletQuery, selectedOutlet]);
  const noOutletText =
    noOutletReason(outletsList) === 'full'
      ? 'Outlet terdekat sedang penuh dan ditutup sementara oleh pengelola. Coba lagi nanti atau hubungi CS.'
      : 'Belum ada cabang yang bisa melayani titik ini.';

  useEffect(() => {
    if (outletQuery) return;
    if (!orderOutlets.length) return;
    if (selectedOutlet && orderOutlets.some((o) => String(o.id) === String(selectedOutlet))) return;
    const pick = orderOutlets[0];
    if (pick?.id) {
      setSelectedOutlet(String(pick.id));
      persistCustomerOutlet(String(pick.id));
    }
  }, [orderOutlets, selectedOutlet, outletQuery]);

  const fetchCustomerProfile = async (phone: string) => {
    const norm = cleanPhone(phone);
    if (!norm) return;

    try {
      let { data: cust } = await supabase.from('customers').select('*').eq('phone', norm).limit(1);
      // Didaftarkan dengan bentuk lain (mis. 62… dari POS atau +kode negara).
      if (!cust?.length) ({ data: cust } = await supabase.from('customers').select('*').in('phone', phoneLookupKeys(norm)).limit(1));
      if (cust && cust.length > 0) {
        setCustomerData(cust[0]);
        if (cust[0].name) setCustomerName(cust[0].name);
      } else {
        setCustomerData({ name: customerName || 'Pelanggan', deposit_balance: 0 });
      }

      // Semua bentuk simpanan nomor ini: 08…/62…/+62… atau +kode negara (lib/phone).
    const keyList = phoneLookupKeys(norm)
      .map((k) => `"${k}"`)
      .join(',');

  // Tarik data pickup_orders langsung dengan query database
  const { data: pickupOrders } = await supabase
    .from('pickup_orders')
    .select('*')
    .or(`customer_phone.in.(${keyList}),phone_number.in.(${keyList})`)
    .order('created_at', { ascending: false });

  // Tarik data transactions langsung dengan query database
  const { data: posTransactions } = await supabase
    .from('transactions')
    .select('*')
    .in('customer_phone', phoneLookupKeys(norm))
    .order('created_at', { ascending: false });

  // Filter dan gabungkan data pickup & POS agar pesanan 'Tiba di Outlet' TIDAK PERNAH HILANG
  const activePickups = pickupOrders || [];
  const activeTxs = posTransactions || [];

  const pickupMap = new Map();
  activePickups.forEach((p: any) => pickupMap.set(p.id, p));
  const pickupByTx = new Map();
  activePickups.forEach((p: any) => {
    if (p.transaction_id) pickupByTx.set(p.transaction_id, p);
  });

  const mergedActive = activeTxs.map((t: any) => {
    const relatedPickup = (t.pickup_id ? pickupMap.get(t.pickup_id) : null) || pickupByTx.get(t.id) || null;
    const overlayStatus =
      relatedPickup && isDeliveryInProgress(relatedPickup) ? relatedPickup.status : t.status;
    // Chat driver: pesanan jemput/antar yang sedang dijalankan driver untuk nota ini.
    const chatPickup = [pickupByTx.get(t.id), t.pickup_id ? pickupMap.get(t.pickup_id) : null].find((p) => isDriverChatOpen(p));
    return {
      ...t,
      status: overlayStatus,
      pickup_id: t.pickup_id || relatedPickup?.id,
      driver_chat_id: chatPickup?.id,
      driver_chat_name: chatPickup?.driver_name,
      pickup_created_at: relatedPickup?.created_at,
      photo_pickup_url: t.photo_pickup_url || relatedPickup?.photo_pickup_url || relatedPickup?.photo_url,
      photo_outlet_url: t.photo_outlet_url || relatedPickup?.photo_outlet_url,
      photo_delivery_url: t.photo_delivery_url || relatedPickup?.photo_delivery_url || t.photo_antar_url || relatedPickup?.photo_antar_url || t.delivery_photo_url,
      rack_photo_url: t.rack_photo_url || relatedPickup?.rack_photo_url,
      sortir_photo_url: t.sortir_photo_url || relatedPickup?.sortir_photo_url
    };
  });

  activePickups.forEach((p: any) => {
    const alreadyInTrx = activeTxs.some(
      (t: any) => t.pickup_id === p.id || p.transaction_id === t.id
    );
    if (!alreadyInTrx) {
      mergedActive.push({
        ...p,
        driver_chat_id: isDriverChatOpen(p) ? p.id : undefined,
        driver_chat_name: isDriverChatOpen(p) ? p.driver_name : undefined,
        photo_pickup_url: p.photo_pickup_url || p.photo_url,
        photo_outlet_url: p.photo_outlet_url,
        photo_delivery_url: p.photo_delivery_url || p.photo_antar_url || p.delivery_photo_url,
        rack_photo_url: p.rack_photo_url,
        sortir_photo_url: p.sortir_photo_url
      });
    }
  });

  setActiveOrders(mergedActive);

  const activeTxIds = mergedActive
    .filter((o) => isTransactionRow(o) && !isOrderFinished(o))
    .map((o) => String(o.id))
    .slice(0, 50);
  if (activeTxIds.length) {
    const { data: logRows } = await supabase
      .from('work_logs')
      .select('transaction_id, stage, created_at')
      .in('transaction_id', activeTxIds)
      .order('created_at', { ascending: true });
    const grouped: Record<string, WorkLogRow[]> = {};
    (logRows || []).forEach((row: WorkLogRow & { transaction_id: string }) => {
      const key = String(row.transaction_id);
      (grouped[key] = grouped[key] || []).push(row);
    });
    setWorkLogsByTx(grouped);
  } else {
    setWorkLogsByTx({});
  }

  const unpaidBills = mergedActive.filter((o: any) => isPaymentLocked(o));
  setPendingCashierInvoice(unpaidBills);

  const withProofPhotos = (row: any, pickup?: any) => ({
    ...row,
    photo_pickup_url: row.photo_pickup_url || pickup?.photo_pickup_url || pickup?.photo_url || row.photo_url,
    photo_outlet_url: row.photo_outlet_url || pickup?.photo_outlet_url,
    photo_delivery_url: row.photo_delivery_url || pickup?.photo_delivery_url || row.photo_antar_url || pickup?.photo_antar_url || row.delivery_photo_url,
    photo_antar_url: row.photo_antar_url || pickup?.photo_antar_url || row.photo_delivery_url,
    rack_photo_url: row.rack_photo_url || pickup?.rack_photo_url,
    sortir_photo_url: row.sortir_photo_url || pickup?.sortir_photo_url,
    items: safeParse(row.items, row.items),
    rack_location: row.rack_location || row.rack_number || pickup?.rack_location,
    package_count: row.package_count || row.bag_count || pickup?.package_count,
    rack_notes: row.rack_notes || pickup?.rack_notes
  });

  let historyArr: any[] = [];
  activePickups.filter((o: any) => isOrderFinished(o)).forEach((o: any) => {
    const alreadyInTrx = activeTxs.some(
      (t: any) => isOrderFinished(t) && (t.pickup_id === o.id || o.transaction_id === t.id)
    );
    if (alreadyInTrx) return;
    historyArr.push({
      ...withProofPhotos(o),
      type: 'Online Order',
      title: o.service_type,
      detail: o.notes || '',
      price: o.amount || o.delivery_fee || 0,
      date: o.delivered_at || o.completed_at || o.created_at
    });
  });

  posTransactions?.filter((t: any) => isOrderFinished(t)).forEach((t: any) => {
    const relatedPickup = (t.pickup_id ? pickupMap.get(t.pickup_id) : null) || pickupByTx.get(t.id) || null;
    historyArr.push({
      ...withProofPhotos(t, relatedPickup),
      pickup_id: t.pickup_id || relatedPickup?.id,
      pickup_created_at: relatedPickup?.created_at,
      type: 'Outlet POS',
      title: `${t.service_type} (${t.receipt_number})`,
      detail: t.notes,
      price: t.amount,
      date: t.delivered_at || t.completed_at || t.created_at
    });
  });

      historyArr.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setCompletedOrders(historyArr);

      const { data: topupRows } = await supabase
        .from('deposit_topups')
        .select('*')
        .eq('customer_phone', norm)
        .order('created_at', { ascending: false });
      const paidTopups = (topupRows || []).filter((r: any) =>
        ['SUCCESS', 'LUNAS', 'PAID'].includes(String(r.status || '').toUpperCase())
      );
      if (paidTopups.length) {
        setDepositLogs(
          paidTopups.map((r: any) => ({
            ...r,
            package_name: depositPackageShort(r.package_name),
            price: r.amount,
            balance_added: r.balance_added,
            payment_method: r.payment_method || 'QRIS Mayar',
            status: 'LUNAS'
          }))
        );
      } else {
        const { data: memLogs } = await supabase
          .from('membership_logs')
          .select('*')
          .eq('customer_phone', norm)
          .order('created_at', { ascending: false });
        setDepositLogs(
          (memLogs || []).map((r: any) => ({
            ...r,
            package_name: depositPackageShort(r.package_name),
            payment_method: String(r.processed_by || '').toLowerCase().includes('mayar') ? 'QRIS Mayar' : r.order_type || 'Kasir',
            status: 'LUNAS'
          }))
        );
      }
    } catch (e) {
      setCustomerData({ name: 'Pelanggan', deposit_balance: 0 });
    }
  };

  const goToLogin = () => {
    const here = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/customer/dashboard';
    router.push(`/customer/login?next=${encodeURIComponent(here)}`);
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inlinePhoneLoginAllowed) return goToLogin();
    const norm = cleanPhone(customerPhone);
    if (!norm || !isValidCustomerPhone(norm)) return alert('Ketik nomor WA aktif!');
    localStorage.setItem('laundry_customer_phone', norm);
    setCustomerData({ name: 'Pelanggan Setia', deposit_balance: 0 });
    fetchCustomerProfile(norm);
    loadCustomerAddresses(norm).then((rows) => {
      applySavedAddressRows(rows);
    });
  };

  const handleLogout = () => {
    void logoutCustomer();
    localStorage.removeItem('laundry_customer_phone');
    setCustomerPhone('');
    setCustomerData(null);
    setSavedAddresses([]);
    setActiveTab('home');
    setActiveChatOrderId(null);
  };

  const coordsOfSaved = (row?: SavedAddress | null) => {
    if (!row) return null;
    const lat = Number(row.latitude);
    const lon = Number(row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  };

  const applySavedAddressRows = (rows: SavedAddress[]) => {
    setSavedAddresses(rows);
    const primary = rows.find((r) => r.is_primary) || rows[0];
    const text = primary?.full_address || primaryAddressOf(rows);
    if (text) {
      const parts = splitHouseNumber(text);
      setCustomerAddress(parts.street);
      if (parts.house) setHouseNumber(parts.house);
    }
    const pin = coordsOfSaved(primary);
    if (pin) {
      pickupPinLockedRef.current = true;
      setUserCoords(pin);
    }
  };

  const syncPrimaryAddress = (rows: SavedAddress[]) => {
    applySavedAddressRows(rows);
  };

  const handleSaveAddressDraft = async (draft: {
    id?: string;
    label: string;
    full_address: string;
    is_primary?: boolean;
    latitude?: number | null;
    longitude?: number | null;
  }) => {
    setAddressBusy(true);
    const next = await upsertCustomerAddress(cleanPhone(customerPhone), savedAddresses, draft);
    syncPrimaryAddress(next);
    if (draft.latitude != null && draft.longitude != null) {
      pickupPinLockedRef.current = true;
      setUserCoords({ lat: Number(draft.latitude), lon: Number(draft.longitude) });
    }
    setAddressBusy(false);
  };

  const handleDeleteAddress = async (id: string) => {
    setAddressBusy(true);
    const next = await removeCustomerAddress(cleanPhone(customerPhone), savedAddresses, id);
    syncPrimaryAddress(next);
    setAddressBusy(false);
  };

  const handleSetPrimaryAddress = async (id: string) => {
    setAddressBusy(true);
    const next = await setPrimaryCustomerAddress(cleanPhone(customerPhone), savedAddresses, id);
    syncPrimaryAddress(next);
    setAddressBusy(false);
  };

  const requestNearbyLocation = () => {
    if (!navigator.geolocation) return;
    setLocatingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDeviceCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setLocatingGps(false);
      },
      () => setLocatingGps(false)
    );
  };

  const handleGetCurrentLocation = () => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setGpsHint('Browser/HP tidak mendukung GPS. Ketik alamat atau pilih alamat tersimpan.');
      return alert('Browser/HP Anda tidak mendukung deteksi lokasi otomatis.');
    }

    setLocatingGps(true);
    setGpsHint('Mengambil lokasi GPS… izinkan akses lokasi jika diminta.');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        pickupPinLockedRef.current = true;
        setUserCoords({ lat: latitude, lon: longitude });
        setDeviceCoords({ lat: latitude, lon: longitude });
        setGpsHint('Pin dipindah ke lokasi Anda. Mengisi nama jalan…');
        const label = await reverseGeocodeAddress(latitude, longitude);
        if (label) {
          setCustomerAddress(splitHouseNumber(label).street);
          setGpsHint('Titik GPS terpasang. Isi nomor rumah, lalu geser peta ke gerbang jika perlu.');
        } else {
          setGpsHint('GPS berhasil. Isi nomor rumah dan geser peta ke gerbang.');
        }
        setLocatingGps(false);
      },
      (err) => {
        setLocatingGps(false);
        const denied = err?.code === 1;
        const msg = denied
          ? 'Izin lokasi ditolak. Aktifkan GPS/izin lokasi di HP, lalu klik lagi.'
          : 'Gagal mengambil GPS. Pastikan izin lokasi aktif, atau ketik alamat / pilih alamat tersimpan.';
        setGpsHint(msg);
        alert(msg);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  };

  const getServiceUnitPrice = (svcName: string) => {
    const activeSvc = dynamicServices.find(s => (s.name || '').trim().toLowerCase() === (svcName || '').trim().toLowerCase());
    if (activeSvc) {
      const localPrice = outletOverrides?.[selectedOutlet]?.[activeSvc.id]?.price;
      return localPrice !== undefined ? Number(localPrice) : Number(activeSvc.price || 0);
    }
    const lower = (svcName || '').toLowerCase();
    if (lower.includes('bedcover double')) return 35000;
    if (lower.includes('bedcover single')) return 25000;
    if (lower.includes('sprei')) return 15000;
    if (lower.includes('setrika')) return 5000;
    return 7000;
  };

  // Kiloan "dipisah" hanya berlaku bermakna kalau lebih dari 1 kantong —
  // 1 kantong dipisah/dicampur sama saja (satu paket).
  const isSplitKiloanBags = washProcess === 'Pisah Perkantong' && Number(bagCount) > 1;

  // Jumlah form per-kantong diatur saat customer mengubah jumlah kantong atau
  // pilihan campur/pisah. Form yang sudah ada dipertahankan; form yang akan
  // dibuang karena sudah berisi rincian harus dikonfirmasi dulu.
  const applyKiloanBagLayout = (nextBagCount: number, nextWashProcess: string) => {
    const count = Math.max(1, Math.min(MAX_KILOAN_BAGS, nextBagCount || 1));
    const split = nextWashProcess === 'Pisah Perkantong' && count > 1;
    const n = split ? count : 1;
    const dropped = kiloanBagForms.slice(n);
    const droppedFilled = dropped
      .map((f, i) => ({ f, bag: n + i + 1 }))
      .filter(({ f }) => BAG_CATEGORY_ORDER.some((k) => String(f.categories[k] ?? '').trim() !== ''));
    if (droppedFilled.length > 0) {
      const names = droppedFilled.map(({ bag }) => `Kantong ${bag}`).join(', ');
      const ok = window.confirm(`Rincian ${names} yang sudah diisi akan dihapus. Lanjutkan?`);
      if (!ok) return;
    }
    setBagCount(String(count));
    // 1 kantong hanya bisa "Dicampur"; pilihan yang belum dibuat tetap kosong.
    setWashProcess(count > 1 || !nextWashProcess ? nextWashProcess : 'Gabung Semua');
    setKiloanFormError('');
    setKiloanBagForms((prev) =>
      Array.from({ length: n }, (_, i) => prev[i] || emptyKiloanBagForm(selectedKiloanSvc, kiloanDuration))
    );
  };

  const patchKiloanBagCategory = (bagIdx: number, key: (typeof BAG_CATEGORY_ORDER)[number], value: string) => {
    setKiloanFormError('');
    setKiloanBagForms((prev) =>
      prev.map((f, i) => (i === bagIdx ? { ...f, categories: { ...f.categories, [key]: value } } : f))
    );
  };

  const patchKiloanBagField = (bagIdx: number, field: 'serviceName' | 'duration', value: string) => {
    setKiloanFormError('');
    setKiloanBagForms((prev) => prev.map((f, i) => (i === bagIdx ? { ...f, [field]: value } : f)));
  };

  const kiloanUnitPriceFor = (svcName: string, duration: string) =>
    Math.round(getServiceUnitPrice(svcName) * getDurationMultiplier(duration));

  /** 5 isian jumlah per kategori pakaian (satu kantong). Dipakai mode gabung (bagIdx 0) & mode pisah (per kantong). */
  const renderKiloanBagCategoryInputs = (bagIdx: number, categories: BagCategoryCounts) => (
    <div className="grid grid-cols-2 gap-2">
      {BAG_CATEGORY_ORDER.map((key) => (
        <div key={key}>
          <label className="block text-[9px] text-slate-500 font-bold mb-0.5">{BAG_CATEGORY_LABELS[key]}</label>
          <input
            type="number"
            min="0"
            inputMode="numeric"
            placeholder="Isi"
            aria-label={`${BAG_CATEGORY_LABELS[key]} Kantong ${bagIdx + 1}`}
            value={categories[key]}
            onChange={(e) => patchKiloanBagCategory(bagIdx, key, e.target.value.replace(/[^\d]/g, ''))}
            className="w-full bg-white border border-brand-200 rounded-xl p-2 text-xs font-extrabold text-center"
          />
        </div>
      ))}
    </div>
  );

  /**
   * Validasi & commit ke keranjang. Mode gabung: SATU form (kiloanBagForms[0])
   * memakai layanan/durasi di atas (selectedKiloanSvc/kiloanDuration), berapa
   * pun jumlah kantongnya — bukan berarti membuat 2 paket hanya karena
   * bagCount=2. Mode pisah (>1 kantong): SEMUA kantong divalidasi dulu,
   * lalu ditambahkan sekaligus, masing-masing dengan layanan/durasi sendiri.
   */
  const handleAddKiloanToCart = () => {
    setKiloanFormError('');
    if (!Number(bagCount)) {
      setKiloanFormError('Isi jumlah kantong dulu (tekan +).');
      return;
    }
    if (!washProcess) {
      setKiloanFormError('Pilih proses cuci: Dicampur atau Dipisah.');
      return;
    }
    if (!hasFading) {
      setKiloanFormError('Pilih apakah ada pakaian luntur: Tidak atau Ya.');
      return;
    }
    if (isSplitKiloanBags) {
      const n = Math.max(1, Math.min(MAX_KILOAN_BAGS, Number(bagCount) || 1));
      const forms = kiloanBagForms.slice(0, n);
      for (let i = 0; i < n; i++) {
        const f = forms[i];
        if (!f?.serviceName) {
          setKiloanFormError(`Pilih jenis kiloan untuk Kantong ${i + 1}.`);
          return;
        }
        if (!f.duration) {
          setKiloanFormError(`Pilih durasi untuk Kantong ${i + 1}.`);
          return;
        }
        if (!bagCategoryCountsComplete(f.categories)) {
          setKiloanFormError(`Lengkapi semua isian jumlah di Kantong ${i + 1} (boleh 0, tidak boleh kosong).`);
          return;
        }
        if (!bagCategoryCountsValid(f.categories)) {
          setKiloanFormError(`Total isian Kantong ${i + 1} harus lebih dari 0.`);
          return;
        }
      }
      const newLines = forms.map((f) => {
        const { pcs, kg } = summarizeBagWeight(f.categories);
        return {
          name: f.serviceName,
          kg,
          qty: pcs,
          duration: f.duration,
          price: kiloanUnitPriceFor(f.serviceName, f.duration),
          bagDetail: { ...f.categories },
          bags: 1
        };
      });
      setCartKiloan((prev) => [...prev, ...newLines]);
    } else {
      if (!selectedKiloanSvc) {
        setKiloanFormError('Pilih jenis kiloan dulu.');
        return;
      }
      if (!kiloanDuration) {
        setKiloanFormError('Pilih durasi kiloan dulu.');
        return;
      }
      const f = kiloanBagForms[0] || emptyKiloanBagForm();
      if (!bagCategoryCountsComplete(f.categories)) {
        setKiloanFormError('Lengkapi semua isian jumlah (boleh 0, tidak boleh kosong).');
        return;
      }
      if (!bagCategoryCountsValid(f.categories)) {
        setKiloanFormError('Total isian harus lebih dari 0.');
        return;
      }
      const { pcs, kg } = summarizeBagWeight(f.categories);
      setCartKiloan((prev) => [
        ...prev,
        {
          name: selectedKiloanSvc,
          kg,
          qty: pcs,
          duration: kiloanDuration,
          price: kiloanActiveUnitPrice,
          bagDetail: { ...f.categories },
          // Mode campur: semua kantong jadi satu paket (satu mesin).
          bags: Math.max(1, Number(bagCount) || 1)
        }
      ]);
    }
    // Paket berikutnya: jumlah kantong & proses cuci dipilih ulang oleh customer.
    setBagCount('');
    setWashProcess('');
    setKiloanBagForms([emptyKiloanBagForm(selectedKiloanSvc, kiloanDuration)]);
  };

  const handleRemoveKiloan = (idx: number) => {
    setCartKiloan((prev) => prev.filter((_, i) => i !== idx));
  };

  const formatSatuanItemNotes = (item: { merk?: string; warna?: string; corak?: string }) =>
    [
      item.merk?.trim() && `Merk: ${item.merk.trim()}`,
      item.warna?.trim() && `Warna: ${item.warna.trim()}`,
      item.corak?.trim() && `Corak: ${item.corak.trim()}`
    ].filter(Boolean).join(' · ');

  const formatSatuanPiecesNotes = (pieces?: Array<{ merk?: string; warna?: string; corak?: string }>) => {
    if (!pieces?.length) return '';
    const lines = pieces.map((p) => formatSatuanItemNotes(p));
    const allSame = lines.every((line) => line === lines[0]);
    if (allSame) return lines[0] || '';
    return pieces
      .map((p, i) => {
        const n = formatSatuanItemNotes(p);
        return n ? `Pcs ${i + 1}: ${n}` : '';
      })
      .filter(Boolean)
      .join(' · ');
  };

  const patchSatuanPiece = (idx: number, field: 'merk' | 'warna' | 'corak', value: string) => {
    setSatuanPieceNotes((prev) => {
      if (satuanNotesSame) {
        const first = { ...(prev[0] || emptySatuanPiece()), [field]: value };
        return prev.map(() => ({ ...first }));
      }
      return prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p));
    });
  };

  // Foto wajib per potong. Mode "semua pcs sama": mengunggah/menghapus di
  // slot 0 berlaku untuk semua potong (sama seperti merk/warna/corak di atas).
  // Mode berbeda per pcs: setiap indeks independen.
  const handleSatuanPiecePhotoSelect = async (idx: number, file: File | null) => {
    if (!file) return;
    setSatuanFormError('');
    const applyPatch = (patch: Partial<SatuanPieceForm>) =>
      setSatuanPieceNotes((prev) =>
        satuanNotesSame ? prev.map((p) => ({ ...p, ...patch })) : prev.map((p, i) => (i === idx ? { ...p, ...patch } : p))
      );
    applyPatch({ photoUploading: true, photoError: undefined });
    try {
      const { path, previewUrl } = await uploadSatuanItemPhoto(file);
      // Cabut pratinjau lama sebelum diganti supaya tidak bocor memori.
      setSatuanPieceNotes((prev) => {
        prev.forEach((p, i) => {
          if (p.photoPreviewUrl && (satuanNotesSame || i === idx)) {
            try {
              URL.revokeObjectURL(p.photoPreviewUrl);
            } catch {
              /* ignore */
            }
          }
        });
        return prev;
      });
      applyPatch({ photoPath: path, photoPreviewUrl: previewUrl, photoUploading: false, photoError: undefined });
    } catch (err: unknown) {
      const message = err instanceof Error && err.message ? err.message : 'Gagal mengunggah foto. Coba lagi.';
      applyPatch({ photoUploading: false, photoError: message });
    }
  };

  const handleRemoveSatuanPiecePhoto = (idx: number) => {
    setSatuanPieceNotes((prev) => {
      const next = prev.map((p, i) => {
        if (!(satuanNotesSame || i === idx)) return p;
        if (p.photoPreviewUrl) {
          try {
            URL.revokeObjectURL(p.photoPreviewUrl);
          } catch {
            /* ignore */
          }
        }
        return { ...p, photoPath: undefined, photoPreviewUrl: undefined, photoError: undefined };
      });
      return next;
    });
  };

  /** Slot foto yang WAJIB terisi saat ini: 1 slot bila "semua pcs sama", N slot bila berbeda per pcs. */
  const requiredSatuanPhotoSlots = () =>
    satuanNotesSame ? satuanPieceNotes.slice(0, 1) : satuanPieceNotes.slice(0, Number(inputSatuanQty) || 1);

  const resetSatuanPiecePhotos = () => {
    setSatuanPieceNotes((prev) => {
      prev.forEach((p) => {
        if (p.photoPreviewUrl) {
          try {
            URL.revokeObjectURL(p.photoPreviewUrl);
          } catch {
            /* ignore */
          }
        }
      });
      return prev;
    });
  };

  useEffect(() => {
    const n = Math.max(1, Math.min(12, Number(inputSatuanQty) || 1));
    setSatuanPieceNotes((prev) => {
      const next = Array.from({ length: n }, (_, i) => prev[i] || emptySatuanPiece());
      if (satuanNotesSame) {
        const first = next[0] || emptySatuanPiece();
        return next.map(() => ({ ...first }));
      }
      return next;
    });
  }, [inputSatuanQty, satuanNotesSame]);

  const handleAddSatuanToCart = () => {
    setSatuanFormError('');
    if (!selectedSatuanSvc) {
      setSatuanFormError('Pilih item satuan dulu.');
      return;
    }
    if (!satuanInputDuration) {
      setSatuanFormError('Pilih durasi item ini dulu.');
      return;
    }
    const qty = Number(inputSatuanQty) || 1;
    if (satuanPhotoRequired && !satuanPhoto) {
      setSatuanFormError('Memuat pengaturan foto. Coba lagi sebentar.');
      return;
    }
    if (satuanPhotoRequired && !satuanPhoto?.canUpload) {
      setSatuanFormError(SATUAN_PHOTO_NEEDS_VERIFIED_LOGIN);
      return;
    }
    // Wajib foto: minimal 1 slot (mode sama) atau N slot (mode beda per pcs)
    // sudah punya foto yang BERHASIL diunggah — tidak sedang mengunggah, dan
    // tidak gagal. Tidak pernah menganggap unggahan yang gagal/belum selesai
    // sebagai cukup untuk lanjut.
    const slots = satuanPhotoRequired ? requiredSatuanPhotoSlots() : [];
    const missingIdx = slots.findIndex((p) => !p.photoPath || p.photoUploading || p.photoError);
    if (missingIdx !== -1) {
      const slot = slots[missingIdx];
      setSatuanFormError(
        slot?.photoUploading
          ? 'Tunggu sampai foto selesai diunggah sebelum menambahkan item.'
          : slot?.photoError
          ? `Foto ${satuanNotesSame ? '' : `Pcs ${missingIdx + 1} `}gagal diunggah: ${slot.photoError}`
          : `Unggah foto ${satuanNotesSame ? 'item ini' : `untuk Pcs ${missingIdx + 1}`} dulu — wajib sebelum item bisa ditambahkan.`
      );
      return;
    }
    const basePrice = getServiceUnitPrice(selectedSatuanSvc);
    const mult = getDurationMultiplier(satuanInputDuration);
    const finalPrice = Math.round(basePrice * mult);
    const pieces: SatuanPieceRecord[] = (satuanNotesSame
      ? Array.from({ length: qty }, () => ({ ...(satuanPieceNotes[0] || emptySatuanPiece()) }))
      : satuanPieceNotes.slice(0, qty)
    ).map((p) => ({
      merk: p.merk.trim(),
      warna: p.warna.trim(),
      corak: p.corak.trim(),
      photo_path: satuanPhotoRequired ? p.photoPath : undefined
    }));

    setCartSatuan([...cartSatuan, {
      name: selectedSatuanSvc,
      basePrice,
      price: finalPrice,
      qty,
      duration: satuanInputDuration,
      pieces
    }]);
    resetSatuanPiecePhotos();
    setInputSatuanQty('1');
    setSatuanNotesSame(true);
    setSatuanPieceNotes([emptySatuanPiece()]);
  };

  const handleRemoveSatuan = (idx: number) => {
    setCartSatuan(cartSatuan.filter((_, i) => i !== idx));
  };

  const kiloanBaseUnitPrice = getServiceUnitPrice(selectedKiloanSvc);
  const kiloanActiveUnitPrice = Math.round(kiloanBaseUnitPrice * getDurationMultiplier(kiloanDuration));
  // Kiloan HANYA masuk hitungan setelah ditekan "Tambah Paket Kiloan Ini" —
  // tidak ada lagi fallback implisit dari form yang belum di-commit (form
  // sekarang berisi rincian per kategori, bukan sekadar kg/pcs tunggal).
  const kiloanLines = cartKiloan;
  // Hasil akhir keranjang: total kantong (paket campur bisa >1 kantong) dan
  // proses cuci (lebih dari 1 paket = dicuci terpisah).
  const kiloanBagTotal = kiloanLines.reduce((sum, k) => sum + Math.max(1, Number(k.bags) || 1), 0);
  const kiloanWashFinal = kiloanLines.length > 1 ? 'Pisah Perkantong' : 'Gabung Semua';
  const kiloanSubtotal = kiloanLines.reduce((sum, line) => sum + kiloanLineTotal(line.price, line.kg), 0);
  const kiloanTotalKg = kiloanOrderKgOf(kiloanLines);

  let satuanSubtotal = 0;
  if (isSatuanChecked) {
    cartSatuan.forEach(item => { 
      satuanSubtotal += item.price * item.qty; 
    });
  }

  const isInternalDriver = courierType === 'INTERNAL';
  const rawOngkir = isInternalDriver ? 0 : deliveryFee || 0;
  const rawSubtotal = kiloanSubtotal + satuanSubtotal;

  const promoDiscountVal = promoDiscountRp(claimedPromo, rawSubtotal, rawOngkir);

  const finalOngkir = Math.max(0, rawOngkir - (claimedPromo?.type === 'ongkir' ? promoDiscountVal : 0));
  const basketAfterPromo = Math.max(0, rawSubtotal + rawOngkir - promoDiscountVal);
  const loyaltyDiscountVal = loyaltyRedeem > 0 && loyaltyRedeem <= basketAfterPromo ? loyaltyRedeem : 0;
  const grandTotalEstimate = Math.max(0, Math.round(basketAfterPromo - loyaltyDiscountVal));

  const handleClaimPromo = (promo: CatalogPromo) => {
    const basket = rawSubtotal + rawOngkir;
    if (!promoIsClaimable(promo, basket)) {
      if (promo.max_quota > 0 && promo.used_count >= promo.max_quota) {
        alert('Kuota voucher ini sudah habis.');
        return false;
      }
      alert(`Minimal transaksi untuk promo ini adalah Rp ${Number(promo.minTx || 0).toLocaleString('id-ID')}`);
      return false;
    }
    setClaimedPromo(promo);
    setShowPromoModal(false);
    setSelectedBanner(null);
    return true;
  };

  const handleApplyPromoCode = (raw: string) => {
    const found = findPromoByCode(availablePromos, raw);
    if (!found) {
      alert('Kode promo tidak ditemukan atau tidak aktif.');
      return false;
    }
    return handleClaimPromo(found);
  };

  // Validasi per langkah form pesanan. Aturan sama dengan validasi submit lama,
  // hanya dipindah ke langkah terkait agar pesan muncul lebih awal.
  const orderStepError = (step: 1 | 2 | 3): string => {
    if (step === 1) {
      if (!customerAddress || customerAddress.trim().length < 5) return 'Cari dan pilih nama jalan / lokasi penjemputan dulu.';
      if (!isValidHouseNumber(houseNumber)) return 'Isi nomor rumah / blok. Boleh lengkap, contoh: 117, 12A, B-3, atau rumah no.117.';
      if (!userCoords) return 'Pasang titik di peta dulu: pilih saran, tekan GPS, atau geser peta ke gerbang.';
      if (!selectedOutlet || !orderOutlets.some((o) => String(o.id) === String(selectedOutlet))) {
        return orderOutlets.length ? 'Pilih outlet yang melayani alamat Anda.' : noOutletText;
      }
      if (pickupLater) {
        const sched = parsePickupSchedule(pickupDate, pickupTime);
        if (!sched) return 'Isi tanggal dan jam jemput yang valid (contoh 03/09/2026 dan 09.00).';
        if (sched.at.getTime() <= Date.now()) return 'Jadwal jemput harus di masa depan.';
      }
      if (courierType === 'INTERNAL' && !internalDriverOnDuty) {
        return 'Driver internal cabang ini sedang tidak bertugas. Silakan pilih kurir instan/antar mandiri.';
      }
      return '';
    }
    if (step === 2) {
      if (!isKiloanChecked && !kiloanLines.length && (!isSatuanChecked || cartSatuan.length === 0)) {
        return 'Pilih minimal 1 paket Kiloan atau Satuan!';
      }
      if (isKiloanChecked && kiloanLines.length === 0) {
        return 'Tekan "Tambah Paket Kiloan Ini" untuk memasukkan kiloan, atau hapus centang Paket Laundry Kiloan.';
      }
      if (kiloanLines.length > 0 && kiloanOrderKgOf(kiloanLines) < KILOAN_MIN_ORDER_KG) {
        return `Total kiloan minimal ${KILOAN_MIN_ORDER_KG} kg (saat ini ~${kiloanOrderKgOf(kiloanLines)} kg). Tambah cucian kiloan lagi.`;
      }
      if (isSatuanChecked && cartSatuan.length === 0) {
        return 'Tekan "Tambah Item Satuan Ini" untuk memasukkan item satuan, atau hapus centang Items Satuan.';
      }
      if (satuanPhotoRequired && isSatuanChecked && cartSatuan.some((it) => !satuanItemHasRequiredPhotos(it))) {
        return 'Setiap item satuan wajib punya foto. Lengkapi foto pada item yang belum sebelum lanjut.';
      }
      return '';
    }
    if (!customerName.trim()) return 'Isi nama lengkap pemesan.';
    if (!agreedNoValuables) return 'Centang pernyataan tidak ada barang berharga / selain cucian di saku atau tas.';
    if (!agreedTerms) return 'Centang persetujuan Syarat & Ketentuan untuk melanjutkan pesanan.';
    return '';
  };

  const goOrderStep = (target: 1 | 2 | 3) => {
    // Maju hanya jika langkah sebelumnya valid; mundur selalu boleh.
    for (let st = 1 as 1 | 2 | 3; st < target; st = (st + 1) as 1 | 2 | 3) {
      const msg = orderStepError(st);
      if (msg) {
        setOrderStep(st);
        setOrderFormError(msg);
        return false;
      }
    }
    setOrderFormError('');
    setOrderStep(target);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
    return true;
  };

  const handleOrderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Cegah pesanan ganda: kunci sinkron sebelum state React sempat diperbarui.
    if (orderSubmitLockRef.current) return;
    if (!customerPhone) return alert('Login terlebih dahulu!');
    for (const st of [1, 2, 3] as const) {
      const msg = orderStepError(st);
      if (msg) {
        setOrderStep(st);
        setOrderFormError(msg);
        return;
      }
    }
    setOrderFormError('');
    orderSubmitLockRef.current = true;
    try {
      await submitValidatedOrder();
    } finally {
      orderSubmitLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  const submitValidatedOrder = async () => {
    // PENGAMAN: Blokir total pembayaran COD
    if ((typeof paymentMethod !== 'undefined' && paymentMethod === 'COD') || (typeof paymentMethod !== 'undefined' && paymentMethod === 'Cash on Delivery')) {
      alert('Mohon maaf, Laundrivery saat ini hanya melayani pembayaran cashless / transfer online. Pembayaran COD tidak tersedia.');
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(true);
    const normPhone = cleanPhone(customerPhone);

    const detailLines: string[] = [];
    if (kiloanLines.length) {
      detailLines.push(
        `Kiloan: ${kiloanLines.map((k) => `${k.name} ${k.kg}Kg · ${k.qty} Pcs (${k.duration})`).join(', ')}`
      );
    }
    if (isSatuanChecked && cartSatuan.length > 0) {
      const items = cartSatuan.map((i) => {
        const extra = formatSatuanPiecesNotes(i.pieces);
        return extra ? `${i.name} x${i.qty} (${extra})` : `${i.name} x${i.qty}`;
      }).join(', ');
      detailLines.push(`Satuan: ${items}`);
    }
    if (claimedPromo) detailLines.push(`Promo: ${claimedPromo.title}`);
    if (loyaltyDiscountVal > 0) detailLines.push(`Poin loyalty: -${idr(loyaltyDiscountVal)}`);
    detailLines.push(`Est. Tagihan: Rp ${grandTotalEstimate.toLocaleString('id-ID')}`);

    const mainServiceLabel = kiloanLines.length
      ? `${kiloanLines[0].name} (${kiloanLines[0].duration})`
      : `Satuan (${cartSatuan.length} Item)`;
    const pickupFull = composePickupAddress(customerAddress, houseNumber, pickupLandmark);
    const notesCombined = `Alamat: ${pickupFull} | Detail: ${detailLines.join(' | ')}${notes ? ` | Catatan: ${notes}` : ''}`;
    // Nomor order dibuat sekali per draf dan dipakai ulang saat kirim ulang setelah
    // gagal jaringan, sehingga percobaan ulang tidak membuat pesanan kedua.
    if (!draftOrderNoRef.current) draftOrderNoRef.current = `ORD-${Date.now().toString().slice(-8)}`;
    const autoOrderNo = draftOrderNoRef.current;

    const schedule = pickupLater ? parsePickupSchedule(pickupDate, pickupTime) : null;
    if (pickupLater && !schedule) {
      setIsSubmitting(false);
      return alert('Isi tanggal dan jam jemput yang valid (contoh 03/09/2026 dan 09.00).');
    }
    if (schedule && schedule.at.getTime() <= Date.now()) {
      setIsSubmitting(false);
      return alert('Jadwal jemput harus di masa depan.');
    }
    const isFuturePickup = !!schedule;

    const hasKiloanOrder = kiloanLines.length > 0;
    // bagCount/washProcess di state hanya berlaku untuk kantong yang SEDANG
    // diisi (di-reset tiap kali "Tambah Paket Kiloan Ini" ditekan). Nilai yang
    // dikirim ke payload harus mencerminkan HASIL AKHIR keranjang kiloan:
    // berapa paket kiloan terpisah yang benar-benar jadi, bukan status form
    // yang sudah direset.
    const finalKiloanBagCount = hasKiloanOrder ? kiloanBagTotal : 1;
    const finalKiloanWashProcess = hasKiloanOrder ? kiloanWashFinal : '';
    const detailInfo = hasKiloanOrder
      ? `[INFO CUCIAN] Kantong: ${finalKiloanBagCount} | Cuci: ${finalKiloanWashProcess || '-'} | Luntur: ${hasFading || '-'}`
      : '';
    const statementNote = '[PERNYATAAN] Tidak ada barang berharga / selain cucian pada saku atau tas';
    const termsNote = '[S&K] Disetujui';
    const baseNotes = [detailInfo, notesCombined, statementNote, termsNote].filter(Boolean).join(' | ');
    const finalNotes = isFuturePickup && schedule ? withScheduleNote(baseNotes, schedule.date, schedule.time.slice(0, 5)) : baseNotes;

    // Rincian item satuan dikirim terstruktur agar POS bisa memuatnya langsung ke
    // keranjang nota. Catatan merk/warna/corak ikut di `notes` per baris.
    const satuanItems = isSatuanChecked
      ? cartSatuan.map((i) => ({
          name: i.name,
          qty: Number(i.qty) || 1,
          price: Number(i.price) || 0,
          basePrice: Number(i.basePrice) || 0,
          duration: i.duration || 'Reguler (3 Hari)',
          type: 'pcs' as const,
          pieces: i.pieces || [],
          notes: formatSatuanPiecesNotes(i.pieces)
        }))
      : [];
    // bag_category_counts dikirim terstruktur (per kategori pakaian) supaya
    // POS/kasir bisa melihat rincian yang customer isi, bukan hanya kg total —
    // lihat "Data Penjemputan Terisi Otomatis" di app/pos/page.tsx.
    const kiloanItems = kiloanLines.map((k) => ({
      name: k.name,
      qty: Number(k.qty) || 1,
      weight: Number(k.kg) || 0,
      price: Number(k.price) || 0,
      duration: k.duration || 'Reguler (3 Hari)',
      type: 'kg' as const,
      bag_category_counts: k.bagDetail || null
    }));
    const itemsPayload = [...kiloanItems, ...satuanItems];

    const payload = {
      order_number: autoOrderNo,
      outlet_id: selectedOutlet || null,
      customer_name: customerName || 'Pelanggan Online',
      customer_phone: normPhone,
      phone_number: normPhone,
      service_type: mainServiceLabel,
      estimated_weight: kiloanLines.reduce((s, k) => s + k.kg, 0) || 0,
      address: pickupFull,
      formatted_address: pickupFull,
      latitude: userCoords?.lat ?? null,
      longitude: userCoords?.lon ?? null,
      address_id: (() => {
        const id = savedAddresses.find((a) => a.full_address === pickupFull || a.full_address === customerAddress)?.id || '';
        return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
      })(),
      duration: kiloanLines[0]?.duration || 'Reguler (3 Hari)',
      bag_count: finalKiloanBagCount,
      wash_process: finalKiloanWashProcess,
      has_fading: hasKiloanOrder && hasFading === 'Ya',
      has_valuables: false,
      items: itemsPayload,
      delivery_fee: Number(finalOngkir) || 0,
      notes: finalNotes,
      // "Jemput sekarang": pickup_date wajib diisi (kolom NOT NULL) — pakai
      // tanggal hari ini di zona waktu lokal pelanggan, tanpa pickup_time
      // eksplisit, supaya order tetap terklasifikasi "Berlangsung" (bukan
      // "Terjadwal") — lihat isScheduledOrder di lib/customerActivity.ts.
      pickup_date: isFuturePickup && schedule ? schedule.date : localDateISO(),
      pickup_time: isFuturePickup && schedule ? schedule.time : null,
      scheduled_at: isFuturePickup && schedule ? schedule.iso : null,
      pickup_at: isFuturePickup && schedule ? schedule.iso : null,
      status: isFuturePickup ? 'Terjadwal' : 'Menunggu Kurir',
      courier_type: isFuturePickup ? null : courierType || 'INTERNAL'
    };

    // Pesanan dibuat SERVER (/api/customer/order/create): validasi isi, nomor dari
    // sesi, status/tanggal, wajib foto item satuan, dan tugas driver/CS. Browser
    // tidak lagi menulis pickup_orders/system_tasks sendiri. Idempoten per
    // order_number, jadi ketukan ulang/retry tidak membuat pesanan ganda.
    let insertedData: { id: string }[] | null = null;
    let error: { message: string; userFacing?: boolean } | null = null;
    try {
      const res = await fetch('/api/customer/order/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
      });
      const out = await res.json().catch(() => ({}));
      if (res.ok && out?.id) {
        insertedData = [{ id: String(out.id) }];
        if (!out.duplicate) {
          notifyStaffNewOrder({ outletId: selectedOutlet || null, customerName: payload.customer_name, service: payload.service_type });
        }
      } else {
        error = res.status < 500 && out?.error ? { message: String(out.error), userFacing: true } : { message: String(out?.detail || out?.error || `HTTP ${res.status}`) };
      }
    } catch (e) {
      error = { message: String((e as Error)?.message || 'Failed to fetch') };
    }

    if (!error && insertedData && insertedData.length > 0) {
      if (userCoords && customerAddress) {
        const match = savedAddresses.find(
          (a) => a.full_address === pickupFull || splitHouseNumber(a.full_address).street === customerAddress
        );
        if (match) {
          void upsertCustomerAddress(normPhone, savedAddresses, {
            id: match.id,
            label: match.label,
            full_address: pickupFull,
            is_primary: match.is_primary,
            latitude: userCoords.lat,
            longitude: userCoords.lon
          });
        }
      }
      if (claimedPromo?.id && !String(claimedPromo.id).startsWith('settings-')) {
        const nextUsed = (Number(claimedPromo.used_count) || 0) + 1;
        await supabase.from('promos').update({ used_count: nextUsed }).eq('id', claimedPromo.id);
      }
      if (loyaltyDiscountVal > 0 && normPhone) {
        const redeemed = await redeemLoyaltyPoints({
          phone: normPhone,
          amount: loyaltyDiscountVal,
          note: `Tukar poin potongan ${idr(loyaltyDiscountVal)} di pesanan ${autoOrderNo}`
        });
        if (redeemed.error) {
          toast(`Pesanan tersimpan, klaim poin gagal: ${redeemed.error}`, 'err');
        }
      }
      // Simpan data order terbaru & buka Modal Live Tracking Success
      setLatestCreatedOrder({
        ...insertedData[0],
        order_number: autoOrderNo,
        status: payload.status,
        pickup_date: payload.pickup_date,
        pickup_time: payload.pickup_time,
        scheduled_at: payload.scheduled_at
      });
      setShowOrderSuccessModal(true);
      
      // Reset form
      setCartSatuan([]);
      setCartKiloan([]);
      setNotes('');
      setClaimedPromo(null);
      setLoyaltyRedeem(0);
      setKiloanDuration('');
      setSelectedKiloanSvc('');
      setSelectedSatuanSvc('');
      setSatuanInputDuration('');
      setKiloanBagForms([emptyKiloanBagForm()]);
      setKiloanFormError('');
      setIsKiloanChecked(false);
      setIsSatuanChecked(false);
      setSatuanNotesSame(true);
      setSatuanPieceNotes([{ merk: '', warna: '', corak: '' }]);
      resetSatuanPiecePhotos();
      setBagCount('');
      setWashProcess('');
      setHasFading('');
      setAgreedNoValuables(false);
      setAgreedTerms(false);
      setPickupLater(false);
      setOrderStep(1);
      draftOrderNoRef.current = '';

      goActivity(isFuturePickup ? 'terjadwal' : 'berlangsung');
      fetchCustomerProfile(normPhone);
    } else {
      // Jangan tampilkan pesan error database mentah ke pelanggan — tampilkan
      // pesan yang bisa dipahami, dan kirim detail teknisnya untuk diperiksa
      // lewat Diagnosa Sistem (Owner).
      if (error?.userFacing) {
        toast(error.message, 'err');
        setIsSubmitting(false);
        return;
      }
      toast(friendlyPickupOrderError(error?.message), 'err');
      void reportPickupOrderError(error?.message, {
        isFuturePickup,
        kiloanLines: kiloanLines.length,
        satuanLines: cartSatuan.length
      });
    }
    setIsSubmitting(false);
  };

  const persistSchedule = async (order: any, date: string, time: string) => {
    if (!order?.id) return false;
    if (!date || !time) {
      toast('Isi tanggal dan jam jemput.', 'warn');
      return false;
    }
    const sched = parsePickupSchedule(date, time);
    if (!sched) {
      toast('Format jadwal tidak valid. Gunakan tanggal dan jam yang benar.', 'warn');
      return false;
    }
    setScheduleBusyId(order.id);
    const notes = withScheduleNote(String(order.notes || ''), sched.date, sched.time.slice(0, 5));
    const { error } = await updateWithFallback(
      'pickup_orders',
      [
        { pickup_date: sched.date, pickup_time: sched.time, scheduled_at: sched.iso, pickup_at: sched.iso, status: 'Terjadwal', notes },
        { pickup_date: sched.date, pickup_time: sched.time, status: 'Terjadwal', notes },
        { pickup_date: sched.date, status: 'Terjadwal', notes },
        { status: 'Terjadwal', notes }
      ],
      { column: 'id', value: order.id }
    );
    setScheduleBusyId(null);
    if (error) {
      toast('Gagal mengubah jadwal. Coba lagi.', 'err');
      return false;
    }
    toast('Jadwal penjemputan diperbarui.', 'ok');
    setEditingScheduleId(null);
    if (customerPhone) fetchCustomerProfile(cleanPhone(customerPhone));
    return true;
  };

  const cancelScheduledOrder = async (order: any) => {
    if (!order?.id) return;
    if (!confirm('Batalkan jadwal penjemputan ini?')) return;
    setScheduleBusyId(order.id);
    const { error } = await updatePickupOrder(order.id, { status: 'Batal' });
    setScheduleBusyId(null);
    if (error) {
      toast('Gagal membatalkan jadwal.', 'err');
      return;
    }
    toast('Jadwal dibatalkan.', 'ok');
    if (customerPhone) fetchCustomerProfile(cleanPhone(customerPhone));
  };

  const kiloanServicesList = dynamicServices.filter(s => s.type !== 'pcs');
  const satuanServicesList = dynamicServices.filter(s => s.type === 'pcs');

  const currentOutletObj = outletsList.find(o => o.id === selectedOutlet);
  const targetAdminWa = getAdminWaNumber(currentOutletObj?.name || '');
  const ongoingOrders = activeOrders.filter((o: any) => isOngoingOrder(o));
  const scheduledOrders = activeOrders.filter((o: any) => isScheduledOrder(o));
  const ongoingCount = ongoingOrders.length;
  const scheduledCount = scheduledOrders.length;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-4 md:p-6 pb-32 max-w-md mx-auto relative font-sans">
      <main>
      {readyPopup && (
        <div className="fixed inset-x-0 bottom-20 z-40 pointer-events-none flex justify-center px-4">
          <div className="pointer-events-auto bg-white rounded-2xl p-4 w-full max-w-sm shadow-xl border border-slate-200 space-y-2">
            <p className="text-sm font-black text-slate-900 inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Cucian siap diambil
            </p>
            <p className="text-xs text-slate-600 leading-relaxed">
              Cucian Anda sudah selesai dan siap diambil! Silakan ambil ke outlet atau pesan Kurir Internal.
            </p>
            <p className="text-[11px] text-slate-400">{readyPopup.service_type} · {readyPopup.status}</p>
            <div className="flex gap-2">
              <button type="button" onClick={dismissReadyPopup} className="flex-1 border border-slate-200 font-bold text-xs py-2.5 rounded-xl">
                Nanti
              </button>
              <button
                type="button"
                onClick={(e) => {
                  handleRequestDelivery(readyPopup, e);
                  dismissReadyPopup();
                }}
                className="flex-1 bg-sky-500 text-white font-bold text-xs py-2.5 rounded-xl inline-flex items-center justify-center gap-1"
              >
                <Truck className="w-3.5 h-3.5" /> Minta Driver
              </button>
            </div>
          </div>
        </div>
      )}
      
      {activeTab !== 'chat' && <CustomerHeader />}

      {(activeTab === 'home' || !customerData) && (
        <PromoBannerCarousel
          slides={bannerSlidesOf(showcasePromos, outletsList, selectedOutlet)}
          onOpenOutlet={(id) => {
            const found = outletsList.find((o) => String(o.id) === String(id));
            if (found) setProfileOutlet(found);
          }}
          onOpenPromo={(slide) => setSelectedBanner(slide)}
        />
      )}

      {!customerData ? (
        <form onSubmit={handleLogin} className="bg-white border border-slate-200 p-6 rounded-3xl space-y-4 shadow-sm my-6">
          <div className="w-14 h-14 bg-brand-50 text-brand-600 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
            <Phone className="w-6 h-6" />
          </div>
          <div className="text-center">
            <h2 className="text-base font-extrabold text-slate-900">Masuk Aplikasi</h2>
            <p className="text-xs text-slate-600 mt-1">Ketik Nomor WhatsApp Anda untuk melihat saldo deposit & status pesanan.</p>
            {outletQuery ? (
              <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mt-3 text-left leading-relaxed">
                Anda scan QR outlet. Login dengan nomor WhatsApp yang dipakai saat order di kasir untuk melihat & membayar tagihan pending — tanpa menunggu konfirmasi CS.
              </p>
            ) : null}
          </div>
          {inlinePhoneLoginAllowed ? (
            <PhoneNumberInput value={customerPhone} onChange={setCustomerPhone} required />
          ) : null}
          <button
            type="submit"
            disabled={!authState}
            className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-extrabold py-4 rounded-2xl text-xs uppercase shadow-lg shadow-brand-200 transition"
          >
            {inlinePhoneLoginAllowed || !authState ? 'Lanjutkan' : 'Masuk dengan WhatsApp'}
          </button>
        </form>
      ) : null}

      {!customerData && (
        <div className="mt-4">
          <NearbyOutlets
            items={nearbyItems}
            locating={locatingGps}
            userCity={userCity}
            cities={nearbyCities}
            showAllCities={showAllCities}
            onOpen={(o) => {
              setProfileOutlet(o);
              if (o?.id) chooseOutlet(String(o.id), { clearQuery: true });
            }}
            onRequestLocation={requestNearbyLocation}
            onSelectCity={(city) => {
              setCityOverride(city);
              setShowAllCities(false);
            }}
            onShowAllCities={() => {
              setShowAllCities(true);
              setCityOverride(null);
            }}
          />
        </div>
      )}

      {customerData ? (
        <>
          {activeTab === 'home' && (
            <div className="space-y-4">
              {Array.isArray(pendingCashierInvoice) && pendingCashierInvoice.length > 0 && (
                <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 space-y-3 shadow-sm">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wide text-amber-700">Tagihan menunggu pembayaran</p>
                    <p className="text-xs text-amber-900 mt-0.5">
                      Ada {pendingCashierInvoice.length} tagihan dari kasir/outlet. Bayar di sini seperti order PWA — CS tidak wajib konfirmasi.
                    </p>
                  </div>
                  <div className="space-y-2">
                    {pendingCashierInvoice.slice(0, 5).map((bill: any) => (
                      <button
                        key={bill.id}
                        type="button"
                        onClick={() => setDetailOrder(bill)}
                        className="w-full text-left bg-white border border-amber-100 rounded-2xl px-3 py-2.5 hover:border-amber-300 transition"
                      >
                        <div className="flex justify-between gap-2 items-start">
                          <div>
                            <p className="text-xs font-extrabold text-slate-900">{bill.receipt_number || bill.id}</p>
                            <p className="text-[10px] text-slate-500">{bill.service_type || 'Laundry'} · {bill.payment_method || 'QRIS'}</p>
                          </div>
                          <p className="text-xs font-black text-amber-800 whitespace-nowrap">
                            Rp {Number(bill.amount || 0).toLocaleString('id-ID')}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('chat')}
                    className="w-full text-[11px] font-bold text-indigo-700 underline"
                  >
                    Buka Live Chat (invoice QRIS)
                  </button>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                <LoyaltyProfileCard
                  phone={customerPhone}
                  name={customerData.name || customerName}
                  outletId={selectedOutlet}
                />
                <button
                  type="button"
                  onClick={() => setActiveTab('order')}
                  className="bg-white border border-slate-200 p-3 rounded-3xl flex flex-col gap-2 hover:border-brand-500 transition shadow-sm text-left min-w-0"
                >
                  <IconBadge icon={Truck} tone="blue" size="lg" />
                  <div className="min-w-0">
                    <span className="text-[10px] font-extrabold text-slate-900 block">Pesan Express</span>
                    <span className="text-[9px] text-slate-500 font-medium">Jemput ke Rumah</span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('deposit')}
                  className="bg-white border border-slate-200 p-3 rounded-3xl flex flex-col gap-2 hover:border-indigo-500 transition shadow-sm text-left min-w-0"
                >
                  <IconBadge icon={Wallet} tone="indigo" size="lg" />
                  <div className="min-w-0">
                    <span className="text-[10px] font-extrabold text-slate-900 block">Saldo Deposit</span>
                    <span className="text-[9px] text-indigo-600 font-bold mt-1 block leading-tight">
                      Rp {Number(customerData.deposit_balance || 0).toLocaleString('id-ID')}
                    </span>
                  </div>
                </button>
              </div>

              <details className="group bg-white border border-slate-200 rounded-2xl px-4 py-2.5 shadow-sm text-[11px]">
                <summary className="cursor-pointer list-none font-extrabold text-slate-700 inline-flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-brand-600" /> Arti Pesan Express, poin & deposit
                  <ChevronRight className="w-3.5 h-3.5 transition group-open:rotate-90" />
                </summary>
                <ul className="mt-2 space-y-1.5 text-slate-600 leading-relaxed">
                  <li>
                    <b className="text-slate-800">Pesan Express</b> — pesan jemput cucian ke alamat Anda lewat aplikasi, lalu
                    diantar kembali. Durasi cuci (Reguler, Oneday, Express 6 jam, Quick 3 jam) dipilih di langkah Layanan.
                  </li>
                  <li>
                    <b className="text-slate-800">Poin loyalty</b> — cashback poin dari transaksi sesuai level Anda
                    ({cashbackCopy(loyaltyProfile?.tier_level || 'Standard', loyaltySettings).replace(/^Level [^:]+:\s*/, '')}). 1 poin = Rp1,
                    bisa ditukar sebagai potongan {redeemableAmounts(loyaltySettings).map((n) => idr(n)).join(' / ')} saat memesan atau di kasir.
                  </li>
                  <li>
                    <b className="text-slate-800">Saldo deposit</b> — saldo prabayar dari top up (bonus saldo sesuai paket). Dipakai untuk
                    membayar tagihan cucian di kasir outlet.
                  </li>
                </ul>
              </details>

              <NearbyOutlets
                items={nearbyItems}
                locating={locatingGps}
                userCity={userCity}
                cities={nearbyCities}
                showAllCities={showAllCities}
                onOpen={(o) => {
                  setProfileOutlet(o);
                  if (o?.id) chooseOutlet(String(o.id), { clearQuery: true });
                }}
                onRequestLocation={requestNearbyLocation}
                onSelectCity={(city) => {
                  setCityOverride(city);
                  setShowAllCities(false);
                }}
                onShowAllCities={() => {
                  setShowAllCities(true);
                  setCityOverride(null);
                }}
              />

              {(ongoingCount > 0 || scheduledCount > 0) && (
                <button
                  type="button"
                  onClick={() => goActivity(ongoingCount > 0 ? 'berlangsung' : 'terjadwal')}
                  className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 flex items-center justify-between shadow-sm hover:border-indigo-300 hover:shadow-md active:scale-[0.99] transition"
                >
                  <span className="flex items-center gap-2 text-left">
                    <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[11px] font-extrabold text-slate-800">
                      {ongoingCount > 0
                        ? `${ongoingCount} cucian berlangsung`
                        : `${scheduledCount} jemputan terjadwal`}
                      {ongoingCount > 0 && scheduledCount > 0 ? ` · ${scheduledCount} terjadwal` : ''}
                    </span>
                  </span>
                  <span className="text-[10px] font-bold text-indigo-600 inline-flex items-center gap-0.5">
                    Lihat Aktivitas <ChevronRight className="w-3.5 h-3.5" />
                  </span>
                </button>
              )}
            </div>
          )}

          {activeTab === 'order' && (
            <form onSubmit={handleOrderSubmit} className="space-y-4 pb-48" noValidate>
              <div className="bg-white border border-slate-200 rounded-2xl p-1.5 grid grid-cols-3 gap-1 shadow-sm" role="tablist" aria-label="Langkah pemesanan">
                {([
                  [1, 'Alamat & Jemput'],
                  [2, 'Layanan'],
                  [3, 'Periksa & Pesan']
                ] as const).map(([n, label]) => (
                  <button
                    key={n}
                    type="button"
                    role="tab"
                    aria-selected={orderStep === n}
                    onClick={() => goOrderStep(n)}
                    className={`rounded-xl px-1.5 py-2 text-left transition ${
                      orderStep === n ? 'bg-brand-600 text-white shadow-sm' : orderStep > n ? 'bg-brand-50 text-brand-800' : 'text-slate-500'
                    }`}
                  >
                    <span className="block text-[9px] font-black uppercase tracking-wide opacity-80">Langkah {n}</span>
                    <span className="block text-[11px] font-extrabold leading-tight">{label}</span>
                  </button>
                ))}
              </div>
              {orderStep === 1 && (
                <>
              <div className="bg-white border border-slate-200 p-4 rounded-3xl space-y-3 shadow-sm">
                <h3 className="text-[11px] font-extrabold text-slate-700 uppercase tracking-wide">Alamat penjemputan *</h3>
                {savedAddresses.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {savedAddresses.map((addr) => {
                      const parts = splitHouseNumber(addr.full_address);
                      const active = selectedAddressId ? selectedAddressId === addr.id : customerAddress === parts.street;
                      return (
                        <button
                          key={addr.id}
                          type="button"
                          onClick={() => {
                            setSelectedAddressId(addr.id);
                            setCustomerAddress(parts.street);
                            setHouseNumber(parts.house);
                            pickupPinLockedRef.current = Boolean(addr.latitude && addr.longitude);
                            if (addr.latitude != null && addr.longitude != null) {
                              setUserCoords({ lat: Number(addr.latitude), lon: Number(addr.longitude) });
                            } else {
                              setUserCoords(null);
                            }
                          }}
                          className={`text-[10px] font-extrabold px-2.5 py-1.5 rounded-lg border max-w-full truncate ${
                            active ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-600 border-slate-200'
                          }`}
                        >
                          {addressDisplayLabel(addr, savedAddresses)}{addr.is_primary ? ' · Utama' : ''}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedAddressId('NEW');
                        setCustomerAddress('');
                        setHouseNumber('');
                        setPickupLandmark('');
                        pickupPinLockedRef.current = false;
                        setUserCoords(null);
                      }}
                      className={`text-[10px] font-extrabold px-2.5 py-1.5 rounded-lg border ${
                        selectedAddressId === 'NEW' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-brand-700 border-brand-200'
                      }`}
                    >
                      + Alamat baru
                    </button>
                  </div>
                )}
                  <PickupLocationPicker
                    street={customerAddress}
                    houseNo={houseNumber}
                    landmark={pickupLandmark}
                    pin={userCoords ? { lat: userCoords.lat, lng: userCoords.lon } : null}
                    locating={locatingGps}
                    hint={gpsHint}
                    onStreetChange={setCustomerAddress}
                    onHouseNoChange={setHouseNumber}
                    onLandmarkChange={setPickupLandmark}
                    onGps={handleGetCurrentLocation}
                    onPin={(pt, streetLabel) => {
                      pickupPinLockedRef.current = true;
                      setUserCoords({ lat: pt.lat, lon: pt.lng });
                      if (streetLabel) setCustomerAddress(splitHouseNumber(streetLabel).street);
                    }}
                  />
              </div>
              <div className="bg-white border border-slate-200 p-4 rounded-3xl space-y-3 shadow-sm">
                <h3 className="text-[11px] font-extrabold text-slate-700 uppercase tracking-wide">Outlet yang melayani</h3>
                {!userCoords ? (
                  <p className="text-[11px] font-semibold text-slate-500 bg-slate-50 border border-slate-200 rounded-2xl px-3 py-2.5">
                    Isi alamat dan pasang pin dulu. Nanti muncul 3 cabang terdekat yang bisa menerima semua durasi.
                  </p>
                ) : orderOutlets.length === 0 ? (
                  <p className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded-2xl px-3 py-2.5">
                    {noOutletText}
                  </p>
                ) : (
                  <>
                    <select
                      value={selectedOutlet}
                      onChange={(e) => chooseOutlet(e.target.value, { clearQuery: true })}
                      aria-label="Pilih outlet"
                      className="w-full bg-slate-50 border border-slate-300 rounded-2xl px-3.5 py-3 text-sm font-bold text-slate-800"
                    >
                      {orderOutlets.map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                    <p className="text-[10px] text-slate-500 font-medium">
                      {distanceLoading
                        ? 'Menghitung jarak ke outlet…'
                        : distanceKm != null
                        ? `Jarak jalan ±${distanceKm.toFixed(1)} km dari titik jemput.`
                        : 'Outlet terdekat dari titik jemput Anda.'}
                    </p>
                  </>
                )}
              </div>
              <div className="bg-white border border-slate-200 p-4 rounded-3xl space-y-3 shadow-sm">
                <h3 className="text-[11px] font-extrabold text-slate-700 uppercase tracking-wide">Waktu & metode penjemputan</h3>
                <div className="grid grid-cols-2 gap-1 bg-slate-100 p-1 rounded-2xl">
                  {([
                    [false, 'Jemput sekarang'],
                    [true, 'Jadwalkan']
                  ] as const).map(([later, label]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setPickupLater(later)}
                      aria-pressed={pickupLater === later}
                      className={`py-2 rounded-xl text-[11px] font-extrabold inline-flex items-center justify-center gap-1 ${
                        pickupLater === later ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500'
                      }`}
                    >
                      {later ? <Calendar className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />} {label}
                    </button>
                  ))}
                </div>
                {pickupLater && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1">Tanggal</label>
                      <input
                        type="date"
                        min={localDateISO()}
                        value={pickupDate}
                        onChange={(e) => setPickupDate(e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-2 text-sm font-bold text-slate-800"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1">Jam</label>
                      <input
                        type="time"
                        value={pickupTime}
                        onChange={(e) => setPickupTime(e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-2 text-sm font-bold text-slate-800"
                      />
                    </div>
                    <p className="col-span-2 text-[10px] text-slate-500">
                      Driver baru ditugaskan mendekati jadwal. Pesanan tampil di tab Terjadwal.
                    </p>
                  </div>
                )}
                <label className="text-[10px] font-extrabold text-slate-500 uppercase block">Metode penjemputan</label>
                  <div className="grid grid-cols-1 gap-2.5">
                    <button
                      type="button"
                      disabled={!internalDriverOnDuty}
                      onClick={() => {
                        if (!internalDriverOnDuty) return;
                        setCourierType('INTERNAL');
                      }}
                      className={`p-3.5 rounded-2xl border text-left transition ${
                        !internalDriverOnDuty
                          ? 'bg-slate-100 border-slate-200 opacity-60 cursor-not-allowed'
                          : courierType === 'INTERNAL' 
                          ? 'bg-emerald-50 border-emerald-400 ring-2 ring-emerald-100' 
                          : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-black text-slate-900 inline-flex items-center gap-1">
                          <Truck className="w-3.5 h-3.5" /> Driver Internal
                        </span>
                        {internalDriverOnDuty ? (
                          <span className="bg-emerald-100 text-emerald-700 border border-emerald-200 text-[9px] font-black uppercase px-2 py-0.5 rounded-full">
                            FREE
                          </span>
                        ) : (
                          <span className="bg-slate-200 text-slate-600 text-[9px] font-black uppercase px-2 py-0.5 rounded-full">
                            Tidak bertugas
                          </span>
                        )}
                      </div>
                      {internalDriverOnDuty ? (
                        <p className="text-[10px] text-slate-500 font-semibold leading-relaxed">
                          {queueCount} Antrean • Est. Penjemputan ~{estimatedPickupMinutes} Menit
                        </p>
                      ) : (
                        <p className="text-[10px] text-rose-600 font-bold leading-relaxed">
                          Driver internal cabang ini sedang tidak bertugas. Silakan pilih kurir instan/antar mandiri.
                        </p>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setCourierType('THIRD_PARTY')}
                      className={`p-3.5 rounded-2xl border text-left transition ${
                        courierType === 'THIRD_PARTY' 
                          ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-100' 
                          : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <span className="text-xs font-black text-slate-900 inline-flex items-center gap-1">
                        <Package className="w-3.5 h-3.5" /> Instan (Gojek / Grab / Lalamove)
                      </span>
                      <p className="text-[10px] text-slate-500 font-semibold leading-relaxed mt-1">
                        {distanceLoading
                          ? 'Menghitung estimasi ongkir…'
                          : deliveryFee !== null
                          ? `Estimasi ongkir antar-jemput Rp ${Number(deliveryFee).toLocaleString('id-ID')}${distanceKm != null ? ` (±${distanceKm.toFixed(1)} km)` : ''}`
                          : 'Ongkir muncul setelah alamat & pin diisi'}{' '}
                        • Waktu tunggu 20–30 menit • Dipesankan oleh CS
                      </p>
                    </button>
                  </div>
                <input
                  type="text"
                  placeholder="Catatan penjemputan (misal: titip di satpam)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-2xl p-3.5 text-sm text-slate-800 font-medium"
                />
              </div>
                </>
              )}
              {orderStep === 2 && (
                <>
                <div className="bg-brand-50/50 p-4 rounded-2xl border border-brand-100 space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isKiloanChecked}
                      onChange={(e) => setIsKiloanChecked(e.target.checked)}
                      className="w-4 h-4 accent-brand-600 rounded"
                    />
                    <span className="text-xs font-extrabold text-brand-900 inline-flex items-center gap-1.5">
                      <img src="/assets/icons/washing-machine.svg" alt="" className="w-7 h-7" /> Paket Laundry Kiloan
                    </span>
                  </label>

                  {isKiloanChecked && (
                    <div className="space-y-2.5 pt-2 border-t border-brand-100">
                      <div className="bg-slate-800/80 border border-slate-700/80 p-3.5 rounded-2xl space-y-3">
                        <h3 className="text-[10px] font-black tracking-wider uppercase text-cyan-400 flex items-center gap-2">
                          <ClipboardList className="w-3.5 h-3.5" /> Informasi Detail Cucian Kiloan
                        </h3>

                        <div className="space-y-3 text-xs text-slate-200">
                          <div className="flex justify-between items-center">
                            <span className="font-semibold text-slate-300">Jumlah Kantong</span>
                            <div className="flex items-center gap-1">
                              <StepperBtn
                                variant="minus"
                                disabled={Number(bagCount) <= 1}
                                onClick={() => applyKiloanBagLayout((Number(bagCount) || 1) - 1, washProcess)}
                              />
                              <span className="w-8 text-center font-extrabold text-cyan-400" aria-label="Jumlah kantong">
                                {bagCount || '–'}
                              </span>
                              <StepperBtn
                                variant="plus"
                                disabled={Number(bagCount) >= MAX_KILOAN_BAGS}
                                onClick={() => applyKiloanBagLayout((Number(bagCount) || 0) + 1, washProcess)}
                              />
                            </div>
                          </div>

                          <div className="flex justify-between items-center">
                            <span className="font-semibold text-slate-300">Proses Cuci</span>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => applyKiloanBagLayout(Number(bagCount) || 1, 'Gabung Semua')}
                                aria-pressed={washProcess === 'Gabung Semua'}
                                className={`px-3 py-1 rounded-xl font-extrabold text-xs transition ${washProcess === 'Gabung Semua' ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20' : 'bg-slate-900 border border-slate-700 text-slate-400'}`}
                              >
                                Dicampur
                              </button>
                              <button
                                type="button"
                                onClick={() => applyKiloanBagLayout(Number(bagCount) || 1, 'Pisah Perkantong')}
                                aria-pressed={washProcess === 'Pisah Perkantong'}
                                disabled={Number(bagCount) <= 1}
                                className={`px-3 py-1 rounded-xl font-extrabold text-xs transition disabled:opacity-40 ${washProcess === 'Pisah Perkantong' ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20' : 'bg-slate-900 border border-slate-700 text-slate-400'}`}
                              >
                                Dipisah
                              </button>
                            </div>
                          </div>
                          {isSplitKiloanBags && (
                            <p className="text-[10px] text-cyan-300 font-medium">
                              {bagCount} kantong dipisah — isi layanan, durasi, dan rincian jumlah untuk setiap kantong di bawah.
                            </p>
                          )}

                          <div className="flex justify-between items-center">
                            <span className="font-semibold text-slate-300">Ada Pakaian Luntur?</span>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setHasFading('Tidak')}
                                aria-pressed={hasFading === 'Tidak'}
                                className={`px-3 py-1 rounded-xl font-extrabold text-xs transition ${hasFading === 'Tidak' ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20' : 'bg-slate-900 border border-slate-700 text-slate-400'}`}
                              >
                                Tidak
                              </button>
                              <button
                                type="button"
                                onClick={() => setHasFading('Ya')}
                                aria-pressed={hasFading === 'Ya'}
                                className={`px-3 py-1 rounded-xl font-extrabold text-xs transition ${hasFading === 'Ya' ? 'bg-rose-500 text-white shadow-md shadow-rose-500/20' : 'bg-slate-900 border border-slate-700 text-slate-400'}`}
                              >
                                Ya
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                      {!isSplitKiloanBags ? (
                        <div className="space-y-2.5">
                          <div>
                            <label className="block text-[10px] text-slate-500 font-bold mb-1">Pilih Jenis Kiloan</label>
                            <select
                              value={selectedKiloanSvc}
                              onChange={(e) => setSelectedKiloanSvc(e.target.value)}
                              className="w-full bg-white border border-brand-200 rounded-xl p-2.5 text-xs font-bold text-slate-800"
                            >
                              <option value="" disabled>-- Pilih jenis kiloan --</option>
                              {kiloanServicesList.map((svc, i) => (
                                <option key={i} value={svc.name}>{svc.name}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-500 font-bold mb-1 inline-flex items-center gap-1">
                              Durasi Kiloan
                            </label>
                            <select
                              value={kiloanDuration}
                              onChange={(e) => setKiloanDuration(e.target.value)}
                              className="w-full bg-amber-50 border border-amber-300 rounded-xl p-2 text-xs font-extrabold text-amber-800"
                            >
                              <option value="" disabled>-- Pilih durasi --</option>
                              <option value="Reguler (3 Hari)">Reguler 3 Hari</option>
                              <option value="Oneday">Oneday 24jam</option>
                              <option value="Express">Express 6 Jam</option>
                              <option value="Quick">Quick 3 Jam</option>
                            </select>
                          </div>
                          <p className="text-[10px] text-slate-500 font-bold uppercase">Jumlah per kategori pakaian</p>
                          {renderKiloanBagCategoryInputs(0, kiloanBagForms[0]?.categories || emptyBagCategoryCounts())}
                          {(() => {
                            const { pcs, kg } = summarizeBagWeight(kiloanBagForms[0]?.categories || emptyBagCategoryCounts());
                            return (
                              <p className="text-[10px] text-brand-700 font-bold bg-brand-50 border border-brand-100 rounded-xl px-2.5 py-1.5">
                                Estimasi: {pcs} pcs · ~{kg} Kg
                                {selectedKiloanSvc && kiloanDuration
                                  ? ` · Rp ${kiloanUnitPriceFor(selectedKiloanSvc, kiloanDuration).toLocaleString('id-ID')}/Kg`
                                  : ''}
                              </p>
                            );
                          })()}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {kiloanBagForms.map((form, bagIdx) => {
                            const { pcs, kg } = summarizeBagWeight(form.categories);
                            return (
                              <div key={bagIdx} className="bg-white border border-brand-200 rounded-2xl p-3 space-y-2.5">
                                <p className="text-[11px] font-black text-brand-800">Kantong {bagIdx + 1}</p>
                                <div>
                                  <label className="block text-[10px] text-slate-500 font-bold mb-1">Jenis Kiloan</label>
                                  <select
                                    value={form.serviceName}
                                    onChange={(e) => patchKiloanBagField(bagIdx, 'serviceName', e.target.value)}
                                    className="w-full bg-slate-50 border border-brand-200 rounded-xl p-2 text-xs font-bold text-slate-800"
                                  >
                                    <option value="">-- Pilih --</option>
                                    {kiloanServicesList.map((svc, i) => (
                                      <option key={i} value={svc.name}>{svc.name}</option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label className="text-[10px] text-slate-500 font-bold mb-1 inline-flex items-center gap-1">
                                    Durasi
                                  </label>
                                  <select
                                    value={form.duration}
                                    onChange={(e) => patchKiloanBagField(bagIdx, 'duration', e.target.value)}
                                    className="w-full bg-amber-50 border border-amber-300 rounded-xl p-2 text-xs font-extrabold text-amber-800"
                                  >
                                    <option value="">-- Pilih durasi --</option>
                                    <option value="Reguler (3 Hari)">Reguler 3 Hari</option>
                                    <option value="Oneday">Oneday 24jam</option>
                                    <option value="Express">Express 6 Jam</option>
                                    <option value="Quick">Quick 3 Jam</option>
                                  </select>
                                </div>
                                <p className="text-[10px] text-slate-500 font-bold uppercase">Jumlah per kategori pakaian</p>
                                {renderKiloanBagCategoryInputs(bagIdx, form.categories)}
                                <p className="text-[10px] text-brand-700 font-bold bg-brand-50 border border-brand-100 rounded-xl px-2.5 py-1.5">
                                  Estimasi Kantong {bagIdx + 1}: {pcs} pcs · ~{kg} Kg
                                  {form.serviceName && form.duration ? ` · Rp ${kiloanUnitPriceFor(form.serviceName, form.duration).toLocaleString('id-ID')}/Kg` : ''}
                                </p>
                              </div>
                            );
                          })}
                          <p className="text-[10px] text-brand-800 font-black text-right">
                            Total semua kantong: ~
                            {kiloanBagForms.reduce((s, f) => s + summarizeBagWeight(f.categories).kg, 0).toFixed(2)} Kg
                          </p>
                        </div>
                      )}

                      <p className="text-[10px] text-slate-400 font-medium">
                        Jumlah pcs & estimasi kg dihitung otomatis dari isian di atas — tidak perlu diisi ulang.
                      </p>
                      <p className="text-[10px] bg-brand-50 border border-brand-100 text-brand-800 rounded-xl px-2.5 py-1.5 font-semibold">
                        Berat & harga di atas adalah ESTIMASI. Kasir akan menimbang ulang cucian di outlet dan mengonfirmasi tagihan final.
                      </p>
                      <p className="text-[10px] bg-amber-50 border border-amber-100 text-amber-800 rounded-xl px-2.5 py-1.5 font-semibold">
                        Info: Total kiloan minimal {KILOAN_MIN_ORDER_KG} kg per order (1 Mesin Cuci = 1 Customer, pakaian tidak dicampur dengan pelanggan lain).
                      </p>

                      {kiloanFormError && (
                        <p className="text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2" role="alert">
                          {kiloanFormError}
                        </p>
                      )}
                      <button type="button" onClick={handleAddKiloanToCart} className="w-full bg-brand-600 hover:bg-brand-700 text-white font-bold py-2.5 rounded-xl text-xs shadow-sm inline-flex items-center justify-center gap-1.5">
                        Tambah Paket Kiloan Ini
                      </button>
                      {cartKiloan.length > 0 && (
                        <div className="space-y-1.5">
                          {kiloanTotalKg < KILOAN_MIN_ORDER_KG && (
                            <p className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-2.5 py-1.5">
                              Total kiloan saat ini ~{kiloanTotalKg} Kg, masih di bawah minimal {KILOAN_MIN_ORDER_KG} Kg. Tambah kantong/paket lagi.
                            </p>
                          )}
                          {cartKiloan.map((item, idx) => (
                            <div key={idx} className="bg-white p-2.5 rounded-xl flex justify-between items-center text-xs border border-brand-100">
                              <div className="min-w-0">
                                <span className="font-bold text-slate-800 block">{item.name} · ~{item.kg} Kg</span>
                                <span className="text-[9px] text-slate-500 font-semibold">{item.qty} Pcs (estimasi)</span>
                                <span className="text-[9px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded font-bold ml-1">{item.duration}</span>
                                {item.bagDetail && (
                                  <span className="block text-[9px] text-slate-400 mt-0.5">
                                    {BAG_CATEGORY_ORDER.map((k) => `${BAG_CATEGORY_LABELS[k].split(' ')[0]} ${item.bagDetail?.[k] || 0}`).join(' · ')}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="font-extrabold text-brand-600">Rp {kiloanLineTotal(item.price, item.kg).toLocaleString('id-ID')}</span>
                                <button type="button" onClick={() => handleRemoveKiloan(idx)} className="text-rose-500 p-1 rounded-full hover:bg-rose-50" aria-label="Hapus">
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isSatuanChecked}
                      onChange={(e) => setIsSatuanChecked(e.target.checked)}
                      className="w-4 h-4 accent-indigo-600 rounded"
                    />
                    <span className="text-xs font-extrabold text-slate-800 inline-flex items-center gap-1.5">
                      <img src="/assets/icons/laundry-basket.svg" alt="" className="w-7 h-7" /> Items Satuan (Bedcover/Sepatu/dll)
                    </span>
                  </label>

                  {isSatuanChecked && (
                    <div className="space-y-2.5 pt-2 border-t border-slate-200">
                      <div>
                        <label className="block text-[10px] text-slate-500 font-bold mb-1">Pilih Item Satuan</label>
                        <select
                          value={selectedSatuanSvc}
                          onChange={(e) => setSelectedSatuanSvc(e.target.value)}
                          className="w-full bg-white border border-slate-300 rounded-xl p-2.5 text-xs font-bold text-slate-800"
                        >
                          <option value="" disabled>-- Pilih item satuan --</option>
                          {satuanServicesList.map((svc, i) => (
                            <option key={i} value={svc.name}>{svc.name}</option>
                          ))}
                          <option value="Bedcover Double">Bedcover Double</option>
                          <option value="Bedcover Single">Bedcover Single</option>
                          <option value="Sprei Single">Sprei Single</option>
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-slate-500 font-bold mb-1 inline-flex items-center gap-1">
                            Durasi Item Ini
                          </label>
                          <select
                            value={satuanInputDuration}
                            onChange={(e) => setSatuanInputDuration(e.target.value)}
                            className="w-full bg-amber-50 border border-amber-300 rounded-xl p-2 text-xs font-extrabold text-amber-800"
                          >
                            <option value="" disabled>-- Pilih durasi --</option>
                            <option value="Reguler (3 Hari)">Reguler 3 Hari</option>
                            <option value="Oneday (1 Hari / 24 Jam)">Oneday 24jam</option>
                            <option value="Express (6 Jam)">Express 6 Jam</option>
                            <option value="Quick (3 Jam)">Quick 3 Jam</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-500 font-bold mb-1">Jumlah (Pcs)</label>
                          <div className="flex items-center gap-1">
                            <StepperBtn variant="minus" tone="indigo" disabled={Number(inputSatuanQty) <= 1} onClick={() => setInputSatuanQty(String(Math.max(1, (Number(inputSatuanQty) || 1) - 1)))} />
                            <input
                              type="number"
                              min="1"
                              placeholder="Qty"
                              value={inputSatuanQty}
                              onChange={(e) => setInputSatuanQty(e.target.value)}
                              className="w-full bg-white border border-slate-300 rounded-xl p-2 text-xs font-bold text-slate-800 text-center"
                            />
                            <StepperBtn variant="plus" tone="indigo" onClick={() => setInputSatuanQty(String((Number(inputSatuanQty) || 1) + 1))} />
                          </div>
                        </div>
                      </div>

                      {Number(inputSatuanQty) > 1 && (
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={satuanNotesSame}
                            onChange={(e) => setSatuanNotesSame(e.target.checked)}
                            className="w-4 h-4 accent-indigo-600 rounded"
                          />
                          <span className="text-[10px] font-bold text-slate-600">Semua pcs sama (merk, warna, corak)</span>
                        </label>
                      )}

                      {(satuanNotesSame || satuanPieceNotes.length === 1 ? [satuanPieceNotes[0] || emptySatuanPiece()] : satuanPieceNotes).map((piece, idx) => (
                        <div key={idx} className="space-y-1.5">
                          {!satuanNotesSame && satuanPieceNotes.length > 1 && (
                            <p className="text-[10px] font-extrabold text-indigo-700">Pcs {idx + 1}</p>
                          )}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <div>
                              <label className="block text-[10px] text-slate-500 font-bold mb-1">Merk</label>
                              <input
                                type="text"
                                placeholder="Contoh: King Koil"
                                value={piece?.merk || ''}
                                onChange={(e) => patchSatuanPiece(idx, 'merk', e.target.value)}
                                className="w-full bg-white border border-slate-300 rounded-xl p-2 text-xs font-semibold text-slate-800"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] text-slate-500 font-bold mb-1">Warna</label>
                              <input
                                type="text"
                                placeholder="Contoh: Putih"
                                value={piece?.warna || ''}
                                onChange={(e) => patchSatuanPiece(idx, 'warna', e.target.value)}
                                className="w-full bg-white border border-slate-300 rounded-xl p-2 text-xs font-semibold text-slate-800"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] text-slate-500 font-bold mb-1">Corak</label>
                              <input
                                type="text"
                                placeholder="Polos / Bunga"
                                value={piece?.corak || ''}
                                onChange={(e) => patchSatuanPiece(idx, 'corak', e.target.value)}
                                className="w-full bg-white border border-slate-300 rounded-xl p-2 text-xs font-semibold text-slate-800"
                              />
                            </div>
                          </div>
                          {satuanPhotoRequired && (
                          <div>
                            <label className="block text-[10px] text-slate-500 font-bold mb-1">
                              Foto {satuanNotesSame ? 'Item' : `Pcs ${idx + 1}`} <span className="text-rose-600">*wajib</span>
                            </label>
                            {satuanPhoto && !satuanPhoto.canUpload ? (
                              <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-2 py-1.5 font-semibold">
                                {SATUAN_PHOTO_NEEDS_VERIFIED_LOGIN}
                              </p>
                            ) : piece?.photoPreviewUrl ? (
                              <div className="relative w-24 h-24">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={piece.photoPreviewUrl}
                                  alt={`Foto ${satuanNotesSame ? 'item satuan' : `pcs ${idx + 1}`}`}
                                  className="w-24 h-24 object-cover rounded-xl border border-slate-200"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleRemoveSatuanPiecePhoto(idx)}
                                  aria-label="Hapus foto"
                                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-rose-600 text-white rounded-full flex items-center justify-center shadow"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                                <label className="absolute bottom-0 inset-x-0 bg-black/50 text-white text-[9px] font-bold text-center py-0.5 rounded-b-xl cursor-pointer">
                                  Ganti
                                  <input
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    className="hidden"
                                    aria-label={`Ganti foto ${satuanNotesSame ? 'item satuan' : `pcs ${idx + 1}`}`}
                                    onChange={(e) => {
                                      const file = e.target.files?.[0] || null;
                                      e.target.value = '';
                                      void handleSatuanPiecePhotoSelect(idx, file);
                                    }}
                                  />
                                </label>
                              </div>
                            ) : (
                              <label
                                className={`flex flex-col items-center justify-center w-24 h-24 rounded-xl border-2 border-dashed cursor-pointer text-slate-400 ${
                                  piece?.photoError ? 'border-rose-300 bg-rose-50' : 'border-slate-300 bg-slate-50'
                                }`}
                              >
                                {piece?.photoUploading ? (
                                  <Loader2 className="w-5 h-5 animate-spin text-brand-600" />
                                ) : (
                                  <Camera className="w-5 h-5" />
                                )}
                                <span className="text-[9px] font-bold mt-1 text-center px-1">
                                  {piece?.photoUploading ? 'Mengunggah…' : 'Ambil / Unggah'}
                                </span>
                                <input
                                  type="file"
                                  accept="image/*"
                                  capture="environment"
                                  className="hidden"
                                  disabled={piece?.photoUploading}
                                  aria-label={`Unggah foto ${satuanNotesSame ? 'item satuan' : `pcs ${idx + 1}`}`}
                                  onChange={(e) => {
                                    const file = e.target.files?.[0] || null;
                                    e.target.value = '';
                                    void handleSatuanPiecePhotoSelect(idx, file);
                                  }}
                                />
                              </label>
                            )}
                            {piece?.photoError && (
                              <p className="text-[10px] text-rose-600 font-semibold mt-1" role="alert">{piece.photoError}</p>
                            )}
                          </div>
                          )}
                        </div>
                      ))}

                      {satuanFormError && (
                        <p className="text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2" role="alert">
                          {satuanFormError}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={handleAddSatuanToCart}
                        disabled={requiredSatuanPhotoSlots().some((p) => p.photoUploading)}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-bold py-2.5 rounded-xl text-xs shadow-sm"
                      >
                        Tambah Item Satuan Ini
                      </button>

                      {cartSatuan.length > 0 && (
                        <div className="space-y-1.5 pt-2">
                          {cartSatuan.map((item, idx) => {
                            const extra = formatSatuanPiecesNotes(item.pieces);
                            return (
                            <div key={idx} className="bg-white p-2.5 rounded-xl flex justify-between items-center text-xs border border-slate-200 shadow-sm">
                              <div>
                                <span className="font-bold text-slate-800 block">{item.name} x{item.qty}</span>
                                <span className="text-[9px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded font-bold">{item.duration}</span>
                                {extra && <span className="block text-[9px] text-slate-500 font-semibold mt-0.5">{extra}</span>}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="font-extrabold text-brand-600">Rp {(item.price * item.qty).toLocaleString('id-ID')}</span>
                                <button type="button" onClick={() => handleRemoveSatuan(idx)} className="text-rose-500 p-1 rounded-full hover:bg-rose-50" aria-label="Hapus">
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>

              <div className="bg-white border border-slate-200 p-4 rounded-3xl space-y-3 shadow-sm">
                <h3 className="text-[11px] font-extrabold text-slate-700 uppercase tracking-wide">Voucher & poin loyalty</h3>
                <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/80 p-3.5 rounded-2xl flex justify-between items-center text-xs">
                  <div>
                    <p className="font-extrabold text-amber-900 text-[11px] inline-flex items-center gap-1">
                      <Gift className="w-3.5 h-3.5" />
                      {claimedPromo ? claimedPromo.title : 'Gunakan Voucher Promo'}
                    </p>
                    <p className="text-[9px] text-amber-700">
                      {claimedPromo ? `Diskon Terpasang: -Rp ${promoDiscountVal.toLocaleString('id-ID')}` : 'Hemat ongkir dan cuci kiloan'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPromoModal(true)}
                    className="bg-amber-500 hover:bg-amber-600 text-white font-extrabold px-3 py-1.5 rounded-xl text-[10px] shadow-sm transition"
                  >
                    {claimedPromo ? 'Ganti' : 'Pilih Promo'}
                  </button>
                </div>

                {loyaltyProfile && (
                  <div className="bg-emerald-50 border border-emerald-200 p-3.5 rounded-2xl space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-extrabold text-emerald-900 text-[11px]">Klaim poin loyalty</p>
                      <p className="text-[10px] font-bold text-emerald-700">
                        {Math.round(Number(loyaltyProfile.loyalty_points) || 0).toLocaleString('id-ID')} poin
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {redeemableAmounts(loyaltySettings).map((amt) => {
                        const ok = Number(loyaltyProfile.loyalty_points) >= amt && basketAfterPromo >= amt;
                        return (
                          <button
                            key={amt}
                            type="button"
                            disabled={!ok}
                            onClick={() => setLoyaltyRedeem((prev) => (prev === amt ? 0 : amt))}
                            className={`px-2.5 py-1.5 rounded-xl text-[10px] font-black ${
                              loyaltyRedeem === amt
                                ? 'bg-emerald-600 text-white'
                                : ok
                                ? 'bg-white border border-emerald-200 text-emerald-800'
                                : 'bg-white/60 border border-emerald-100 text-emerald-300'
                            }`}
                          >
                            {idr(amt)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-xs flex justify-between font-bold text-slate-700">
                <span>Subtotal layanan</span>
                <span>Rp {rawSubtotal.toLocaleString('id-ID')}</span>
              </div>
                </>
              )}
              {orderStep === 3 && (
                <>
              <div className="bg-white border border-slate-200 rounded-3xl p-4 space-y-3 shadow-sm text-xs">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] font-extrabold text-slate-500 uppercase">Alamat & outlet</p>
                    <p className="font-bold text-slate-900 mt-0.5 break-words">{composePickupAddress(customerAddress, houseNumber, pickupLandmark) || '-'}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {userCoords ? 'Pin gerbang terpasang' : 'Pin belum dipasang'} · Outlet: <b className="text-slate-700">{currentOutletObj?.name || '-'}</b>
                    </p>
                  </div>
                  <button type="button" onClick={() => goOrderStep(1)} className="text-[10px] font-extrabold text-brand-700 inline-flex items-center gap-0.5"><Pencil className="w-3 h-3" /> Ubah</button>
                </div>
                <div className="flex justify-between items-start gap-2 border-t border-slate-100 pt-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-extrabold text-slate-500 uppercase">Penjemputan</p>
                    <p className="font-bold text-slate-900 mt-0.5">
                      {pickupLater
                        ? `Terjadwal ${(() => {
                            const sc = parsePickupSchedule(pickupDate, pickupTime);
                            return sc
                              ? sc.at.toLocaleString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                              : '-';
                          })()}`
                        : 'Jemput sekarang'}
                      {' · '}
                      {isInternalDriver ? 'Driver Internal' : 'Instan (Gojek / Grab / Lalamove)'}
                    </p>
                    {!pickupLater && isInternalDriver && (
                      <p className="text-[10px] text-slate-500">{queueCount} antrean · est. dijemput ~{estimatedPickupMinutes} menit</p>
                    )}
                    {notes ? <p className="text-[10px] text-slate-500 mt-0.5">Catatan: {notes}</p> : null}
                  </div>
                  <button type="button" onClick={() => goOrderStep(1)} className="text-[10px] font-extrabold text-brand-700 inline-flex items-center gap-0.5"><Pencil className="w-3 h-3" /> Ubah</button>
                </div>
                <div className="flex justify-between items-start gap-2 border-t border-slate-100 pt-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-[10px] font-extrabold text-slate-500 uppercase">Layanan</p>
                    {kiloanLines.map((k, i) => (
                      <p key={`k-${i}`} className="flex justify-between gap-2 font-semibold text-slate-800">
                        <span className="min-w-0">{k.name} · {k.kg} Kg · {k.duration}</span>
                        <span className="shrink-0">Rp {kiloanLineTotal(k.price, k.kg).toLocaleString('id-ID')}</span>
                      </p>
                    ))}
                    {isSatuanChecked &&
                      cartSatuan.map((it, i) => (
                        <p key={`s-${i}`} className="flex justify-between gap-2 font-semibold text-slate-800">
                          <span className="min-w-0">{it.name} ×{it.qty} · {it.duration}</span>
                          <span className="shrink-0">Rp {(it.price * it.qty).toLocaleString('id-ID')}</span>
                        </p>
                      ))}
                    {kiloanLines.length > 0 ? (
                      <p className="text-[10px] text-slate-500">
                        Kantong: {kiloanBagTotal} · Cuci: {kiloanWashFinal === 'Pisah Perkantong' ? 'Dipisah' : 'Dicampur'} · Luntur: {hasFading || '-'}
                      </p>
                    ) : null}
                    {claimedPromo ? <p className="text-[10px] text-emerald-700 font-bold">Promo: {claimedPromo.title}</p> : null}
                    {loyaltyDiscountVal > 0 ? <p className="text-[10px] text-emerald-700 font-bold">Poin loyalty: -{idr(loyaltyDiscountVal)}</p> : null}
                  </div>
                  <button type="button" onClick={() => goOrderStep(2)} className="text-[10px] font-extrabold text-brand-700 inline-flex items-center gap-0.5"><Pencil className="w-3 h-3" /> Ubah</button>
                </div>
              </div>

              <div className="bg-white border border-slate-200 p-4 rounded-3xl shadow-sm">
                <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">Nama lengkap pemesan *</label>
                <input
                  type="text"
                  placeholder="Nama Anda"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-2xl px-4 py-3 text-sm font-semibold text-slate-800"
                />
              </div>
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-1.5 text-xs">
                  <div className="flex justify-between text-slate-500 font-medium"><span>Subtotal Kiloan:</span><span>Rp {kiloanSubtotal.toLocaleString('id-ID')}</span></div>
                  <div className="flex justify-between text-slate-500 font-medium"><span>Subtotal Satuan:</span><span>Rp {satuanSubtotal.toLocaleString('id-ID')}</span></div>
                  
                  <div className="flex justify-between text-slate-700 font-bold border-t border-slate-200/80 pt-1.5">
                    <span>Ongkir Antar-Jemput{isInternalDriver ? '' : ' Motor'}:</span>
                    <span>
                      {isInternalDriver
                        ? 'Rp 0 (FREE)'
                        : distanceLoading
                          ? 'Menghitung…'
                          : deliveryFee !== null
                            ? `Rp ${rawOngkir.toLocaleString('id-ID')}`
                            : 'Isi alamat dahulu'}
                    </span>
                  </div>

                  {promoDiscountVal > 0 && (
                    <div className="flex justify-between text-emerald-600 font-extrabold bg-emerald-50 p-1.5 rounded-lg border border-emerald-100">
                      <span>Potongan Promo ({claimedPromo?.title}):</span>
                      <span>- Rp {promoDiscountVal.toLocaleString('id-ID')}</span>
                    </div>
                  )}
                  {loyaltyDiscountVal > 0 && (
                    <div className="flex justify-between text-emerald-700 font-extrabold bg-emerald-50 p-1.5 rounded-lg border border-emerald-100">
                      <span>Potongan poin loyalty:</span>
                      <span>- {idr(loyaltyDiscountVal)}</span>
                    </div>
                  )}

                  <div className="flex justify-between items-center font-black text-brand-600 text-sm border-t border-slate-200 pt-2 mt-1">
                    <div className="flex items-center gap-1.5">
                      <span>ESTIMASI TOTAL:</span>
                      <button
                        type="button"
                        onClick={() => setShowEstimateInfoModal(true)}
                        className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 hover:bg-brand-200 flex items-center justify-center border border-brand-200"
                        title="Informasi Estimasi Harga"
                      >
                        <Info className="w-3 h-3" />
                      </button>
                    </div>
                    <span>Rp {grandTotalEstimate.toLocaleString('id-ID')}</span>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 p-4 rounded-2xl space-y-3">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={agreedNoValuables}
                      onChange={(e) => setAgreedNoValuables(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-brand-600 rounded shrink-0"
                    />
                    <span className="text-[11px] font-semibold text-slate-700 leading-relaxed">
                      Saya pastikan tidak ada barang berharga atau barang selain cucian pada saku atau tas cucian saya.
                    </span>
                  </label>
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={agreedTerms}
                      onChange={(e) => setAgreedTerms(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-brand-600 rounded shrink-0"
                    />
                    <span className="text-[11px] font-semibold text-slate-700 leading-relaxed">
                      Dengan melanjutkan pesan sekarang, saya menyetujui{' '}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setShowTermsModal(true);
                        }}
                        className="text-brand-600 font-extrabold underline underline-offset-2"
                      >
                        S&amp;K
                      </button>
                      {' '}yang berlaku.
                    </span>
                  </label>
                </div>

                </>
              )}
              <div
                className="fixed inset-x-0 z-40 max-w-md mx-auto px-3"
                style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom))' }}
              >
                <div className="bg-white/95 backdrop-blur-md border border-slate-200 rounded-2xl shadow-[0_-6px_24px_rgba(15,23,42,0.10)] p-2.5 space-y-2">
                  {/* Pesan dihitung ulang dari isi form, sehingga hilang begitu masalahnya diperbaiki. */}
                  {orderFormError && orderStepError(orderStep) && (
                    <p className="text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2" role="alert">
                      {orderStepError(orderStep)}
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    {orderStep > 1 ? (
                      <button
                        type="button"
                        onClick={() => goOrderStep((orderStep - 1) as 1 | 2)}
                        className="shrink-0 w-11 h-11 rounded-xl border border-slate-200 text-slate-600 flex items-center justify-center"
                        aria-label="Kembali ke langkah sebelumnya"
                      >
                        <ArrowLeft className="w-4 h-4" />
                      </button>
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="text-[9px] font-bold text-slate-500 uppercase leading-none">Estimasi total</p>
                      <p className="text-sm font-black text-slate-900 leading-tight">Rp {grandTotalEstimate.toLocaleString('id-ID')}</p>
                    </div>
                    {orderStep < 3 ? (
                      <button
                        type="button"
                        onClick={() => goOrderStep((orderStep + 1) as 2 | 3)}
                        className="shrink-0 bg-brand-600 hover:bg-brand-700 text-white font-extrabold text-xs px-4 h-11 rounded-xl inline-flex items-center gap-1 shadow-md shadow-brand-600/20"
                      >
                        Lanjut <ChevronRight className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={isSubmitting}
                        className="shrink-0 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-extrabold text-xs px-4 h-11 rounded-xl inline-flex items-center gap-1.5 shadow-md shadow-brand-600/20"
                      >
                        <Truck className="w-4 h-4" /> {isSubmitting ? 'Memproses…' : 'Pesan Sekarang'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </form>
          )}

          {activeTab === 'deposit' && (
            <div className="space-y-4">
              <div className="bg-white border border-slate-200 p-6 rounded-3xl space-y-4 text-center shadow-sm">
                <div className="w-14 h-14 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto">
                  <Wallet className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">Top Up Saldo Deposit</h3>
                  <p className="text-xs text-slate-500 mt-1">Dapatkan bonus saldo ekstra & bayar cucian instan tanpa uang pas.</p>
                </div>

                <div className="grid grid-cols-1 gap-3 text-left">
                  {DEPOSIT_PACKAGES.map((pkg) => {
                    const bonus = depositBonusOf(pkg);
                    return (
                    <button
                      key={pkg.key}
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => handleTopupMayar(pkg)}
                      className={`w-full p-4 rounded-2xl border text-left transition active:scale-[0.99] disabled:opacity-60 space-y-2 ${
                        pkg.key === 'Gold'
                          ? 'bg-amber-50/30 border-amber-200'
                          : pkg.key === 'Platinum'
                          ? 'bg-indigo-50/30 border-indigo-200'
                          : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="min-w-0">
                          <p className="font-extrabold text-slate-900 text-xs">{pkg.label}</p>
                          <p className="text-sm font-black text-slate-800 mt-0.5">Rp {pkg.pay.toLocaleString('id-ID')}</p>
                        </div>
                        <span className="shrink-0 bg-emerald-50 text-emerald-700 border border-emerald-200 font-black text-[10px] px-2.5 py-1 rounded-full">
                          + Rp {bonus.toLocaleString('id-ID')} Saldo Extra
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500 font-semibold">
                        Total Saldo Didapat: Rp {pkg.credit.toLocaleString('id-ID')}
                      </p>
                    </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => openCustomerChat('GENERAL_CS')}
                  className="w-full bg-brand-600 hover:bg-brand-700 text-white font-bold py-3 px-4 rounded-2xl text-xs shadow inline-flex items-center justify-center gap-2"
                >
                  <Headphones className="w-4 h-4" />
                  <span>Bantuan Customer Service (Live Chat)</span>
                </button>
              </div>

              <div className="space-y-2">
                <h4 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider inline-flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5" /> Riwayat Top Up Saldo
                </h4>
                {depositLogs.length === 0 && (
                  <p className="text-[11px] text-slate-400 text-center py-4">Belum ada top up. Pilih paket di atas untuk bayar via QRIS Mayar.</p>
                )}
                {depositLogs.map((log, i) => {
                  const pkg = DEPOSIT_PACKAGES.find((p) => depositPackageShort(log.package_name) === p.key);
                  const paid = Number(log.price || log.amount || pkg?.pay || 0);
                  const credited = Number(log.balance_added || 0) || pkg?.credit || paid;
                  const bonus = depositBonusOf(pkg) || (credited > paid ? credited - paid : Number(log.bonus || 0));
                  return (
                    <div key={log.id || i} className="bg-white border border-slate-200 p-3.5 rounded-2xl text-xs shadow-sm space-y-1.5">
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <p className="font-extrabold text-slate-900">Paket {depositPackageShort(log.package_name)}</p>
                          <p className="text-[10px] text-slate-400 font-medium">
                            {new Date(log.paid_at || log.created_at).toLocaleString('id-ID', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </p>
                        </div>
                        <span className="text-[9px] font-black bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-full">
                          {log.status || 'LUNAS'}
                        </span>
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-500">
                        <span>Bayar Rp {paid.toLocaleString('id-ID')}</span>
                        <span className="font-black text-slate-800">
                          Total Saldo Didapat: Rp {credited.toLocaleString('id-ID')}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-[10px] text-slate-400">
                        <span>{log.payment_method || 'QRIS Mayar'}</span>
                        {bonus > 0 && (
                          <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 font-black px-2 py-0.5 rounded-full">
                            + Rp {bonus.toLocaleString('id-ID')} Saldo Extra
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'activity' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider inline-flex items-center gap-1.5">
                  <ListTodo className="w-3.5 h-3.5" /> Aktivitas
                </h3>
                <span className="text-[10px] font-bold text-slate-400">
                  {activitySub === 'berlangsung' && `${ongoingCount} aktif`}
                  {activitySub === 'terjadwal' && `${scheduledCount} jadwal`}
                  {activitySub === 'riwayat' && `${completedOrders.length} selesai`}
                </span>
              </div>
              <ActivitySegmentTabs
                value={activitySub}
                onChange={(tab) => goActivity(tab)}
                counts={{ berlangsung: ongoingCount, terjadwal: scheduledCount, riwayat: completedOrders.length }}
              />

              <div key={activitySub} className="space-y-3 transition-opacity duration-200">
                {activitySub === 'berlangsung' && (
                  <>
                    {ongoingOrders.length === 0 && (
                      <div className="bg-white border border-slate-100 p-8 rounded-3xl text-center text-xs text-slate-400 shadow-sm">
                        Belum ada cucian yang sedang diproses.
                      </div>
                    )}
                    {ongoingOrders.map((order: any) => {
                      const progress = customerProgressOf(order, workLogsByTx[String(order.id)]);
                      const payment = customerPaymentOf(order);
                      const price = priceBreakdownOf(order);
                      const outletName = outletsList.find((o) => String(o.id) === String(order.outlet_id))?.name;
                      return (
                        <div
                          key={order.id}
                          onClick={() => setDetailOrder(order)}
                          className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex flex-col gap-3 transition-all hover:shadow-md cursor-pointer active:scale-[0.98]"
                        >
                          <div className="flex justify-between items-start border-b border-slate-50 pb-2 gap-2">
                            <div className="min-w-0 space-y-0.5">
                              <p className="text-[11px] font-black text-slate-800">
                                ID Transaksi: {formatTrxId(order)}
                              </p>
                              <p className="text-[11px] font-semibold text-slate-700 truncate">{serviceSummaryOf(order)}</p>
                              <p className="text-[10px] text-slate-500 truncate">
                                {outletName ? `${outletName} · ` : ''}
                                {order.created_at
                                  ? new Date(order.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
                                  : ''}
                              </p>
                            </div>
                            <PaymentBadge payment={payment} />
                          </div>

                          <ProgressBar progress={progress} />
                          <p className="text-[10px] text-slate-500 -mt-1">
                            Estimasi selesai:{' '}
                            <b className="text-slate-700">
                              {isTransactionRow(order) ? formatEstSelesai(order) : 'dihitung setelah diterima outlet'}
                            </b>
                          </p>

                          <div className="flex justify-between items-center">
                            <div className="pr-2">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDetailOrder(order);
                                }}
                                className="text-[11px] text-indigo-600 font-semibold line-clamp-1 mt-0.5 flex items-center gap-1 hover:underline cursor-pointer focus:outline-none"
                              >
                                <Search className="w-3 h-3" /> Detail item & status
                                <ChevronRight className="w-3 h-3" />
                              </button>
                            </div>
                            <div className="text-right whitespace-nowrap">
                              <span className="text-[10px] text-slate-500 block font-normal">
                                {price.isEstimate ? 'Estimasi total' : 'Total tagihan'}
                              </span>
                              <span className="font-extrabold text-slate-900 text-sm">
                                Rp {price.total.toLocaleString('id-ID')}
                              </span>
                              {price.discounts.length > 0 && (
                                <span className="block text-[10px] text-emerald-700 font-bold">
                                  Hemat Rp {price.discounts.reduce((a, d) => a + d.amount, 0).toLocaleString('id-ID')}
                                </span>
                              )}
                            </div>
                          </div>

                          {order.driver_chat_id && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const id = String(order.driver_chat_id);
                                setDriverChat({ id, driverName: String(order.driver_chat_name || 'Driver'), label: formatTrxId(order) });
                                setDriverChatUnread((prev) => ({ ...prev, [id]: 0 }));
                              }}
                              className="relative w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs py-3 rounded-xl shadow-sm inline-flex items-center justify-center gap-1.5"
                            >
                              <MessageCircle className="w-4 h-4" /> Chat Driver {order.driver_chat_name ? `(${order.driver_chat_name})` : ''}
                              {(driverChatUnread[String(order.driver_chat_id)] || 0) > 0 && (
                                <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center">
                                  {driverChatUnread[String(order.driver_chat_id)]}
                                </span>
                              )}
                            </button>
                          )}

                          {isSiapDiambil(order) && !isThirdPartyDelivery(order) && (
                            <button
                              type="button"
                              onClick={(e) => handleRequestDelivery(order, e)}
                              disabled={requestingDeliveryId === order.id}
                              className="w-full bg-sky-500 hover:bg-sky-600 text-white font-black text-xs py-3 rounded-xl shadow-sm inline-flex items-center justify-center gap-1.5"
                            >
                              <Truck className="w-4 h-4" />
                              {requestingDeliveryId === order.id ? 'Mengirim…' : 'Minta Pengantaran Driver'}
                            </button>
                          )}

                          {isThirdPartyDelivery(order) && !isOrderFinished(order) && (
                            <div onClick={(e) => e.stopPropagation()}>
                              <ThirdPartyDeliveryCard
                                order={order}
                                payload={thirdPartyFromOrder(order)}
                                showConfirm
                                confirmBusy={confirmDeliveryId === order.id}
                                onConfirm={() => handleConfirmThirdParty(order)}
                                onOpenPhoto={setLightboxSrc}
                              />
                            </div>
                          )}

                          {order.status === 'Driver Menuju Lokasi' && order.driver_lat && (
                            <div
                              className="bg-brand-50/80 border border-brand-100 p-3 rounded-xl space-y-1.5 text-xs mt-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex justify-between items-center">
                                <span className="font-bold text-brand-900 flex items-center gap-1 text-[11px]">
                                  <MapPin className="w-3.5 h-3.5" /> Driver Sedang Menuju Lokasi
                                </span>
                                <a
                                  href={`https://maps.google.com/?q=${order.driver_lat},${order.driver_lon}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="bg-brand-600 text-white font-bold text-[10px] px-2.5 py-1 rounded-lg shadow-sm inline-flex items-center gap-1"
                                >
                                  Buka Peta Live <ChevronRight className="w-3 h-3" />
                                </a>
                              </div>
                              <p className="text-[10px] text-brand-600">Posisi driver diperbarui secara otomatis.</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}

                {activitySub === 'terjadwal' && (
                  <>
                    {scheduledOrders.length === 0 && (
                      <div className="bg-white border border-slate-100 p-8 rounded-3xl text-center space-y-3 shadow-sm">
                        <p className="text-xs text-slate-400">Belum ada jemputan terjadwal.</p>
                        <button
                          type="button"
                          onClick={() => setActiveTab('order')}
                          className="text-[11px] font-extrabold text-indigo-600 inline-flex items-center gap-1"
                        >
                          Buat jadwal baru <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                    {scheduledOrders.map((order: any) => {
                      const editing = editingScheduleId === order.id;
                      return (
                        <div key={order.id} className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 space-y-3">
                          <div className="flex justify-between items-start gap-2">
                            <div className="min-w-0">
                              <p className="text-[11px] font-black text-slate-800">
                                {order.service_type || 'Jemput terjadwal'}
                              </p>
                              <p className="text-[10px] text-slate-500 font-semibold mt-0.5 inline-flex items-center gap-1">
                                <Clock className="w-3 h-3 text-indigo-500" /> {formatScheduleLabel(order)}
                              </p>
                              <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-2">{order.address}</p>
                            </div>
                            <StatusPill status={order.status || 'Terjadwal'} />
                          </div>

                          {editing ? (
                            <div className="grid grid-cols-2 gap-2 bg-slate-50 border border-slate-100 rounded-xl p-2.5">
                              <input
                                type="date"
                                min={localDateISO()}
                                value={editScheduleDate}
                                onChange={(e) => setEditScheduleDate(e.target.value)}
                                className="bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-[11px] font-bold"
                              />
                              <input
                                type="time"
                                value={editScheduleTime}
                                onChange={(e) => setEditScheduleTime(e.target.value)}
                                className="bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-[11px] font-bold"
                              />
                              <button
                                type="button"
                                disabled={scheduleBusyId === order.id}
                                onClick={() => persistSchedule(order, editScheduleDate, editScheduleTime)}
                                className="col-span-1 bg-indigo-600 text-white text-[10px] font-extrabold py-2 rounded-lg"
                              >
                                {scheduleBusyId === order.id ? 'Menyimpan…' : 'Simpan'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingScheduleId(null)}
                                className="col-span-1 bg-white border border-slate-200 text-[10px] font-extrabold py-2 rounded-lg text-slate-500"
                              >
                                Batal edit
                              </button>
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  const when = scheduleAtOf(order);
                                  const localDate = when
                                    ? `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`
                                    : pickupDate;
                                  const localTime = when
                                    ? `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`
                                    : pickupTime;
                                  setEditScheduleDate(localDate);
                                  setEditScheduleTime(localTime);
                                  setEditingScheduleId(order.id);
                                }}
                                className="bg-indigo-50 text-indigo-700 text-[10px] font-extrabold py-2.5 rounded-xl border border-indigo-100 inline-flex items-center justify-center gap-1"
                              >
                                <Pencil className="w-3 h-3" /> Ubah jadwal
                              </button>
                              <button
                                type="button"
                                disabled={scheduleBusyId === order.id}
                                onClick={() => cancelScheduledOrder(order)}
                                className="bg-rose-50 text-rose-600 text-[10px] font-extrabold py-2.5 rounded-xl border border-rose-100"
                              >
                                {scheduleBusyId === order.id ? 'Membatal…' : 'Batalkan'}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}

                {activitySub === 'riwayat' && (
                  <>
                    {completedOrders.map((item: any) => (
                      <div
                        key={item.id}
                        className="bg-white border border-slate-200 rounded-2xl p-4 text-xs space-y-2 shadow-sm"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setDetailOrder({
                              ...item,
                              items: Array.isArray(item.items) ? item.items : safeParse(item.items, [])
                            })
                          }
                          className="w-full text-left space-y-2"
                        >
                          <div className="flex justify-between items-start">
                            <div>
                              <span className="font-extrabold text-slate-900 block">{item.title}</span>
                              <span className="text-[10px] text-slate-500 font-medium line-clamp-2">{item.detail}</span>
                            </div>
                            <StatusPill status={item.status} />
                          </div>
                          <div className="flex justify-between items-center pt-2 border-t border-slate-100 text-[10px]">
                            <span className="text-slate-400 font-medium">{new Date(item.date).toLocaleDateString('id-ID')}</span>
                            <span className="font-black text-brand-600 text-xs">
                              {item.receipt_number ? 'Total' : 'Ongkir'}: Rp {Number(item.price || item.amount || 0).toLocaleString('id-ID')}
                            </span>
                          </div>
                          <p className="text-[10px] font-bold text-indigo-600 inline-flex items-center gap-1">
                            <Search className="w-3 h-3" /> Lihat invoice, timeline & foto
                          </p>
                        </button>
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setActiveTab('order')}
                            className="bg-brand-50 text-brand-700 text-[10px] font-extrabold py-2 rounded-xl border border-brand-100"
                          >
                            Pesan lagi
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDetailOrder({
                                ...item,
                                items: Array.isArray(item.items) ? item.items : safeParse(item.items, [])
                              });
                              setReviewStars(0);
                              setReviewText('');
                              setReviewOpen(true);
                            }}
                            className="bg-amber-50 text-amber-700 text-[10px] font-extrabold py-2 rounded-xl border border-amber-100 inline-flex items-center justify-center gap-1"
                          >
                            <Star className="w-3 h-3" /> Beri ulasan
                          </button>
                        </div>
                      </div>
                    ))}

                    {completedOrders.length === 0 && (
                      <div className="bg-white border border-slate-200 p-8 rounded-3xl text-center text-xs text-slate-400 shadow-sm">
                        Belum ada riwayat transaksi selesai.
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {activeTab === 'profile' && (
            <div className="space-y-4">
              <div className="bg-white border border-slate-200 p-6 rounded-3xl space-y-4 shadow-sm text-xs">
                <h3 className="text-sm font-extrabold text-slate-900 border-b border-slate-100 pb-2 inline-flex items-center gap-2">
                  <IconBadge icon={User} tone="slate" size="sm" /> Profil Akun
                </h3>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-extrabold block">Nama Lengkap</span>
                  <p className="font-extrabold text-slate-900 text-sm mt-0.5">{customerData.name || '-'}</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-extrabold block">Nomor WhatsApp</span>
                  <p className="font-mono text-brand-600 font-extrabold mt-0.5">{customerPhone}</p>
                </div>

                <BackupEmailCard
                  auth={authState}
                  onLinked={() => {
                    void fetchCustomerAuthState().then(setAuthState);
                    toast('Email cadangan terverifikasi dan tertaut.', 'ok');
                  }}
                  onRelogin={goToLogin}
                />

                <div className="pt-2 border-t border-slate-100">
                  <AddressManager
                    addresses={savedAddresses}
                    busy={addressBusy}
                    onSave={handleSaveAddressDraft}
                    onDelete={handleDeleteAddress}
                    onSetPrimary={handleSetPrimaryAddress}
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (!confirm('Keluar dari akun pelanggan?')) return;
                  handleLogout();
                }}
                className="w-full bg-rose-50 border border-rose-200 text-rose-600 font-extrabold py-3.5 rounded-2xl text-xs hover:bg-rose-100 transition"
              >
                Keluar
              </button>
            </div>
          )}
        </>
      ) : null}

      <PromoBannerDetailModal
        slide={selectedBanner}
        eligibility={
          selectedBanner?.kind === 'promo'
            ? {
                outletNames: (() => {
                  const ids = selectedBanner.targetOutletIds || [];
                  if (!ids.length || ids.some((id) => id.toUpperCase() === 'ALL')) return null;
                  return ids.map((id) => outletsList.find((o) => String(o.id) === id)?.name).filter(Boolean) as string[];
                })(),
                voucher:
                  findPromoByCode(availablePromos, selectedBanner.promoCode || '') ||
                  availablePromos.find((p) => String(p.title || '').toLowerCase() === String(selectedBanner.title || '').toLowerCase()) ||
                  null
              }
            : null
        }
        claimed={
          !!claimedPromo &&
          selectedBanner?.kind === 'promo' &&
          [claimedPromo.code, claimedPromo.id, claimedPromo.title].some(
            (v) => String(v || '').toLowerCase() === String(selectedBanner.promoCode || selectedBanner.title || '').toLowerCase()
          )
        }
        onClose={() => setSelectedBanner(null)}
        onClaim={() => {
          if (!selectedBanner || selectedBanner.kind !== 'promo') return;
          const code = selectedBanner.promoCode || selectedBanner.title;
          const found =
            findPromoByCode(availablePromos, code) ||
            availablePromos.find((p) => String(p.title || '').toLowerCase() === String(selectedBanner.title || '').toLowerCase());
          if (!found) {
            alert('Promo ini belum terhubung ke kode voucher. Isi kode promo di form order, atau hubungkan kode di /owner/promos.');
            return;
          }
          handleClaimPromo(found);
        }}
      />

      <PromoVoucherModal
        open={showPromoModal}
        promos={availablePromos}
        claimedId={claimedPromo?.id}
        onClose={() => setShowPromoModal(false)}
        onClaim={handleClaimPromo}
        onApplyCode={handleApplyPromoCode}
      />

      {showTermsModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[90] flex items-center justify-center p-4" onClick={() => setShowTermsModal(false)}>
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900 text-center">Syarat &amp; Ketentuan</h3>
              <p className="text-xs text-slate-600 mt-3 leading-relaxed font-medium whitespace-pre-line">
                {receiptTerms || DEFAULT_RECEIPT_TERMS}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setAgreedTerms(true);
                setShowTermsModal(false);
              }}
              className="w-full bg-brand-600 hover:bg-brand-700 text-white font-extrabold py-3 rounded-2xl text-xs uppercase shadow-md transition"
            >
              Saya Setuju
            </button>
          </div>
        </div>
      )}

      {/* MODAL INFORMASI CREDENTIAL ESTIMASI TOTAL */}
      {showEstimateInfoModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[90] flex items-center justify-center p-4" onClick={() => setShowEstimateInfoModal(false)}>
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl text-center" onClick={(e) => e.stopPropagation()}>
            <div className="w-12 h-12 bg-brand-50 text-brand-600 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
              <Info className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">Informasi Estimasi Tagihan</h3>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed font-medium">
                Perhitungan angka ini adalah <b>estimasi sementara</b>, tagihan final akan dihitung dan dikonfirmasi ulang oleh kasir outlet setelah pakaian ditimbang dan dicek langsung di lokasi.
              </p>
            </div>
            <button
              onClick={() => setShowEstimateInfoModal(false)}
              className="w-full bg-brand-600 hover:bg-brand-700 text-white font-extrabold py-3 rounded-2xl text-xs uppercase shadow-md transition"
            >
              Saya Mengerti
            </button>
          </div>
        </div>
      )}

      {depositCheckout && (
        <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
            <div className="bg-[#075e54] text-white px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-100">QRIS Mayar</p>
                <p className="font-extrabold text-sm">{depositCheckout.packageLabel || `Paket ${depositCheckout.packageName}`}</p>
              </div>
              <button
                type="button"
                onClick={() => setDepositCheckout(null)}
                className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center"
                aria-label="Tutup"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-center overflow-y-auto">
              {depositCheckout.paid ? (
                <div className="space-y-3 py-6">
                  <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
                  <p className="font-black text-slate-900">Pembayaran Lunas</p>
                  <p className="text-xs text-slate-500">
                    Total saldo didapat Rp {Number(depositCheckout.balanceAdded || 0).toLocaleString('id-ID')} sudah masuk.
                  </p>
                  {Number(depositCheckout.bonus || 0) > 0 && (
                    <p className="mx-auto inline-flex items-center justify-center bg-emerald-50 text-emerald-700 border border-emerald-200 font-black text-[11px] px-3 py-1 rounded-full">
                      + Rp {Number(depositCheckout.bonus).toLocaleString('id-ID')} Saldo Extra
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => setDepositCheckout(null)}
                    className="w-full bg-emerald-600 text-white font-black text-xs py-3 rounded-2xl"
                  >
                    Selesai
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-2xl font-black text-slate-900">
                    Rp {Number(depositCheckout.amount || 0).toLocaleString('id-ID')}
                  </p>
                  {Number(depositCheckout.bonus || 0) > 0 && (
                    <p className="mx-auto inline-flex items-center justify-center bg-emerald-50 text-emerald-700 border border-emerald-200 font-black text-[11px] px-3 py-1.5 rounded-full">
                      + Rp {Number(depositCheckout.bonus).toLocaleString('id-ID')} Saldo Extra
                    </p>
                  )}
                  <p className="text-[11px] text-slate-500 font-semibold">
                    Total Saldo Didapat: Rp {Number(depositCheckout.balanceAdded || 0).toLocaleString('id-ID')}
                  </p>
                  {depositCheckout.qrisUrl || depositCheckout.invoiceUrl ? (
                    <img
                      src={
                        depositCheckout.qrisUrl ||
                        `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(depositCheckout.invoiceUrl)}`
                      }
                      alt="QRIS Mayar"
                      className="w-48 h-48 mx-auto bg-white rounded-2xl border border-slate-200 object-contain"
                    />
                  ) : null}
                  <p className="text-[11px] text-slate-500 font-medium">Scan QRIS Mayar sesuai nominal. Status akan berubah otomatis setelah webhook payment.received.</p>
                  {depositCheckout.invoiceUrl && (
                    <a
                      href={depositCheckout.invoiceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-[11px] font-bold text-indigo-600"
                    >
                      Buka tautan invoice
                    </a>
                  )}
                  {depositCheckout.mock && (
                    <button
                      type="button"
                      disabled={depositPayBusy}
                      onClick={async () => {
                        setDepositPayBusy(true);
                        try {
                          await simulateMayarAutoPay({
                            topupId: depositCheckout.topupId,
                            receipt: depositCheckout.receipt,
                            amount: depositCheckout.amount,
                            customerPhone: cleanPhone(customerPhone)
                          });
                          setDepositCheckout((c: any) => (c ? { ...c, paid: true } : c));
                          fetchCustomerProfile(cleanPhone(customerPhone));
                          toast('Top up deposit berhasil. Saldo sudah ditambahkan.', 'ok');
                        } catch (err: any) {
                          alert(err?.message || 'Gagal simulasi pembayaran');
                        } finally {
                          setDepositPayBusy(false);
                        }
                      }}
                      className="w-full bg-amber-500 text-white font-black text-xs py-3 rounded-2xl"
                    >
                      {depositPayBusy ? 'Memproses…' : 'Test Auto-Payment (Mock)'}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <OutletProfileDrawer outlet={profileOutlet} onClose={() => setProfileOutlet(null)} />

      {complaintTicketOpen && complaintTicket && (
        <ComplaintTicketChat
          ticket={complaintTicket}
          senderType="customer"
          senderName={customerName || 'Pelanggan'}
          variant="fullscreen"
          onClose={() => setComplaintTicketOpen(false)}
        />
      )}
      {/* LIVE CHAT — WhatsApp-style tab */}
      {activeTab === 'chat' && customerData && (
        <div className="fixed inset-x-0 top-0 bottom-[4.75rem] z-[60] max-w-md mx-auto h-auto flex flex-col bg-[#ece5dd]">
          <div className="shrink-0 bg-[#075e54] text-white pl-0.5 pr-1.5 pt-[max(0.45rem,env(safe-area-inset-top))] pb-2 flex items-center gap-0.5 shadow-md">
            <button
              type="button"
              onClick={() => goHome()}
              className="shrink-0 w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10"
              aria-label="Kembali"
            >
              <ArrowLeft className="w-6 h-6" strokeWidth={2.2} />
            </button>
            <div className="flex-1 min-w-0 pr-1.5">
              <p className="font-semibold text-[12px] sm:text-[13px] leading-snug flex flex-wrap items-center gap-x-1 gap-y-0">
                <span>Customer Service Care</span>
                <span className="inline-flex items-center">
                  BERANI
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    className="inline-block ml-1 align-middle -mt-0.5"
                    aria-label="Akun terverifikasi"
                    role="img"
                  >
                    <path
                      fillRule="evenodd"
                      clipRule="evenodd"
                      d="M12 2C12.4674 2 12.9238 2.13849 13.312 2.39805L14.738 3.35105C15.0153 3.53637 15.3429 3.64966 15.681 3.67705L17.419 3.81805C17.8924 3.85642 18.3364 4.07221 18.6517 4.41707C18.967 4.76193 19.1278 5.20739 19.098 5.68205L18.988 7.41605C18.9668 7.75383 19.0354 8.09033 19.185 8.38405L19.953 9.89205C20.1624 10.3026 20.2227 10.7712 20.1206 11.2201C20.0185 11.6691 19.7583 12.0617 19.382 12.333L18.01 13.323C17.7423 13.5162 17.5342 13.7801 17.411 14.082L16.782 15.629C16.611 16.0503 16.2891 16.3888 15.8727 16.5855C15.4563 16.7822 14.9785 16.821 14.522 16.695L12.822 16.225C12.4907 16.1333 12.1413 16.1333 11.81 16.225L10.11 16.695C9.65349 16.821 9.17571 16.7822 8.75932 16.5855C8.34293 16.3888 8.02103 16.0503 7.85 15.629L7.221 14.082C7.09783 13.7801 6.88972 13.5162 6.622 13.323L5.25 12.333C4.87372 12.0617 4.61352 11.6691 4.51141 11.2201C4.4093 10.7712 4.46961 10.3026 4.679 9.89205L5.447 8.38405C5.5966 8.09033 5.66523 7.75383 5.644 7.41605L5.534 5.68205C5.50422 5.20739 5.66504 4.76193 5.98033 4.41707C6.29562 4.07221 6.73961 3.85642 7.213 3.81805L8.951 3.67705C9.28912 3.64966 9.6167 3.53637 9.894 3.35105L11.32 2.39805C11.7082 2.13849 12.1646 2 12.632 2H12Z"
                      fill="#0084FF"
                    />
                    <path d="M10.3 14.2L6.9 10.8L8.3 9.4L10.3 11.4L15.7 6L17.1 7.4L10.3 14.2Z" fill="white" />
                  </svg>
                </span>
              </p>
              <p className="text-[10px] text-emerald-200 leading-tight">Online</p>
            </div>
            <div className="shrink-0 flex bg-black/20 p-0.5 rounded-md">
              <button
                type="button"
                onClick={() => setActiveSupportTab('cs')}
                className={`px-1.5 py-1 text-[9px] font-bold rounded transition whitespace-nowrap ${
                  activeSupportTab === 'cs' ? 'bg-white text-[#075e54]' : 'text-white/85 hover:text-white'
                }`}
              >
                Live CS
              </button>
              <button
                type="button"
                onClick={() => setActiveSupportTab('ai')}
                className={`px-1.5 py-1 text-[9px] font-bold rounded transition whitespace-nowrap ${
                  activeSupportTab === 'ai' ? 'bg-white text-[#075e54]' : 'text-white/85 hover:text-white'
                }`}
              >
                Tanya AI
              </button>
            </div>
          </div>

          <div
            ref={chatScrollRef}
            className="flex-1 overflow-y-auto px-3 py-4 space-y-2"
            style={{
              backgroundImage:
                'linear-gradient(rgba(236,229,221,0.92), rgba(236,229,221,0.92)), url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23d4cfc7\' fill-opacity=\'0.45\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")'
            }}
          >
            {(activeSupportTab === 'cs' ? chatMessages : aiMessages).length === 0 ? (
              <div className="text-center text-xs text-slate-500 py-16">
                Belum ada percakapan. Halo CS kami sekarang!
              </div>
            ) : (
              (activeSupportTab === 'cs' ? chatMessages : aiMessages).map((msg: any) => {
                const isCustomer = msg.sender_type === 'customer';
                const isAi = msg.sender_type === 'ai';

                return (
                  <div
                    key={msg.id || msg.created_at}
                    className={`flex ${isCustomer ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[82%] rounded-lg px-3 py-1.5 text-[13px] font-medium leading-relaxed shadow-sm ${
                        isCustomer
                          ? 'bg-[#dcf8c6] text-slate-900 rounded-tr-none'
                          : isAi
                          ? 'bg-indigo-50 text-slate-900 rounded-tl-none border border-indigo-100'
                          : 'bg-white text-slate-900 rounded-tl-none'
                      }`}
                    >
                      {visibleChatText(msg) && <p className="whitespace-pre-wrap">{visibleChatText(msg)}</p>}
                      <ChatInvoiceCard message={msg} />
                      <ThirdPartyDeliveryCard message={msg} onOpenPhoto={setLightboxSrc} />
                      <ChatAttachment message={msg} onOpen={setLightboxSrc} />
                      <span className={`text-[10px] block mt-1 ${isCustomer ? 'text-slate-500 text-right' : 'text-slate-400'}`}>
                        {new Date(msg.created_at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="shrink-0 bg-[#f0f2f5] px-2 pt-2 pb-[max(0.6rem,env(safe-area-inset-bottom))] flex items-end gap-2">
            {activeSupportTab === 'cs' && (
              <>
                <input
                  id="cust-chat-attach"
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) handleSendChat(f);
                  }}
                />
                <label
                  htmlFor="cust-chat-attach"
                  title="Kirim bukti transfer / foto"
                  className="shrink-0 w-11 h-11 rounded-full bg-white text-slate-500 flex items-center justify-center cursor-pointer shadow-sm border border-slate-200"
                >
                  <Paperclip className="w-5 h-5" />
                </label>
              </>
            )}
            <input
              type="text"
              value={inputChat}
              onChange={(e) => setInputChat(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
              placeholder={activeSupportTab === 'cs' ? 'Ketik pesan atau unggah bukti bayar...' : 'Tanya AI seputar layanan laundry...'}
              className="flex-1 bg-white border border-slate-200 rounded-full px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#075e54]/20"
            />
            <button
              type="button"
              onClick={() => handleSendChat()}
              className={`shrink-0 w-11 h-11 rounded-full text-white flex items-center justify-center shadow-md transition ${
                activeSupportTab === 'cs' ? 'bg-[#075e54] hover:bg-[#064e46]' : 'bg-indigo-600 hover:bg-indigo-700'
              }`}
              aria-label="Kirim"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
{/* MODAL SUCCESS ORDER REDIRECT (SMOOTH UX FLOW) */}
{showOrderSuccessModal && latestCreatedOrder && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[90] flex items-center justify-center p-4" onClick={() => setShowOrderSuccessModal(false)}>
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl text-center" onClick={(e) => e.stopPropagation()}>
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                {isScheduledOrder(latestCreatedOrder) ? 'Jemputan Terjadwal!' : 'Pesanan Terkirim ke Kasir!'}
              </h3>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed font-medium">
                No. Pesanan: <b className="text-slate-900">{latestCreatedOrder.order_number}</b><br/>
                {isScheduledOrder(latestCreatedOrder)
                  ? `Driver belum ditugaskan. Jadwal: ${formatScheduleLabel(latestCreatedOrder)}.`
                  : 'Driver & Kasir outlet kami sedang memproses penjemputan ke lokasi Anda.'}
              </p>
            </div>
            <button
              onClick={() => {
                setShowOrderSuccessModal(false);
                goActivity(isScheduledOrder(latestCreatedOrder) ? 'terjadwal' : 'berlangsung');
              }}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-3.5 rounded-2xl text-xs uppercase shadow-md transition inline-flex items-center justify-center gap-1.5"
            >
              {isScheduledOrder(latestCreatedOrder) ? 'Lihat Jadwal' : 'Lihat Status Live Tracking'} <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
      </main>
      <BottomNavbar
        activeTab={activeTab}
        ongoingCount={ongoingCount}
        customerPhone={customerPhone}
        onHome={goHome}
        onChat={() => (customerData ? openCustomerChat() : setActiveTab('chat'))}
        onOrder={() => setActiveTab('order')}
        onActivity={() => goActivity(activitySub)}
        onProfile={() => setActiveTab('profile')}
      />

{/* ================= MODAL POPUP DETAIL ITEM & STATUS ================= */}
{detailOrder && (
  <div className="fixed inset-0 z-[55] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { setDetailOrder(null); setDetailPayCharge(null); setComplaintOpen(false); setReviewOpen(false); }}>
    <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
      
      {/* Header */}
      <div className="bg-indigo-600 p-4 text-white flex justify-between items-center">
        <div>
          <h3 className="font-extrabold text-base">Detail Pesanan</h3>
          <p className="text-[11px] text-indigo-100">
            Resi: {detailOrder.receipt_number || detailOrder.id || '-'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setDetailOrder(null);
            setDetailPayCharge(null);
            setComplaintOpen(false);
            setReviewOpen(false);
          }}
          className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="p-4 overflow-y-auto space-y-4 text-xs text-slate-700">
        <div className="bg-indigo-50 p-3 rounded-xl border border-indigo-100 space-y-1.5">
          <p className="font-black text-slate-900 text-sm">ID Transaksi: {formatTrxId(detailOrder)}</p>
          <p className="text-[11px] font-semibold text-indigo-800">
            Estimasi Selesai:{' '}
            {isTransactionRow(detailOrder) ? formatEstSelesai(detailOrder) : 'dihitung setelah cucian diterima outlet'}
          </p>
          {(() => {
            const outletName = outletsList.find((o) => String(o.id) === String(detailOrder.outlet_id))?.name;
            return outletName ? <p className="text-[11px] font-semibold text-indigo-800">Outlet: {outletName}</p> : null;
          })()}
          <div className="pt-1 space-y-1.5">
            <ProgressBar progress={customerProgressOf(detailOrder, detailWorkLogs)} />
            <p className="text-[11px] font-semibold text-slate-700 inline-flex items-center gap-1.5">
              Pembayaran: <PaymentBadge payment={customerPaymentOf(detailOrder)} />
            </p>
          </div>
          {isPaymentLocked(detailOrder) ? (
            <div className="mt-2 space-y-2">
              <p className="text-[10px] text-amber-800 font-semibold">
                Bayar via QRIS Mayar di bawah. Setelah lunas, status diperbarui otomatis (CS opsional).
              </p>
              {detailPayCharge?.qrisUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={detailPayCharge.qrisUrl}
                  alt="QRIS pembayaran"
                  className="w-40 h-40 mx-auto bg-white rounded-xl border object-contain"
                />
              ) : null}
              {detailPayCharge?.invoiceUrl ? (
                <a
                  href={detailPayCharge.invoiceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-center text-[11px] font-bold text-sky-700"
                >
                  Buka tautan pembayaran
                </a>
              ) : null}
              <button
                type="button"
                disabled={detailPayBusy}
                onClick={async () => {
                  setDetailPayBusy(true);
                  try {
                    const charge = await requestMayarInvoice({
                      amount: Number(detailOrder.amount || detailOrder.price || 0),
                      name: `Laundrivery ${detailOrder.receipt_number || ''}`.trim(),
                      description: `Tagihan ${detailOrder.receipt_number || ''}`.trim(),
                      mobile: cleanPhone(customerPhone) || undefined,
                      receipt: detailOrder.receipt_number,
                      transactionId: detailOrder.id,
                      outletId: detailOrder.outlet_id || selectedOutlet || undefined
                    });
                    setDetailPayCharge(charge);
                    toast(charge.mock ? 'QRIS uji coba siap discan.' : 'QRIS siap discan dari e-wallet.', 'ok');
                  } catch (e: any) {
                    toast(e?.message || 'Gagal membuat QRIS', 'err');
                  } finally {
                    setDetailPayBusy(false);
                  }
                }}
                className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-[11px] font-extrabold py-2.5"
              >
                {detailPayBusy ? 'Menyiapkan QRIS…' : detailPayCharge ? 'Generate ulang QRIS' : 'Bayar dengan QRIS'}
              </button>
              <CheckPaymentStatusButton
                orderId={String(detailOrder.id)}
                className="w-full"
                onPaid={() => {
                  setDetailOrder((prev: any) =>
                    prev ? { ...prev, is_paid: true, payment_status: 'paid', status: 'Diterima' } : prev
                  );
                  setDetailPayCharge(null);
                  setPendingCashierInvoice((prev) => prev.filter((b) => String(b.id) !== String(detailOrder.id)));
                  if (customerPhone) fetchCustomerProfile(customerPhone);
                }}
              />
            </div>
          ) : null}
        </div>

        {/* Rincian Items + harga */}
        <div className="space-y-2">
          <h4 className="font-extrabold text-slate-800 uppercase text-[10px] inline-flex items-center gap-1">
            <Package className="w-3.5 h-3.5" /> Rincian Item & Harga
          </h4>
          {(() => {
            const bd = priceBreakdownOf(detailOrder);
            return (
              <>
                {bd.items.length > 0 ? (
                  <div className="space-y-1.5">
                    {bd.items.map((it, idx) => (
                      <div key={idx} className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 flex justify-between items-center gap-2">
                        <div className="min-w-0">
                          <span className="font-bold text-slate-800 block">{it.name}</span>
                          {it.detail && <span className="text-[10px] text-slate-500">{it.detail}</span>}
                        </div>
                        <span className="font-black text-slate-900 shrink-0">Rp {it.amount.toLocaleString('id-ID')}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <p className="text-slate-600 font-medium">
                      {detailOrder.notes || 'Detail item telah dicatat oleh kasir/driver.'}
                    </p>
                  </div>
                )}
                <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-1.5">
                  <div className="flex justify-between text-[11px] text-slate-600">
                    <span>Subtotal layanan</span>
                    <span>Rp {bd.subtotal.toLocaleString('id-ID')}</span>
                  </div>
                  {bd.discounts.map((d, i) => (
                    <div key={i} className="flex justify-between text-[11px] font-bold text-emerald-700">
                      <span>{d.label}</span>
                      <span>- Rp {d.amount.toLocaleString('id-ID')}</span>
                    </div>
                  ))}
                  {bd.deliveryFee > 0 && (
                    <div className="flex justify-between text-[11px] text-slate-600">
                      <span>Ongkir antar-jemput</span>
                      <span>Rp {bd.deliveryFee.toLocaleString('id-ID')}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-black text-slate-900 border-t border-slate-100 pt-1.5">
                    <span>{bd.isEstimate ? 'Estimasi total' : 'Total bayar'}</span>
                    <span>Rp {bd.total.toLocaleString('id-ID')}</span>
                  </div>
                  {bd.promoNote && <p className="text-[10px] text-emerald-700 font-semibold">{bd.promoNote}</p>}
                  {bd.isEstimate ? (
                    <p className="text-[10px] text-slate-500">
                      Estimasi dari form pesanan. Tagihan final dihitung kasir outlet setelah cucian ditimbang.
                    </p>
                  ) : bd.items.length > 0 && bd.itemsTotal !== bd.subtotal ? (
                    <p className="text-[10px] text-slate-500">Subtotal mengikuti nota kasir (termasuk penyesuaian durasi/layanan).</p>
                  ) : null}
                </div>
              </>
            );
          })()}
        </div>

        {(detailOrder.rack_location || detailOrder.rack_number || detailOrder.package_count || detailOrder.bag_count || detailOrder.rack_notes) && (
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 space-y-1">
            <h4 className="font-extrabold text-amber-800 uppercase text-[10px] inline-flex items-center gap-1">
              <Box className="w-3.5 h-3.5" /> Rak Penyimpanan
            </h4>
            <p className="font-bold text-slate-800">
              Rak {detailOrder.rack_location || detailOrder.rack_number || '-'}
              {(detailOrder.package_count || detailOrder.bag_count) ? ` · ${detailOrder.package_count || detailOrder.bag_count} pack` : ''}
            </p>
            {detailOrder.rack_notes && <p className="text-[10px] text-slate-600">{detailOrder.rack_notes}</p>}
          </div>
        )}

        {/* Riwayat Waktu Pengerjaan */}
        <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
          <StageTimeline
            logs={detailWorkLogs}
            transaction={detailOrder}
            showCrew={false}
            variant="customer"
            title="Progres & Waktu Pengerjaan"
            onOpenPhoto={setLightboxSrc}
          />
        </div>

        {isThirdPartyDelivery(detailOrder) && !isOrderFinished(detailOrder) && (
          <ThirdPartyDeliveryCard
            order={detailOrder}
            showConfirm
            confirmBusy={confirmDeliveryId === detailOrder.id}
            onConfirm={() => handleConfirmThirdParty(detailOrder)}
            onOpenPhoto={setLightboxSrc}
          />
        )}

        {isOrderFinished(detailOrder) && (() => {
          const ui = showComplaintActions(detailOrder);
          if (ui.awaitingCustomer || complaintStepOf(detailComplaint) === 'awaiting_customer') {
            return (
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 space-y-2">
                <p className="text-[11px] font-bold text-indigo-900">
                  Keputusan Supervisor: {decisionLabelOf(detailComplaint?.supervisor_decision)}
                  {detailComplaint?.supervisor_note ? ` — ${detailComplaint.supervisor_note}` : ''}
                </p>
                <p className="text-[10px] text-indigo-700">Setuju untuk menyelesaikan, atau Banding agar CS Care investigasi ulang.</p>
                {complaintTicket && (
                  <button
                    type="button"
                    onClick={() => setComplaintTicketOpen(true)}
                    className="w-full bg-rose-600 text-white font-black text-[11px] py-2.5 rounded-xl"
                  >
                    Buka {ticketTitleOf(complaintTicket)}
                  </button>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={complaintRespondBusy}
                    onClick={() => handleComplaintRespond(true)}
                    className="bg-emerald-600 text-white font-black text-[11px] py-2.5 rounded-xl"
                  >
                    {complaintRespondBusy ? 'Mengirim…' : 'Setuju'}
                  </button>
                  <button
                    type="button"
                    disabled={complaintRespondBusy}
                    onClick={() => handleComplaintRespond(false)}
                    className="bg-rose-50 text-rose-700 border border-rose-200 font-black text-[11px] py-2.5 rounded-xl"
                  >
                    Banding
                  </button>
                </div>
              </div>
            );
          }
          if (ui.pending) {
            const step = complaintStepOf(detailComplaint);
            const msg =
              step === 'pending_supervisor'
                ? 'Temuan CS Care menunggu keputusan Supervisor.'
                : step === 'decision_ready'
                ? 'Supervisor sudah memutuskan. CS Care akan meneruskan ke Tiket Komplain Anda.'
                : step === 'appealed'
                ? 'Banding diterima. CS Care sedang investigasi ulang.'
                : 'Komplain Anda sedang diinvestigasi CS Care.';
            return (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
                <p className="text-[11px] font-bold text-amber-800">{msg}</p>
                {complaintTicket && (
                  <button
                    type="button"
                    onClick={() => setComplaintTicketOpen(true)}
                    className="w-full bg-rose-600 text-white font-black text-[11px] py-2.5 rounded-xl"
                  >
                    Buka {ticketTitleOf(complaintTicket)}
                  </button>
                )}
              </div>
            );
          }
          if (ui.autoConfirmed) {
            return (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] text-slate-500 font-medium">
                Jendela komplain 24 jam telah berakhir. Pesanan dikunci otomatis sebagai sesuai.
              </div>
            );
          }
          if (ui.locked) {
            return (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-[11px] font-bold text-emerald-700">
                Pesanan dikonfirmasi sesuai. Terima kasih.
              </div>
            );
          }
          return (
            <div className="space-y-2">
              <p className="text-[10px] text-slate-400 font-medium">
                Komplain hanya tersedia 24 jam setelah cucian diserahkan.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleSudahSesuai}
                  className="bg-emerald-600 text-white font-black text-[11px] py-2.5 rounded-xl inline-flex items-center justify-center gap-1"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> Sudah Sesuai
                </button>
                <button
                  type="button"
                  onClick={() => setComplaintOpen(true)}
                  className="bg-rose-50 text-rose-700 border border-rose-200 font-black text-[11px] py-2.5 rounded-xl inline-flex items-center justify-center gap-1"
                >
                  <AlertTriangle className="w-3.5 h-3.5" /> Komplain / Ada Kendala
                </button>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Footer */}
      <div className="p-3 bg-slate-50 border-t border-slate-100">
        <button
          type="button"
          onClick={() => {
            setDetailOrder(null);
            setComplaintOpen(false);
            setReviewOpen(false);
          }}
          className="w-full py-2 bg-slate-800 text-white font-bold rounded-xl text-xs cursor-pointer"
        >
          Kembali
        </button>
      </div>

    </div>
  </div>
)}
      {complaintOpen && detailOrder && (
        <div className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-4" onClick={() => setComplaintOpen(false)}>
          <div className="bg-white w-full max-w-sm rounded-2xl p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-black text-sm text-slate-900 inline-flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-rose-500" /> Komplain / Ada Kendala
            </h3>
            <textarea
              value={complaintText}
              onChange={(e) => setComplaintText(e.target.value)}
              rows={4}
              placeholder="Jelaskan kendala (sobek, kurang, salah item, dll.)"
              className="w-full border border-slate-200 rounded-xl p-2.5 text-xs"
            />
            <div>
              <p className="text-[10px] font-black text-rose-600 mb-1">Video unboxing (wajib)</p>
              <FileProofInput
                file={complaintVideo}
                onFile={setComplaintVideo}
                accept="video/*"
                required
                label="Unggah video unboxing"
                icon="upload"
              />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-500 mb-1">Foto tambahan (opsional)</p>
              <FileProofInput file={complaintFile} onFile={setComplaintFile} />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setComplaintOpen(false)} className="flex-1 border border-slate-200 font-bold text-xs py-2.5 rounded-xl">
                Batal
              </button>
              <button
                type="button"
                disabled={complaintBusy}
                onClick={handleSubmitComplaint}
                className="flex-1 bg-rose-600 text-white font-black text-xs py-2.5 rounded-xl"
              >
                {complaintBusy ? 'Mengirim…' : 'Kirim Komplain'}
              </button>
            </div>
          </div>
        </div>
      )}
      {reviewOpen && detailOrder && (
        <div className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-4" onClick={() => setReviewOpen(false)}>
          <div className="bg-white w-full max-w-sm rounded-2xl p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-black text-sm text-slate-900">Rating & Ulasan</h3>
            <p className="text-[11px] text-slate-500">Opsional — bantu kami meningkatkan layanan outlet.</p>
            <StarRating value={reviewStars} onChange={setReviewStars} />
            <textarea
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              rows={3}
              placeholder="Saran atau masukan (opsional)"
              className="w-full border border-slate-200 rounded-xl p-2.5 text-xs"
            />
            <button
              type="button"
              disabled={reviewBusy}
              onClick={handleSubmitReview}
              className="w-full bg-indigo-600 text-white font-black text-xs py-2.5 rounded-xl"
            >
              {reviewBusy ? 'Menyimpan…' : 'Kirim Ulasan'}
            </button>
            <button type="button" onClick={() => setReviewOpen(false)} className="w-full text-[11px] font-bold text-slate-400">
              Nanti saja
            </button>
          </div>
        </div>
      )}
      <PhotoLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      {driverChat && (
        <DriverChatSheet
          as="customer"
          orderId={driverChat.id}
          title={`Chat Driver · ${driverChat.driverName}`}
          subtitle={driverChat.label}
          customerPhone={customerPhone}
          onClose={() => setDriverChat(null)}
        />
      )}
    </div>
  );
}

export default function CustomerDashboardPageWrapped() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-100" />}>
      <CustomerDashboardPage />
    </Suspense>
  );
}
