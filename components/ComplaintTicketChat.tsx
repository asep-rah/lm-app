'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Headphones, Paperclip, Send, X } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import ChatAttachment, { visibleChatText } from '@/components/ChatAttachment';
import {
  insertTicketMessage,
  loadTicketMessages,
  ticketIsOpen,
  ticketTitleOf
} from '@/lib/complaintTicket';
import { fileToCompressedDataUrl, uploadChatAttachment } from '@/lib/uploadProof';
import { toast } from '@/lib/toast';

type Props = {
  ticket: any;
  senderType: 'customer' | 'cs';
  senderName?: string;
  variant?: 'embed' | 'fullscreen';
  onClose?: () => void;
};

export default function ComplaintTicketChat({
  ticket,
  senderType,
  senderName,
  variant = 'embed',
  onClose
}: Props) {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ticketId = String(ticket?.id || '');
  const open = ticketIsOpen(ticket);

  useEffect(() => {
    if (!ticketId) return;
    let cancelled = false;
    loadTicketMessages(ticketId).then((rows) => {
      if (!cancelled) setMessages(rows);
    });
    const ch = supabase
      .channel(`complaint_ticket_${ticketId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'complaint_chat_messages', filter: `ticket_id=eq.${ticketId}` },
        (payload) => {
          const row: any = payload.new;
          if (!row?.id) return;
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
        }
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [ticketId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, ticketId]);

  const send = async (file?: File | null) => {
    const text = input.trim();
    if ((!text && !file) || !ticketId || busy) return;
    if (!open) return toast('Tiket sudah diselesaikan. Room chat akan dihapus dalam 24 jam.', 'warn');
    setBusy(true);
    try {
      let attachmentUrl = '';
      if (file) {
        attachmentUrl =
          (await uploadChatAttachment(file, `complaint_chat_${ticketId}`).catch(() => '')) ||
          (await fileToCompressedDataUrl(file).catch(() => ''));
      }
      const { error } = await insertTicketMessage({
        ticketId,
        senderType,
        message: text,
        attachmentUrl: attachmentUrl || null
      });
      if (error) {
        toast(error.message, 'err');
        return;
      }
      setInput('');
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <div className={`flex items-center gap-2 ${variant === 'fullscreen' ? 'px-1.5 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2.5' : 'px-3 py-2.5 rounded-t-2xl'}`}>
      {variant === 'fullscreen' && onClose && (
        <button
          type="button"
          onClick={onClose}
          className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-white/10"
          aria-label="Kembali"
        >
          <ArrowLeft className="w-6 h-6" strokeWidth={2.2} />
        </button>
      )}
      <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center shrink-0">
        <Headphones className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-black text-sm leading-tight truncate">{ticketTitleOf(ticket)}</p>
        <p className="text-[10px] text-rose-100 font-bold uppercase tracking-wider">
          {open ? 'Room Chat Tiket Komplain' : 'Diselesaikan · hapus otomatis 24 jam'}
        </p>
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/10"
          aria-label="Tutup"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );

  const thread = (
    <div
      ref={scrollRef}
      className={`flex-1 overflow-y-auto px-3 py-3 space-y-2 ${variant === 'embed' ? 'min-h-[220px] max-h-72' : ''}`}
      style={{
        backgroundImage:
          'linear-gradient(rgba(236,229,221,0.92), rgba(236,229,221,0.92)), url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23d4cfc7\' fill-opacity=\'0.45\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")'
      }}
    >
      {messages.length === 0 ? (
        <p className="text-center text-[11px] text-slate-500 py-8">Belum ada pesan di tiket ini.</p>
      ) : (
        messages.map((msg) => {
          const mine =
            (senderType === 'customer' && msg.sender_type === 'customer') ||
            (senderType === 'cs' && msg.sender_type === 'cs');
          return (
            <div key={msg.id || msg.created_at} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[82%] rounded-lg px-3 py-1.5 text-[13px] font-medium leading-relaxed shadow-sm ${
                  mine ? 'bg-[#dcf8c6] text-slate-900 rounded-tr-none' : 'bg-white text-slate-900 rounded-tl-none'
                }`}
              >
                {visibleChatText(msg) && <p className="whitespace-pre-wrap">{visibleChatText(msg)}</p>}
                <ChatAttachment message={msg} />
                <span className={`text-[10px] block mt-1 ${mine ? 'text-slate-500 text-right' : 'text-slate-400'}`}>
                  {new Date(msg.created_at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          );
        })
      )}
    </div>
  );

  const composer = (
    <div className={`shrink-0 bg-[#f0f2f5] px-2 pt-2 flex items-end gap-2 ${variant === 'fullscreen' ? 'pb-[max(0.6rem,env(safe-area-inset-bottom))]' : 'pb-2 rounded-b-2xl'}`}>
      <input
        id={`complaint-attach-${ticketId}-${senderType}`}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        disabled={!open || busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) send(f);
        }}
      />
      <label
        htmlFor={`complaint-attach-${ticketId}-${senderType}`}
        className={`shrink-0 w-10 h-10 rounded-full bg-white text-slate-500 flex items-center justify-center border border-slate-200 ${!open ? 'opacity-40 pointer-events-none' : 'cursor-pointer'}`}
      >
        <Paperclip className="w-4 h-4" />
      </label>
      <input
        type="text"
        value={input}
        disabled={!open || busy}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && send()}
        placeholder={open ? `Tulis pesan${senderName ? ` sebagai ${senderName}` : ''}…` : 'Tiket sudah diselesaikan'}
        className="flex-1 bg-white border border-slate-200 rounded-full px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-200 disabled:bg-slate-50"
      />
      <button
        type="button"
        disabled={!open || busy}
        onClick={() => send()}
        className="shrink-0 w-10 h-10 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center disabled:opacity-40"
        aria-label="Kirim"
      >
        <Send className="w-4 h-4" />
      </button>
    </div>
  );

  if (variant === 'fullscreen') {
    return (
      <div className="fixed inset-0 z-[80] h-full w-full flex flex-col bg-[#ece5dd]">
        <div className="shrink-0 bg-rose-700 text-white shadow-md">{header}</div>
        {thread}
        {composer}
      </div>
    );
  }

  return (
    <div className="border border-rose-100 rounded-2xl overflow-hidden bg-white">
      <div className="bg-rose-700 text-white">{header}</div>
      {thread}
      {composer}
    </div>
  );
}
