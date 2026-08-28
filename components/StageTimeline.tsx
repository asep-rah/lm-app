'use client';

import { buildStageTimeline, formatStageTime, stageKeyOf } from '@/lib/stageTimeline';

interface StageTimelineProps {
  /** Baris work_logs milik transaksi ini. */
  logs: any[] | null | undefined;
  /** Baris transaksi; dipakai untuk status terkini, created_at, dan kolom by_*. */
  transaction?: any;
  /** Nama crew disembunyikan pada tampilan pelanggan. */
  showCrew?: boolean;
  title?: string;
}

/**
 * Timeline tahap pengerjaan (Sortir s/d Selesai) beserta waktu penyelesaian dan
 * nama crew. Dipakai di POS, Owner, halaman Track publik, dan dashboard customer.
 *
 * Waktu diambil dari work_logs.created_at, yang dicatat POS tepat saat sebuah
 * tahap diselesaikan, sehingga stempel waktunya adalah waktu SELESAI tahap itu.
 */
export default function StageTimeline({
  logs,
  transaction,
  showCrew = true,
  title = 'Riwayat Waktu Pengerjaan'
}: StageTimelineProps) {
  const timeline = buildStageTimeline(logs, transaction);
  const isReadyForPickup = stageKeyOf(transaction?.status) === 'siap';

  return (
    <div>
      <h4 className="font-bold text-xs text-slate-800 mb-4 uppercase tracking-wider flex items-center gap-1.5">
        <span>⏱️</span> {title}
      </h4>

      <div className="relative border-l-2 border-slate-200 ml-3 space-y-4 pl-4 text-xs">
        {transaction?.created_at && (
          <div className="relative">
            <div className="absolute -left-[23px] top-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white" />
            <p className="font-bold text-slate-800">Cucian Diterima di Kasir</p>
            <p className="text-[10px] text-slate-400 font-mono">{formatStageTime(transaction.created_at)}</p>
          </div>
        )}

        {timeline.map((stage) => {
          // Tahap penyerahan disorot khusus saat cucian sudah siap tapi belum diambil.
          const waitingPickup = stage.key === 'selesai' && !stage.done && isReadyForPickup;

          return (
            <div key={stage.key} className="relative">
              <div
                className={`absolute -left-[23px] top-0.5 w-3 h-3 rounded-full border-2 border-white ${
                  stage.done
                    ? 'bg-emerald-500'
                    : waitingPickup
                    ? 'bg-blue-600 animate-pulse'
                    : 'bg-slate-300'
                }`}
              />
              <p className={`font-bold ${stage.done ? 'text-slate-800' : waitingPickup ? 'text-blue-700' : 'text-slate-400'}`}>
                {stage.icon} {stage.label}
              </p>

              {stage.done ? (
                <>
                  <p className="text-[10px] text-slate-400 font-mono">
                    {formatStageTime(stage.at) || 'Waktu tidak tercatat'}
                  </p>
                  {showCrew && stage.crew && (
                    <p className="text-[9px] text-slate-400 italic">Petugas: {stage.crew}</p>
                  )}
                </>
              ) : (
                <p className={`text-[10px] font-medium ${waitingPickup ? 'text-blue-500' : 'text-slate-300'}`}>
                  {waitingPickup ? 'Siap diambil di outlet' : 'Belum dikerjakan'}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
