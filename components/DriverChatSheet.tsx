'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Lock, MessageCircle, Send, X } from 'lucide-react';
import { DRIVER_CHAT_MAX_LENGTH, type DriverChatMessage, type DriverChatSender } from '@/lib/driverChat';

const POLL_MS = 4000;

type Props = {
  /** 'customer' → /api/customer/driver-chat, 'driver' → /api/staff/driver-chat. */
  as: DriverChatSender;
  orderId: string;
  title: string;
  subtitle?: string;
  /** Legacy customer login only: the phone typed at login (the server ignores it with a verified session). */
  customerPhone?: string;
  onClose: () => void;
};

const timeOf = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
};

/**
 * Chat per pesanan antara driver dan pelanggan (seperti Grab/Gojek).
 * Dibaca/ditulis lewat API server; diperbarui tiap beberapa detik selama terbuka.
 */
export default function DriverChatSheet({ as, orderId, title, subtitle, customerPhone, onClose }: Props) {
  const endpoint = as === 'driver' ? '/api/staff/driver-chat' : '/api/customer/driver-chat';
  const [messages, setMessages] = useState<DriverChatMessage[]>([]);
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);

  const headers = useCallback(
    (json = false): HeadersInit => ({
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(as === 'customer' && customerPhone ? { 'x-customer-phone': customerPhone } : {})
    }),
    [as, customerPhone]
  );

  const load = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const res = await fetch(`${endpoint}?order=${encodeURIComponent(orderId)}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: headers()
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Chat belum bisa dimuat.');
        return;
      }
      setError('');
      setOpen(Boolean(data.open));
      setMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch {
      /* jaringan putus sesaat — dicoba lagi pada interval berikutnya */
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  }, [endpoint, orderId, headers]);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(t);
    };
  }, [load]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setError('');
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: headers(true),
        body: JSON.stringify({ order: orderId, message, phone: as === 'customer' ? customerPhone : undefined })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Pesan belum terkirim. Coba lagi.');
        if (res.status === 409) setOpen(false);
        return;
      }
      setText('');
      if (data.message) setMessages((prev) => [...prev, data.message]);
    } catch {
      setError('Koneksi bermasalah. Pesan belum terkirim.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Tutup chat" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md h-[85vh] sm:h-[70vh] bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
          <div className="w-9 h-9 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <MessageCircle className="w-4.5 h-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black text-slate-900 truncate">{title}</p>
            {subtitle && <p className="text-[11px] text-slate-500 truncate">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center" aria-label="Tutup">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-slate-50">
          {loading ? (
            <div className="flex justify-center py-10 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" aria-label="Memuat" />
            </div>
          ) : messages.length === 0 ? (
            <p className="text-center text-xs text-slate-400 py-10">
              {as === 'driver' ? 'Belum ada pesan. Sapa pelanggan Anda.' : 'Belum ada pesan. Kirim pesan ke driver Anda.'}
            </p>
          ) : (
            messages.map((m) => {
              const mine = m.sender_type === as;
              return (
                <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                      mine ? 'bg-emerald-600 text-white rounded-br-md' : 'bg-white text-slate-800 border border-slate-100 rounded-bl-md'
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.message}</p>
                    <p className={`text-[10px] mt-0.5 text-right ${mine ? 'text-emerald-100' : 'text-slate-400'}`}>
                      {timeOf(m.created_at)}
                      {mine && m.read_at ? ' · Dibaca' : ''}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {error && (
          <p className="text-[11px] font-semibold text-rose-600 bg-rose-50 border-t border-rose-100 px-4 py-2" role="alert">
            {error}
          </p>
        )}

        {open ? (
          <form onSubmit={send} className="flex items-end gap-2 p-3 border-t border-slate-100 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, DRIVER_CHAT_MAX_LENGTH))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              rows={1}
              placeholder="Tulis pesan…"
              aria-label="Tulis pesan"
              className="flex-1 resize-none max-h-28 bg-slate-100 rounded-2xl px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-200"
            />
            <button
              type="submit"
              disabled={sending || !text.trim()}
              className="w-11 h-11 rounded-full bg-emerald-600 text-white flex items-center justify-center disabled:opacity-50 shrink-0"
              aria-label="Kirim"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </form>
        ) : (
          <p className="text-[11px] text-slate-500 text-center px-4 py-3 border-t border-slate-100 inline-flex items-center justify-center gap-1.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Lock className="w-3.5 h-3.5" /> Chat ditutup — perjalanan driver untuk pesanan ini sudah selesai.
          </p>
        )}
      </div>
    </div>
  );
}
