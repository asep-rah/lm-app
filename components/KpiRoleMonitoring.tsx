'use client';

import React from 'react';

export default function KpiRoleMonitoring() {
  const kpis = [
    { role: '💰 Finance', val: 'Rp 0 Selisih', status: '100% Match', desc: 'Rekonsiliasi Kas POS & Bank', color: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' },
    { role: '📦 Admin Ops', val: '1.2 Jam', status: 'SLA 98%', desc: 'Rata-rata Respon Restock', color: 'border-blue-500/30 text-blue-400 bg-blue-500/10' },
    { role: '🛡️ Supervisor', val: '94/100 QC', status: 'Audit Clear', desc: 'Kepatuhan SOP Harian', color: 'border-purple-500/30 text-purple-400 bg-purple-500/10' },
    { role: '🤝 Owner Relation', val: '100% Response', status: 'Active', desc: 'Update Investor & Mitra', color: 'border-indigo-500/30 text-indigo-400 bg-indigo-500/10' },
    { role: '🚀 Digital Mktg', val: '320 Vouchers', status: 'ROI 3.4x', desc: 'Redeem Promo Ads POS', color: 'border-amber-500/30 text-amber-400 bg-amber-500/10' },
    { role: '🛒 Kasir / POS', val: '142 Transaksi', status: '98% Speed', desc: 'Avg. Speed: 1.5 Menit', color: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' },
    { role: '🛵 Kurir & CS', val: '4.9 / 5.0 Rating', status: 'SLA 95%', desc: '38/38 Paket On-Time', color: 'border-teal-500/30 text-teal-400 bg-teal-500/10' },
  ];

  return (
    <div className="my-6 p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="text-xl font-black text-white flex items-center gap-2">
            <span>📊</span> Monitoring KPI 7 Role Internal
          </h3>
          <p className="text-xs text-slate-400 mt-1">Performa realtime operational & execution team</p>
        </div>
        <span className="px-3 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full text-xs font-bold">
          ● System Healthy
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((item, idx) => (
          <div key={idx} className="bg-slate-800/60 p-4 rounded-xl border border-slate-700/50 hover:border-slate-600 transition">
            <div className="flex justify-between items-center mb-2">
              <span className="font-bold text-slate-200 text-sm">{item.role}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded font-bold border ${item.color}`}>
                {item.status}
              </span>
            </div>
            <p className="text-lg font-black text-white mt-1">{item.val}</p>
            <p className="text-xs text-slate-400 mt-1">{item.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}