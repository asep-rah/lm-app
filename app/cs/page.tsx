'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { getStaffSession } from '@/lib/staffSession';
import {
  claimThread,
  insertChatMessage,
  isStaffOnlyMessage,
  phoneFromThread,
  phoneVariants,
  resolveThread,
  threadKeyOf,
  upsertChatSession
} from '@/lib/csChat';
import { CS_MACROS } from '@/lib/csMacros';
import { createSupervisorIssueTask } from '@/lib/createOutletIssueTask';
import { insertWithFallback } from '@/lib/safeWrite';
import StageTimeline from '@/components/StageTimeline';
import KpiRoleMonitoring from '@/components/KpiRoleMonitoring';
import StatusBadge from '@/components/ui/StatusBadge';
import { toast } from '@/lib/toast';

type Thread = {
  key: string;
  phone: string;
  preview: string;
  lastAt: string;
  lastSender: string;
  waitingFrom: number;
  assignedId: string;
  assignedName: string;
  claimed: boolean;
  resolved: boolean;
};

const waitTone = (ms: number) => (ms < 60_000 ? 'emerald' : ms < 180_000 ? 'amber' : 'rose');

const fmtWait = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `Waiting ${s}s`;
  return `Waiting ${Math.floor(s / 60)}m ${s % 60}s`;
};

const fmtDur = (ms: number) => {
  if (!ms || !isFinite(ms)) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};

const playChime = () => {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.07, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    /* ignore */
  }
};

