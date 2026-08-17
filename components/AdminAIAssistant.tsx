"use client";
import { useState } from "react";

export default function AdminAIAssistant() {
  const [activeTab, setActiveTab] = useState<"analytics" | "churn">("analytics");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

  const handleAnalyze = async (selectedMode?: "analytics" | "churn") => {
    const mode = selectedMode || activeTab;
    setLoading(true);
    setResult("");

    try {
      const res = await fetch("/api/admin/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: mode,
          userQuery: query,
        }),
      });

      const data = await res.json();
      setResult(data.reply || "Gagal memuat analisis.");
    } catch (err) {
      setResult("❌ Terjadi kendala saat terhubung ke server AI.");
    } finally {
      setLoading(false);
    }
  };

  // Funsi penataan format tampilan teks agar rapi tanpa simbol mentah
  const renderFormattedText = (text: string) => {
    if (!text) return null;

    // Bersihkan simbol pagar dan asterisk berlebih
    const cleanedText = text
      .replace(/^#{1,6}\s*/gm, "")
      .replace(/\*{3,}/g, "**");

    const lines = cleanedText.split("\n");

    return lines.map((line, lineIdx) => {
      // Deteksi tag **teks** untuk penyorotan cetak tebal
      const parts = line.split(/(\*\*.*?\*\*)/g);

      return (
        <p key={lineIdx} className="min-h-[1.25em] mb-1.5 leading-relaxed text-slate-200">
          {parts.map((part, partIdx) => {
            if (part.startsWith("**") && part.endsWith("**")) {
              const boldContent = part.slice(2, -2);
              return (
                <strong key={partIdx} className="font-bold text-amber-300">
                  {boldContent}
                </strong>
              );
            }
            return part;
          })}
        </p>
      );
    });
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 text-white shadow-xl my-6">
      {/* Header Widget */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-800 pb-4 mb-4">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            📊 AI Executive Copilot <span className="text-xs bg-blue-600/30 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded-full">Owner Mode</span>
          </h2>
          <p className="text-xs text-slate-400">Analisis bisnis otomatis & sistem deteksi retensi pelanggan</p>
        </div>

        {/* Tab Navigasi */}
        <div className="flex bg-slate-800 p-1 rounded-xl text-xs">
          <button
            onClick={() => {
              setActiveTab("analytics");
              setResult("");
            }}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
              activeTab === "analytics" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            📈 Business Analyst
          </button>
          <button
            onClick={() => {
              setActiveTab("churn");
              setResult("");
            }}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
              activeTab === "churn" ? "bg-amber-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            ⚠️ Churn & Retensi
          </button>
        </div>
      </div>

      {/* Konten Tab Business Analyst */}
      {activeTab === "analytics" && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tanyakan hal bisnis (misal: 'Berapa estimasi omset dan saran minggu ini?')..."
              className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => handleAnalyze("analytics")}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-xs font-semibold disabled:opacity-50"
            >
              {loading ? "Menganalisis..." : "Analisis"}
            </button>
          </div>
        </div>
      )}

      {/* Konten Tab Churn Detector */}
      {activeTab === "churn" && (
        <div className="space-y-3">
          <p className="text-xs text-slate-300">
            Deteksi pelanggan yang lama tidak transaksi dan buat draf pesan promosi untuk mengajak mereka cuci kembali.
          </p>
          <button
            onClick={() => handleAnalyze("churn")}
            disabled={loading}
            className="bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded-xl text-xs font-semibold disabled:opacity-50"
          >
            {loading ? "Memindai Data Pelanggan..." : "🔍 Cek Pelanggan Pasif & Buat Draf Promo"}
          </button>
        </div>
      )}

      {/* Area Tampilan Hasil Analisis Eksekutif */}
      {result && (
        <div className="mt-4 p-4 bg-slate-950/90 border border-slate-800 rounded-xl text-xs space-y-1">
          {renderFormattedText(result)}
        </div>
      )}
    </div>
  );
}