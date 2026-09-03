'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { getStaffSession, isCsRole } from '@/lib/staffSession';
import { isStaffOnlyMessage } from '@/lib/csChat';
import { notifyOps, unlockOpsAudio } from '@/lib/opsNotify';
import { ensurePushSubscription } from '@/lib/notifications';
import { isOpenComplaint, isPendingPickup, unreadChatCountOf } from '@/lib/csPortal';

type CsPortalValue = {
  agent: { id: string; name: string; role: string };
  unreadChats: number;
  pendingPickups: number;
  urgentComplaints: number;
  unlockAudio: () => void;
};

const EMPTY_AGENT = { id: '', name: '', role: 'cs' };

const CsPortalContext = createContext<CsPortalValue>({
  agent: EMPTY_AGENT,
  unreadChats: 0,
  pendingPickups: 0,
  urgentComplaints: 0,
  unlockAudio: () => {}
});

export const useCsPortal = () => useContext(CsPortalContext);

const showBrowserPush = async (title: string, body: string, url: string) => {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg?.showNotification) {
      await reg.showNotification(title, {
        body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: { url }
      });
      return;
    }
  } catch {
    /* fall through */
  }
  try {
    new Notification(title, { body, icon: '/icon-192.png' });
  } catch {
    /* ignore */
  }
};

export default function CsPortalProvider({ children }: { children: React.ReactNode }) {
  const [agent, setAgent] = useState(EMPTY_AGENT);
  const [unreadChats, setUnreadChats] = useState(0);
  const [pendingPickups, setPendingPickups] = useState(0);
  const [urgentComplaints, setUrgentComplaints] = useState(0);
  const seenRef = useRef(new Set<string>());

  const refreshCounts = useCallback(async () => {
    const [{ data: sessions }, { data: pkps }, { data: issues }, { data: tickets }] = await Promise.all([
      supabase.from('support_chat_sessions').select('thread_key, customer_phone, is_claimed, is_resolved, status, last_sender_type'),
      supabase.from('pickup_orders').select('id, status, driver_name'),
      supabase.from('outlet_issues').select('id, category, title, description, status, workflow_step, assigned_to_role, urgency').limit(120),
      supabase.from('complaint_tickets').select('id, status, issue_description, outlet_issue_id, transaction_id').limit(80)
    ]);
    setUnreadChats(unreadChatCountOf(sessions || []));
    setPendingPickups((pkps || []).filter(isPendingPickup).length);
    const openIssues = (issues || []).filter(isOpenComplaint);
    const openTickets = (tickets || []).filter((t: any) => {
      const st = String(t.status || '').toLowerCase();
      return st === 'open' || st === 'urgent' || st === 'pending' || (!st && isOpenComplaint(t));
    });
    const issueIds = new Set(openIssues.map((i: any) => String(i.id)));
    const extraTickets = openTickets.filter((t: any) => !t.outlet_issue_id || !issueIds.has(String(t.outlet_issue_id)));
    setUrgentComplaints(openIssues.length + extraTickets.length);
  }, []);

  const ping = useCallback(
    (key: string, kind: 'chat' | 'pickup' | 'complaint', text: string, url: string) => {
      if (seenRef.current.has(key)) return;
      seenRef.current.add(key);
      if (seenRef.current.size > 200) {
        seenRef.current = new Set([...seenRef.current].slice(-80));
      }
      notifyOps(kind, text, true);
      void showBrowserPush(kind === 'chat' ? 'Live Chat' : kind === 'pickup' ? 'Pickup baru' : 'Komplain urgent', text, url);
    },
    []
  );

  const unlockAudio = useCallback(() => {
    unlockOpsAudio();
    void ensurePushSubscription();
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    const session = getStaffSession();
    setAgent({ id: session.id, name: session.name, role: session.role });
  }, []);

  useEffect(() => {
    if (!agent.id && !agent.name) return;
    if (!isCsRole(agent.role) && agent.role !== 'owner' && agent.role !== 'supervisor') return;
    refreshCounts();
    const ch = supabase
      .channel(`cs_portal_badges_${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_chats' }, (payload) => {
        const row: any = payload.new;
        const sender = String(row?.sender_type || '').toLowerCase();
        if (payload.eventType === 'INSERT' && sender === 'customer' && !isStaffOnlyMessage(row)) {
          ping(`chat:${row.id}`, 'chat', 'Pesan baru dari pelanggan.', '/cs');
        }
        refreshCounts();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_chat_messages' }, (payload) => {
        const row: any = payload.new;
        const sender = String(row?.sender_type || '').toLowerCase();
        if (payload.eventType === 'INSERT' && sender === 'customer' && !isStaffOnlyMessage(row)) {
          ping(`chatm:${row.id}`, 'chat', 'Pesan baru dari pelanggan.', '/cs');
        }
        refreshCounts();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_chat_sessions' }, () => {
        refreshCounts();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pickup_orders' }, (payload) => {
        const row: any = payload.new;
        if (payload.eventType === 'INSERT' && row?.id) {
          ping(`pkp:${row.id}`, 'pickup', 'Pickup online baru. Assign driver atau kurir instan.', '/cs/dashboard');
        }
        refreshCounts();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'outlet_issues' }, (payload) => {
        const row: any = payload.new;
        if (payload.eventType === 'INSERT' && isOpenComplaint(row)) {
          ping(`iss:${row.id}`, 'complaint', 'Tiket komplain baru. Perlu penanganan CS Care.', '/cs/care');
        }
        refreshCounts();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'complaint_tickets' }, () => {
        refreshCounts();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [agent.id, agent.name, agent.role, ping, refreshCounts]);

  const value = useMemo(
    () => ({
      agent: { id: agent.id, name: agent.name, role: agent.role },
      unreadChats,
      pendingPickups,
      urgentComplaints,
      unlockAudio
    }),
    [agent.id, agent.name, agent.role, unreadChats, pendingPickups, urgentComplaints, unlockAudio]
  );

  return <CsPortalContext.Provider value={value}>{children}</CsPortalContext.Provider>;
}
