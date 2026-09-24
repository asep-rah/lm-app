'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, RefreshCw, Shield, XCircle } from 'lucide-react';
import { diagnosisCardOf } from '@/lib/errorDiagnosis';
import { toast } from '@/lib/toast';
import { paymentOpsClientHeaders } from '@/lib/requirePaymentOpsAuth';
import ManualMarkPaidModal from '@/components/payment/ManualMarkPaidModal';

type ErrRow = {
  id: string;
  source: string;
  code?: string | null;
  message: string;
  hint?: string | null;
  severity?: string;
  transaction_id?: string | null;
  resolved?: boolean;
  created_at: string;
  context?: unknown;
};

export default function SystemHealthPage() {
  const [errors, setErrors] = useState<ErrRow[]>([]);
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [pending, setPending] = useState<any[]>([]);
  const [customerLogin, setCustomerLogin] = useState<{
    whatsapp: boolean;
    legacy: boolean;
    replies: boolean;
    checks: Array<{ key: string; ok: boolean; need: string }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [resyncId, setResyncId] = useState<string | null>(null);
  const [manualOrder, setManualOrder] = useState<any | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const raw = localStorage.getItem('laundry_owner_user') || localStorage.getItem('laundry_user');
      let staffId = '';
      let role = 'owner';
      let agentName = 'Owner';
      try {
        const u = raw ? JSON.parse(raw) : {};
        staffId = String(u.id || u.username || '');
        role = String(u.role || 'owner').toLowerCase();
        agentName = String(u.name || 'Owner');
      } catch {
        /* ignore */
      }
      const q = new URLSearchParams({ staffId, role, agentName });
      const res = await fetch(`/api/owner/system-health?${q}`, {
        headers: paymentOpsClientHeaders()
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal muat diagnosis');
      setErrors((json.errors as ErrRow[]) || []);
      setWebhooks(json.webhooks || []);
      setPending(json.pending || []);
      setCustomerLogin(json.customerLogin || null);
    } catch (e: any) {
      toast(e?.message || 'Gagal muat diagnosis (cek PAYMENT_OPS_SECRET)', 'err');
      setErrors([]);
      setWebhooks([]);
      setPending([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  const resync = async (txId: string, errorLogId?: string) => {
    setResyncId(txId);
    try {
      const raw = localStorage.getItem('laundry_owner_user') || localStorage.getItem('laundry_user');
      let staffId = '';
      let role = 'owner';
      try {
        const u = raw ? JSON.parse(raw) : {};
        staffId = String(u.id || u.username || '');
        role = String(u.role || 'owner').toLowerCase();
      } catch {
        /* ignore */
      }
      const res = await fetch('/api/pay/resync', {
        method: 'POST',
        headers: paymentOpsClientHeaders(),
        body: JSON.stringify({
          transactionId: txId,
          errorLogId,
          agentName: 'Owner',
          staffId,
          role
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Re-sync gagal');
      if (json.status === 'still_pending') {
        toast(json.message || 'Masih pending di gateway', 'warn');
      } else {
        toast('Re-sync berhasil — status LUNAS', 'ok');
      }
      void load();
    } catch (e: any) {
      toast(e?.message || 'Re-sync gagal', 'err');
    } finally {
      setResyncId(null);
    }
  };

  const openCount = errors.filter((e) => !e.resolved).length;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-4 md:p-6 max-w-5xl mx-auto pb-28">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <Link href="/owner" className="p-2.5 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl bg-white border border-slate-200 shadow-sm" aria-label="Kembali ke dashboard owner">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-lg font-black text-slate-900 inline-flex items-center gap-2">
              <Shield className="w-5 h-5 text-indigo-600" aria-hidden /> Diagnosis Sistem
            </h1>
            <p className="text-[11px] text-slate-600">Log error, webhook, dan petunjuk perbaikan pembayaran</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="text-[11px] font-extrabold text-indigo-700 bg-indigo-50 border border-indigo-100 px-3 py-2.5 min-h-[44px] rounded-xl inline-flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden /> Muat ulang
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        <div className="bg-white border border-rose-100 rounded-2xl p-4 shadow-sm">
          <p className="text-[10px] font-extrabold text-slate-500 uppercase">Error terbuka</p>
          <p className="text-2xl font-black text-rose-600 mt-1">{openCount}</p>
        </div>
        <div className="bg-white border border-amber-100 rounded-2xl p-4 shadow-sm">
          <p className="text-[10px] font-extrabold text-slate-500 uppercase">Pending bayar</p>
          <p className="text-2xl font-black text-amber-600 mt-1">{pending.length}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm col-span-2 md:col-span-1">
          <p className="text-[10px] font-extrabold text-slate-500 uppercase">Webhook terbaru</p>
          <p className="text-2xl font-black text-slate-800 mt-1">{webhooks.length}</p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Memuat log…
        </p>
      ) : (
        <div className="space-y-6">
          {customerLogin && (
            <section className="space-y-2">
              <h2 className="text-xs font-black uppercase tracking-wide text-slate-500">Login WhatsApp pelanggan</h2>
              <div
                className={`rounded-2xl border p-4 space-y-2 text-[12px] ${
                  customerLogin.whatsapp ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'
                }`}
              >
                <p className="font-black text-slate-900">
                  {customerLogin.whatsapp
                    ? 'Aktif — pelanggan wajib mengirim kode lewat WhatsApp dan nomornya diverifikasi otomatis.'
                    : 'Belum aktif — halaman login masih memakai cara lama (tanpa verifikasi). Lengkapi env di bawah lalu Redeploy (Production).'}
                </p>
                <ul className="space-y-1">
                  {customerLogin.checks.map((c) => (
                    <li key={c.key} className="flex items-start gap-2">
                      {c.ok ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      )}
                      <span>
                        <code className="font-bold">{c.key}</code>
                        {!c.ok && <span className="text-rose-700"> — {c.need}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-slate-600">
                  Balasan otomatis WA: {customerLogin.replies ? 'aktif' : 'nonaktif (EVOLUTION_API_URL/KEY kosong — login tetap jalan)'} · Login lama
                  (CUSTOMER_LEGACY_LOGIN_ENABLED): {customerLogin.legacy ? 'masih diterima' : 'dimatikan'}
                </p>
              </div>
            </section>
          )}
          <section className="space-y-3">
            <h2 className="text-xs font-black uppercase tracking-wide text-slate-500">Log Error & Cara Solving</h2>
            {errors.length === 0 ? (
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-[12px] font-semibold text-slate-700">
                Belum ada error tercatat pada sampel diagnosis. Ini bukan jaminan sistem sehat — hanya berarti tidak ada
                log error terbuka yang dimuat.
              </div>
            ) : (
              errors.map((row) => {
                const card = diagnosisCardOf(row.message, row.code);
                const hint = row.hint || `Error: ${card.title}. Solusi: ${card.solution}`;
                return (
                  <div
                    key={row.id}
                    className={`bg-white border rounded-2xl p-4 shadow-sm space-y-2 ${
                      row.resolved ? 'border-slate-200 opacity-70' : 'border-rose-100'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[11px] font-black text-slate-900 inline-flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                          {row.source} · {row.code || card.code}
                          {row.resolved ? (
                            <span className="text-[8px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">RESOLVED</span>
                          ) : (
                            <span className="text-[8px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-full">{row.severity || 'ERROR'}</span>
                          )}
                        </p>
                        <p className="text-[11px] text-slate-700 mt-1 font-medium">{row.message}</p>
                        <p className="text-[11px] text-indigo-800 bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2 mt-2 leading-relaxed">
                          {hint}
                        </p>
                        <p className="text-[9px] text-slate-400 mt-1">{new Date(row.created_at).toLocaleString('id-ID')}</p>
                      </div>
                    </div>
                    {row.transaction_id && !row.resolved ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={resyncId === row.transaction_id}
                          onClick={() => void resync(row.transaction_id!, row.id)}
                          className="text-[10px] font-extrabold bg-indigo-600 text-white px-3 py-2 rounded-xl disabled:opacity-60 inline-flex items-center gap-1"
                        >
                          {resyncId === row.transaction_id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3 h-3" />
                          )}
                          Re-sync / Pemicu Ulang
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-xs font-black uppercase tracking-wide text-slate-500">Pesanan menunggu bayar</h2>
            {pending.length === 0 ? (
              <p className="text-[11px] text-slate-500 bg-white border border-slate-200 rounded-2xl p-4">
                Tidak ada antrean pending pada sampel transaksi terbaru yang diperiksa. Bukan klaim seluruh histori.
              </p>
            ) : (
              pending.map((o) => {
                const pendingHours =
                  typeof o.pending_hours === 'number'
                    ? o.pending_hours
                    : o.created_at
                      ? Math.max(0, Math.round((Date.now() - new Date(o.created_at).getTime()) / 36e5))
                      : null;
                const ageLabel =
                  pendingHours == null
                    ? 'lama tertunda belum diketahui'
                    : pendingHours < 24
                      ? `${pendingHours} jam`
                      : `${Math.floor(pendingHours / 24)} hari ${pendingHours % 24} jam`;
                return (
                  <div
                    key={o.id}
                    className="bg-white border border-amber-100 rounded-2xl p-3 shadow-sm space-y-2"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-xs font-black text-slate-900">{o.receipt_number || o.id}</p>
                        <p className="text-[10px] text-slate-700">
                          {o.customer_name || 'Pelanggan'} · {o.customer_phone || '—'} · Rp{' '}
                          {Number(o.amount || 0).toLocaleString('id-ID')}
                        </p>
                        <p className="text-[10px] text-slate-600">
                          {o.created_at ? new Date(o.created_at).toLocaleString('id-ID') : 'Waktu —'} · tertunda{' '}
                          {ageLabel}
                        </p>
                        <p className="text-[10px] text-slate-600">
                          Outlet: {o.outlet_name || o.outlet_id || '—'} · metode: {o.payment_method || '—'}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          Status: {o.payment_status || o.status || 'pending'}
                          {o.mayar_payment_id ? ` · gateway: ${o.mayar_payment_id}` : ' · ID gateway belum ada'}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => void resync(o.id)}
                          disabled={resyncId === o.id}
                          className="text-[10px] font-extrabold bg-indigo-50 text-indigo-700 border border-indigo-100 px-2.5 py-2.5 min-h-[44px] rounded-xl disabled:opacity-60"
                        >
                          {resyncId === o.id ? 'Re-sync…' : 'Re-sync'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setManualOrder(o)}
                          className="text-[10px] font-extrabold bg-emerald-600 text-white px-2.5 py-2.5 min-h-[44px] rounded-xl"
                        >
                          Tandai Lunas Manual
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-xs font-black uppercase tracking-wide text-slate-500">Webhook logs</h2>
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
              <table className="w-full text-[10px]">
                <thead className="bg-slate-50 text-slate-500 font-extrabold uppercase">
                  <tr>
                    <th className="text-left p-2">Waktu</th>
                    <th className="text-left p-2">Gateway</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Sig</th>
                  </tr>
                </thead>
                <tbody>
                  {webhooks.map((w) => (
                    <tr key={w.id} className="border-t border-slate-100">
                      <td className="p-2 text-slate-600">{new Date(w.created_at).toLocaleString('id-ID')}</td>
                      <td className="p-2 font-bold">{w.gateway}</td>
                      <td className="p-2 font-bold">{w.status}</td>
                      <td className="p-2">{w.signature_ok === false ? '❌' : w.signature_ok ? '✅' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      <ManualMarkPaidModal
        open={Boolean(manualOrder)}
        order={manualOrder}
        agentName="Owner"
        role="owner"
        onClose={() => setManualOrder(null)}
        onSuccess={() => {
          toast('Ditandai lunas — metrik & role lain akan sync realtime', 'ok');
          void load();
        }}
      />
    </div>
  );
}
