'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import StageTimeline from '@/components/StageTimeline';
import { fetchThreadMessages, insertChatMessage, isStaffOnlyMessage, phoneVariants, threadKeyOf } from '@/lib/csChat';
import { parseChatInvoice } from '@/lib/chatInvoice';
import { findPromoByCode, mapDbPromo, mapSettingsPromo, promoDiscountRp, promoIsClaimable, type CatalogPromo } from '@/lib/promoCatalog';
import { createPickupRoleTasks, insertPickupOrder, requestDriverDelivery } from '@/lib/pickupDispatch';
import { displayStatusLabel, stageKeyOf } from '@/lib/stageTimeline';
import { laundryFallbackReply } from '@/lib/laundryFaq';
import PhotoLightbox from '@/components/PhotoLightbox';
import ChatAttachment, { visibleChatText } from '@/components/ChatAttachment';
import ChatInvoiceCard from '@/components/ChatInvoiceCard';
import ThirdPartyDeliveryCard from '@/components/ThirdPartyDeliveryCard';
import {
  confirmThirdPartyReceived,
  isThirdPartyDelivery,
  thirdPartyFromOrder
} from '@/lib/thirdPartyDelivery';
import FileProofInput from '@/components/FileProofInput';
import { fileToCompressedDataUrl, uploadChatAttachment, uploadProofFile } from '@/lib/uploadProof';
import { displayItemAmount, kiloanLineTotal } from '@/lib/kiloanPrice';
import { formatEstSelesai, formatTrxId } from '@/lib/posQueue';
import { DEPOSIT_PACKAGES, depositBonusOf, depositPackageShort } from '@/lib/depositTopup';
import { simulateMayarAutoPay } from '@/lib/mayar';
import {
  complaintStepOf,
  customerRespondComplaint,
  decisionLabelOf,
  loadComplaintForOrder
} from '@/lib/csCare';
import ComplaintTicketChat from '@/components/ComplaintTicketChat';
import { ensureComplaintTicketFromIssue, findComplaintTicket, ticketTitleOf } from '@/lib/complaintTicket';
import { nearestOpenOutlet } from '@/lib/outletCapacity';
import { toast } from '@/lib/toast';
import {
  showComplaintActions,
  markOrderConfirmed,
  submitOrderComplaint,
  submitOrderReview,
  maybeAutoConfirmOrder,
  readLocalFlag
} from '@/lib/orderFeedback';
import { IconBadge, SlaBadge, StarRating, StatusPill, StepperBtn } from '@/components/customer/ui';
import PromoBannerCarousel from '@/components/customer/PromoBannerCarousel';
import NearbyOutlets from '@/components/customer/NearbyOutlets';
import PromoVoucherModal from '@/components/customer/PromoVoucherModal';
import PromoBannerDetailModal from '@/components/customer/PromoBannerDetailModal';
import OutletProfileDrawer from '@/components/customer/OutletProfileDrawer';
import BottomNavbar from '@/components/customer/BottomNavbar';
import AddressManager from '@/components/customer/AddressManager';
import LoyaltyProfileCard from '@/components/customer/LoyaltyProfileCard';
import PinpointMap from '@/components/customer/PinpointMap';
import CustomerHeader from '@/components/customer/CustomerHeader';
import {
  MAX_NEARBY_RADIUS_KM,
  bannerSlidesOf,
  citiesMatch,
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
import { geocodeAddress, reverseGeocodeAddress, reverseGeocodeCity } from '@/lib/reverseGeocode';
import { matchOutletFromQuery, persistCustomerOutlet, readStoredCustomerOutlet } from '@/lib/outletUuid';
import ActivitySegmentTabs from '@/components/customer/ActivitySegmentTabs';
import {
  formatScheduleLabel,
  isOngoingOrder,
  isOrderFinished,
  isScheduledOrder,
  parseActivityTab,
  scheduleAtOf,
  parsePickupSchedule,
  withScheduleNote,
  type ActivitySubTab
} from '@/lib/customerActivity';
import { updatePickupOrder } from '@/lib/pickupUpdates';
import { updateWithFallback } from '@/lib/safeWrite';
import { hasOnDutyDriverAtOutlet } from '@/lib/driverAttendance';
import {
  AlertTriangle,
  ArrowLeft,
  Box,
  Calendar,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  Gift,
  Headphones,
  History,
  Image as ImageIcon,
  Info,
  ListTodo,
  MapPin,
  Package,
  Paperclip,
  Pencil,
  Phone,
  Search,
  Send,
  Star,
  Truck,
  User,
  Wallet,
  X
} from 'lucide-react';

const supabase = createClient(
  'https://qlgbjvzabnfqmfnjdkmo.supabase.co',
  'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs'
);

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

const sortirPhotoOf = (order: any, logs?: any[]) =>
  order?.sortir_photo_url ||
  (logs || []).filter((l) => stageKeyOf(l?.stage) === 'sortir').slice(-1)[0]?.photo_url ||
  null;

function ProofPhotoGrid({
  order,
  logs,
  onOpen,
  compact
}: {
  order: any;
  logs?: any[];
  onOpen: (src: string) => void;
  compact?: boolean;
}) {
  const h = compact ? 'h-16' : 'h-24';
  const slots = [
    { label: 'Jemput', src: order?.photo_pickup_url || order?.photo_url },
    { label: 'Outlet', src: order?.photo_outlet_url },
    { label: 'Sortir', src: sortirPhotoOf(order, logs) },
    { label: 'Rak', src: order?.rack_photo_url },
    { label: 'Antar', src: order?.photo_delivery_url || order?.photo_antar_url || order?.delivery_photo_url }
  ];
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {slots.map((s) => (
        <div key={s.label} className="flex flex-col gap-1 min-w-0">
          <span className="text-[8px] font-bold text-slate-400 truncate">{s.label}</span>
          {s.src ? (
            <button type="button" onClick={() => onOpen(s.src)} className="block w-full">
              <img src={s.src} alt={s.label} className={`w-full ${h} object-cover rounded-lg border border-slate-200`} />
            </button>
          ) : (
            <div className={`w-full ${h} bg-slate-100 rounded-lg flex items-center justify-center text-slate-300`}>
              <ImageIcon className="w-4 h-4" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const cleanPhone = (phoneStr: string) => {
  if (!phoneStr) return '';
  let cleaned = phoneStr.trim().replace(/\D/g, '');
  if (cleaned.startsWith('62')) cleaned = '0' + cleaned.slice(2);
  return cleaned;
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
    return d.toISOString().split('T')[0];
  });
  const [pickupTime, setPickupTime] = useState('09:00');
  const [scheduleBusyId, setScheduleBusyId] = useState<string | null>(null);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [editScheduleDate, setEditScheduleDate] = useState('');
  const [editScheduleTime, setEditScheduleTime] = useState('09:00');
  const [activeSupportTab, setActiveSupportTab] = useState<'cs' | 'ai'>('cs');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerData, setCustomerData] = useState<any>(null);
  const [outletsList, setOutletsList] = useState<any[]>([]);
  const [filteredOutlets, setFilteredOutlets] = useState<any[]>([]);
  const [selectedOutlet, setSelectedOutlet] = useState('');
  const qrOutletLockRef = useRef(false);
  const skipAddressGeocodeRef = useRef(false);
  const [addressGeoStatus, setAddressGeoStatus] = useState<'idle' | 'searching' | 'found' | 'miss'>('idle');
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
  const [gpsCity, setGpsCity] = useState('');
  const [cityOverride, setCityOverride] = useState<string | null>(null);
  const [showAllCities, setShowAllCities] = useState(false);
  const [showcasePromos, setShowcasePromos] = useState<ShowcasePromo[]>([]);
  const [profileOutlet, setProfileOutlet] = useState<any | null>(null);
  const [locatingGps, setLocatingGps] = useState(false);

  const [isKiloanChecked, setIsKiloanChecked] = useState(false);
  const [selectedKiloanSvc, setSelectedKiloanSvc] = useState('');
  const [kiloanEstKg, setKiloanEstKg] = useState('3');
  const [kiloanQty, setKiloanQty] = useState('1');
  const [kiloanDuration, setKiloanDuration] = useState('Reguler (3 Hari)');
  const [cartKiloan, setCartKiloan] = useState<Array<{ name: string; kg: number; qty: number; duration: string; price: number }>>([]);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const [isSatuanChecked, setIsSatuanChecked] = useState(false);
  const [cartSatuan, setCartSatuan] = useState<Array<{ name: string; basePrice: number; price: number; qty: number; duration: string }>>([]);
  const [selectedSatuanSvc, setSelectedSatuanSvc] = useState('');
  const [inputSatuanQty, setInputSatuanQty] = useState('1');
  const [satuanInputDuration, setSatuanInputDuration] = useState('Reguler (3 Hari)');

  const [deliveryFee, setDeliveryFee] = useState<number | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [claimedPromo, setClaimedPromo] = useState<any>(null);
  const [showPromoModal, setShowPromoModal] = useState(false);
  const [showEstimateInfoModal, setShowEstimateInfoModal] = useState(false);
  const [latestCreatedOrder, setLatestCreatedOrder] = useState<any>(null);
  const [showOrderSuccessModal, setShowOrderSuccessModal] = useState(false);
  const [pendingCashierInvoice, setPendingCashierInvoice] = useState<any>(null);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

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
  const [hasValuables, setHasValuables] = useState('');
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
        customerAddress,
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
      let pendingByOutlet: Record<string, number> = {};
      if (dbOutlets && dbOutlets.length > 0) {
        const [{ data: pendingPickups }, { data: pendingTx }] = await Promise.all([
          supabase.from('pickup_orders').select('outlet_id, status').neq('status', 'Selesai').neq('status', 'Batal'),
          supabase.from('transactions').select('outlet_id, status').neq('status', 'Selesai')
        ]);
        [...(pendingPickups || []), ...(pendingTx || [])].forEach((row: any) => {
          if (row.outlet_id) pendingByOutlet[row.outlet_id] = (pendingByOutlet[row.outlet_id] || 0) + 1;
        });
        const open = dbOutlets.filter((o: any) => !o.is_coming_soon && !o.is_overcapacity && (pendingByOutlet[o.id] || 0) < 20);
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
          const pick = nearestOpenOutlet(visible, null, pendingByOutlet, calculateDistanceKm);
          if (pick) setSelectedOutlet(pick.id);
        }
      }

      const { data: dbSettings } = await supabase.from('app_settings').select('*').eq('id', 1).single();
      if (dbSettings) {
        const svcs = safeParse(dbSettings.dynamic_services, []);
        setDynamicServices(svcs);
        setOutletOverrides(safeParse(dbSettings.outlet_overrides, {}));

        const { data: dbPromos } = await supabase.from('promos').select('*');
        const fromTable = (dbPromos || []).map((p: any) => mapDbPromo(p)).filter((p: CatalogPromo) => p.is_active);
        const fromSettings = safeParse(dbSettings.promos_data, []).map((p: any, i: number) => mapSettingsPromo(p, i));
        setAvailablePromos(fromTable.length ? fromTable : fromSettings);

        const defaultKiloan = svcs.find((s: any) => s.type !== 'pcs') || svcs[0];
        const defaultSatuan = svcs.find((s: any) => s.type === 'pcs') || svcs[0];

        if (defaultKiloan) setSelectedKiloanSvc(defaultKiloan.name);
        if (defaultSatuan) setSelectedSatuanSvc(defaultSatuan.name);
      }

      const { data: bannerPromos } = await supabase.from('promotions').select('*').order('created_at', { ascending: false });
      if (bannerPromos) setShowcasePromos(bannerPromos);

      const savedPhone = localStorage.getItem('laundry_customer_phone');
      const savedAddr = localStorage.getItem('laundry_customer_address');
      if (savedAddr) setCustomerAddress(savedAddr);

      if (savedPhone) {
        setCustomerPhone(savedPhone);
        fetchCustomerProfile(savedPhone);
        loadCustomerAddresses(savedPhone).then((rows) => {
          setSavedAddresses(rows);
          const primary = primaryAddressOf(rows);
          if (primary) setCustomerAddress(primary);
        });
      }

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          setUserCoords({ lat, lon });

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
              const pick = nearestOpenOutlet(visible, { lat, lon }, {}, calculateDistanceKm);
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
      return;
    }

    const curOutlet = outletsList.find(o => o.id === selectedOutlet);
    if (curOutlet && userCoords && curOutlet.latitude && curOutlet.longitude) {
      const dist = calculateDistanceKm(userCoords.lat, userCoords.lon, Number(curOutlet.latitude), Number(curOutlet.longitude));
      const roundedDist = Math.round(dist * 10) / 10;
      setDistanceKm(roundedDist);

      let lalamoveOneWay = 9000;
      if (roundedDist > 3) {
        lalamoveOneWay += Math.ceil(roundedDist - 3) * 2000;
      }

      const roundTripFee = lalamoveOneWay * 2;
      setDeliveryFee(roundTripFee);
    } else {
      setDistanceKm(null);
      setDeliveryFee(18000);
    }
  }, [customerAddress, selectedOutlet, userCoords, outletsList]);

  useEffect(() => {
    if (!userCoords) return;
    let cancelled = false;
    reverseGeocodeCity(userCoords.lat, userCoords.lon).then((city) => {
      if (!cancelled && city) setGpsCity(city);
    });
    return () => {
      cancelled = true;
    };
  }, [userCoords]);

  useEffect(() => {
    const q = customerAddress.trim();
    if (skipAddressGeocodeRef.current) {
      skipAddressGeocodeRef.current = false;
      return;
    }
    if (q.length < 8) {
      setAddressGeoStatus('idle');
      return;
    }
    setAddressGeoStatus('searching');
    const t = window.setTimeout(() => {
      void geocodeAddress(q).then((pt) => {
        if (!pt) {
          setAddressGeoStatus('miss');
          return;
        }
        setAddressGeoStatus('found');
        setUserCoords({ lat: pt.lat, lon: pt.lng });
      });
    }, 900);
    return () => window.clearTimeout(t);
  }, [customerAddress]);

  const userCity = cityOverride || gpsCity;
  const nearbyCities = useMemo(() => {
    const fromOutlets = uniqueOutletCities(outletsList);
    if (gpsCity && !fromOutlets.some((c) => citiesMatch(c, gpsCity))) {
      return [gpsCity, ...fromOutlets];
    }
    return fromOutlets;
  }, [outletsList, gpsCity]);
  const nearbyItems = useMemo(
    () =>
      nearbyActiveOutlets(outletsList, userCoords, {
        city: showAllCities ? '' : userCity,
        ignoreCity: showAllCities || !userCity,
        maxKm: showAllCities ? Number.POSITIVE_INFINITY : MAX_NEARBY_RADIUS_KM
      }),
    [outletsList, userCoords, userCity, showAllCities]
  );

  const fetchCustomerProfile = async (phone: string) => {
    const norm = cleanPhone(phone);
    if (!norm) return;

    try {
      const { data: cust } = await supabase.from('customers').select('*').eq('phone', norm).limit(1);
      if (cust && cust.length > 0) {
        setCustomerData(cust[0]);
        if (cust[0].name) setCustomerName(cust[0].name);
      } else {
        setCustomerData({ name: customerName || 'Pelanggan', deposit_balance: 0 });
      }

      // Normalisasi format nomor HP (08xx atau 62xx)
    const altNorm = norm.startsWith('62')
    ? '0' + norm.slice(2)
    : norm.startsWith('0')
    ? '62' + norm.slice(1)
    : norm;

  // Tarik data pickup_orders langsung dengan query database
  const { data: pickupOrders } = await supabase
    .from('pickup_orders')
    .select('*')
    .or(`customer_phone.eq.${norm},customer_phone.eq.${altNorm},phone_number.eq.${norm},phone_number.eq.${altNorm}`)
    .order('created_at', { ascending: false });

  // Tarik data transactions langsung dengan query database
  const { data: posTransactions } = await supabase
    .from('transactions')
    .select('*')
    .or(`customer_phone.eq.${norm},customer_phone.eq.${altNorm}`)
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
    return {
      ...t,
      status: overlayStatus,
      pickup_id: t.pickup_id || relatedPickup?.id,
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
        photo_pickup_url: p.photo_pickup_url || p.photo_url,
        photo_outlet_url: p.photo_outlet_url,
        photo_delivery_url: p.photo_delivery_url || p.photo_antar_url || p.delivery_photo_url,
        rack_photo_url: p.rack_photo_url,
        sortir_photo_url: p.sortir_photo_url
      });
    }
  });

  setActiveOrders(mergedActive);

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

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const norm = cleanPhone(customerPhone);
    if (!norm) return alert('Ketik nomor WA aktif!');
    localStorage.setItem('laundry_customer_phone', norm);
    setCustomerData({ name: 'Pelanggan Setia', deposit_balance: 0 });
    fetchCustomerProfile(norm);
    loadCustomerAddresses(norm).then((rows) => {
      setSavedAddresses(rows);
      const primary = primaryAddressOf(rows);
      if (primary) setCustomerAddress(primary);
    });
  };

  const handleLogout = () => {
    localStorage.removeItem('laundry_customer_phone');
    setCustomerPhone('');
    setCustomerData(null);
    setSavedAddresses([]);
    setActiveTab('home');
    setActiveChatOrderId(null);
  };

  const syncPrimaryAddress = (rows: SavedAddress[]) => {
    setSavedAddresses(rows);
    const primary = primaryAddressOf(rows);
    if (primary) setCustomerAddress(primary);
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
        setUserCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setLocatingGps(false);
      },
      () => setLocatingGps(false)
    );
  };

  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) {
      return alert('Browser/HP Anda tidak mendukung deteksi lokasi otomatis.');
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setUserCoords({ lat: latitude, lon: longitude });
        const label = await reverseGeocodeAddress(latitude, longitude);
        if (label) {
          skipAddressGeocodeRef.current = true;
          setCustomerAddress(label);
        }
        alert(
          label
            ? 'Lokasi GPS terdeteksi. Alamat terisi otomatis — geser pin ke gerbang jika perlu.'
            : `Lokasi GPS berhasil. Geser pin ke rumah/gerbang. (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`
        );
      },
      (err) => {
        console.error('Gagal ambil GPS:', err);
        alert('Gagal mengambil lokasi GPS. Pastikan izin lokasi/GPS di HP Anda aktif.');
      },
      { enableHighAccuracy: true }
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

  const handleAddKiloanToCart = () => {
    if (!selectedKiloanSvc) return;
    const kg = Math.max(3, Number(kiloanEstKg) || 3);
    const qty = Math.max(1, Number(kiloanQty) || 1);
    setCartKiloan((prev) => [
      ...prev,
      { name: selectedKiloanSvc, kg, qty, duration: kiloanDuration, price: kiloanActiveUnitPrice }
    ]);
    setKiloanEstKg('3');
    setKiloanQty('1');
  };

  const handleRemoveKiloan = (idx: number) => {
    setCartKiloan((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleAddSatuanToCart = () => {
    if (!selectedSatuanSvc) return;
    const basePrice = getServiceUnitPrice(selectedSatuanSvc);
    const qty = Number(inputSatuanQty) || 1;
    const mult = getDurationMultiplier(satuanInputDuration);
    const finalPrice = Math.round(basePrice * mult);

    setCartSatuan([...cartSatuan, { 
      name: selectedSatuanSvc, 
      basePrice, 
      price: finalPrice, 
      qty, 
      duration: satuanInputDuration 
    }]);
    setInputSatuanQty('1');
  };

  const handleRemoveSatuan = (idx: number) => {
    setCartSatuan(cartSatuan.filter((_, i) => i !== idx));
  };

  const kiloanBaseUnitPrice = getServiceUnitPrice(selectedKiloanSvc);
  const kiloanActiveUnitPrice = Math.round(kiloanBaseUnitPrice * getDurationMultiplier(kiloanDuration));
  const kiloanLines = cartKiloan.length
    ? cartKiloan
    : isKiloanChecked
    ? [{ name: selectedKiloanSvc, kg: Math.max(3, Number(kiloanEstKg) || 3), qty: Math.max(1, Number(kiloanQty) || 1), duration: kiloanDuration, price: kiloanActiveUnitPrice }]
    : [];
  const kiloanSubtotal = kiloanLines.reduce((sum, line) => sum + kiloanLineTotal(line.price, line.kg), 0);

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
  const grandTotalEstimate = Math.max(0, Math.round(rawSubtotal + rawOngkir - promoDiscountVal));

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

  const handleOrderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerPhone) return alert('Login terlebih dahulu!');
    if (!customerAddress || customerAddress.trim().length < 5) {
      return alert('Isi Alamat Penjemputan terlebih dahulu!');
    }
    if (!isKiloanChecked && !kiloanLines.length && (!isSatuanChecked || cartSatuan.length === 0)) {
      return alert('Pilih minimal 1 paket Kiloan atau Satuan!');
    }
    if (courierType === 'INTERNAL' && !internalDriverOnDuty) {
      alert('Driver internal cabang ini sedang tidak bertugas. Silakan pilih kurir instan/antar mandiri.');
      return;
    }
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
      const items = cartSatuan.map(i => `${i.name} x${i.qty}`).join(', ');
      detailLines.push(`Satuan: ${items}`);
    }
    if (claimedPromo) detailLines.push(`Promo: ${claimedPromo.title}`);
    detailLines.push(`Est. Tagihan: Rp ${grandTotalEstimate.toLocaleString('id-ID')}`);

    const mainServiceLabel = kiloanLines.length
      ? `${kiloanLines[0].name} (${kiloanLines[0].duration})`
      : `Satuan (${cartSatuan.length} Item)`;
    const notesCombined = `Alamat: ${customerAddress} | Detail: ${detailLines.join(' | ')}${notes ? ` | Catatan: ${notes}` : ''}`;
    const autoOrderNo = `ORD-${Date.now().toString().slice(-8)}`;

    const nowIso = new Date().toISOString();
    const todayDateStr = nowIso.split('T')[0];
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

    const detailInfo = `[INFO CUCIAN] Kantong: ${bagCount} | Cuci: ${washProcess} | Luntur: ${hasFading} | Brg Berharga: ${hasValuables}`;
    const baseNotes = notesCombined ? `${detailInfo} | ${notesCombined}` : detailInfo;
    const finalNotes = isFuturePickup && schedule ? withScheduleNote(baseNotes, schedule.date, schedule.time.slice(0, 5)) : baseNotes;

    // Rincian item satuan dikirim terstruktur agar POS bisa memuatnya langsung ke
    // keranjang nota. Kiloan tidak dimasukkan karena beratnya baru pasti setelah ditimbang kasir.
    const satuanItems = isSatuanChecked
      ? cartSatuan.map((i) => ({
          name: i.name,
          qty: Number(i.qty) || 1,
          price: Number(i.price) || 0,
          basePrice: Number(i.basePrice) || 0,
          duration: i.duration || 'Reguler (3 Hari)',
          type: 'pcs' as const
        }))
      : [];
    const kiloanItems = kiloanLines.map((k) => ({
      name: k.name,
      qty: Number(k.qty) || 1,
      weight: Number(k.kg) || 3,
      price: Number(k.price) || 0,
      duration: k.duration || 'Reguler (3 Hari)',
      type: 'kg' as const
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
      address: customerAddress || '',
      formatted_address: customerAddress || '',
      latitude: userCoords?.lat ?? null,
      longitude: userCoords?.lon ?? null,
      address_id: (() => {
        const id = savedAddresses.find((a) => a.full_address === customerAddress)?.id || '';
        return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
      })(),
      duration: kiloanDuration || 'Reguler (3 Hari)',
      bag_count: Number(bagCount) || 1,
      wash_process: washProcess || 'Pisah',
      has_fading: hasFading === 'Ya',
      has_valuables: hasValuables === 'Ya',
      items: itemsPayload,
      delivery_fee: Number(finalOngkir) || 0,
      notes: finalNotes,
      pickup_date: isFuturePickup && schedule ? schedule.date : todayDateStr,
      pickup_time: isFuturePickup && schedule ? schedule.time : undefined,
      scheduled_at: isFuturePickup && schedule ? schedule.iso : undefined,
      pickup_at: isFuturePickup && schedule ? schedule.iso : undefined,
      status: isFuturePickup ? 'Terjadwal' : 'Menunggu Kurir',
      courier_type: isFuturePickup ? null : courierType || 'INTERNAL'
    };

    const { data: insertedData, error } = await insertPickupOrder(payload);

    if (!error && insertedData && insertedData.length > 0) {
      if (!isFuturePickup) {
        await createPickupRoleTasks({
          id: insertedData[0].id,
          customer_name: payload.customer_name as string,
          customer_phone: normPhone,
          outlet_id: selectedOutlet
        });
      }
      if (userCoords && customerAddress) {
        const match = savedAddresses.find((a) => a.full_address === customerAddress);
        if (match) {
          void upsertCustomerAddress(normPhone, savedAddresses, {
            id: match.id,
            label: match.label,
            full_address: match.full_address,
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
      setKiloanEstKg('3');
      setKiloanQty('1');
      setKiloanDuration('Reguler (3 Hari)');
      setIsKiloanChecked(false);
      setIsSatuanChecked(false);
      setPickupLater(false);

      goActivity(isFuturePickup ? 'terjadwal' : 'berlangsung');
      fetchCustomerProfile(normPhone);
    } else {
      alert('Gagal membuat pesanan: ' + (error?.message || 'Koneksi bermasalah'));
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
    <div className="min-h-screen bg-slate-100 text-slate-800 p-4 md:p-6 pb-32 max-w-md mx-auto relative font-sans">
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
          <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
            <Phone className="w-6 h-6" />
          </div>
          <div className="text-center">
            <h3 className="text-base font-extrabold text-slate-900">Masuk Aplikasi</h3>
            <p className="text-xs text-slate-500 mt-1">Ketik Nomor WhatsApp Anda untuk melihat saldo deposit & status pesanan.</p>
          </div>
          <input
            type="tel"
            placeholder="Contoh: 08123456789"
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
            className="w-full bg-slate-50 border border-slate-300 rounded-2xl px-4 py-3.5 text-sm font-bold text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition"
            required
          />
          <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-4 rounded-2xl text-xs uppercase shadow-lg shadow-blue-200 transition">
            Lanjutkan
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
              <div className="grid grid-cols-3 gap-2">
                <LoyaltyProfileCard
                  phone={customerPhone}
                  name={customerData.name || customerName}
                  outletId={selectedOutlet}
                />
                <button
                  type="button"
                  onClick={() => setActiveTab('order')}
                  className="bg-white border border-slate-200 p-3 rounded-3xl flex flex-col gap-2 hover:border-blue-500 transition shadow-sm text-left min-w-0"
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
            <form onSubmit={handleOrderSubmit} className="space-y-4 pb-32">
              <div className="bg-white border border-slate-200 p-5 rounded-3xl space-y-4 shadow-sm">
                <div className="border-b border-slate-100 pb-3">
                  <h3 className="text-sm font-extrabold text-slate-900">Form Order Penjemputan</h3>
                  <p className="text-[11px] text-slate-500">Layanan Jemput-Antar Langsung ke Kasir POS</p>
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">Outlet Terdekat di Kota Anda</label>
                  <select
                    value={selectedOutlet}
                    onChange={(e) => chooseOutlet(e.target.value, { clearQuery: true })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-2xl px-3.5 py-3 text-xs font-bold text-slate-800"
                  >
                    {filteredOutlets.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5 mt-3">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-extrabold text-slate-500 uppercase">Alamat Penjemputan *</label>
                    <button
                      type="button"
                      onClick={handleGetCurrentLocation}
                      className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-lg hover:bg-indigo-100 inline-flex items-center gap-1 transition"
                    >
                      <MapPin className="w-3 h-3" />
                      <span>{userCoords ? 'GPS Terdeteksi' : 'Ambil Lokasi GPS Presisi'}</span>
                    </button>
                  </div>
                  <textarea
                    value={customerAddress}
                    onChange={(e) => setCustomerAddress(e.target.value)}
                    placeholder="Ketik alamat lengkap (Jalan, No. Rumah, Patokan) — pin peta akan ikut pindah..."
                    className="w-full bg-slate-50 border border-slate-300 rounded-2xl p-3 text-xs font-bold text-slate-800 focus:outline-none"
                    rows={2}
                  />
                  {addressGeoStatus === 'searching' && (
                    <p className="text-[9px] text-indigo-600 font-bold">Mencari titik di peta dari alamat…</p>
                  )}
                  {addressGeoStatus === 'miss' && (
                    <p className="text-[9px] text-amber-700 font-bold">Alamat belum ketemu di peta. Geser pin secara manual ke rumah/gerbang.</p>
                  )}
                  <PinpointMap
                    value={userCoords ? { lat: userCoords.lat, lng: userCoords.lon } : null}
                    onChange={(pt) => setUserCoords({ lat: pt.lat, lon: pt.lng })}
                    onGps={handleGetCurrentLocation}
                  />
                  {savedAddresses.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {savedAddresses.map((addr) => (
                        <button
                          key={addr.id}
                          type="button"
                          onClick={() => {
                            skipAddressGeocodeRef.current = true;
                            setCustomerAddress(addr.full_address);
                            setAddressGeoStatus('idle');
                            if (addr.latitude != null && addr.longitude != null) {
                              setUserCoords({ lat: Number(addr.latitude), lon: Number(addr.longitude) });
                            } else {
                              skipAddressGeocodeRef.current = false;
                              setUserCoords(null);
                            }
                          }}
                          className={`text-[10px] font-extrabold px-2.5 py-1 rounded-lg border ${
                            customerAddress === addr.full_address
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-slate-600 border-slate-200'
                          }`}
                        >
                          {addr.label}{addr.is_primary ? ' · Utama' : ''}
                        </button>
                      ))}
                    </div>
                  )}
                  {userCoords && (
                    <p className="text-[9px] text-emerald-600 font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Lat: {userCoords.lat.toFixed(5)}, Lon: {userCoords.lon.toFixed(5)} (Pinpoint tersimpan)
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">Nama Lengkap Pemesan</label>
                  <input
                    type="text"
                    placeholder="Nama Anda"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-2xl px-4 py-3 text-xs font-semibold text-slate-800"
                    required
                  />
                </div>

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

                <div className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100 space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isKiloanChecked}
                      onChange={(e) => setIsKiloanChecked(e.target.checked)}
                      className="w-4 h-4 accent-blue-600 rounded"
                    />
                    <span className="text-xs font-extrabold text-blue-900 inline-flex items-center gap-1.5">
                      <img src="/assets/icons/washing-machine.svg" alt="" className="w-7 h-7" /> Paket Laundry Kiloan
                    </span>
                  </label>

                  {isKiloanChecked && (
                    <div className="space-y-2.5 pt-2 border-t border-blue-100">
                      <div>
                        <label className="block text-[10px] text-slate-500 font-bold mb-1">Pilih Jenis Kiloan</label>
                        <select
                          value={selectedKiloanSvc}
                          onChange={(e) => setSelectedKiloanSvc(e.target.value)}
                          className="w-full bg-white border border-blue-200 rounded-xl p-2.5 text-xs font-bold text-slate-800"
                        >
                          {kiloanServicesList.map((svc, i) => (
                            <option key={i} value={svc.name}>{svc.name}</option>
                          ))}
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-slate-500 font-bold mb-1 inline-flex items-center gap-1">
                            Durasi Kiloan <SlaBadge duration={kiloanDuration} />
                          </label>
                          <select
                            value={kiloanDuration}
                            onChange={(e) => setKiloanDuration(e.target.value)}
                            className="w-full bg-amber-50 border border-amber-300 rounded-xl p-2 text-xs font-extrabold text-amber-800"
                          >
                            <option value="Reguler (3 Hari)">Reguler 3 Hari</option>
                            <option value="Oneday">Oneday (+50%)</option>
                            <option value="Express">Express 6 Jam (+100%)</option>
                            <option value="Quick">Quick 3 Jam (+200%)</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-500 font-bold mb-1">Estimasi (Kg)</label>
                          <div className="flex items-center gap-1">
                            <StepperBtn
                              variant="minus"
                              disabled={Number(kiloanEstKg) <= 3}
                              onClick={() => setKiloanEstKg(String(Math.max(3, (Number(kiloanEstKg) || 3) - 1)))}
                            />
                            <input
                              type="number"
                              min="3"
                              value={kiloanEstKg}
                              onChange={(e) => setKiloanEstKg(String(Math.max(3, Number(e.target.value) || 3)))}
                              className="w-full bg-white border border-blue-200 rounded-xl p-2 text-xs font-extrabold text-blue-700 text-center"
                            />
                            <StepperBtn
                              variant="plus"
                              onClick={() => setKiloanEstKg(String((Number(kiloanEstKg) || 3) + 1))}
                            />
                          </div>
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 font-bold mb-1">Jumlah Pcs</label>
                        <div className="flex items-center gap-1">
                          <StepperBtn variant="minus" disabled={Number(kiloanQty) <= 1} onClick={() => setKiloanQty(String(Math.max(1, (Number(kiloanQty) || 1) - 1)))} />
                          <input type="number" min="1" value={kiloanQty} onChange={(e) => setKiloanQty(String(Math.max(1, Number(e.target.value) || 1)))} className="w-full bg-white border border-blue-200 rounded-xl p-2 text-xs font-extrabold text-center" />
                          <StepperBtn variant="plus" onClick={() => setKiloanQty(String((Number(kiloanQty) || 1) + 1))} />
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-400 font-medium">
                        Jumlah Pcs hanya catatan kasir (contoh: 4 Kg berisi 10 Pcs), tidak mengubah harga.
                      </p>
                      <p className="text-[10px] bg-blue-50 border border-blue-100 text-blue-800 rounded-xl px-2.5 py-1.5 font-semibold">
                        Info: Minimal 3kg per order (1 Mesin Cuci = 1 Customer, pakaian tidak dicampur)
                      </p>
                      <p className="text-[10px] text-blue-600 font-bold text-right">
                        Harga: Rp {kiloanActiveUnitPrice.toLocaleString('id-ID')}/Kg · Total Rp {kiloanLineTotal(kiloanActiveUnitPrice, Math.max(3, Number(kiloanEstKg) || 3)).toLocaleString('id-ID')}
                      </p>
                      <button type="button" onClick={handleAddKiloanToCart} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl text-xs shadow-sm inline-flex items-center justify-center gap-1.5">
                        Tambah Paket Kiloan Ini
                      </button>
                      {cartKiloan.length > 0 && (
                        <div className="space-y-1.5">
                          {cartKiloan.map((item, idx) => (
                            <div key={idx} className="bg-white p-2.5 rounded-xl flex justify-between items-center text-xs border border-blue-100">
                              <div>
                                <span className="font-bold text-slate-800 block">{item.name} · {item.kg} Kg</span>
                                <span className="text-[9px] text-slate-500 font-semibold">{item.qty} Pcs (catatan)</span>
                                <span className="text-[9px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded font-bold ml-1">{item.duration}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="font-extrabold text-blue-600">Rp {kiloanLineTotal(item.price, item.kg).toLocaleString('id-ID')}</span>
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
                            Durasi Item Ini <SlaBadge duration={satuanInputDuration} />
                          </label>
                          <select
                            value={satuanInputDuration}
                            onChange={(e) => setSatuanInputDuration(e.target.value)}
                            className="w-full bg-amber-50 border border-amber-300 rounded-xl p-2 text-xs font-extrabold text-amber-800"
                          >
                            <option value="Reguler (3 Hari)">Reguler 3 Hari</option>
                            <option value="Oneday (1 Hari / 24 Jam)">Oneday (+50%)</option>
                            <option value="Express (6 Jam)">Express 6 Jam (+100%)</option>
                            <option value="Quick (3 Jam)">Quick 3 Jam (+200%)</option>
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

                      <button
                        type="button"
                        onClick={handleAddSatuanToCart}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl text-xs shadow-sm"
                      >
                        Tambah Item Satuan Ini
                      </button>

                      {cartSatuan.length > 0 && (
                        <div className="space-y-1.5 pt-2">
                          {cartSatuan.map((item, idx) => (
                            <div key={idx} className="bg-white p-2.5 rounded-xl flex justify-between items-center text-xs border border-slate-200 shadow-sm">
                              <div>
                                <span className="font-bold text-slate-800 block">{item.name} x{item.qty}</span>
                                <span className="text-[9px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded font-bold">{item.duration}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="font-extrabold text-blue-600">Rp {(item.price * item.qty).toLocaleString('id-ID')}</span>
                                <button type="button" onClick={() => handleRemoveSatuan(idx)} className="text-rose-500 p-1 rounded-full hover:bg-rose-50" aria-label="Hapus">
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

                <div className="bg-slate-800/80 border border-slate-700/80 p-4 rounded-2xl space-y-3.5 my-4">
                  <h3 className="text-xs font-black tracking-wider uppercase text-cyan-400 flex items-center gap-2">
                    <ClipboardList className="w-4 h-4" /> Informasi Detail Cucian
                  </h3>

                  <div className="space-y-3 text-xs text-slate-200">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-slate-300">1. Jumlah Kantong:</span>
                      <select
                        value={bagCount}
                        onChange={(e) => setBagCount(e.target.value)}
                        className="bg-slate-900 border border-slate-700 text-cyan-400 font-extrabold rounded-xl px-3 py-1.5 focus:outline-none"
                      >
                        <option value="">-- Pilih Jumlah Kantong --</option>
                        <option value="1 Kantong">1 Kantong</option>
                        <option value="2 Kantong">2 Kantong</option>
                        <option value="3 Kantong">3 Kantong</option>
                        <option value="4+ Kantong">4+ Kantong</option>
                      </select>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-slate-300">2. Proses Cuci:</span>
                      <select
                        value={washProcess}
                        onChange={(e) => setWashProcess(e.target.value)}
                        className="bg-slate-900 border border-slate-700 text-cyan-400 font-extrabold rounded-xl px-3 py-1.5 focus:outline-none"
                      >
                        <option value="">-- Pilih Proses Cuci --</option>
                        <option value="Gabung Semua">Gabung Semua</option>
                        <option value="Pisah Perkantong">Pisah Perkantong</option>
                      </select>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-slate-300">3. Ada Pakaian Luntur?</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setHasFading('Tidak')}
                          className={`px-3 py-1 rounded-xl font-extrabold text-xs transition ${hasFading === 'Tidak' ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20' : 'bg-slate-900 border border-slate-700 text-slate-400'}`}
                        >
                          Tidak
                        </button>
                        <button
                          type="button"
                          onClick={() => setHasFading('Ya')}
                          className={`px-3 py-1 rounded-xl font-extrabold text-xs transition ${hasFading === 'Ya' ? 'bg-rose-500 text-white shadow-md shadow-rose-500/20' : 'bg-slate-900 border border-slate-700 text-slate-400'}`}
                        >
                          Ya
                        </button>
                      </div>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-slate-300">4. Ada Barang Berharga?</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setHasValuables('Tidak')}
                          className={`px-3 py-1 rounded-xl font-extrabold text-xs transition ${hasValuables === 'Tidak' ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20' : 'bg-slate-900 border border-slate-700 text-slate-400'}`}
                        >
                          Tidak
                        </button>
                        <button
                          type="button"
                          onClick={() => setHasValuables('Ya')}
                          className={`px-3 py-1 rounded-xl font-extrabold text-xs transition ${hasValuables === 'Ya' ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20' : 'bg-slate-900 border border-slate-700 text-slate-400'}`}
                        >
                          Ya
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-indigo-50/70 border border-indigo-100 rounded-2xl p-3.5 space-y-3">
                  <label className="flex items-center justify-between gap-3 cursor-pointer">
                    <span className="text-xs font-extrabold text-slate-800 inline-flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-indigo-600" /> Jadwalkan jemput
                    </span>
                    <input
                      type="checkbox"
                      checked={pickupLater}
                      onChange={(e) => setPickupLater(e.target.checked)}
                      className="w-4 h-4 accent-indigo-600 rounded"
                    />
                  </label>
                  {pickupLater && (
                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-indigo-100">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">Tanggal</label>
                        <input
                          type="date"
                          min={new Date().toISOString().split('T')[0]}
                          value={pickupDate}
                          onChange={(e) => setPickupDate(e.target.value)}
                          className="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-800"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">Jam</label>
                        <input
                          type="time"
                          value={pickupTime}
                          onChange={(e) => setPickupTime(e.target.value)}
                          className="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-800"
                        />
                      </div>
                      <p className="col-span-2 text-[10px] text-slate-500">
                        Driver baru ditugaskan mendekati jadwal. Pesanan tampil di tab Terjadwal.
                      </p>
                    </div>
                  )}
                </div>

                <input
                  type="text"
                  placeholder="Catatan Penjemputan (misal: Tolong ambil jam 2)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-2xl p-3.5 text-xs text-slate-800 font-medium"
                />

                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-1.5 text-xs">
                  <div className="flex justify-between text-slate-500 font-medium"><span>Subtotal Kiloan:</span><span>Rp {kiloanSubtotal.toLocaleString('id-ID')}</span></div>
                  <div className="flex justify-between text-slate-500 font-medium"><span>Subtotal Satuan:</span><span>Rp {satuanSubtotal.toLocaleString('id-ID')}</span></div>
                  
                  <div className="flex justify-between text-slate-700 font-bold border-t border-slate-200/80 pt-1.5">
                    <span>Ongkir Antar-Jemput{isInternalDriver ? '' : ` Motor ${distanceKm ? `(${distanceKm} Km PP)` : 'PP'}`}:</span>
                    <span>
                      {isInternalDriver
                        ? 'Rp 0 (FREE)'
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

                  <div className="flex justify-between items-center font-black text-blue-600 text-sm border-t border-slate-200 pt-2 mt-1">
                    <div className="flex items-center gap-1.5">
                      <span>ESTIMASI TOTAL:</span>
                      <button
                        type="button"
                        onClick={() => setShowEstimateInfoModal(true)}
                        className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 hover:bg-blue-200 flex items-center justify-center border border-blue-200"
                        title="Informasi Estimasi Harga"
                      >
                        <Info className="w-3 h-3" />
                      </button>
                    </div>
                    <span>Rp {grandTotalEstimate.toLocaleString('id-ID')}</span>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 p-4 rounded-2xl space-y-3">
                  <label className="text-xs font-extrabold text-slate-700 block">Pilih Metode Penjemputan</label>
                  
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
                        Ongkos mulai dari Rp 20.000 (Sudah Pickup & Delivery) • Waktu Tunggu 20–30 Menit • Dipesankan oleh CS
                      </p>
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-4 rounded-2xl text-xs uppercase shadow-lg shadow-blue-200 transition inline-flex items-center justify-center gap-2"
                >
                  <Truck className="w-4 h-4" /> Pesan Sekarang
                </button>
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
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-2xl text-xs shadow inline-flex items-center justify-center gap-2"
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
                            </div>
                            <StatusPill status={order.status || 'Menunggu Kurir'} />
                          </div>

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
                              <span className="text-[10px] text-slate-400 block font-normal">Total Estimasi</span>
                              <span className="font-extrabold text-slate-900 text-sm">
                                Rp {(order.amount || order.total_amount || order.estimated_price || 0).toLocaleString('id-ID')}
                              </span>
                            </div>
                          </div>

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
                              className="bg-blue-50/80 border border-blue-100 p-3 rounded-xl space-y-1.5 text-xs mt-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex justify-between items-center">
                                <span className="font-bold text-blue-900 flex items-center gap-1 text-[11px]">
                                  <MapPin className="w-3.5 h-3.5" /> Driver Sedang Menuju Lokasi
                                </span>
                                <a
                                  href={`https://maps.google.com/?q=${order.driver_lat},${order.driver_lon}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="bg-blue-600 text-white font-bold text-[10px] px-2.5 py-1 rounded-lg shadow-sm inline-flex items-center gap-1"
                                >
                                  Buka Peta Live <ChevronRight className="w-3 h-3" />
                                </a>
                              </div>
                              <p className="text-[10px] text-blue-600">Posisi driver diperbarui secara otomatis.</p>
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
                                min={new Date().toISOString().split('T')[0]}
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
                            <span className="font-black text-blue-600 text-xs">
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
                            className="bg-blue-50 text-blue-700 text-[10px] font-extrabold py-2 rounded-xl border border-blue-100"
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
                  <p className="font-mono text-blue-600 font-extrabold mt-0.5">{customerPhone}</p>
                </div>

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

      {/* MODAL INFORMASI CREDENTIAL ESTIMASI TOTAL */}
      {showEstimateInfoModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[90] flex items-center justify-center p-4" onClick={() => setShowEstimateInfoModal(false)}>
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl text-center" onClick={(e) => e.stopPropagation()}>
            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
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
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-3 rounded-2xl text-xs uppercase shadow-md transition"
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
  <div className="fixed inset-0 z-[55] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { setDetailOrder(null); setComplaintOpen(false); setReviewOpen(false); }}>
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
          <p className="text-[11px] font-semibold text-indigo-800">Estimasi Selesai: {formatEstSelesai(detailOrder)}</p>
          <p className="text-[11px] font-semibold text-indigo-800">
            Status Cucian: {displayStatusLabel(detailOrder.status, detailOrder) || 'Menunggu'}
          </p>
        </div>

        {/* Rincian Items + harga */}
        <div className="space-y-2">
          <h4 className="font-extrabold text-slate-800 uppercase text-[10px] inline-flex items-center gap-1">
            <Package className="w-3.5 h-3.5" /> Rincian Item & Harga
          </h4>
          {(() => {
            const items = Array.isArray(detailOrder.items)
              ? detailOrder.items
              : safeParse(detailOrder.items, []);
            if (Array.isArray(items) && items.length > 0) {
              return (
                <div className="space-y-1.5">
                  {items.map((it: any, idx: number) => (
                    <div key={idx} className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 flex justify-between items-center gap-2">
                      <div>
                        <span className="font-bold text-slate-800 block">{it.name || it.service_type || 'Item Cucian'}</span>
                        <span className="text-[10px] text-slate-500">
                          {it.weight ? `${it.weight} Kg` : ''} {it.qty ? `${it.qty} Pcs` : ''}
                          {it.duration ? ` · ${it.duration}` : ''}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="font-black text-slate-900 block">
                          Rp {displayItemAmount(it).toLocaleString('id-ID')}
                        </span>
                        <span className="px-2 py-0.5 bg-slate-200 text-slate-700 font-bold text-[10px] rounded-md">
                          {displayStatusLabel(it.status || detailOrder.status, detailOrder) || 'Proses'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              );
            }
            return (
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <p className="text-slate-600 font-medium">
                  {detailOrder.notes || 'Detail item telah dicatat oleh kasir/driver.'}
                </p>
              </div>
            );
          })()}
          <div className="bg-white border border-slate-100 rounded-xl p-2.5 space-y-1">
            {Number(detailOrder.delivery_fee) > 0 && (
              <div className="flex justify-between text-[10px] text-slate-500">
                <span>Ongkir</span>
                <span>Rp {Number(detailOrder.delivery_fee).toLocaleString('id-ID')}</span>
              </div>
            )}
            <div className="flex justify-between font-black text-slate-900">
              <span>Total</span>
              <span>
                Rp {Number(detailOrder.amount || detailOrder.price || detailOrder.estimated_price || 0).toLocaleString('id-ID')}
              </span>
            </div>
          </div>
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

        {/* Bukti Foto: jemput → outlet → sortir → rak → antar */}
        <div className="space-y-2">
          <h4 className="font-extrabold text-slate-800 uppercase text-[10px] inline-flex items-center gap-1">
            <ImageIcon className="w-3.5 h-3.5" /> Bukti Foto Cucian
          </h4>
          <ProofPhotoGrid order={detailOrder} logs={detailWorkLogs} onOpen={setLightboxSrc} />
        </div>

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
