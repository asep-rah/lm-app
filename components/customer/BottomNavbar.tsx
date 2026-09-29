'use client';

import { useEffect, useRef, useState } from 'react';
import { Home, ListTodo, MessageSquare, User } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import {
  chatBelongsToCustomer,
  countUnreadCustomerChats,
  isIncomingStaffChat,
  markCustomerChatsRead
} from '@/lib/customerChatUnread';
import { canonicalPhone, phoneVariants, threadKeyOf } from '@/lib/csChat';
import { phoneInFilter, threadKeyFilter } from '@/lib/realtimeFilter';
import {
  alertCustomerIncomingChat,
  ensurePushSubscription,
  registerPushWorker
} from '@/lib/notifications';
import { unlockOpsAudio } from '@/lib/opsNotify';

type Tab = 'home' | 'chat' | 'order' | 'activity' | 'profile' | 'deposit';

export default function BottomNavbar({
  activeTab,
  ongoingCount,
  customerPhone,
  onHome,
  onChat,
  onOrder,
  onActivity,
  onProfile
}: {
  activeTab: Tab;
  ongoingCount?: number;
  customerPhone?: string;
  onHome: () => void;
  onChat: () => void;
  onOrder: () => void;
  onActivity: () => void;
  onProfile: () => void;
}) {
  const item = (on: boolean) => (on ? 'text-brand-700' : 'text-slate-600');
  const tabClass = 'flex flex-col items-center justify-center gap-0.5 py-1 min-h-[2.75rem]';
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const inChatRef = useRef(activeTab === 'chat');
  inChatRef.current = activeTab === 'chat';

  const phone =
    String(customerPhone || (typeof window !== 'undefined' ? localStorage.getItem('laundry_customer_phone') : '') || '').trim();

  const refreshUnread = async (forPhone: string) => {
    const n = await countUnreadCustomerChats(forPhone);
    setUnreadChatCount(n);
  };

  const clearUnread = async (forPhone: string) => {
    setUnreadChatCount(0);
    await markCustomerChatsRead(forPhone);
  };

  useEffect(() => {
    if (!phone) {
      setUnreadChatCount(0);
      return;
    }
    void registerPushWorker();
    void ensurePushSubscription();
    void refreshUnread(phone);

    const canon = canonicalPhone(phone) || phone;
    // Hanya chat milik customer ini (nomor ATAU thread), bukan seluruh tabel.
    // Baris yang cocok di kedua filter datang dua kali → INSERT disaring per id.
    const seenIds = new Set<string>();
    const filters = [
      phoneInFilter('customer_phone', [...phoneVariants(phone)]),
      threadKeyFilter(threadKeyOf({ customer_phone: phone }))
    ].filter((f): f is string => Boolean(f));
    const onInsert = (payload: { new: Record<string, unknown> }) => {
      const row = payload.new;
      const id = String(row.id ?? '');
      if (id) {
        if (seenIds.has(id)) return;
        seenIds.add(id);
      }
      if (!chatBelongsToCustomer(row, phone) || !isIncomingStaffChat(row)) return;
      const viewingChat = inChatRef.current && typeof document !== 'undefined' && document.visibilityState === 'visible';
      if (viewingChat) {
        void clearUnread(phone);
        return;
      }
      alertCustomerIncomingChat({ preview: typeof row.message === 'string' ? row.message : undefined, inChat: false });
      setUnreadChatCount((n) => n + 1);
      void countUnreadCustomerChats(phone).then((n) => {
        if (n > 0) setUnreadChatCount(n);
      });
    };
    const onUpdate = (payload: { new: Record<string, unknown> }) => {
      if (!chatBelongsToCustomer(payload.new, phone)) return;
      void refreshUnread(phone);
    };
    let channel = supabase.channel('cust_nav_unread_' + canon);
    for (const filter of filters) {
      channel = channel
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_chats', filter }, onInsert)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'support_chats', filter }, onUpdate);
    }
    channel.subscribe();

    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshUnread(phone);
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
  }, [phone]);

  useEffect(() => {
    if (activeTab !== 'chat' || !phone) return;
    void clearUnread(phone);
  }, [activeTab, phone]);

  const openChat = () => {
    unlockOpsAudio();
    if (phone) void clearUnread(phone);
    onChat();
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto z-50">
      <div className="bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-[0_-8px_30px_rgba(15,23,42,0.08)] px-1 pt-1.5 pb-[max(0.55rem,env(safe-area-inset-bottom))]">
        <div className="grid grid-cols-5 items-center">
          <button type="button" onClick={onHome} className={`${tabClass} ${item(activeTab === 'home')}`}>
            <Home className="w-5 h-5" strokeWidth={2.2} />
            <span className="text-[10px] font-extrabold">Beranda</span>
          </button>
          <button type="button" onClick={openChat} className={`relative ${tabClass} ${item(activeTab === 'chat')}`}>
            <MessageSquare className="w-5 h-5" strokeWidth={2.2} />
            {unreadChatCount > 0 && (
              <span className="absolute top-0 right-[18%] min-w-[15px] h-[15px] px-1.5 rounded-full bg-red-500 text-white text-[8px] font-black flex items-center justify-center">
                {unreadChatCount > 99 ? '99+' : unreadChatCount}
              </span>
            )}
            <span className="text-[10px] font-extrabold">Chat</span>
          </button>
          <button
            type="button"
            onClick={onOrder}
            aria-label="Order"
            className={`${tabClass} mx-0.5 rounded-xl text-white ${
              activeTab === 'order'
                ? 'bg-gradient-to-br from-brand-500 via-brand-600 to-indigo-700'
                : 'bg-brand-600'
            }`}
          >
            {/* Official Laundrivery collar mark — white on blue tab */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/logo-laundrivery-mark.svg"
              alt=""
              width={24}
              height={24}
              className="w-6 h-6 object-contain"
            />
            <span className="text-[10px] font-extrabold">Order</span>
          </button>
          <button type="button" onClick={onActivity} className={`relative ${tabClass} ${item(activeTab === 'activity')}`}>
            <ListTodo className="w-5 h-5" strokeWidth={2.2} />
            {!!ongoingCount && (
              <span className="absolute top-0 right-[18%] min-w-[15px] h-[15px] px-1 rounded-full bg-brand-600 text-white text-[8px] font-black flex items-center justify-center">
                {ongoingCount > 99 ? '99+' : ongoingCount}
              </span>
            )}
            <span className="text-[10px] font-extrabold">Aktivitas</span>
          </button>
          <button type="button" onClick={onProfile} className={`${tabClass} ${item(activeTab === 'profile')}`}>
            <User className="w-5 h-5" strokeWidth={2.2} />
            <span className="text-[10px] font-extrabold">Profil</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
