'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type ReviewRow = {
  id?: string;
  rating?: number;
  comment?: string | null;
  created_at?: string;
  outlet_id?: string | null;
  customer_phone?: string | null;
  transaction_id?: string | null;
  outlets?: { name?: string } | null;
};

const stars = (n: number) => '★'.repeat(Math.max(0, Math.min(5, Math.round(n)))) + '☆'.repeat(Math.max(0, 5 - Math.round(n)));

export default function OutletCsatPanel() {
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [outlets, setOutlets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [outletId, setOutletId] = useState('ALL');
  const [rating, setRating] = useState('ALL');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: outletRows }, { data: reviewRows, error }] = await Promise.all([
        supabase.from('outlets').select('id, name').order('name'),
        supabase
          .from('order_reviews')
          .select('id, rating, comment, created_at, outlet_id, customer_phone, transaction_id, outlets(name)')
          .order('created_at', { ascending: false })
          .limit(400)
      ]);
      if (cancelled) return;
      if (error) {
        const retry = await supabase
          .from('order_reviews')
          .select('id, rating, comment, created_at, outlet_id, customer_phone, transaction_id')
          .order('created_at', { ascending: false })
          .limit(400);
        setReviews((retry.data || []) as ReviewRow[]);
      } else {
        setReviews(
          (reviewRows || []).map((row: any) => ({
            ...row,
            outlets: Array.isArray(row.outlets) ? row.outlets[0] : row.outlets
          })) as ReviewRow[]
        );
      }
      setOutlets(outletRows || []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    return reviews.filter((r) => {
      if (outletId !== 'ALL' && String(r.outlet_id || '') !== outletId) return false;
      if (rating !== 'ALL' && Number(r.rating) !== Number(rating)) return false;
      const t = r.created_at ? new Date(r.created_at).getTime() : 0;
      if (fromDate) {
        const from = new Date(fromDate).setHours(0, 0, 0, 0);
        if (t && t < from) return false;
      }
      if (toDate) {
        const to = new Date(toDate).setHours(23, 59, 59, 999);
        if (t && t > to) return false;
      }
      return true;
    });
  }, [reviews, outletId, rating, fromDate, toDate]);

  const avgOf = (rows: ReviewRow[]) => {
    if (!rows.length) return 0;
    return rows.reduce((s, r) => s + (Number(r.rating) || 0), 0) / rows.length;
  };

  const brandAvg = avgOf(reviews);
  const perOutlet = outlets.map((o) => {
    const rows = reviews.filter((r) => String(r.outlet_id || '') === String(o.id));
    return { id: o.id, name: o.name, avg: avgOf(rows), count: rows.length };
  });

  const outletName = (id?: string | null) =>
    outlets.find((o) => String(o.id) === String(id))?.name || 'Tanpa cabang';

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="bg-indigo-600 text-white p-4 flex flex-col md:flex-row md:items-center justify-between gap-2">
        <div>
          <h3 className="font-black text-sm">⭐ Performa & CSAT Outlet</h3>
          <p className="text-[11px] text-indigo-100">Rating pelanggan dari ulasan pesanan selesai</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-black leading-none">
            {reviews.length ? `⭐ ${brandAvg.toFixed(1)} / 5.0` : '—'}
          </p>
          <p className="text-[10px] text-indigo-100 mt-1">{reviews.length} ulasan brand</p>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {perOutlet.map((o) => (
            <div key={o.id} className="border border-slate-100 rounded-xl p-2.5 bg-slate-50">
              <p className="text-[10px] font-bold text-slate-500 truncate">{o.name}</p>
              <p className="text-sm font-black text-slate-900 mt-0.5">
                {o.count ? `⭐ ${o.avg.toFixed(1)}` : 'Belum ada'}
              </p>
              <p className="text-[10px] text-slate-400">{o.count} ulasan</p>
            </div>
          ))}
          {!outlets.length && !loading && (
            <p className="text-[11px] text-slate-400 col-span-2">Belum ada data outlet.</p>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <select
            value={outletId}
            onChange={(e) => setOutletId(e.target.value)}
            className="text-xs font-bold border border-slate-200 rounded-xl px-2 py-2 bg-white"
          >
            <option value="ALL">Semua outlet</option>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <select
            value={rating}
            onChange={(e) => setRating(e.target.value)}
            className="text-xs font-bold border border-slate-200 rounded-xl px-2 py-2 bg-white"
          >
            <option value="ALL">Semua rating</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={String(n)}>
                {n} bintang
              </option>
            ))}
          </select>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="text-xs font-bold border border-slate-200 rounded-xl px-2 py-2 bg-white"
          />
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="text-xs font-bold border border-slate-200 rounded-xl px-2 py-2 bg-white"
          />
        </div>

        <div className="overflow-x-auto border border-slate-100 rounded-xl">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left p-2.5 font-extrabold">Tanggal</th>
                <th className="text-left p-2.5 font-extrabold">Outlet</th>
                <th className="text-left p-2.5 font-extrabold">Rating</th>
                <th className="text-left p-2.5 font-extrabold">Ulasan</th>
                <th className="text-left p-2.5 font-extrabold">Pelanggan</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-slate-400">
                    Memuat ulasan…
                  </td>
                </tr>
              )}
              {!loading &&
                filtered.map((r, i) => (
                  <tr key={r.id || i} className="border-t border-slate-100">
                    <td className="p-2.5 whitespace-nowrap text-slate-500">
                      {r.created_at ? new Date(r.created_at).toLocaleDateString('id-ID') : '-'}
                    </td>
                    <td className="p-2.5 font-bold text-slate-800">
                      {r.outlets?.name || outletName(r.outlet_id)}
                    </td>
                    <td className="p-2.5 text-amber-500 font-black whitespace-nowrap">
                      {stars(Number(r.rating) || 0)} {Number(r.rating) || 0}
                    </td>
                    <td className="p-2.5 text-slate-600">{r.comment || '—'}</td>
                    <td className="p-2.5 font-mono text-slate-400">{r.customer_phone || '—'}</td>
                  </tr>
                ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-slate-400">
                    Belum ada ulasan pada filter ini. Jalankan migrasi order_reviews bila tabel belum ada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
