'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ArrowLeft, MessageCircle, Search, Send, Users, X } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { getStaffSession } from '@/lib/staffSession';
import {
  canAccessOutletGroupChat,
  canSwitchOutletGroupChat,
  isCustomerFacingPath,
  OPEN_OUTLET_GROUP_CHAT_EVENT
} from '@/lib/outletGroupChat';
import { matchOutletUuid, resolveOutletUuid, uuidOrNull } from '@/lib/outletUuid';
import { toast } from '@/lib/toast';

type ChatRow = {
  id: string;
  outlet_id: string;
  sender_name?: string;
  sender_role?: string;
  message: string;
  created_at: string;
};

type OutletRow = { id: string; name: string };

const NAME_COLORS = [
  '#e17076',
  '#7bc862',
  '#e5b567',
  '#65aadd',
  '#a695e7',
  '#ee7aae',
  '#6ec9cb',
  '#faa774'
];

const colorOf = (seed: string) => {
  let h = 0;
  const s = String(seed || 'x');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length];
};

const initialsOf = (name: string) => {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
};

const formatClock = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
};

const formatListTime = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return formatClock(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return 'Kemarin';
  }
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
};

const formatDayLabel = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return 'Hari ini';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return 'Kemarin';
  }
  return d.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
};

const dayKey = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

const friendlyChatSendError = (raw?: string) => {
  const msg = String(raw || '').toLowerCase();
  if (msg.includes('schema cache') || msg.includes('could not find') || msg.includes('does not exist')) {
    return 'Room chat belum siap. Muat ulang halaman, lalu coba kirim lagi.';
  }
  if (msg.includes('invalid input syntax') || msg.includes('foreign key') || msg.includes('violates')) {
    return 'Pesan tidak terkirim karena ID sesi tidak cocok. Coba lagi tanpa meninggalkan room.';
  }
  return 'Pesan belum terkirim. Coba lagi sebentar.';
};

function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const bg = colorOf(name);
  return (
    <div
      className="rounded-full flex items-center justify-center text-white font-bold shrink-0 shadow-sm"
      style={{ width: size, height: size, background: bg, fontSize: size * 0.32 }}
      aria-hidden
    >
      {initialsOf(name)}
    </div>
  );
}

