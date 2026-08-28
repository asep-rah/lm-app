'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import StageTimeline from '@/components/StageTimeline';
import { insertChatMessage, isStaffOnlyMessage } from '@/lib/csChat';
import { mapDbPromo, mapSettingsPromo, promoDiscountRp, promoIsClaimable, type CatalogPromo } from '@/lib/promoCatalog';
import { createPickupRoleTasks, insertPickupOrder, createDeliveryRequestTasks } from '@/lib/pickupDispatch';
import { updatePickupOrder } from '@/lib/pickupUpdates';
import { laundryFallbackReply } from '@/lib/laundryFaq';
import AIChatWidget from '@/components/AIChatWidget';

const supabase = createClient(
  'https://qlgbjvzabnfqmfnjdkmo.supabase.co',
  'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs'
);

const safeParse = (data: any, fallback: any) => {
  if (!data) return fallback;
  if (typeof data === 'object') return data;
  try { return JSON.parse(data); } catch (e) { return fallback; }
};

// Tetap di Beranda sepanjang proses. Pindah Riwayat hanya setelah diserahkan
// (Selesai / Delivered / Terkirim) atau dibatalkan — bukan saat Siap Diambil.
const isOrderFinished = (order: any) => {
  const st = String(order?.status || '').toLowerCase().trim();
  if (!st) return false;
  if (st.includes('siap')) return false;
  if (st.includes('packing') || st.includes('cuci') || st.includes('setrika') || st.includes('sortir') || st.includes('jemput') || st.includes('tiba') || st.includes('proses') || st.includes('ering') || st.includes('emas')) {
    return false;
  }
  if (st.includes('batal') || st.includes('cancel')) return true;
  if (st === 'diambil' || st.includes('sudah diambil') || st.includes('telah diambil')) return true;
  return (
    st.includes('delivered') ||
    st.includes('terkirim') ||
    st === 'selesai' ||
    (st.includes('selesai') && !st.includes('pack'))
  );
};

