"use client";
import { useState, useRef, useEffect } from "react";
import { laundryFallbackReply } from "@/lib/laundryFaq";
import { insertChatMessage } from "@/lib/csChat";
import { uploadProofFile } from "@/lib/uploadProof";
import ChatAttachment from "@/components/ChatAttachment";

interface AIChatWidgetProps {
  customerPhone?: string;
}

interface Message {
  sender: "user" | "ai";
  text: string;
  attachment_url?: string;
  attachment_type?: string;
}

export default function AIChatWidget({ customerPhone = "" }: AIChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState<Message[]>([
    {
      sender: "ai",
      text: "Halo Kak! Saya AI Laundrivery 🤖\n\nAda yang bisa dibantu mengenai status cucian, harga, atau jadwal penjemputan?",
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [chatHistory, loading, isOpen]);

  const handleSend = async (textToSend?: string) => {
    const query = textToSend || message;
    if (!query.trim() || loading) return;

    const newHistory: Message[] = [...chatHistory, { sender: "user", text: query }];
    setChatHistory(newHistory);
    if (!textToSend) setMessage("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: query,
          // Riwayat penuh dikirim agar AI mengingat konteks percakapan sebelumnya.
          messages: newHistory,
          customerPhone: customerPhone,
        }),
      });

      const data = await res.json();
      setChatHistory([
        ...newHistory,
        { sender: "ai", text: data.reply || laundryFallbackReply(query) },
      ]);
    } catch (err) {
      setChatHistory([
        ...newHistory,
        { sender: "ai", text: laundryFallbackReply(query) },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickAction = (text: string) => {
    setMessage(text);
    handleSend(text);
  };

  const renderMessageContent = (msgText: string) => {
    const statusMatch = msgText.match(/\[STATUS_CARD\|(.*?)\|(.*?)\|(.*?)\]/);
    
    // DETEKSI HANDOFF WA DINAMIS: MENDUKUNG FORMAT [WA_HANDOFF|628xxx] DAN [WA_HANDOFF]
    const waMatch = msgText.match(/\[WA_HANDOFF\|(.*?)\]/);
    const hasGenericWA = msgText.includes("[WA_HANDOFF]");

    // Nomor Fallback ke CS Pusat jika transaksi tidak memiliki nomor cabang khusus
    let waNumber = "6281234567890"; 
    if (waMatch && waMatch[1]) {
      waNumber = waMatch[1].trim();
    }

    const showWAButton = Boolean(waMatch || hasGenericWA);

    // Bersihkan tag sistem dari tampilan obrolan pelanggan
    const cleanText = msgText
      .replace(/\[STATUS_CARD\|.*?\]/g, "")
      .replace(/\[WA_HANDOFF\|.*?\]/g, "")
      .replace("[WA_HANDOFF]", "")
      .trim();

    let currentStep = 1;
    let rawStatus = "";
    let resi = "";
    let layanan = "";

    if (statusMatch) {
      resi = statusMatch[1];
      layanan = statusMatch[2];
      rawStatus = statusMatch[3].toLowerCase();

      if (rawStatus.includes("selesai")) {
        currentStep = 3;
      } else if (rawStatus.includes("proses") || rawStatus.includes("cuci")) {
        currentStep = 2;
      } else {
        currentStep = 1;
      }
    }

    return (
      <div className="space-y-3">
        <p className="whitespace-pre-line leading-relaxed">{cleanText}</p>

        {/* Kartu Status Visual */}
        {statusMatch && (
          <div className="mt-2 p-3 bg-slate-900/90 rounded-xl border border-blue-500/40 text-xs text-slate-200 shadow-md space-y-2">
            <div className="flex justify-between items-center border-b border-slate-800 pb-1.5 font-medium">
              <span className="text-blue-400">Resi: {resi}</span>
              <span className="bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded text-[10px]">
                {layanan}
              </span>
            </div>

            <div className="py-1">
              <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                <span className={currentStep >= 1 ? "text-emerald-400 font-bold" : ""}>
                  1. Penjemputan
                </span>
                <span className={currentStep >= 2 ? "text-emerald-400 font-bold" : ""}>
                  2. Diproses
                </span>
                <span className={currentStep >= 3 ? "text-emerald-400 font-bold" : ""}>
                  3. Selesai
                </span>
              </div>
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden flex">
                <div
                  className={`h-full bg-emerald-500 transition-all duration-500 ${
                    currentStep === 1 ? "w-1/3" : currentStep === 2 ? "w-2/3" : "w-full"
                  }`}
                />
              </div>
            </div>
          </div>
        )}

        {/* Tombol Handoff WhatsApp Dinamis Sesuai Brand/Cabang */}
        {showWAButton && (
          <div className="pt-1">
            <a
              href={`https://wa.me/${waNumber}?text=Halo%20Admin%20CS,%20saya%20butuh%20bantuan%20terkait%20pesanan%20saya.`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs px-3.5 py-2 rounded-xl shadow-md transition-all active:scale-95"
            >
              💬 Hubungi Admin CS via WhatsApp
            </a>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed bottom-20 right-4 z-50">
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-2 transition-transform active:scale-95 border border-blue-400/30"
        >
          🎧 Tanya Customer Service
        </button>
      )}

      {isOpen && (
        <div className="w-[340px] sm:w-[380px] h-[480px] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-white">
          <div className="p-3.5 bg-slate-800 border-b border-slate-700 flex justify-between items-center">
            <div className="flex items-center gap-2.5">
              <span className="text-xl">🤖</span>
              <div>
                <h3 className="text-sm font-semibold leading-tight">AI Assistant Laundrivery</h3>
                <p className="text-[11px] text-emerald-400 font-medium">● Online</p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-white text-lg font-bold px-2 py-1"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 p-3.5 overflow-y-auto space-y-3 text-sm">
            {chatHistory.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] p-3 rounded-2xl ${
                    msg.sender === "user"
                      ? "bg-blue-600 text-white rounded-br-none whitespace-pre-line leading-relaxed"
                      : "bg-slate-800 border border-slate-700 text-slate-100 rounded-bl-none"
                  }`}
                >
                  {msg.sender === "user" ? (
                    <div>
                      <p className="whitespace-pre-line leading-relaxed">{msg.text}</p>
                      <ChatAttachment message={msg} />
                    </div>
                  ) : (
                    renderMessageContent(msg.text)
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-slate-800 border border-slate-700 text-slate-400 px-4 py-3 rounded-2xl rounded-bl-none text-xs flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></span>
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:0.4s]"></span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="flex gap-2 px-3 py-2 overflow-x-auto text-xs border-t border-slate-800 bg-slate-900/50">
            <button
              type="button"
              onClick={() => handleQuickAction("Tanya status cucian saya")}
              className="whitespace-nowrap bg-blue-900/40 text-blue-300 px-3 py-1.5 rounded-full border border-blue-700/60 hover:bg-blue-800/60 transition-colors"
            >
              🔍 Cek Status
            </button>
            <button
              type="button"
              onClick={() => handleQuickAction("Berapa harga cuci express 6 jam?")}
              className="whitespace-nowrap bg-blue-900/40 text-blue-300 px-3 py-1.5 rounded-full border border-blue-700/60 hover:bg-blue-800/60 transition-colors"
            >
              💰 Cek Harga
            </button>
            <button
              type="button"
              onClick={() => handleQuickAction("Bisa antar jemput hari ini?")}
              className="whitespace-nowrap bg-blue-900/40 text-blue-300 px-3 py-1.5 rounded-full border border-blue-700/60 hover:bg-blue-800/60 transition-colors"
            >
              🛵 Pesan Jemput
            </button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="p-3 bg-slate-800 border-t border-slate-700 flex gap-2"
          >
            <input
              id="ai-widget-attach"
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                try {
                  const url = await uploadProofFile(file, `chat_widget_${customerPhone || "anon"}`);
                  const type = file.type.includes("pdf") ? "pdf" : "image";
                  const caption = file.type.includes("pdf") ? "📄 Invoice / file terlampir" : "📷 Bukti pembayaran terlampir";
                  setChatHistory((prev) => [
                    ...prev,
                    { sender: "user", text: caption, attachment_url: url, attachment_type: type },
                    {
                      sender: "ai",
                      text: "Bukti sudah kami terima. CS akan cek dan konfirmasi pembayaran Kak.",
                    },
                  ]);
                  if (customerPhone) {
                    await insertChatMessage({
                      customer_phone: customerPhone,
                      sender_type: "customer",
                      message: caption,
                      attachment_url: url,
                      attachment_type: type,
                    });
                  }
                } catch (err: any) {
                  setChatHistory((prev) => [
                    ...prev,
                    { sender: "ai", text: "Gagal unggah lampiran: " + (err?.message || "Coba lagi") },
                  ]);
                }
              }}
            />
            <label
              htmlFor="ai-widget-attach"
              title="Kirim foto / bukti bayar ke CS"
              className="shrink-0 w-9 h-9 rounded-xl bg-slate-900 border border-slate-700 text-white flex items-center justify-center text-sm cursor-pointer"
            >
              📎
            </label>
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Ketik pesan..."
              className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 active:scale-95 text-white px-4 py-2 rounded-xl text-xs font-semibold disabled:opacity-50 transition-all"
            >
              Kirim
            </button>
          </form>
        </div>
      )}
    </div>
  );
}