export default function OutletGroupChatDrawer({ embedded = false }: { embedded?: boolean }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState('');
  const [name, setName] = useState('');
  const [outletId, setOutletId] = useState('');
  const [outlets, setOutlets] = useState<OutletRow[]>([]);
  const [previews, setPreviews] = useState<Record<string, ChatRow | null>>({});
  const [rows, setRows] = useState<ChatRow[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [customerOnly, setCustomerOnly] = useState(false);
  const [view, setView] = useState<'list' | 'room'>('list');
  const [query, setQuery] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const onPosPath = String(pathname || '').startsWith('/pos');
  const onOwnerPath = String(pathname || '').startsWith('/owner');
  const onCustomerSurface = isCustomerFacingPath(pathname) || customerOnly;
  const canUse = !onCustomerSurface && canAccessOutletGroupChat(role, pathname);
  const canSwitch = canSwitchOutletGroupChat(role);
  const skipRoom = onPosPath && !embedded;
  const hideFloatFab = onOwnerPath;
  const showListFirst = canSwitch;

  useEffect(() => {
    const staffRaw = localStorage.getItem('laundry_owner_user') || localStorage.getItem('laundry_user');
    const customerPhone = localStorage.getItem('laundry_customer_phone');
    setCustomerOnly(Boolean(customerPhone) && !staffRaw);
    if (!staffRaw) {
      setRole('');
      setReady(true);
      return;
    }
    const s = getStaffSession();
    setRole(s.role);
    setName(s.name);
    setOutletId(s.outletId || '');
    setReady(true);
  }, [pathname]);

  useEffect(() => {
    if (onCustomerSurface) setOpen(false);
  }, [onCustomerSurface]);

  useEffect(() => {
    const onOpenEv = () => {
      const s = getStaffSession();
      setOpen(true);
      setView(canSwitchOutletGroupChat(s.role) ? 'list' : 'room');
    };
    window.addEventListener(OPEN_OUTLET_GROUP_CHAT_EVENT, onOpenEv);
    return () => window.removeEventListener(OPEN_OUTLET_GROUP_CHAT_EVENT, onOpenEv);
  }, []);

  useEffect(() => {
    if (!canUse || skipRoom) return;
    supabase
      .from('outlets')
      .select('id, name')
      .order('name')
      .then(({ data }) => {
        const list = (data || []) as OutletRow[];
        setOutlets(list);
        setOutletId((cur) => matchOutletUuid(list, cur) || uuidOrNull(cur) || cur || list[0]?.id || '');
      });
  }, [canUse, skipRoom]);

  useEffect(() => {
    if (!showListFirst && outletId) setView('room');
  }, [showListFirst, outletId]);

  /** Preview pesan terakhir per room (daftar chat ala Telegram). */
  useEffect(() => {
    if (!canUse || skipRoom || !outlets.length) return;
    if (!open && !embedded) return;
    let cancelled = false;
    const loadPreviews = async () => {
      const { data } = await supabase
        .from('internal_outlet_chats')
        .select('id, outlet_id, sender_name, sender_role, message, created_at')
        .order('created_at', { ascending: false })
        .limit(400);
      if (cancelled) return;
      const map: Record<string, ChatRow | null> = {};
      for (const row of (data || []) as ChatRow[]) {
        const oid = String(row.outlet_id || '');
        if (!oid || map[oid]) continue;
        map[oid] = row;
      }
      setPreviews(map);
    };
    void loadPreviews();
    const ch = supabase
      .channel(`outlet_chat_previews_${embedded ? 'emb' : 'float'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'internal_outlet_chats' }, () =>
        void loadPreviews()
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [canUse, skipRoom, outlets.length, open, embedded]);

  useEffect(() => {
    if (skipRoom || !canUse || !outletId) return;
    const inRoom = view === 'room' || !showListFirst;
    if (!inRoom) return;

    let cancelled = false;
    const load = async () => {
      try {
        const roomId =
          uuidOrNull(outletId) ||
          matchOutletUuid(outlets, outletId) ||
          (await resolveOutletUuid(supabase, outletId, outlets));
        if (!roomId) {
          if (!cancelled) setRows([]);
          return;
        }
        const { data, error } = await supabase
          .from('internal_outlet_chats')
          .select('id, outlet_id, sender_name, sender_role, message, created_at')
          .eq('outlet_id', roomId)
          .order('created_at', { ascending: true })
          .limit(250);
        if (cancelled) return;
        if (error) {
          console.warn('internal_outlet_chats:', error.message);
          setRows([]);
          return;
        }
        setRows((data || []) as ChatRow[]);
      } catch (e) {
        console.warn('internal_outlet_chats load:', e);
        if (!cancelled) setRows([]);
      }
    };
    void load();
    const topic = `internal_outlet_chats_${outletId}_${embedded ? 'emb' : 'float'}_${Math.random().toString(36).slice(2, 8)}`;
    const ch = supabase
      .channel(topic)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'internal_outlet_chats' }, () => void load())
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [canUse, outletId, skipRoom, embedded, view, outlets, showListFirst]);

  useEffect(() => {
    if ((!embedded && !open) || view !== 'room') return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [rows.length, open, embedded, view]);

  useEffect(() => {
    if (view !== 'room' || (!open && !embedded)) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 120);
    return () => window.clearTimeout(t);
  }, [view, open, embedded, outletId]);

  const visibleOutlets = useMemo(() => {
    if (!canSwitch && outletId) return outlets.filter((o) => o.id === outletId);
    return outlets;
  }, [canSwitch, outlets, outletId]);

  const roomList = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = visibleOutlets
      .map((outlet) => ({ outlet, last: previews[outlet.id] || null }))
      .filter(
        (r) =>
          !q ||
          r.outlet.name.toLowerCase().includes(q) ||
          String(r.last?.message || '')
            .toLowerCase()
            .includes(q)
      );
    list.sort((a, b) => {
      const ta = a.last?.created_at ? new Date(a.last.created_at).getTime() : 0;
      const tb = b.last?.created_at ? new Date(b.last.created_at).getTime() : 0;
      if (tb !== ta) return tb - ta;
      return a.outlet.name.localeCompare(b.outlet.name, 'id');
    });
    return list;
  }, [visibleOutlets, previews, query]);

  const effectiveView: 'list' | 'room' = showListFirst ? view : 'room';

  const openRoom = (id: string) => {
    setOutletId(id);
    setView('room');
    setText('');
  };

  const backToList = () => {
    if (!showListFirst) {
      setOpen(false);
      return;
    }
    setView('list');
  };

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const msg = text.trim();
    if (!msg || sending || effectiveView !== 'room') return;
    setSending(true);
    try {
      const session = getStaffSession();
      const outletUuid =
        uuidOrNull(outletId) ||
        matchOutletUuid(outlets, outletId) ||
        (await resolveOutletUuid(supabase, outletId, outlets));
      const senderUuid = uuidOrNull(session.id);

      const attempts: Record<string, unknown>[] = [
        {
          ...(outletUuid ? { outlet_id: outletUuid } : {}),
          ...(senderUuid ? { sender_id: senderUuid } : {}),
          sender_name: name || session.name || 'Staf',
          sender_role: role || session.role || 'kasir',
          message: msg
        },
        {
          ...(outletUuid ? { outlet_id: outletUuid } : {}),
          sender_name: name || session.name || 'Staf',
          sender_role: role || session.role || 'kasir',
          message: msg
        }
      ];

      let inserted: ChatRow | null = null;
      let lastMsg = '';
      for (const row of attempts) {
        try {
          const { data, error } = await supabase
            .from('internal_outlet_chats')
            .insert([row])
            .select('id, outlet_id, sender_name, sender_role, message, created_at');
          if (!error && data?.[0]) {
            inserted = data[0] as ChatRow;
            break;
          }
          lastMsg = error?.message || lastMsg;
          if (/schema cache|could not find the table|does not exist/i.test(lastMsg)) break;
        } catch (inner: unknown) {
          lastMsg = inner instanceof Error ? inner.message : String(inner || lastMsg);
        }
      }

      if (!inserted) {
        toast(friendlyChatSendError(lastMsg), 'err');
        return;
      }

      setRows((prev) => (prev.some((r) => r.id === inserted!.id) ? prev : [...prev, inserted!]));
      setPreviews((prev) => ({ ...prev, [String(inserted!.outlet_id)]: inserted! }));
      setText('');
    } catch {
      toast('Pesan belum terkirim. Coba lagi sebentar.', 'err');
    } finally {
      setSending(false);
    }
  };

  if (!ready || onCustomerSurface || !canUse || skipRoom) return null;

  const roomName = outlets.find((o) => o.id === outletId)?.name || 'Grup Outlet';

  const listPane = (
    <div className="flex flex-col h-full min-h-0 bg-[#17212b] text-white">
      <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Users className="w-5 h-5 text-[#6ab3f3] shrink-0" />
          <div className="min-w-0">
            <p className="text-base font-bold truncate">Chat Outlet</p>
            <p className="text-[11px] text-white/50">{roomList.length} grup</p>
          </div>
        </div>
        {!embedded && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center"
            aria-label="Tutup"
          >
            <X className="w-5 h-5 text-white/70" />
          </button>
        )}
      </div>
      <div className="px-3 pb-3 shrink-0">
        <div className="flex items-center gap-2 rounded-xl bg-[#242f3d] px-3 py-2">
          <Search className="w-4 h-4 text-white/40 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari grup atau pesan"
            className="flex-1 bg-transparent text-sm text-white placeholder:text-white/35 outline-none"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {roomList.length === 0 && (
          <p className="text-center text-sm text-white/40 py-16 px-6">Belum ada grup outlet.</p>
        )}
        {roomList.map(({ outlet, last }) => (
          <button
            type="button"
            key={outlet.id}
            onClick={() => openRoom(outlet.id)}
            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition"
          >
            <Avatar name={outlet.name} />
            <div className="min-w-0 flex-1 border-b border-white/5 pb-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[15px] font-semibold truncate">{outlet.name}</p>
                <span className="text-[11px] text-white/40 shrink-0">{formatListTime(last?.created_at)}</span>
              </div>
              <p className="text-[13px] text-white/45 truncate mt-0.5">
                {last
                  ? `${last.sender_name || 'Staf'}: ${last.message}`
                  : 'Belum ada pesan — ketuk untuk mulai'}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  let lastDay = '';
  const roomPane = (
    <div className="flex flex-col h-full min-h-0 bg-[#0e1621]">
      <div className="px-2 py-2.5 flex items-center gap-1 bg-[#17212b] border-b border-black/20 shrink-0">
        {showListFirst ? (
          <button
            type="button"
            onClick={backToList}
            className="w-10 h-10 rounded-full hover:bg-white/5 flex items-center justify-center text-[#6ab3f3]"
            aria-label="Kembali"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        ) : !embedded ? (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="w-10 h-10 rounded-full hover:bg-white/5 flex items-center justify-center text-[#6ab3f3]"
            aria-label="Tutup"
          >
            <X className="w-5 h-5" />
          </button>
        ) : (
          <span className="w-2" />
        )}
        <Avatar name={roomName} size={40} />
        <div className="min-w-0 flex-1 px-2">
          <p className="text-[15px] font-semibold text-white truncate">{roomName}</p>
          <p className="text-[12px] text-white/45 truncate">Grup koordinasi outlet</p>
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto min-h-0 px-2.5 py-3"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 20%, rgba(106,179,243,0.06), transparent 40%), radial-gradient(circle at 80% 60%, rgba(123,200,98,0.05), transparent 35%)',
          backgroundColor: '#0e1621'
        }}
      >
        {rows.length === 0 && (
          <div className="flex justify-center py-10">
            <p className="text-center text-[13px] text-white/50 bg-[#182533] rounded-xl px-4 py-2 max-w-xs">
              Belum ada pesan di grup ini. Mulai koordinasi di sini.
            </p>
          </div>
        )}
        {rows.map((m) => {
          const mine = m.sender_name === name && m.sender_role === role;
          const dk = dayKey(m.created_at);
          const showDay = Boolean(dk && dk !== lastDay);
          if (showDay) lastDay = dk;
          const senderColor = colorOf(`${m.sender_name}|${m.sender_role}`);
          return (
            <div key={m.id}>
              {showDay && (
                <div className="flex justify-center my-3">
                  <span className="text-[12px] font-semibold text-white/70 bg-[#182533]/80 px-3 py-1 rounded-full">
                    {formatDayLabel(m.created_at)}
                  </span>
                </div>
              )}
              <div className={`flex ${mine ? 'justify-end' : 'justify-start'} mb-1`}>
                <div
                  className={`relative max-w-[82%] px-2.5 pt-1.5 pb-1 shadow-sm ${
                    mine
                      ? 'bg-[#2b5278] text-white rounded-2xl rounded-br-md'
                      : 'bg-[#182533] text-white rounded-2xl rounded-bl-md'
                  }`}
                >
                  {!mine && (
                    <p className="text-[13px] font-bold leading-tight mb-0.5" style={{ color: senderColor }}>
                      {m.sender_name || 'Staf'}
                      <span className="font-medium opacity-60 text-[11px]"> · {m.sender_role || '—'}</span>
                    </p>
                  )}
                  <p className="text-[14.5px] leading-snug whitespace-pre-wrap break-words pr-10">{m.message}</p>
                  <span className="absolute bottom-1 right-2 text-[10px] text-white/45 tabular-nums">
                    {formatClock(m.created_at)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={send}
        className="shrink-0 flex items-end gap-2 px-2 py-2 bg-[#17212b] border-t border-black/20"
      >
        <div className="flex-1 rounded-3xl bg-[#242f3d] px-4 py-2.5 min-h-[44px] flex items-center">
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Pesan"
            className="w-full bg-transparent text-[15px] text-white placeholder:text-white/35 outline-none"
            autoComplete="off"
          />
        </div>
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="w-11 h-11 rounded-full bg-[#5288c1] text-white flex items-center justify-center shrink-0 disabled:opacity-40 hover:bg-[#5e96d1] transition"
          aria-label="Kirim"
        >
          <Send className="w-5 h-5 ml-0.5" />
        </button>
      </form>
    </div>
  );

  const shell = (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {effectiveView === 'list' ? listPane : roomPane}
    </div>
  );

  if (embedded) {
    return (
      <div className="flex flex-col h-[70vh] min-h-[420px] border border-slate-800 rounded-2xl overflow-hidden shadow-lg">
        {shell}
      </div>
    );
  }

  return (
    <>
      {!hideFloatFab && (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setView(showListFirst ? 'list' : 'room');
          }}
          className="fixed bottom-20 left-4 z-[70] bg-[#2AABEE] text-white text-[11px] font-bold px-3.5 py-2.5 rounded-2xl shadow-lg inline-flex items-center gap-1.5"
          title="Chat Grup Outlet"
        >
          <MessageCircle className="w-4 h-4" />
          Chat Outlet
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-[75] flex justify-end">
          <button type="button" className="flex-1 bg-black/40" aria-label="Tutup" onClick={() => setOpen(false)} />
          <aside className="w-full max-w-md h-full shadow-2xl flex flex-col overflow-hidden">{shell}</aside>
        </div>
      )}
    </>
  );
}