const isDeliveryInProgress = (order: any) => {
  const st = String(order?.status || '').toLowerCase();
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

export default function CustomerDashboardPage() {
  const [detailOrder, setDetailOrder] = useState<any>(null);
  const [detailWorkLogs, setDetailWorkLogs] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'home' | 'order' | 'deposit' | 'history' | 'profile'>('home');
  const [activeSupportTab, setActiveSupportTab] = useState<'cs' | 'ai'>('cs');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerData, setCustomerData] = useState<any>(null);
  const [outletsList, setOutletsList] = useState<any[]>([]);
  const [filteredOutlets, setFilteredOutlets] = useState<any[]>([]);
  const [selectedOutlet, setSelectedOutlet] = useState('');

  const [dynamicServices, setDynamicServices] = useState<any[]>([]);
  const [outletOverrides, setOutletOverrides] = useState<any>({});
  const [availablePromos, setAvailablePromos] = useState<any[]>([]);

  const [customerName, setCustomerName] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const [userCoords, setUserCoords] = useState<{ lat: number; lon: number } | null>(null);

  const [isKiloanChecked, setIsKiloanChecked] = useState(false);
  const [selectedKiloanSvc, setSelectedKiloanSvc] = useState('');
  const [kiloanEstKg, setKiloanEstKg] = useState('3');
  const [kiloanDuration, setKiloanDuration] = useState('Reguler (3 Hari)');

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

// Fungsi Trigger Xendit Top-Up
const handleTopupXendit = async (priceAmount: number, packageName: string) => {
  try {
    setIsSubmitting(true);
    const res = await fetch('/api/qris/charge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: priceAmount,
        customerName: customerData?.name || 'Pelanggan',
        customerPhone: customerPhone,
        description: `Top-Up Deposit ${packageName}`,
        type: 'deposit'
      })
    });
    const data = await res.json();
    if (data.invoiceUrl) {
      window.location.href = data.invoiceUrl;
    } else {
      alert('Gagal: ' + (data.error || 'Terjadi kesalahan'));
    }
  } catch (err: any) {
    alert('Koneksi gagal: ' + err.message);
  } finally {
    setIsSubmitting(false);
  }
};
  const [bagCount, setBagCount] = useState('');
  const [washProcess, setWashProcess] = useState('');
  const [hasFading, setHasFading] = useState('');
  const [hasValuables, setHasValuables] = useState('');
  const [thirdPartyVendor, setThirdPartyVendor] = useState('');

  const [courierType, setCourierType] = useState<'' | 'INTERNAL' | 'THIRD_PARTY'>('');
  const [queueCount, setQueueCount] = useState<number>(0);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [inputChat, setInputChat] = useState<string>('');
  const [activeChatOrderId, setActiveChatOrderId] = useState<string | null>(null);

  useEffect(() => {
    const fetchQueue = async () => {
      const { count } = await supabase
        .from('pickup_orders')
        .select('*', { count: 'exact', head: true })
        .in('status', ['Baru Masuk', 'Driver Menuju Lokasi']);
      setQueueCount(count || 0);
    };
    fetchQueue();
  }, []);
  const [activeOrders, setActiveOrders] = useState<any[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [completedOrders, setCompletedOrders] = useState<any[]>([]);
  const [depositLogs, setDepositLogs] = useState<any[]>([]);
  const [readyPopup, setReadyPopup] = useState<any>(null);
  const [requestingDeliveryId, setRequestingDeliveryId] = useState<string | null>(null);

  const estimatedPickupMinutes = (queueCount * 30) + 15;

  const [aiMessages, setAiMessages] = useState<any[]>([
    { id: '1', sender_type: 'ai', message: 'Halo! Saya AI Assistant Laundrivery. Ada yang bisa saya bantu mengenai layanan laundry?' }
  ]);

  const handleSendChat = async () => {
    if (!inputChat.trim()) return;
    const messageText = inputChat.trim();
    setInputChat('');

    if (activeSupportTab === 'cs') {
      const validOrderId = (activeChatOrderId && activeChatOrderId !== 'GENERAL_CS') ? activeChatOrderId : null;
      const newMsg = {
        id: Date.now().toString(),
        order_id: validOrderId,
        customer_phone: customerPhone || null,
        sender_type: 'customer',
        message: messageText,
        created_at: new Date().toISOString()
      };
      setChatMessages((prev) => [...prev, newMsg]);

      const { error } = await insertChatMessage({
        order_id: validOrderId,
        customer_phone: customerPhone || null,
        sender_type: 'customer',
        message: messageText
      });

      if (error) {
        console.error('Error insert chat Supabase:', error.message);
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

  const fetchChatMessages = async (targetId: string) => {
    let query = supabase.from('support_chats').select('*');

    if (targetId === 'GENERAL_CS') {
      const norm = cleanPhone(customerPhone);
      query = query.or(`customer_phone.eq.${norm},customer_phone.eq.${customerPhone}`);
    } else {
      query = query.eq('order_id', targetId);
    }

    const { data } = await query.order('created_at', { ascending: true });
    if (data) setChatMessages(data.filter((m: any) => !isStaffOnlyMessage(m)));
  };

  useEffect(() => {
    if (activeChatOrderId) {
      fetchChatMessages(activeChatOrderId);
      
      const channel = supabase
        .channel('support_chats_realtime')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'support_chats' },
          (payload) => {
            const newMsg = payload.new;
            // Baca pesan dari CS jika order_id cocok ATAU nomor WA cocok
            const isMatchingOrder = activeChatOrderId !== 'GENERAL_CS' && newMsg.order_id === activeChatOrderId;
            const isMatchingPhone = cleanPhone(newMsg.customer_phone) === cleanPhone(customerPhone);

            if ((isMatchingOrder || isMatchingPhone) && !isStaffOnlyMessage(newMsg)) {
              setChatMessages((prev) => {
                if (prev.some((m) => m.id === newMsg.id)) return prev;
                return [...prev, newMsg];
              });
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [activeChatOrderId, customerPhone]);

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
      alert('Permintaan pengantaran sudah dikirim. Admin Ops / CS akan menugaskan driver.');
      return;
    }
    setRequestingDeliveryId(order.id);
    try {
      const notes = `Request Pengantaran Customer · ${order.receipt_number || order.order_number || order.id}`;
      const isPosOrder = Boolean(order.receipt_number);
      let pickupId = isPosOrder ? order.pickup_id || null : order.id;

      if (isPosOrder) {
        if (!pickupId) {
          const { data: existing } = await supabase
            .from('pickup_orders')
            .select('id')
            .eq('transaction_id', order.id)
            .limit(1);
          pickupId = existing?.[0]?.id || null;
        }
        if (pickupId) {
          const { error } = await updatePickupOrder(pickupId, {
            status: 'Siap Diantar',
            notes: `${order.notes || ''} | ${notes}`.trim()
          });
          if (error) throw error;
        } else {
          const { data, error } = await insertPickupOrder({
            outlet_id: order.outlet_id || selectedOutlet || null,
            customer_name: customerName || order.customer_name || 'Pelanggan',
            customer_phone: customerPhone,
            phone_number: customerPhone,
            service_type: order.service_type || 'Antar cucian',
            address: customerAddress,
            notes,
            status: 'Siap Diantar',
            transaction_id: order.id
          });
          if (error) throw error;
          pickupId = data?.[0]?.id || pickupId;
        }
        await supabase.from('transactions').update({ status: 'Siap Diantar' }).eq('id', order.id);
      } else {
        const { error } = await updatePickupOrder(order.id, {
          status: 'Siap Diantar',
          notes: `${order.notes || ''} | ${notes}`.trim()
        });
        if (error) throw error;
        pickupId = order.id;
      }

      await createDeliveryRequestTasks({
        id: pickupId || order.id,
        customer_name: customerName || order.customer_name,
        customer_phone: customerPhone,
        notes
      });

      alert('✅ Permintaan pengantaran terkirim ke Admin Ops & CS. Driver akan di-assign.');
      fetchCustomerProfile(customerPhone);
    } catch (err: any) {
      alert('❌ Gagal minta pengantaran: ' + (err.message || 'Coba lagi'));
    } finally {
      setRequestingDeliveryId(null);
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
      .select('stage, employee_name, created_at')
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
    setActiveChatOrderId(orderId);
    let query = supabase.from('support_chats').select('*');
    if (orderId && orderId !== 'GENERAL_CS') {
      query = query.eq('order_id', orderId);
    } else {
      query = query.is('order_id', null);
    }
    const { data, error } = await query.order('created_at', { ascending: true });
    if (!error && data) {
      setChatMessages(data.filter((m: any) => !isStaffOnlyMessage(m)));
    }
  };

  useEffect(() => {
    async function initPWA() {
      const { data: dbOutlets } = await supabase.from('outlets').select('*');
      if (dbOutlets && dbOutlets.length > 0) {
        setOutletsList(dbOutlets);
        setFilteredOutlets(dbOutlets);
        setSelectedOutlet(dbOutlets[0].id);
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

      const savedPhone = localStorage.getItem('laundry_customer_phone');
      const savedAddr = localStorage.getItem('laundry_customer_address');
      if (savedAddr) setCustomerAddress(savedAddr);

      if (savedPhone) {
        setCustomerPhone(savedPhone);
        fetchCustomerProfile(savedPhone);
      }

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          setUserCoords({ lat, lon });

          if (dbOutlets && dbOutlets.length > 0) {
            const nearby = dbOutlets.filter(o => {
              if (!o.latitude || !o.longitude) return true;
              const dist = calculateDistanceKm(lat, lon, Number(o.latitude), Number(o.longitude));
              return dist <= 30;
            });

            if (nearby.length > 0) {
              setFilteredOutlets(nearby);
              setSelectedOutlet(nearby[0].id);
            }
          }
        }, () => {});
      }
    }
    initPWA();
  }, []);

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
      photo_pickup_url: t.photo_pickup_url || relatedPickup?.photo_pickup_url || relatedPickup?.photo_url,
      photo_outlet_url: t.photo_outlet_url || relatedPickup?.photo_outlet_url,
      photo_delivery_url: t.photo_delivery_url || relatedPickup?.photo_delivery_url
    };
  });

  activePickups.forEach((p: any) => {
    const alreadyInTrx = activeTxs.some((t: any) => t.pickup_id === p.id);
    if (!alreadyInTrx) {
      mergedActive.push({
        ...p,
        photo_pickup_url: p.photo_pickup_url || p.photo_url,
        photo_outlet_url: p.photo_outlet_url,
        photo_delivery_url: p.photo_delivery_url
      });
    }
  });

  setActiveOrders(mergedActive);

  let historyArr: any[] = [];
  activePickups.filter((o: any) => isOrderFinished(o)).forEach((o: any) => {
    historyArr.push({ id: o.id, type: 'Online Order', title: o.service_type, detail: o.notes || '', price: o.delivery_fee || 0, date: o.created_at, status: o.status });
  });

      posTransactions?.filter((t: any) => isOrderFinished(t)).forEach((t: any) => {
        historyArr.push({ id: t.id, type: 'Outlet POS', title: `${t.service_type} (${t.receipt_number})`, detail: t.notes, price: t.amount, date: t.created_at, status: t.status });
      });

      historyArr.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setCompletedOrders(historyArr);

      const { data: memLogs } = await supabase
        .from('membership_logs')
        .select('*')
        .eq('customer_phone', norm)
        .order('created_at', { ascending: false });

      if (memLogs) setDepositLogs(memLogs);
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
  };

  const handleLogout = () => {
    localStorage.removeItem('laundry_customer_phone');
    setCustomerPhone('');
    setCustomerData(null);
  };

  const handleSaveAddress = () => {
    localStorage.setItem('laundry_customer_address', customerAddress);
    setIsEditingAddress(false);
    alert('✅ Alamat penjemputan berhasil disimpan!');
  };

  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) {
      return alert('⚠️ Browser/HP Anda tidak mendukung deteksi lokasi otomatis.');
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setUserCoords({ lat: latitude, lon: longitude });
        alert(`📍 Lokasi GPS berhasil didapatkan! (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`);
      },
      (err) => {
        console.error('Gagal ambil GPS:', err);
        alert('⚠️ Gagal mengambil lokasi GPS. Pastikan izin lokasi/GPS di HP Anda aktif.');
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
  const kiloanSubtotal = isKiloanChecked ? Math.round((Number(kiloanEstKg) || 0) * kiloanActiveUnitPrice) : 0;

  let satuanSubtotal = 0;
  if (isSatuanChecked) {
    cartSatuan.forEach(item => { 
      satuanSubtotal += item.price * item.qty; 
    });
  }

  const rawOngkir = deliveryFee || 0;
  const rawSubtotal = kiloanSubtotal + satuanSubtotal;

  const promoDiscountVal = promoDiscountRp(claimedPromo, rawSubtotal, rawOngkir);

  const finalOngkir = Math.max(0, rawOngkir - (claimedPromo?.type === 'ongkir' ? promoDiscountVal : 0));
  const grandTotalEstimate = Math.max(0, Math.round(rawSubtotal + rawOngkir - promoDiscountVal));

  const handleClaimPromo = (promo: CatalogPromo) => {
    const basket = rawSubtotal + rawOngkir;
    if (!promoIsClaimable(promo, basket)) {
      if (promo.max_quota > 0 && promo.used_count >= promo.max_quota) {
        return alert('⚠️ Kuota voucher ini sudah habis.');
      }
      return alert(`⚠️ Minimal transaksi untuk promo ini adalah Rp ${Number(promo.minTx || 0).toLocaleString('id-ID')}`);
    }
    setClaimedPromo(promo);
    setShowPromoModal(false);
  };

  const handleOrderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerPhone) return alert('Login terlebih dahulu!');
    if (!customerAddress || customerAddress.trim().length < 5) {
      return alert('⚠️ Isi Alamat Penjemputan terlebih dahulu!');
    }
    if (!isKiloanChecked && (!isSatuanChecked || cartSatuan.length === 0)) {
      return alert('⚠️ Pilih minimal 1 paket Kiloan atau Satuan!');
    }
    // PENGAMAN: Blokir total pembayaran COD
    if ((typeof paymentMethod !== 'undefined' && paymentMethod === 'COD') || (typeof paymentMethod !== 'undefined' && paymentMethod === 'Cash on Delivery')) {
      alert('⚠️ Mohon maaf, Laundrivery saat ini hanya melayani pembayaran cashless / transfer online. Pembayaran COD tidak tersedia.');
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(true);
    const normPhone = cleanPhone(customerPhone);

    const detailLines: string[] = [];
    if (isKiloanChecked) {
      detailLines.push(`Kiloan: ${selectedKiloanSvc} (${kiloanDuration}, ${kiloanEstKg}Kg)`);
    }
    if (isSatuanChecked && cartSatuan.length > 0) {
      const items = cartSatuan.map(i => `${i.name} x${i.qty}`).join(', ');
      detailLines.push(`Satuan: ${items}`);
    }
    if (claimedPromo) detailLines.push(`Promo: ${claimedPromo.title}`);
    detailLines.push(`Est. Tagihan: Rp ${grandTotalEstimate.toLocaleString('id-ID')}`);

    const mainServiceLabel = isKiloanChecked ? `${selectedKiloanSvc} (${kiloanDuration})` : `Satuan (${cartSatuan.length} Item)`;
    const notesCombined = `Alamat: ${customerAddress} | Detail: ${detailLines.join(' | ')}${notes ? ` | Catatan: ${notes}` : ''}`;
    const autoOrderNo = `ORD-${Date.now().toString().slice(-8)}`;

    const nowIso = new Date().toISOString();
    const todayDateStr = nowIso.split('T')[0];

    const detailInfo = `[INFO CUCIAN] Kantong: ${bagCount} | Cuci: ${washProcess} | Luntur: ${hasFading} | Brg Berharga: ${hasValuables}`;
    const finalNotes = notesCombined ? `${detailInfo} | ${notesCombined}` : detailInfo;

    // Rincian item satuan dikirim terstruktur agar POS bisa memuatnya langsung ke
    // keranjang nota. Kiloan tidak dimasukkan karena beratnya baru pasti setelah ditimbang kasir.
    const itemsPayload = isSatuanChecked
      ? cartSatuan.map((i) => ({
          name: i.name,
          qty: Number(i.qty) || 1,
          price: Number(i.price) || 0,
          basePrice: Number(i.basePrice) || 0,
          duration: i.duration || 'Reguler (3 Hari)',
          type: 'pcs' as const
        }))
      : [];

    const payload = {
      order_number: autoOrderNo,
      outlet_id: selectedOutlet || null,
      customer_name: customerName || 'Pelanggan Online',
      customer_phone: normPhone,
      phone_number: normPhone,
      service_type: mainServiceLabel,
      estimated_weight: isKiloanChecked ? Number(kiloanEstKg) || 3 : 0,
      address: customerAddress || '',
      duration: kiloanDuration || 'Reguler (3 Hari)',
      bag_count: Number(bagCount) || 1,
      wash_process: washProcess || 'Pisah',
      has_fading: hasFading === 'Ya',
      has_valuables: hasValuables === 'Ya',
      items: itemsPayload,
      delivery_fee: Number(finalOngkir) || 0,
      notes: finalNotes,
      pickup_date: todayDateStr,
      status: 'Baru Masuk',
      created_at: nowIso
    };

    const { data: insertedData, error } = await insertPickupOrder(payload);

    if (!error && insertedData && insertedData.length > 0) {
      await createPickupRoleTasks({
        id: insertedData[0].id,
        customer_name: payload.customer_name as string,
        customer_phone: normPhone,
        outlet_id: selectedOutlet
      });
      if (claimedPromo?.id && !String(claimedPromo.id).startsWith('settings-')) {
        const nextUsed = (Number(claimedPromo.used_count) || 0) + 1;
        await supabase.from('promos').update({ used_count: nextUsed }).eq('id', claimedPromo.id);
      }
      // Simpan data order terbaru & buka Modal Live Tracking Success
      setLatestCreatedOrder(insertedData[0]);
      setShowOrderSuccessModal(true);
      
      // Reset form
      setCartSatuan([]);
      setNotes('');
      setClaimedPromo(null);
      setKiloanEstKg('3');
      setKiloanDuration('Reguler (3 Hari)');
      setIsKiloanChecked(false);
      setIsSatuanChecked(false);
      
      // Smooth Switch ke tab Beranda
      setActiveTab('home');
      fetchCustomerProfile(normPhone);
    } else {
      alert('❌ Gagal membuat pesanan: ' + (error?.message || 'Koneksi bermasalah'));
    }
    setIsSubmitting(false);
  };

  const kiloanServicesList = dynamicServices.filter(s => s.type !== 'pcs');
  const satuanServicesList = dynamicServices.filter(s => s.type === 'pcs');

  const currentOutletObj = outletsList.find(o => o.id === selectedOutlet);
  const targetAdminWa = getAdminWaNumber(currentOutletObj?.name || '');

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 p-4 md:p-6 pb-28 max-w-md mx-auto relative font-sans">
      {readyPopup && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-5 w-full max-w-sm shadow-xl space-y-3">
            <p className="text-sm font-black text-slate-900">Cucian siap diambil</p>
            <p className="text-xs text-slate-600 leading-relaxed">
              Cucian Anda sudah selesai dan siap diambil! Silakan ambil ke outlet atau pesan Kurir Internal.
            </p>
            <p className="text-[11px] text-slate-400">{readyPopup.service_type} · {readyPopup.status}</p>
            <div className="flex gap-2">
              <button onClick={dismissReadyPopup} className="flex-1 border border-slate-200 font-bold text-xs py-2.5 rounded-xl">
                Nanti
              </button>
              <button
                onClick={(e) => {
                  handleRequestDelivery(readyPopup, e);
                  dismissReadyPopup();
                }}
                className="flex-1 bg-sky-500 text-white font-bold text-xs py-2.5 rounded-xl"
              >
                Minta Driver
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* HEADER TOP BAR */}
      <div className="bg-white rounded-2xl p-3.5 shadow-sm border border-slate-200/80 flex justify-between items-center mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 bg-blue-600 text-white rounded-xl flex items-center justify-center font-black text-xl shadow-md shadow-blue-200">
            🧺
          </div>
          <div>
            <h1 className="text-base font-extrabold text-slate-900 tracking-tight leading-none">Laundrivery</h1>
            <p className="text-[10px] text-blue-600 font-bold tracking-wide uppercase mt-0.5">Express Laundry Delivery</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowPromoModal(true)} className="bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-extrabold px-2.5 py-1.5 rounded-xl hover:bg-amber-100 transition shadow-sm">
            🎁 Promo & Vouchers
          </button>
          {customerData && (
            <button onClick={handleLogout} className="bg-rose-50 border border-rose-200 text-rose-600 text-[10px] font-bold px-2.5 py-1.5 rounded-xl hover:bg-rose-100 transition">
              Keluar
            </button>
          )}
        </div>
      </div>

      {!customerData ? (
        <form onSubmit={handleLogin} className="bg-white border border-slate-200 p-6 rounded-3xl space-y-4 shadow-sm my-6">
          <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center text-2xl mx-auto font-black shadow-inner">
            📲
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
      ) : (
        <>
          {activeTab === 'home' && (
            <div className="space-y-4">
              <div className="bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-800 rounded-3xl p-5 text-white shadow-xl shadow-blue-200/50 space-y-4 relative overflow-hidden">
                <div className="flex justify-between items-start relative z-10">
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-widest text-blue-200 block">Laundrivery Wallet</span>
                    <h2 className="text-lg font-extrabold text-white mt-0.5">{customerData.name || 'Pelanggan Setia'}</h2>
                    <p className="text-[11px] font-mono text-blue-100 opacity-90">{customerPhone}</p>
                  </div>
                  <span className="bg-white/20 backdrop-blur-md px-3 py-1 rounded-full text-[10px] font-extrabold uppercase border border-white/20">
                    VIP Member
                  </span>
                </div>

                <div className="bg-white/10 backdrop-blur-md p-4 rounded-2xl border border-white/20 flex justify-between items-center relative z-10">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-blue-200 block">Saldo Deposit</span>
                    <span className="text-2xl font-black text-white">Rp {Number(customerData.deposit_balance || 0).toLocaleString('id-ID')}</span>
                  </div>
                  <button 
  type="button" 
  onClick={() => setActiveTab('deposit')} 
  className="bg-white text-blue-700 px-4 py-2 rounded-xl text-xs font-extrabold shadow-md hover:bg-blue-50 transition cursor-pointer"
>
  + Top-Up via Xendit
</button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setActiveTab('order')} className="bg-white border border-slate-200 p-4 rounded-3xl flex items-center gap-3 hover:border-blue-500 transition shadow-sm text-left">
                  <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center text-2xl font-black">🛵</div>
                  <div>
                    <span className="text-xs font-extrabold text-slate-900 block">Pesan Express</span>
                    <span className="text-[10px] text-slate-500 font-medium">Jemput ke Rumah</span>
                  </div>
                </button>

                <button onClick={() => setActiveTab('deposit')} className="bg-white border border-slate-200 p-4 rounded-3xl flex items-center gap-3 hover:border-indigo-500 transition shadow-sm text-left">
                  <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center text-2xl font-black">💳</div>
                  <div>
                    <span className="text-xs font-extrabold text-slate-900 block">Paket Deposit</span>
                    <span className="text-[10px] text-slate-500 font-medium">Bonus Saldo Extra</span>
                  </div>
                </button>
              </div>

              {/* FLOATING BANNER BANTUAN LIVE CS & AI */}
              <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-4 rounded-3xl text-white my-4 shadow-lg flex justify-between items-center">
                <div>
                  <h4 className="font-black text-xs">💬 Butuh Bantuan / Tanya AI?</h4>
                  <p className="text-[10px] text-indigo-100">Hubungi CS Admin atau AI Assistant kami.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveChatOrderId('GENERAL_CS')}
                  className="bg-white text-indigo-900 font-extrabold px-3.5 py-2 rounded-xl text-xs shadow hover:bg-indigo-50 transition"
                >
                  Mulai Chat
                </button>
              </div>

              <div className="space-y-3 pt-1">
      {/* Header Section */}
      <div className="flex justify-between items-center mb-1">
        <div className="flex items-center gap-1.5">
          <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <h3 className="text-xs font-bold text-slate-800 tracking-wide uppercase">
            {activeTab === 'home'
              ? `Pesanan Berlangsung (${activeOrders.filter((o: any) => !isOrderFinished(o)).length})`
              : 'Riwayat Pesanan Selesai'}
          </h3>
        </div>
        <button
          onClick={() => setActiveTab(activeTab === 'home' ? 'history' : 'home')}
          className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700"
        >
          {activeTab === 'home' ? 'Lihat Riwayat Selesai' : 'Kembali ke Beranda'}
        </button>
      </div>

      {/* Render Pesanan */}
      {(() => {
        const berandaOrders = activeOrders.filter((o: any) => !isOrderFinished(o));
        const riwayatOrders = activeOrders.filter((o: any) => isOrderFinished(o));
        const displayOrders = activeTab === 'home' ? berandaOrders : riwayatOrders;

        if (displayOrders.length === 0) {
          return (
            <div className="bg-white border border-slate-100 p-6 rounded-2xl text-center text-xs text-slate-400 shadow-sm">
              {activeTab === 'home'
                ? 'Belum ada cucian yang sedang diproses.'
                : 'Belum ada riwayat pesanan selesai.'}
            </div>
          );
        }

        return displayOrders.map((order: any) => {
          const currentStatus = (order.status || '').toLowerCase();
          const stages = [
            { label: 'Jemput', icon: '🛺', match: ['jemput', 'menuju', 'diambil driver'] },
            { label: 'Diterima', icon: '🏠', match: ['diterima', 'tiba'] },
            // 'ering' (bukan 'kering') dipakai karena 'Mengeringkan' tidak mengandung
            // substring 'kering' — awalan meng- melebur dengan huruf k akar katanya.
            { label: 'Proses', icon: '🧼', match: ['cuci', 'mencuci', 'sortir', 'ering'] },
            // Packing masih tahap pengerjaan, jadi digabung ke tahap penyelesaian.
            // Kalau dimasukkan ke 'Siap', pelanggan dikabari cucian sudah siap
            // padahal masih dikemas. 'emas' menangkap 'Kemas'/'Mengemas'/'Pengemasan'.
            { label: 'Setrika', icon: '👔', match: ['setrika', 'gosok', 'pack', 'emas'] },
            { label: 'Siap', icon: '📦', match: ['siap'] },
            { label: 'Selesai', icon: '✅', match: ['selesai', 'diambil'] }
          ];

          let activeIndex = stages.findIndex(s => s.match.some(m => currentStatus.includes(m)));
          if (activeIndex === -1) activeIndex = 1;

          const formattedDate = order.created_at
            ? new Date(order.created_at).toLocaleDateString('id-ID', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit'
              })
            : 'Baru Saja';

          return (
            <div
              key={order.id}
              onClick={() => setSelectedOrder(order)}
              className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex flex-col gap-3 transition-all hover:shadow-md cursor-pointer active:scale-[0.98] mb-3"
            >
              {/* Header Kartu */}
              <div className="flex justify-between items-center border-b border-slate-50 pb-2">
                <span className="text-[10px] font-extrabold tracking-wider text-slate-400 uppercase">
                  {order.receipt_number || order.order_type || 'Laundry Express'} • {formattedDate}
                </span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-600 border border-amber-200/50">
                  {order.status || 'Tiba di Outlet'}
                </span>
              </div>

              {/* Body Kartu */}
              <div className="flex justify-between items-center">
                <div className="pr-2">
                  <h4 className="font-bold text-slate-800 text-sm line-clamp-1">
                    {order.service_type || 'Layanan Laundry'}
                  </h4>
                  <button
  type="button"
  onClick={(e) => {
    e.stopPropagation();
    setDetailOrder(order);
  }}
  className="text-[11px] text-indigo-600 font-semibold line-clamp-1 mt-0.5 flex items-center gap-1 hover:underline cursor-pointer focus:outline-none"
>
  <span>🔍</span> Klik untuk detail item & status lengkap
</button>
                </div>
                <div className="text-right whitespace-nowrap">
                  <span className="text-[10px] text-slate-400 block font-normal">Total Estimasi</span>
                  <span className="font-extrabold text-slate-900 text-sm">
                    Rp {(order.amount || order.total_amount || order.estimated_price || 0).toLocaleString('id-ID')}
                  </span>
                </div>
              </div>

              {/* Tracker Visual 6 Tahap */}
              <div className="grid grid-cols-6 gap-1 text-center pt-2 mt-1 border-t border-slate-50">
                {stages.map((step, idx) => {
                  const isPassedOrActive = idx <= activeIndex;
                  const isActiveNow = idx === activeIndex;
                  return (
                    <div key={idx} className="flex flex-col items-center">
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all ${
                          isActiveNow
                            ? 'bg-indigo-600 text-white ring-2 ring-indigo-200 scale-110 animate-pulse'
                            : isPassedOrActive
                            ? 'bg-emerald-500 text-white shadow-sm'
                            : 'bg-slate-100 text-slate-400'
                        }`}
                      >
                        {step.icon}
                      </div>
                      <span
                        className={`text-[8px] mt-1 font-semibold ${
                          isActiveNow
                            ? 'text-indigo-600 font-bold'
                            : isPassedOrActive
                            ? 'text-slate-700'
                            : 'text-slate-400'
                        }`}
                      >
                        {step.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              {isSiapDiambil(order) && (
                <button
                  type="button"
                  onClick={(e) => handleRequestDelivery(order, e)}
                  disabled={requestingDeliveryId === order.id}
                  className="w-full bg-sky-500 hover:bg-sky-600 text-white font-black text-xs py-3 rounded-xl shadow-sm"
                >
                  {requestingDeliveryId === order.id ? 'Mengirim…' : '🛵 Minta Pengantaran Driver'}
                </button>
              )}

              {/* PETA LIVE DRIVER */}
              {order.status === 'Driver Menuju Lokasi' && order.driver_lat && (
                <div
                  className="bg-blue-50/80 border border-blue-100 p-3 rounded-xl space-y-1.5 text-xs mt-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-blue-900 flex items-center gap-1 text-[11px]">
                      📍 Driver Sedang Menuju Lokasi
                    </span>
                    <a
                      href={`https://maps.google.com/?q=${order.driver_lat},${order.driver_lon}`}
                      target="_blank"
                      rel="noreferrer"
                      className="bg-blue-600 text-white font-bold text-[10px] px-2.5 py-1 rounded-lg shadow-sm"
                    >
                      Buka Peta Live 🗺️
                    </a>
                  </div>
                  <p className="text-[10px] text-blue-600">Posisi driver diperbarui secara otomatis.</p>
                </div>
              )}

              {/* BUKTI FOTO (PICKUP, OUTLET, SERAH TERIMA) */}
<div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 space-y-2 mt-2">
  <p className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">
    📸 Bukti Foto Kurir
  </p>
  <div className="grid grid-cols-3 gap-2">
    <div className="flex flex-col gap-1">
      <span className="text-[9px] font-bold text-slate-400">Jemput</span>
      {order.photo_pickup_url || order.photo_url ? (
        <img 
          src={order.photo_pickup_url || order.photo_url} 
          alt="Foto Pickup" 
          className="w-full h-20 object-cover rounded-lg border border-slate-200"
        />
      ) : (
        <div className="w-full h-20 bg-slate-100 rounded-lg flex items-center justify-center text-[10px] text-slate-400">
          Belum Ada
        </div>
      )}
    </div>

    <div className="flex flex-col gap-1">
      <span className="text-[9px] font-bold text-slate-400">Outlet</span>
      {order.photo_outlet_url ? (
        <img 
          src={order.photo_outlet_url} 
          alt="Foto Outlet" 
          className="w-full h-20 object-cover rounded-lg border border-slate-200"
        />
      ) : (
        <div className="w-full h-20 bg-slate-100 rounded-lg flex items-center justify-center text-[10px] text-slate-400">
          Belum Ada
        </div>
      )}
    </div>

    <div className="flex flex-col gap-1">
      <span className="text-[9px] font-bold text-slate-400">Antar</span>
      {order.photo_delivery_url ? (
        <img 
          src={order.photo_delivery_url} 
          alt="Foto Serah Terima" 
          className="w-full h-20 object-cover rounded-lg border border-slate-200"
        />
      ) : (
        <div className="w-full h-20 bg-slate-100 rounded-lg flex items-center justify-center text-[10px] text-slate-400">
          Belum Ada
        </div>
      )}
    </div>
  </div>
</div>
            </div>
          );
        });
      })()}
              </div>
            </div>
          )}

          {activeTab === 'order' && (
            <form onSubmit={handleOrderSubmit} className="space-y-4">
              <div className="bg-white border border-slate-200 p-5 rounded-3xl space-y-4 shadow-sm">
                <div className="border-b border-slate-100 pb-3">
                  <h3 className="text-sm font-extrabold text-slate-900">Form Order Penjemputan</h3>
                  <p className="text-[11px] text-slate-500">Layanan Jemput-Antar Langsung ke Kasir POS</p>
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">Outlet Terdekat di Kota Anda</label>
                  <select
                    value={selectedOutlet}
                    onChange={(e) => setSelectedOutlet(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-2xl px-3.5 py-3 text-xs font-bold text-slate-800"
                  >
                    {filteredOutlets.map((o) => (
                      <option key={o.id} value={o.id}>📍 {o.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5 mt-3">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-extrabold text-slate-500 uppercase">Alamat Penjemputan *</label>
                    <button
                      type="button"
                      onClick={handleGetCurrentLocation}
                      className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-lg hover:bg-indigo-100 flex items-center gap-1 transition"
                    >
                      <span>📍</span>
                      <span>{userCoords ? 'GPS Terdeteksi ✓' : 'Ambil Lokasi GPS Presisi'}</span>
                    </button>
                  </div>
                  <textarea
                    value={customerAddress}
                    onChange={(e) => setCustomerAddress(e.target.value)}
                    placeholder="Ketik alamat lengkap (Jalan, No. Rumah, Patokan)..."
                    className="w-full bg-slate-50 border border-slate-300 rounded-2xl p-3 text-xs font-bold text-slate-800 focus:outline-none"
                    rows={2}
                  />
                  {userCoords && (
                    <p className="text-[9px] text-emerald-600 font-bold flex items-center gap-1">
                      <span>✓</span> Lat: {userCoords.lat.toFixed(5)}, Lon: {userCoords.lon.toFixed(5)} (Pinpoint tersimpan)
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
                    <p className="font-extrabold text-amber-900 text-[11px]">
                      {claimedPromo ? `🎉 ${claimedPromo.title}` : '🎁 Gunakan Voucher Promo'}
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
                    <span className="text-xs font-extrabold text-blue-900">📦 Paket Laundry Kiloan</span>
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
                          <label className="block text-[10px] text-slate-500 font-bold mb-1">Durasi Kiloan</label>
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
                          <label className="block text-[10px] text-slate-500 font-bold mb-1">Est. Berat (Kg)</label>
                          <input
                            type="number"
                            min="3"
                            value={kiloanEstKg}
                            onChange={(e) => setKiloanEstKg(e.target.value)}
                            className="w-full bg-white border border-blue-200 rounded-xl p-2 text-xs font-extrabold text-blue-700"
                          />
                        </div>
                      </div>
                      <p className="text-[10px] text-blue-600 font-bold text-right">
                        Harga: Rp {kiloanActiveUnitPrice.toLocaleString('id-ID')}/Kg
                      </p>
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
                    <span className="text-xs font-extrabold text-slate-800">👔 Items Satuan (Bedcover/Sepatu/dll)</span>
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
                          <label className="block text-[10px] text-slate-500 font-bold mb-1">Durasi Item Ini</label>
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
                          <input
                            type="number"
                            placeholder="Qty"
                            value={inputSatuanQty}
                            onChange={(e) => setInputSatuanQty(e.target.value)}
                            className="w-full bg-white border border-slate-300 rounded-xl p-2 text-xs font-bold text-slate-800"
                          />
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleAddSatuanToCart}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl text-xs shadow-sm"
                      >
                        ➕ Tambah Item Satuan Ini
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
                                <button type="button" onClick={() => handleRemoveSatuan(idx)} className="text-rose-500 font-bold px-1">✕</button>
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
                    📋 INFORMASI DETAIL CUCIAN
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
                    <span>
                      Ongkir Antar-Jemput Motor {distanceKm ? `(${distanceKm} Km PP)` : 'PP'}:
                    </span>
                    <span>
                      {deliveryFee !== null ? `Rp ${rawOngkir.toLocaleString('id-ID')}` : 'Isi alamat dahulu'}
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
                        className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 hover:bg-blue-200 font-bold text-[10px] flex items-center justify-center border border-blue-200"
                        title="Informasi Estimasi Harga"
                      >
                        ℹ️
                      </button>
                    </div>
                    <span>Rp {grandTotalEstimate.toLocaleString('id-ID')}</span>
                  </div>
                </div>

                <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl space-y-3 my-4">
                  <label className="text-xs font-bold text-slate-300 block">Pilih Metode Penjemputan</label>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div 
                      onClick={() => setCourierType('INTERNAL')}
                      className={`p-3 rounded-xl border cursor-pointer transition ${
                        courierType === 'INTERNAL' 
                          ? 'bg-cyan-950/50 border-cyan-500 text-white' 
                          : 'bg-slate-800/50 border-slate-700 text-slate-400'
                      }`}
                    >
                      <div className="text-xs font-bold mb-1">🛵 Driver Internal</div>
                      <div className="text-[10px] text-cyan-400 font-semibold">
                        {queueCount === 0 ? '🟢 Tanpa Antrian' : `🔴 ${queueCount} Antrian`}
                      </div>
                      <div className="text-[9px] text-slate-400 mt-1">
                        Est. Penjemputan ~{estimatedPickupMinutes} Menit
                      </div>
                    </div>

                    <div 
                      onClick={() => setCourierType('THIRD_PARTY')}
                      className={`p-3 rounded-xl border cursor-pointer transition ${
                        courierType === 'THIRD_PARTY' 
                          ? 'bg-cyan-950/50 border-cyan-500 text-white' 
                          : 'bg-slate-800/50 border-slate-700 text-slate-400'
                      }`}
                    >
                      <div className="text-xs font-bold mb-1">📦 Pihak Ketiga</div>
                      <div className="text-[10px] text-amber-400 font-semibold">Gojek / Grab / Lalamove</div>
                      <div className="text-[9px] text-slate-400 mt-1">
                        Dipesankan manual oleh CS + Link Live Track
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-4 rounded-2xl text-xs uppercase shadow-lg shadow-blue-200 transition"
                >
                  🚀 Pesan Penjemputan Sekarang
                </button>
              </div>
            </form>
          )}

          {activeTab === 'deposit' && (
            <div className="space-y-4">
              <div className="bg-white border border-slate-200 p-6 rounded-3xl space-y-4 text-center shadow-sm">
                <div className="w-14 h-14 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center text-3xl mx-auto font-black">💳</div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">Top Up Saldo Deposit</h3>
                  <p className="text-xs text-slate-500 mt-1">Dapatkan bonus saldo ekstra & bayar cucian instan tanpa uang pas.</p>
                </div>

                <div className="grid grid-cols-1 gap-3 text-left">
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 flex justify-between items-center">
                    <div>
                      <p className="font-extrabold text-slate-900 text-xs">Paket Silver</p>
                      <p className="text-[10px] text-slate-500 font-medium">Bayar Rp 300.000</p>
                    </div>
                    <span className="text-blue-600 font-black text-xs bg-blue-50 px-3 py-1.5 rounded-full border border-blue-100">+ Rp 320.000 Saldo</span>
                  </div>

                  <div className="bg-slate-50 p-4 rounded-2xl border border-amber-200 flex justify-between items-center bg-amber-50/30">
                    <div>
                      <p className="font-extrabold text-slate-900 text-xs">Paket Gold</p>
                      <p className="text-[10px] text-slate-500 font-medium">Bayar Rp 500.000</p>
                    </div>
                    <span className="text-amber-700 font-black text-xs bg-amber-50 px-3 py-1.5 rounded-full border border-amber-200">+ Rp 550.000 Saldo</span>
                  </div>

                  <div className="bg-slate-50 p-4 rounded-2xl border border-indigo-200 flex justify-between items-center bg-indigo-50/30">
                    <div>
                      <p className="font-extrabold text-slate-900 text-xs">Paket Platinum</p>
                      <p className="text-[10px] text-slate-500 font-medium">Bayar Rp 900.000</p>
                    </div>
                    <span className="text-indigo-700 font-black text-xs bg-indigo-50 px-3 py-1.5 rounded-full border border-indigo-200">+ Rp 1.000.000 Saldo</span>
                  </div>
                </div>

                <a
                href={`https://wa.me/${(currentOutletObj?.phonee || '6281234567890').replace(/[^0-9]/g, '').replace(/^0/, '62')}?text=${encodeURIComponent(`Halo Admin ${currentOutletObj?.name || ''}, saya ingin konfirmasi Top Up Saldo Deposit.`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-2xl text-xs shadow flex items-center justify-center gap-2"
              >
                <span>💬</span>
                <span>HUBUNGI ADMIN VIA WHATSAPP ({currentOutletObj?.name || 'OUTLET'})</span>
              </a>
              </div>

              <div className="space-y-2">
                <h4 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">📜 Riwayat Top Up Saldo</h4>
                {depositLogs.map((log, i) => (
                  <div key={i} className="bg-white border border-slate-200 p-3.5 rounded-2xl text-xs flex justify-between items-center shadow-sm">
                    <div>
                      <p className="font-extrabold text-slate-900">Paket {log.package_name}</p>
                      <p className="text-[10px] text-slate-400 font-medium">{new Date(log.created_at).toLocaleDateString('id-ID')}</p>
                    </div>
                    <span className="font-black text-blue-600">+ Rp {Number(log.balance_added).toLocaleString('id-ID')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-3">
              <h3 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">📜 Riwayat Pesanan Selesai</h3>
              {completedOrders.map((item: any) => (
                <div key={item.id} className="bg-white border border-slate-200 rounded-2xl p-4 text-xs space-y-2 shadow-sm">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="font-extrabold text-slate-900 block">{item.title}</span>
                      <span className="text-[10px] text-slate-500 font-medium">{item.detail}</span>
                    </div>
                    <span className="bg-blue-50 text-blue-700 border border-blue-200 text-[9px] font-extrabold px-2.5 py-0.5 rounded-full">
                      {item.status}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-slate-100 text-[10px]">
                    <span className="text-slate-400 font-medium">{new Date(item.date).toLocaleDateString('id-ID')}</span>
                    <span className="font-black text-blue-600 text-xs">Ongkir: Rp {Number(item.price || 0).toLocaleString('id-ID')}</span>
                  </div>
                </div>
              ))}

              {completedOrders.length === 0 && (
                <div className="bg-white border border-slate-200 p-8 rounded-3xl text-center text-xs text-slate-400 shadow-sm">
                  Belum ada riwayat transaksi selesai.
                </div>
              )}
            </div>
          )}

          {activeTab === 'profile' && (
            <div className="bg-white border border-slate-200 p-6 rounded-3xl space-y-4 shadow-sm text-xs">
              <h3 className="text-sm font-extrabold text-slate-900 border-b border-slate-100 pb-2">👤 Profil Akun</h3>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-extrabold block">Nama Lengkap</span>
                <p className="font-extrabold text-slate-900 text-sm mt-0.5">{customerData.name || '-'}</p>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-extrabold block">Nomor WhatsApp</span>
                <p className="font-mono text-blue-600 font-extrabold mt-0.5">{customerPhone}</p>
              </div>

              <div className="pt-2 border-t border-slate-100">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[10px] text-slate-400 uppercase font-extrabold">Alamat Penjemputan Utama</span>
                  {!isEditingAddress && (
                    <button onClick={() => setIsEditingAddress(true)} className="text-[10px] font-extrabold text-blue-600 hover:underline">
                      ✏️ Edit Alamat
                    </button>
                  )}
                </div>

                {!isEditingAddress ? (
                  <p className="text-slate-700 font-medium bg-slate-50 p-3 rounded-2xl border border-slate-200">
                    {customerAddress || 'Belum diatur'}
                  </p>
                ) : (
                  <div className="space-y-2 mt-2">
                    <textarea
                      value={customerAddress}
                      onChange={(e) => setCustomerAddress(e.target.value)}
                      placeholder="Tulis alamat lengkap penjemputan..."
                      className="w-full bg-slate-50 border border-slate-300 rounded-2xl p-3 text-xs text-slate-800 font-medium"
                      rows={3}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleSaveAddress}
                        className="flex-1 bg-blue-600 text-white font-extrabold py-2.5 rounded-xl text-xs shadow-sm hover:bg-blue-700 transition"
                      >
                        💾 Simpan Alamat
                      </button>
                      <button
                        onClick={() => setIsEditingAddress(false)}
                        className="bg-slate-100 text-slate-600 font-bold px-3 py-2.5 rounded-xl text-xs hover:bg-slate-200 transition"
                      >
                        Batal
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* MODAL KLAIM VOUCHER PROMO AKTIF */}
      {showPromoModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-5 max-w-sm w-full space-y-4 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b pb-2">
              <h3 className="text-sm font-extrabold text-slate-900">🎁 Klaim Voucher Promo Active</h3>
              <button onClick={() => setShowPromoModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>
            <div className="space-y-2.5">
              <p className="text-[10px] font-extrabold text-slate-400 uppercase">Pilih Promo Untuk Pesanan Ini:</p>
              {availablePromos.length > 0 ? (
                availablePromos.map((promo, idx) => {
                  const isClaimed = claimedPromo?.id === promo.id;
                  return (
                    <div key={idx} className={`p-3.5 rounded-2xl border transition space-y-2 ${isClaimed ? 'bg-amber-50 border-amber-400' : 'bg-slate-50 border-slate-200'}`}>
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-extrabold text-slate-900 text-xs">{promo.title}</h4>
                          <p className="text-[10px] text-slate-500 mt-0.5">{promo.desc}</p>
                          <p className="text-[9px] text-amber-700 font-bold mt-1">Min. Transaksi: Rp {Number(promo.minTx || 0).toLocaleString('id-ID')}</p>
                        </div>
                        <button
                          onClick={() => handleClaimPromo(promo)}
                          className={`text-[10px] font-extrabold px-3 py-1.5 rounded-xl shadow-sm transition ${isClaimed ? 'bg-emerald-600 text-white' : 'bg-amber-500 hover:bg-amber-600 text-white'}`}
                        >
                          {isClaimed ? 'Terpasang ✓' : 'Klaim Promo'}
                        </button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-slate-400 text-center py-4">Belum ada promo aktif saat ini.</p>
              )}
            </div>

            <div className="space-y-2 pt-2 border-t border-slate-100">
              <p className="text-[10px] font-extrabold text-slate-400 uppercase">Daftar Cabang Outlet Resmi ({outletsList.length}):</p>
              {outletsList.map((o, idx) => (
                <div key={idx} className="bg-slate-50 border border-slate-200 p-3 rounded-2xl text-xs space-y-1">
                  <p className="font-extrabold text-slate-900">📍 {o.name}</p>
                  <p className="text-[10px] text-slate-500">{o.address || 'Alamat cabang resmi'}</p>
                </div>
              ))}
            </div>

            <button onClick={() => setShowPromoModal(false)} className="w-full bg-slate-900 text-white font-extrabold py-3 rounded-2xl text-xs">
              Tutup Modal
            </button>
          </div>
        </div>
      )}

      {/* MODAL INFORMASI CREDENTIAL ESTIMASI TOTAL */}
      {showEstimateInfoModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl text-center">
            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center text-2xl mx-auto font-black shadow-inner">
              ℹ️
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

      {/* MODAL CHAT CUSTOMER SERVICE */}
      {activeChatOrderId && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl flex flex-col h-[500px]">
            {/* Header Modal Chat & Switcher AI/CS */}
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white">💬 Bantuan Laundrivery</span>
                <div className="flex bg-slate-800 p-0.5 rounded-lg border border-slate-700">
                  <button
                    type="button"
                    onClick={() => setActiveSupportTab('cs')}
                    className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition ${
                      activeSupportTab === 'cs' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    🎧 Live CS
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveSupportTab('ai')}
                    className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition ${
                      activeSupportTab === 'ai' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    🤖 Tanya AI
                  </button>
                </div>
              </div>
              <button onClick={() => setActiveChatOrderId(null)} className="text-slate-400 hover:text-white text-xs font-bold">✕</button>
            </div>

            {/* Bubble Chat Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-900/90">
              {(activeSupportTab === 'cs' ? chatMessages : aiMessages).length === 0 ? (
                <div className="text-center text-xs text-slate-400 py-12">
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
                        className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-xs font-medium shadow ${
                          isCustomer
                            ? 'bg-cyan-500 text-slate-950 rounded-br-none'
                            : isAi
                            ? 'bg-purple-600 text-white rounded-bl-none shadow-md'
                            : 'bg-slate-800 text-slate-100 rounded-bl-none border border-slate-700'
                        }`}
                      >
                        <p>{msg.message}</p>
                        <span className={`text-[8px] block mt-1 ${isCustomer ? 'text-slate-900/70 text-right' : 'text-slate-400'}`}>
                          {new Date(msg.created_at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Input Chat */}
            <div className="p-3 border-t border-slate-800 flex gap-2">
              <input
                type="text"
                value={inputChat}
                onChange={(e) => setInputChat(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
                placeholder={activeSupportTab === 'cs' ? "Ketik pesan ke CS..." : "Tanya AI seputar layanan laundry..."}
                className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 text-xs text-white focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSendChat}
                className={`font-bold px-4 py-2 rounded-xl text-xs text-white transition ${
                  activeSupportTab === 'cs' ? 'bg-cyan-500 hover:bg-cyan-600' : 'bg-purple-600 hover:bg-purple-700'
                }`}
              >
                Kirim
              </button>
            </div>
          </div>
        </div>
      )}
{/* MODAL SUCCESS ORDER REDIRECT (SMOOTH UX FLOW) */}
{showOrderSuccessModal && latestCreatedOrder && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl text-center">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center text-3xl mx-auto font-black shadow-inner">
              ✓
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">Pesanan Terkirim ke Kasir!</h3>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed font-medium">
                No. Pesanan: <b className="text-slate-900">{latestCreatedOrder.order_number}</b><br/>
                Driver & Kasir outlet kami sedang memproses penjemputan ke lokasi Anda.
              </p>
            </div>
            <button
              onClick={() => setShowOrderSuccessModal(false)}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-3.5 rounded-2xl text-xs uppercase shadow-md transition"
            >
              Lihat Status Live Tracking 🚀
            </button>
          </div>
        </div>
      )}
      {/* BOTTOM NAVIGATION BAR */}
      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white/95 backdrop-blur-md border-t border-slate-200 flex justify-around p-2.5 z-50 shadow-lg">
        <button onClick={() => setActiveTab('home')} className={`flex flex-col items-center flex-1 ${activeTab === 'home' ? 'text-blue-600' : 'text-slate-400'}`}>
          <span className="text-lg">🏠</span>
          <span className="text-[9px] font-extrabold mt-0.5">Beranda</span>
        </button>
        <button onClick={() => setActiveTab('order')} className={`flex flex-col items-center flex-1 ${activeTab === 'order' ? 'text-blue-600' : 'text-slate-400'}`}>
          <span className="text-lg">🛵</span>
          <span className="text-[9px] font-extrabold mt-0.5">Order</span>
        </button>
        <button onClick={() => setActiveTab('deposit')} className={`flex flex-col items-center flex-1 ${activeTab === 'deposit' ? 'text-blue-600' : 'text-slate-400'}`}>
          <span className="text-lg">💳</span>
          <span className="text-[9px] font-extrabold mt-0.5">Deposit</span>
        </button>
        <button onClick={() => setActiveTab('history')} className={`flex flex-col items-center flex-1 ${activeTab === 'history' ? 'text-blue-600' : 'text-slate-400'}`}>
          <span className="text-lg">📜</span>
          <span className="text-[9px] font-extrabold mt-0.5">Riwayat</span>
        </button>
        <button onClick={() => setActiveTab('profile')} className={`flex flex-col items-center flex-1 ${activeTab === 'profile' ? 'text-blue-600' : 'text-slate-400'}`}>
          <span className="text-lg">👤</span>
          <span className="text-[9px] font-extrabold mt-0.5">Profil</span>
        </button>
      </div>

{/* ================= MODAL POPUP DETAIL ITEM & STATUS ================= */}
{detailOrder && (
  <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
      
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
          onClick={() => setDetailOrder(null)}
          className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white font-bold flex items-center justify-center cursor-pointer"
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div className="p-4 overflow-y-auto space-y-4 text-xs text-slate-700">
        <div className="bg-indigo-50 p-3 rounded-xl border border-indigo-100 flex justify-between items-center">
          <div>
            <span className="text-[10px] text-indigo-500 font-bold uppercase block">Layanan</span>
            <span className="font-bold text-slate-900 text-sm">
              {detailOrder.service_type || detailOrder.service_name || 'Cuci Kering Gosok'}
            </span>
          </div>
          <span className="px-2.5 py-1 bg-indigo-600 text-white font-black text-[10px] rounded-lg">
            {detailOrder.status || 'Diterima'}
          </span>
        </div>

        {/* Rincian Items */}
        <div className="space-y-2">
          <h4 className="font-extrabold text-slate-800 uppercase text-[10px]">📦 Rincian Item Cucian</h4>
          {detailOrder.items && Array.isArray(detailOrder.items) && detailOrder.items.length > 0 ? (
            <div className="space-y-1.5">
              {detailOrder.items.map((it: any, idx: number) => (
                <div key={idx} className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 flex justify-between items-center">
                  <div>
                    <span className="font-bold text-slate-800 block">{it.name || it.service_type || 'Item Cucian'}</span>
                    <span className="text-[10px] text-slate-500">
                      {it.weight ? `${it.weight} Kg` : ''} {it.qty ? `${it.qty} Pcs` : ''}
                    </span>
                  </div>
                  <span className="px-2 py-0.5 bg-slate-200 text-slate-700 font-bold text-[10px] rounded-md">
                    {it.status || detailOrder.status || 'Proses'}
                  </span>
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
        </div>

        {/* Riwayat Waktu Pengerjaan */}
        <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
          <StageTimeline
            logs={detailWorkLogs}
            transaction={detailOrder}
            showCrew={false}
            title="Progres & Waktu Pengerjaan"
          />
        </div>

        {/* Bukti Foto */}
        <div className="space-y-2">
          <h4 className="font-extrabold text-slate-800 uppercase text-[10px]">📸 Bukti Foto Cucian</h4>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <span className="text-[10px] font-bold text-slate-400 block mb-1">Jemput</span>
              {detailOrder.photo_pickup_url || detailOrder.photo_url ? (
                <img src={detailOrder.photo_pickup_url || detailOrder.photo_url} alt="Pickup" className="w-full h-24 object-cover rounded-xl border border-slate-200" />
              ) : (
                <div className="w-full h-24 bg-slate-100 rounded-xl flex items-center justify-center text-[10px] text-slate-400">Belum Ada</div>
              )}
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-400 block mb-1">Outlet</span>
              {detailOrder.photo_outlet_url ? (
                <img src={detailOrder.photo_outlet_url} alt="Outlet" className="w-full h-24 object-cover rounded-xl border border-slate-200" />
              ) : (
                <div className="w-full h-24 bg-slate-100 rounded-xl flex items-center justify-center text-[10px] text-slate-400">Belum Ada</div>
              )}
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-400 block mb-1">Antar</span>
              {detailOrder.photo_delivery_url ? (
                <img src={detailOrder.photo_delivery_url} alt="Delivery" className="w-full h-24 object-cover rounded-xl border border-slate-200" />
              ) : (
                <div className="w-full h-24 bg-slate-100 rounded-xl flex items-center justify-center text-[10px] text-slate-400">Belum Ada</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="p-3 bg-slate-50 border-t border-slate-100">
        <button
          type="button"
          onClick={() => setDetailOrder(null)}
          className="w-full py-2 bg-slate-800 text-white font-bold rounded-xl text-xs cursor-pointer"
        >
          Tutup
        </button>
      </div>

    </div>
  </div>
)}
      {customerData && <AIChatWidget customerPhone={customerPhone} />}
    </div>
  );
}
