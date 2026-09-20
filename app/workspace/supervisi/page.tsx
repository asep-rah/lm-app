'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { getStaffSession, homePathForRole, isHeadManagementRole, isSupervisorRole } from '@/lib/staffSession';
import { parseAssignedOutletIds } from '@/lib/driverAttendance';
import {
  daysSince,
  isVisitSubmitted,
  loadVisits,
  scoreTone,
  type SupervisionVisit
} from '@/lib/supervisionVisit';
import VisitForm from '@/components/supervision/VisitForm';

type Outlet = { id: string; name: string };

const TONE_TEXT: Record<string, string> = {
  emerald: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  amber: 'text-amber-700 bg-amber-50 border-amber-200',
  rose: 'text-rose-700 bg-rose-50 border-rose-200',
  slate: 'text-slate-500 bg-slate-50 border-slate-200'
};

/** Rentang baca default: 90 hari. PRD §8 melarang kueri all-time tanpa batas. */
const LOOKBACK_DAYS = 90;
const STALE_DAYS = 14;

const sinceIso = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

export default function SupervisiPage() {
  const [ready, setReady] = useState(false);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [visits, setVisits] = useState<SupervisionVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const session = useMemo(() => getStaffSession(), []);
  const allowedOutletIds = useMemo(() => {
    try {
      const raw = localStorage.getItem('laundry_owner_user') || localStorage.getItem('laundry_user');
      return parseAssignedOutletIds(raw ? JSON.parse(raw) : {});
    } catch {
      return [];
    }
  }, []);

  // Owner & head management melihat seluruh outlet; supervisor dibatasi
  // outlet yang ditugaskan padanya.
  const seesAllOutlets = isHeadManagementRole(session.role) || session.role === 'owner';

  useEffect(() => {
    const raw = localStorage.getItem('laundry_owner_user') || localStorage.getItem('laundry_user');
    if (!raw) {
      window.location.href = '/login';
      return;
    }
    if (!isSupervisorRole(session.role) && !isHeadManagementRole(session.role)) {
      window.location.href = homePathForRole(session.role);
      return;
    }
    setReady(true);
  }, [session.role]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: outs } = await supabase.from('outlets').select('id, name').order('name');
    const allOutlets = (outs as Outlet[]) || [];
    const mine =
      seesAllOutlets || !allowedOutletIds.length
        ? allOutlets
        : allOutlets.filter((o) => allowedOutletIds.includes(o.id));
    setOutlets(mine);

    setVisits(
      await loadVisits({
        outletIds: seesAllOutlets ? undefined : mine.map((o) => o.id),
        sinceDate: sinceIso(LOOKBACK_DAYS),
        limit: 200
      })
    );
    setLoading(false);
  }, [allowedOutletIds, seesAllOutlets]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  const outletName = useMemo(
    () => Object.fromEntries(outlets.map((o) => [o.id, o.name])),
    [outlets]
  );

  // Kunjungan terakhir per outlet -- visits sudah terurut terbaru lebih dulu.
  const lastVisitByOutlet = useMemo(() => {
    const map = new Map<string, SupervisionVisit>();
    visits.forEach((v) => {
      if (!v.outlet_id || !isVisitSubmitted(v)) return;
      if (!map.has(v.outlet_id)) map.set(v.outlet_id, v);
    });
    return map;
  }, [visits]);

  const stale = useMemo(
    () =>
      outlets
        .map((o) => {
          const last = lastVisitByOutlet.get(o.id);
          return { outlet: o, last, days: daysSince(last?.visit_date) };
        })
        .filter((row) => row.days == null || row.days >= STALE_DAYS)
        .sort((a, b) => (b.days ?? 9999) - (a.days ?? 9999)),
    [outlets, lastVisitByOutlet]
  );

  const openFollowUps = visits.filter((v) => v.follow_up_task_id).length;

  if (!ready) return <div className="min-h-screen bg-[#f7f7f5]" />;

  return (
    <div className="min-h-screen bg-[#f7f7f5] pb-20">
      <header className="bg-white border-b border-slate-200 px-4 py-3 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div>
            <h1 className="text-sm font-bold text-slate-900">Supervisi Outlet</h1>
            <p className="text-[11px] text-slate-500">
              {session.name} · {outlets.length} outlet
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/workspace"
              className="text-[11px] font-semibold px-3 py-2 rounded-lg border border-slate-200 text-slate-600"
            >
              Workspace
            </Link>
            <button
              type="button"
              onClick={() => setShowForm(true)}
              disabled={!outlets.length}
              className="text-[11px] font-bold px-3 py-2 rounded-lg bg-slate-900 text-white disabled:opacity-50"
            >
              + Kunjungan
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        <section className="grid grid-cols-3 gap-2">
          <div className="bg-white border border-slate-200 rounded-2xl p-3">
            <p className="text-[9px] uppercase font-bold text-slate-400">Kunjungan {LOOKBACK_DAYS} hari</p>
            <p className="text-lg font-bold text-slate-900">{visits.filter(isVisitSubmitted).length}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-3">
            <p className="text-[9px] uppercase font-bold text-slate-400">Perlu dikunjungi</p>
            <p className="text-lg font-bold text-amber-600">{stale.length}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-3">
            <p className="text-[9px] uppercase font-bold text-slate-400">Tindak lanjut</p>
            <p className="text-lg font-bold text-slate-900">{openFollowUps}</p>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-slate-900 mb-1">
            Belum dikunjungi {STALE_DAYS}+ hari
          </h2>
          <p className="text-[11px] text-slate-500 mb-3">
            Outlet yang paling lama tidak disupervisi muncul di atas.
          </p>
          {loading ? (
            <p className="text-xs text-slate-400">Memuat...</p>
          ) : stale.length === 0 ? (
            <p className="text-xs text-emerald-700">Semua outlet dikunjungi dalam {STALE_DAYS} hari terakhir.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {stale.slice(0, 20).map(({ outlet, days }) => (
                <li key={outlet.id} className="py-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-800 truncate">{outlet.name}</span>
                  <span className="text-[10px] font-bold text-amber-700 shrink-0">
                    {days == null ? 'Belum pernah' : `${days} hari lalu`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Laporan Terakhir</h2>
          {loading ? (
            <p className="text-xs text-slate-400">Memuat...</p>
          ) : visits.length === 0 ? (
            <p className="text-xs text-slate-400">Belum ada laporan supervisi.</p>
          ) : (
            <div className="space-y-2">
              {visits.slice(0, 30).map((v) => {
                const tone = scoreTone(v.score);
                return (
                  <article key={v.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 truncate">
                          {outletName[v.outlet_id || ''] || 'Outlet'}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {new Date(v.visit_date).toLocaleDateString('id-ID')} · {v.supervisor_name || '—'}
                          {!isVisitSubmitted(v) && ' · draft'}
                        </p>
                      </div>
                      <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-lg border ${TONE_TEXT[tone]}`}>
                        {v.score == null ? '—' : v.score}
                      </span>
                    </div>
                    {v.omset_action_plan && (
                      <p className="text-[11px] text-slate-600 mt-2 leading-relaxed">
                        <span className="font-semibold text-slate-500">Rencana omset:</span> {v.omset_action_plan}
                      </p>
                    )}
                    {Array.isArray(v.issues_found) && v.issues_found.length > 0 && (
                      <p className="text-[10px] text-rose-600 mt-1">
                        {v.issues_found.length} temuan
                        {v.follow_up_task_id ? ' · tugas tindak lanjut dibuat' : ''}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {showForm && (
        <VisitForm
          outlets={outlets}
          session={{ id: session.id, name: session.name }}
          onClose={() => setShowForm(false)}
          onSaved={load}
        />
      )}
    </div>
  );
}
