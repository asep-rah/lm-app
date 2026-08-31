'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { getStaffSession } from '@/lib/staffSession';
import { canAccessOutletGroupChat, canSwitchOutletGroupChat, isCustomerFacingPath } from '@/lib/outletGroupChat';
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

export default function OutletGroupChatDrawer() {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState('');
  const [name, setName] = useState('');
  const [outletId, setOutletId] = useState('');
  const [outlets, setOutlets] = useState<{ id: string; name: string }[]>([]);
  const [rows, setRows] = useState<ChatRow[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [customerOnly, setCustomerOnly] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const onCustomerSurface = isCustomerFacingPath(pathname) || customerOnly;
  const canUse = !onCustomerSurface && canAccessOutletGroupChat(role, pathname);
  const canSwitch = canSwitchOutletGroupChat(role);

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
    if (!canUse) return;
    supabase
      .from('outlets')
      .select('id, name')
      .order('name')
      .then(({ data }) => {
        const list = data || [];
        setOutlets(list);
        setOutletId((cur) => matchOutletUuid(list, cur) || uuidOrNull(cur) || cur || list[0]?.id || '');
      });
  }, [canUse]);

  useEffect(() => {
    if (!canUse || !outletId) {
      setRows([]);
      return;
    }
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
          .limit(200);
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
    load();
    const ch = supabase
      .channel('internal_outlet_chats_' + outletId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'internal_outlet_chats' }, () => load())
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [canUse, outletId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [rows.length, open]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const msg = text.trim();
    if (!msg || sending) return;
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
        },
        {
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
      setText('');
    } catch {
      toast('Pesan belum terkirim. Coba lagi sebentar.', 'err');
    } finally {
      setSending(false);
    }
  };

  if (!ready || onCustomerSurface || !canUse) return null;

  const roomName = outlets.find((o) => o.id === outletId)?.name || 'Outlet';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-20 left-4 z-[70] bg-slate-900 text-white text-[11px] font-bold px-3.5 py-2.5 rounded-2xl shadow-lg"
        title="Grup Koordinasi Outlet"
      >
        Grup Outlet
      </button>

      {open && (
        <div className="fixed inset-0 z-[75] flex justify-end">
          <button type="button" className="flex-1 bg-black/30" aria-label="Tutup" onClick={() => setOpen(false)} />
          <aside className="w-full max-w-md h-full bg-white shadow-2xl flex flex-col">
            <div className="p-4 border-b border-slate-100 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-sky-600">Internal</p>
                  <h2 className="text-base font-black text-slate-900">Grup Koordinasi Outlet</h2>
                </div>
                <button type="button" onClick={() => setOpen(false)} className="text-xs font-bold text-slate-400">
                  Tutup
                </button>
              </div>
              {canSwitch ? (
                <select
                  value={outletId}
                  onChange={(e) => setOutletId(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold bg-slate-50"
                >
                  {outlets.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              ) : (
                <p className="text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                  Room: {roomName}
                </p>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50">
              {rows.length === 0 && (
                <p className="text-center text-xs text-slate-400 py-10">Belum ada pesan di room ini.</p>
              )}
              {rows.map((m) => {
                const mine = m.sender_name === name && m.sender_role === role;
                return (
                  <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs ${mine ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200'}`}>
                      <p className={`text-[9px] font-bold uppercase mb-0.5 ${mine ? 'text-slate-300' : 'text-slate-400'}`}>
                        {m.sender_name || 'Staf'} · {m.sender_role || '—'}
                      </p>
                      <p className="leading-relaxed whitespace-pre-wrap">{m.message}</p>
                      <p className={`text-[9px] mt-1 ${mine ? 'text-slate-400' : 'text-slate-400'}`}>
                        {m.created_at ? new Date(m.created_at).toLocaleString('id-ID') : ''}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            <form onSubmit={send} className="p-3 border-t border-slate-100 flex gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Tulis koordinasi outlet…"
                className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-xs"
              />
              <button
                type="submit"
                disabled={sending || !text.trim()}
                className="bg-slate-900 text-white text-xs font-bold px-3 rounded-xl disabled:opacity-50"
              >
                Kirim
              </button>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}