export default function CsCommandCenter() {
  const agent = useMemo(() => getStaffSession(), []);
  const [filter, setFilter] = useState<'unassigned' | 'mine' | 'all'>('unassigned');
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [macroQ, setMacroQ] = useState('');
  const [macroOpen, setMacroOpen] = useState(false);
  const [drafts, setDrafts] = useState<string[]>([]);
  const [viewers, setViewers] = useState<{ id: string; name: string }[]>([]);
  const [typingName, setTypingName] = useState('');
  const [drawer, setDrawer] = useState(true);
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [handoverTo, setHandoverTo] = useState('');
  const [handoverReason, setHandoverReason] = useState('');
  const [colleagues, setColleagues] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [pickups, setPickups] = useState<any[]>([]);
  const [spend, setSpend] = useState(0);
  const [logs, setLogs] = useState<any[]>([]);
  const [stats, setStats] = useState({ resolved: 0, avgMs: 0, csat: 0, target: 20 });
  const [noteMode, setNoteMode] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());
  const seenIds = useRef(new Set<string>());
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presenceRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const selected = threads.find((t) => t.key === selectedKey) || null;
  const isMine = selected?.assignedId === agent.id || selected?.assignedName === agent.name;
  const canSend = !!selected && selected.claimed && isMine && !selected.resolved;
  const phone = selected ? selected.phone : '';

  const loadThreads = useCallback(async () => {
    const [{ data: msgs }, { data: sessions }] = await Promise.all([
      supabase.from('support_chats').select('*').order('created_at', { ascending: false }).limit(900),
      supabase.from('support_chat_sessions').select('*')
    ]);
    const sessMap: Record<string, any> = {};
    (sessions || []).forEach((s: any) => {
      sessMap[s.thread_key] = s;
    });

    const groups: Record<string, any[]> = {};
    (msgs || []).forEach((m: any) => {
      const k = threadKeyOf(m);
      (groups[k] ||= []).push(m);
    });

    const next: Thread[] = Object.entries(groups)
      .filter(([k]) => k !== 'unknown')
      .map(([key, list]) => {
        const sorted = [...list].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        const last = sorted[sorted.length - 1];
        const lastCust = [...sorted].reverse().find((m) => String(m.sender_type).toLowerCase() === 'customer');
        const lastCs = [...sorted]
          .reverse()
          .find(
            (m) =>
              ['cs', 'admin', 'owner'].includes(String(m.sender_type).toLowerCase()) && !isStaffOnlyMessage(m)
          );
        const waitingFrom = lastCust && (!lastCs || new Date(lastCust.created_at) > new Date(lastCs.created_at))
          ? new Date(lastCust.created_at).getTime()
          : 0;
        const s = sessMap[key] || {};
        return {
          key,
          phone: phoneFromThread(key) || String(last?.customer_phone || ''),
          preview: String(last?.message || '').slice(0, 80),
          lastAt: last?.created_at || s.last_message_at || '',
          lastSender: String(last?.sender_type || s.last_sender_type || '').toLowerCase(),
          waitingFrom,
          assignedId: String(s.assigned_to_agent_id || last?.assigned_to_agent_id || ''),
          assignedName: String(s.assigned_to_agent_name || last?.assigned_to_agent_name || ''),
          claimed: !!(s.is_claimed || last?.is_claimed),
          resolved: !!s.is_resolved
        };
      })
      .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());

    setThreads(next);

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const mineToday = (sessions || []).filter(
      (s: any) =>
        (s.assigned_to_agent_id === agent.id || s.assigned_to_agent_name === agent.name) &&
        s.resolved_at &&
        new Date(s.resolved_at) >= start
    );
    const avgs = mineToday
      .map((s: any) => {
        const a = new Date(s.first_customer_at).getTime();
        const b = new Date(s.first_cs_at).getTime();
        if (isNaN(a) || isNaN(b) || b < a) return null;
        return b - a;
      })
      .filter((n: number | null): n is number => n !== null);
    const csatVals = mineToday.map((s: any) => Number(s.csat_score) || 0).filter((n: number) => n > 0);
    setStats({
      resolved: mineToday.length,
      avgMs: avgs.length ? avgs.reduce((s, n) => s + n, 0) / avgs.length : 0,
      csat: csatVals.length ? csatVals.reduce((s, n) => s + n, 0) / csatVals.length : 0,
      target: 20
    });
  }, [agent.id, agent.name]);

  const loadMessages = useCallback(async (key: string) => {
    const p = phoneFromThread(key);
    const variants = phoneVariants(p);
    let q = supabase.from('support_chats').select('*').order('created_at', { ascending: true });
    if (variants.length) {
      const orExpr = [...variants.map((v) => `customer_phone.eq.${v}`), `thread_key.eq.${key}`].join(',');
      q = q.or(orExpr);
    } else {
      q = q.eq('thread_key', key);
    }
    const { data } = await q.limit(400);
    setMessages(data || []);
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    });
  }, []);

  const loadContext = useCallback(async (p: string) => {
    if (!p) {
      setProfile(null);
      setOrders([]);
      setPickups([]);
      setSpend(0);
      setLogs([]);
      return;
    }
    const variants = phoneVariants(p);

    const [cust, txs, pks] = await Promise.all([
      supabase.from('customers').select('*').in('phone', variants).limit(1),
      supabase.from('transactions').select('*, outlets(name)').in('customer_phone', variants).order('created_at', { ascending: false }).limit(8),
      supabase.from('pickup_orders').select('*').in('customer_phone', variants).order('created_at', { ascending: false }).limit(6)
    ]);
    setProfile(cust.data?.[0] || null);
    setOrders(txs.data || []);
    setPickups(pks.data || []);
    setSpend((txs.data || []).reduce((s, t: any) => s + (Number(t.amount) || 0), 0));
    const txId = txs.data?.[0]?.id;
    if (txId) {
      const { data } = await supabase
        .from('work_logs')
        .select('stage, employee_name, created_at')
        .eq('transaction_id', txId)
        .order('created_at', { ascending: true });
      setLogs(data || []);
    } else setLogs([]);
  }, []);

  useEffect(() => {
    if (!agent.role || !['cs', 'supervisor', 'owner', 'head_cs'].includes(agent.role)) {
      if (typeof window !== 'undefined' && !localStorage.getItem('laundry_user') && !localStorage.getItem('laundry_owner_user')) {
        window.location.href = '/login';
      }
    }
    loadThreads();
    supabase.from('employees').select('id, name, role').then(({ data }) => {
      const rows = (data || []).filter((e: any) =>
        ['cs', 'supervisor', 'owner', 'head_cs'].includes(String(e.role || '').toLowerCase())
      );
      setColleagues((prev) => {
        const map: Record<string, any> = {};
        [...rows, ...prev].forEach((c) => {
          const k = String(c.id || c.name);
          map[k] = { ...c, ...map[k] };
        });
        return Object.values(map);
      });
    });

    const lobby = supabase.channel('cs-agents-online', {
      config: { presence: { key: agent.id || agent.name || 'cs' } }
    });
    lobby
      .on('presence', { event: 'sync' }, () => {
        const people: any[] = [];
        Object.values(lobby.presenceState()).forEach((arr: any) => {
          (arr || []).forEach((p: any) =>
            people.push({ id: p.id || p.name, name: p.name, role: p.role || 'cs', online: true })
          );
        });
        setColleagues((prev) => {
          const map: Record<string, any> = {};
          [...prev, ...people].forEach((c) => {
            const k = String(c.id || c.name);
            map[k] = { ...map[k], ...c };
          });
          return Object.values(map);
        });
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await lobby.track({ id: agent.id, name: agent.name, role: agent.role });
        }
      });

    const ch = supabase
      .channel('cs_command_chats')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_chats' }, (payload) => {
        const row: any = payload.new;
        if (row && String(row.sender_type).toLowerCase() === 'customer' && !isStaffOnlyMessage(row) && row.id && !seenIds.current.has(row.id)) {
          seenIds.current.add(row.id);
          if (audioReady) playChime();
        }
        loadThreads();
        if (selectedKey && threadKeyOf(row) === selectedKey) loadMessages(selectedKey);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_chat_sessions' }, () => loadThreads())
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
      supabase.removeChannel(lobby);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioReady, selectedKey]);

  useEffect(() => {
    if (!selectedKey) return;
    loadMessages(selectedKey);
    loadContext(phoneFromThread(selectedKey));

    const presence = supabase.channel('cs-view-' + selectedKey, {
      config: { presence: { key: agent.id || agent.name } }
    });
    presenceRef.current = presence;
    presence
      .on('presence', { event: 'sync' }, () => {
        const state = presence.presenceState();
        const people: { id: string; name: string }[] = [];
        Object.values(state).forEach((arr: any) => {
          (arr || []).forEach((p: any) => people.push({ id: p.id || p.name, name: p.name }));
        });
        setViewers(people.filter((p, i, a) => a.findIndex((x) => x.name === p.name) === i));
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload?.name && payload.name !== agent.name) {
          setTypingName(payload.name);
          window.setTimeout(() => setTypingName(''), 1800);
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presence.track({ id: agent.id, name: agent.name });
        }
      });

    return () => {
      presenceRef.current = null;
      supabase.removeChannel(presence);
    };
  }, [selectedKey, agent.id, agent.name, loadMessages, loadContext]);

  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const lastCust = [...messages].reverse().find((m) => String(m.sender_type).toLowerCase() === 'customer' && !isStaffOnlyMessage(m));
    if (!lastCust || !canSend) {
      setDrafts([]);
      return;
    }
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch('/api/cs/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lastCustomerMessage: lastCust.message,
            messages: messages.filter((m) => !isStaffOnlyMessage(m)).slice(-8)
          })
        });
        const data = await res.json();
        setDrafts(Array.isArray(data.drafts) ? data.drafts : []);
      } catch {
        setDrafts([]);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [messages, canSend]);

  const visibleThreads = threads.filter((t) => {
    if (filter === 'unassigned') return !t.claimed && !t.resolved;
    if (filter === 'mine') return t.claimed && (t.assignedId === agent.id || t.assignedName === agent.name) && !t.resolved;
    return !t.resolved;
  });

  const send = async (text: string, internal = false) => {
    const body = text.trim();
    if (!body || !selected) return;
    if (!internal && !canSend) return toast('Klaim chat dulu sebelum membalas.', 'warn');
    if (internal && !isMine && selected.claimed) return toast('Hanya agen pemegang yang bisa menulis catatan.', 'warn');

    setInput('');
    setMacroOpen(false);
    const { error } = await insertChatMessage({
      customer_phone: selected.phone,
      sender_type: internal ? 'internal' : 'cs',
      message: body,
      sender_name: agent.name,
      is_internal: internal,
      assigned_to_agent_id: agent.id,
      assigned_to_agent_name: agent.name,
      is_claimed: true
    });
    if (error) {
      toast('Gagal kirim: ' + error.message, 'err');
      return;
    }
    const firstCs = !messages.some((m) => ['cs', 'admin'].includes(String(m.sender_type).toLowerCase()));
    const firstCust = messages.find((m) => String(m.sender_type).toLowerCase() === 'customer');
    await upsertChatSession({
      thread_key: selected.key,
      customer_phone: selected.phone,
      assigned_to_agent_id: agent.id,
      assigned_to_agent_name: agent.name,
      is_claimed: true,
      last_message_at: new Date().toISOString(),
      last_sender_type: internal ? 'internal' : 'cs',
      last_preview: body.slice(0, 80),
      first_cs_at: firstCs ? new Date().toISOString() : undefined,
      first_customer_at: firstCust?.created_at
    });
    loadMessages(selected.key);
    loadThreads();
  };

  const broadcastTyping = () => {
    if (!selectedKey || !presenceRef.current) return;
    presenceRef.current.send({ type: 'broadcast', event: 'typing', payload: { name: agent.name } });
  };

  const handleClaim = async () => {
    if (!selected || selected.claimed) return;
    const firstCust = messages.find((m) => String(m.sender_type).toLowerCase() === 'customer');
    await claimThread(selected.key, { id: agent.id, name: agent.name }, selected.phone, {
      first_customer_at: firstCust?.created_at || new Date().toISOString()
    });
    toast('Chat diklaim. Anda pemegang thread ini.', 'ok');
    loadThreads();
  };

  const handleHandover = async () => {
    if (!selected || !handoverTo) return;
    const other = colleagues.find((c) => String(c.id) === handoverTo || c.name === handoverTo);
    const name = other?.name || handoverTo;
    const id = String(other?.id || handoverTo);
    await claimThread(selected.key, { id, name }, selected.phone);
    await upsertChatSession({
      thread_key: selected.key,
      handover_reason: handoverReason || null
    });
    await insertChatMessage({
      customer_phone: selected.phone,
      sender_type: 'internal',
      message: `Handover ke ${name}. ${handoverReason || ''}`.trim(),
      sender_name: agent.name,
      is_internal: true,
      assigned_to_agent_id: id,
      assigned_to_agent_name: name,
      is_claimed: true
    });
    setHandoverOpen(false);
    setHandoverReason('');
    toast('Chat ditransfer ke ' + name, 'ok');
    loadThreads();
    loadMessages(selected.key);
  };

  const handleResolve = async (csat: number) => {
    if (!selected) return;
    await resolveThread(selected.key, csat);
    toast('Chat diselesaikan.', 'ok');
    loadThreads();
  };

  const escalate = async (kind: 'issue' | 'task') => {
    if (!selected) return;
    const lastCust = [...messages].reverse().find((m) => String(m.sender_type).toLowerCase() === 'customer');
    const desc = lastCust?.message || 'Komplain dari live chat';
    const outletId = orders[0]?.outlet_id || pickups[0]?.outlet_id || agent.outletId;
    if (kind === 'issue') {
      if (!outletId) return toast('Tidak ada outlet pada riwayat pelanggan.', 'warn');
      const { data, error } = await insertWithFallback<{ id: string }>('outlet_issues', [
        {
          outlet_id: outletId,
          category: 'Komplain Pelanggan',
          description: `${selected.phone}: ${desc}`,
          reporter_name: agent.name,
          status: 'Sedang Diproses'
        },
        {
          outlet_id: outletId,
          category: 'Komplain Pelanggan',
          description: `${selected.phone}: ${desc}`,
          status: 'Sedang Diproses'
        },
        { outlet_id: outletId, description: desc }
      ], { select: 'id' });
      if (error || !data?.[0]?.id) return toast(error?.message || 'Gagal buat tiket', 'err');
      await createSupervisorIssueTask({
        id: data[0].id,
        category: 'Komplain Pelanggan',
        description: desc,
        reporter_name: agent.name,
        urgency: 'mendesak'
      });
      toast('Tiket outlet_issues + task Supervisor dibuat.', 'ok');
    } else {
      const due = new Date();
      due.setHours(due.getHours() + 8);
      const { error } = await insertWithFallback('system_tasks', [
        {
          title: `Chat komplain ${selected.phone}`,
          description: desc,
          assigned_to_role: 'supervisor',
          sla_hours: 8,
          due_date: due.toISOString(),
          kpi_penalty_points: 10,
          created_by_name: agent.name,
          status: 'pending',
          source_type: 'CS_CHAT'
        },
        {
          title: `Chat komplain ${selected.phone}`,
          description: desc,
          assigned_to_role: 'supervisor',
          due_date: due.toISOString(),
          status: 'pending'
        },
        {
          title: `Chat komplain ${selected.phone}`,
          description: desc,
          assigned_to_role: 'supervisor',
          status: 'pending'
        }
      ]);
      if (error) return toast(error.message, 'err');
      toast('system_tasks Supervisor dibuat.', 'ok');
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawer(false);
      if ((e.ctrlKey || e.metaKey) && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const idx = visibleThreads.findIndex((t) => t.key === selectedKey);
        const next = e.key === 'ArrowDown' ? idx + 1 : idx - 1;
        const t = visibleThreads[Math.max(0, Math.min(visibleThreads.length - 1, next))];
        if (t) setSelectedKey(t.key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visibleThreads, selectedKey]);

  const macros = CS_MACROS.filter(
    (m) =>
      !macroQ ||
      m.label.toLowerCase().includes(macroQ.toLowerCase()) ||
      m.body.toLowerCase().includes(macroQ.toLowerCase())
  );
  const ring = Math.min(100, Math.round((stats.resolved / stats.target) * 100));
  const unassignedCount = threads.filter((t) => !t.claimed && !t.resolved).length;
  const liveWait = (t: Thread) => (t.waitingFrom ? nowTick - t.waitingFrom : 0);

  return (
    <div
      className="h-screen bg-slate-50 text-slate-900 flex flex-col overflow-hidden"
      onPointerDown={() => setAudioReady(true)}
    >
      <header className="bg-white border-b border-slate-200/80 px-4 py-2.5 flex items-center gap-4 shrink-0">
        <div className="min-w-[160px]">
          <p className="text-[10px] font-bold uppercase tracking-widest text-sky-600">CS Command Center</p>
          <p className="text-sm font-black text-slate-900 flex items-center gap-2">
            {agent.name}
            {unassignedCount > 0 && <StatusBadge tone="rose">{unassignedCount} antri</StatusBadge>}
          </p>
        </div>
        <div className="flex-1 grid grid-cols-4 gap-2">
          <div className="bg-slate-50 rounded-xl px-3 py-1.5 border border-slate-200/80">
            <p className="text-[9px] text-slate-400 font-bold uppercase">Resolved today</p>
            <p className="text-sm font-black text-slate-900">{stats.resolved}</p>
          </div>
          <div className="bg-slate-50 rounded-xl px-3 py-1.5 border border-slate-200/80">
            <p className="text-[9px] text-slate-400 font-bold uppercase">Avg response</p>
            <p className="text-sm font-black text-slate-900">{fmtDur(stats.avgMs)}</p>
          </div>
          <div className="bg-slate-50 rounded-xl px-3 py-1.5 border border-slate-200/80">
            <p className="text-[9px] text-slate-400 font-bold uppercase">CSAT</p>
            <p className="text-sm font-black text-amber-600">
              {stats.csat ? '★'.repeat(Math.round(stats.csat)) + ` ${stats.csat.toFixed(1)}` : '—'}
            </p>
          </div>
          <div className="bg-slate-50 rounded-xl px-3 py-1.5 border border-slate-200/80 flex items-center gap-2">
            <svg viewBox="0 0 36 36" className="w-8 h-8">
              <path d="M18 2 a 16 16 0 1 1 0 32 a 16 16 0 1 1 0 -32" fill="none" stroke="#e2e8f0" strokeWidth="4" />
              <path
                d="M18 2 a 16 16 0 1 1 0 32 a 16 16 0 1 1 0 -32"
                fill="none"
                stroke="#10b981"
                strokeWidth="4"
                strokeDasharray={`${ring}, 100`}
              />
            </svg>
            <div>
              <p className="text-[9px] text-slate-400 font-bold uppercase">Daily goal</p>
              <p className="text-xs font-black text-slate-900">
                {stats.resolved}/{stats.target}
              </p>
            </div>
          </div>
        </div>
        <Link href="/cs/dashboard" className="text-[11px] font-bold text-slate-500 border border-slate-200 rounded-xl px-3 py-2">
          Ops Dashboard
        </Link>
      </header>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0">
        <aside className="lg:col-span-3 border-r border-slate-200/80 bg-white flex flex-col min-h-0">
          <div className="p-2 flex gap-1 border-b border-slate-100">
            {(['unassigned', 'mine', 'all'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex-1 text-[10px] font-bold py-1.5 rounded-lg ${
                  filter === f ? 'bg-sky-500 text-white' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                {f === 'unassigned' ? `Unassigned${unassignedCount ? ` (${unassignedCount})` : ''}` : f === 'mine' ? 'Saya' : 'Aktif'}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {visibleThreads.map((t) => (
              <button
                key={t.key}
                onClick={() => setSelectedKey(t.key)}
                className={`w-full text-left px-3 py-2.5 border-b border-slate-50 ${
                  selectedKey === t.key ? 'bg-sky-50' : 'hover:bg-slate-50'
                }`}
              >
                <div className="flex justify-between gap-2">
                  <p className="text-xs font-black text-slate-900 truncate">{t.phone || t.key}</p>
                  {liveWait(t) > 0 && (
                    <StatusBadge tone={waitTone(liveWait(t)) as any}>{fmtWait(liveWait(t))}</StatusBadge>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 truncate mt-0.5">{t.preview}</p>
                <p className="text-[9px] text-slate-400 mt-0.5">
                  {t.claimed ? t.assignedName || 'Claimed' : 'Unassigned'}
                </p>
              </button>
            ))}
            {visibleThreads.length === 0 && (
              <p className="text-xs text-slate-400 p-6 text-center">Tidak ada percakapan di antrean ini.</p>
            )}
          </div>
        </aside>

        <main className={`${drawer ? 'lg:col-span-6' : 'lg:col-span-9'} flex flex-col min-h-0 bg-slate-50`}>
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-400">Pilih percakapan di kiri</div>
          ) : (
            <>
              <div className="bg-white border-b border-slate-200/80 px-4 py-2.5 flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-black text-slate-900">{selected.phone}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    {viewers.map((v) => (
                      <span
                        key={v.id + v.name}
                        title={v.name}
                        className="w-5 h-5 rounded-full bg-sky-500 text-white text-[9px] font-black flex items-center justify-center"
                      >
                        {v.name.slice(0, 1).toUpperCase()}
                      </span>
                    ))}
                    {typingName && (
                      <span className="text-[10px] text-amber-600 font-bold">{typingName} sedang mengetik…</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => setDrawer(true)} className="text-[10px] font-bold border border-slate-200 rounded-lg px-2 py-1">
                    Info
                  </button>
                  {!selected.claimed ? (
                    <button onClick={handleClaim} className="text-[10px] font-bold bg-emerald-500 text-white rounded-lg px-3 py-1.5">
                      Ambil Chat
                    </button>
                  ) : isMine ? (
                    <>
                      <button onClick={() => setHandoverOpen(true)} className="text-[10px] font-bold border border-slate-200 rounded-lg px-2 py-1">
                        Transfer
                      </button>
                      <button onClick={() => handleResolve(5)} className="text-[10px] font-bold bg-sky-500 text-white rounded-lg px-2 py-1">
                        Selesai
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              {selected.claimed && !isMine && (
                <div className="bg-amber-50 text-amber-800 text-[11px] font-bold px-4 py-2 border-b border-amber-100">
                  Chat ini dipegang oleh {selected.assignedName || 'agen lain'} — mode baca saja.
                </div>
              )}

              <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-2">
                {messages.map((m) => {
                  const internal = isStaffOnlyMessage(m);
                  const mine = ['cs', 'admin', 'owner'].includes(String(m.sender_type).toLowerCase()) && !internal;
                  return (
                    <div key={m.id} className={`flex ${mine || internal ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[78%] rounded-2xl px-3 py-2 text-xs shadow-sm ${
                          internal
                            ? 'bg-amber-50 border border-amber-200 text-amber-900'
                            : mine
                            ? 'bg-sky-50 border border-sky-100 text-slate-900 rounded-br-sm'
                            : 'bg-white border border-slate-200/80 text-slate-800 rounded-bl-sm'
                        }`}
                      >
                        {internal && <p className="text-[9px] font-black uppercase mb-0.5">Catatan internal</p>}
                        <p>{m.message}</p>
                        <p className="text-[9px] text-slate-400 mt-1 text-right">
                          {m.sender_name ? `${m.sender_name} · ` : ''}
                          {new Date(m.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {canSend && drafts.length > 0 && (
                <div className="px-3 pb-1 flex gap-1.5 overflow-x-auto">
                  {drafts.map((d, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setInput(d);
                        inputRef.current?.focus();
                      }}
                      className="shrink-0 max-w-[240px] text-left text-[10px] bg-white border border-sky-100 rounded-xl px-2.5 py-1.5 text-slate-600 hover:border-sky-400"
                    >
                      {d.slice(0, 90)}
                    </button>
                  ))}
                </div>
              )}

              <div className="p-3 bg-white border-t border-slate-200/80 relative">
                {macroOpen && (
                  <div className="absolute bottom-full left-3 right-3 mb-1 bg-white border border-slate-200 rounded-xl shadow-md max-h-48 overflow-y-auto z-10">
                    <input
                      autoFocus
                      value={macroQ}
                      onChange={(e) => setMacroQ(e.target.value)}
                      placeholder="Cari macro…"
                      className="w-full border-b border-slate-100 px-3 py-2 text-xs"
                    />
                    {macros.map((m) => (
                      <button
                        key={m.key}
                        onClick={() => {
                          setInput(m.body);
                          setMacroOpen(false);
                          inputRef.current?.focus();
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-slate-50"
                      >
                        <p className="text-[11px] font-black text-slate-900">{m.label}</p>
                        <p className="text-[10px] text-slate-400 truncate">{m.body}</p>
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <button
                    type="button"
                    onClick={() => setNoteMode(!noteMode)}
                    className={`text-[10px] font-bold px-2 py-2 rounded-lg border ${
                      noteMode ? 'bg-amber-50 border-amber-200 text-amber-800' : 'border-slate-200 text-slate-500'
                    }`}
                  >
                    Note
                  </button>
                  <textarea
                    ref={inputRef}
                    rows={2}
                    disabled={!canSend && !noteMode}
                    value={input}
                    onChange={(e) => {
                      const v = e.target.value;
                      setInput(v);
                      if (v === '/') {
                        setMacroOpen(true);
                        setMacroQ('');
                      }
                      if (typingTimer.current) clearTimeout(typingTimer.current);
                      typingTimer.current = setTimeout(broadcastTyping, 200);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        send(input, noteMode);
                      }
                      if (e.key === 'Escape') setMacroOpen(false);
                    }}
                    placeholder={
                      noteMode
                        ? 'Catatan internal (tidak terlihat pelanggan)…'
                        : canSend
                        ? 'Balas pelanggan · / macro · Enter kirim'
                        : 'Klaim chat untuk membalas'
                    }
                    className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-xs resize-none disabled:bg-slate-50"
                  />
                  <button
                    onClick={() => send(input, noteMode)}
                    disabled={!input.trim() || (!canSend && !noteMode)}
                    className="bg-sky-500 disabled:opacity-40 text-white font-bold text-xs px-4 py-2.5 rounded-xl"
                  >
                    Kirim
                  </button>
                </div>
              </div>
            </>
          )}
        </main>

        <aside className={`${drawer ? 'lg:col-span-3' : 'hidden'} bg-white border-l border-slate-200/80 overflow-y-auto`}>
          <div className="p-4 space-y-4">
            <div className="flex justify-between">
              <h3 className="text-xs font-black text-slate-900 uppercase">Customer</h3>
              <button onClick={() => setDrawer(false)} className="text-[10px] text-slate-400">
                Tutup
              </button>
            </div>
            <div>
              <p className="text-sm font-black text-slate-900">{profile?.name || 'Pelanggan'}</p>
              <p className="text-xs text-slate-500 font-mono">{phone}</p>
              <p className="text-xs font-bold text-emerald-600 mt-1">Lifetime Rp {spend.toLocaleString('id-ID')}</p>
            </div>
            <div className="flex gap-1.5">
              <a
                href={`https://wa.me/${phone.startsWith('0') ? '62' + phone.slice(1) : phone}`}
                target="_blank"
                rel="noreferrer"
                className="flex-1 text-center text-[10px] font-bold bg-emerald-50 text-emerald-700 py-2 rounded-xl"
              >
                WhatsApp
              </a>
              <Link href="/cs/dashboard" className="flex-1 text-center text-[10px] font-bold bg-sky-50 text-sky-700 py-2 rounded-xl">
                Pickup
              </Link>
            </div>
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Order aktif</p>
              {orders.slice(0, 4).map((o) => (
                <div key={o.id} className="text-[11px] border border-slate-100 rounded-xl p-2 mb-1.5">
                  <p className="font-bold">{o.receipt_number || o.service_type}</p>
                  <p className="text-slate-400">
                    {o.status} · Rp {Number(o.amount || 0).toLocaleString('id-ID')}
                  </p>
                </div>
              ))}
              {orders.length === 0 && <p className="text-[11px] text-slate-400">Tidak ada transaksi.</p>}
            </div>
            {orders[0] && (
              <StageTimeline logs={logs} transaction={orders[0]} showCrew={false} title="Timeline" />
            )}
            <div className="space-y-1.5 pt-2 border-t border-slate-100">
              <p className="text-[10px] font-black text-slate-400 uppercase">Eskalasi</p>
              <button
                onClick={() => escalate('issue')}
                className="w-full text-[11px] font-bold border border-amber-200 bg-amber-50 text-amber-800 py-2 rounded-xl"
              >
                Buat tiket outlet_issues
              </button>
              <button
                onClick={() => escalate('task')}
                className="w-full text-[11px] font-bold border border-slate-200 py-2 rounded-xl"
              >
                Assign task Supervisor
              </button>
              {selected && isMine && (
                <div className="flex gap-1 pt-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => handleResolve(n)}
                      className="flex-1 text-xs py-1 rounded-lg bg-slate-50 hover:bg-amber-50"
                      title="CSAT lalu selesaikan"
                    >
                      {n <= 2 ? '🙁' : n === 3 ? '😐' : '🙂'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {handoverOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-3 shadow-lg">
            <h3 className="text-sm font-black text-slate-900">Transfer chat</h3>
            <select
              value={handoverTo}
              onChange={(e) => setHandoverTo(e.target.value)}
              className="w-full border border-slate-200 rounded-xl p-2 text-xs"
            >
              <option value="">Pilih CS / Supervisor online…</option>
              {colleagues
                .filter((c) => c.name !== agent.name)
                .map((c) => (
                  <option key={c.id || c.name} value={c.id || c.name}>
                    {c.name} ({c.role || 'CS'}){c.online ? ' · online' : ''}
                  </option>
                ))}
            </select>
            <textarea
              rows={2}
              value={handoverReason}
              onChange={(e) => setHandoverReason(e.target.value)}
              placeholder="Alasan handover"
              className="w-full border border-slate-200 rounded-xl p-2 text-xs"
            />
            <div className="flex gap-2">
              <button onClick={() => setHandoverOpen(false)} className="flex-1 text-xs font-bold border rounded-xl py-2">
                Batal
              </button>
              <button onClick={handleHandover} className="flex-1 text-xs font-bold bg-sky-500 text-white rounded-xl py-2">
                Transfer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
