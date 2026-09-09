'use client';

import { buildStageTimeline, formatStageTime, stageKeyOf } from '@/lib/stageTimeline';
import { TIMELINE_ICONS } from '@/components/customer/ui';
import { Clock, FileText, ImageIcon } from 'lucide-react';

interface StageTimelineProps {
  /** Baris work_logs milik transaksi ini. */
  logs: any[] | null | undefined;
  /** Baris transaksi; dipakai untuk status terkini, created_at, dan kolom by_*. */
  transaction?: any;
  /** Nama crew disembunyikan pada tampilan pelanggan. */
  showCrew?: boolean;
  title?: string;
  /** Pelanggan melihat jemput → outlet → laundry. Ops/POS tetap mulai dari kasir. */
  variant?: 'ops' | 'customer';
  onOpenPhoto?: (url: string) => void;
}

const pendingLabel = (key: string, inProgress: boolean) => {
  if (key === 'jemput') return inProgress ? 'Menunggu kurir / pickup request' : 'Belum dijemput';
  if (key === 'outlet') return inProgress ? 'Menuju outlet' : 'Belum sampai outlet';
  if (key === 'pembayaran') return inProgress ? 'Menunggu Pembayaran' : 'Belum dibayar';
  if (key === 'siap') return inProgress ? 'Siap diambil / diantar' : 'Belum siap';
  if (key === 'selesai') return inProgress ? 'Siap diambil di outlet' : 'Belum diserahkan';
  return inProgress ? 'Sedang dikerjakan' : 'Belum dikerjakan';
};

/**
 * Timeline tahap pengerjaan beserta waktu penyelesaian dan nama crew.
 * Tombol Lihat foto di samping kanan tiap tahap (foto tidak di-load otomatis).
 */
export default function StageTimeline({
  logs,
  transaction,
  showCrew = true,
  title = 'Riwayat Waktu Pengerjaan',
  variant = 'ops',
  onOpenPhoto
}: StageTimelineProps) {
  const timeline = buildStageTimeline(logs, transaction, { variant });
  const isReadyForPickup = stageKeyOf(transaction?.status) === 'siap';
  const firstOpen = timeline.findIndex((s) => !s.done);

  const openPhoto = (url: string) => {
    if (onOpenPhoto) onOpenPhoto(url);
    else window.open(url, '_blank');
  };

  return (
    <div>
      <h4 className="font-bold text-xs text-slate-800 mb-3 uppercase tracking-wider flex items-center gap-1.5">
        {variant === 'customer' ? <Clock className="w-3.5 h-3.5 text-slate-500" /> : <span>⏱️</span>} {title}
      </h4>

      <div className="relative border-l-2 border-slate-200 ml-3 space-y-3 pl-4 text-xs">
        {variant !== 'customer' && transaction?.created_at && (
          <div className="relative min-h-[2.5rem]">
            <div className="absolute -left-[23px] top-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white" />
            <p className="font-bold text-slate-800 leading-5">Cucian Diterima di Kasir</p>
            <p className="text-[10px] text-slate-400 font-mono leading-4 mt-0.5">{formatStageTime(transaction.created_at)}</p>
          </div>
        )}

        {timeline.map((stage, idx) => {
          const waitingPickup = stage.key === 'selesai' && !stage.done && isReadyForPickup;
          const inProgress = !stage.done && (waitingPickup || idx === firstOpen);
          const StageIcon = TIMELINE_ICONS[stage.key] || Clock;
          const photos = stage.photoUrls?.length ? stage.photoUrls : stage.photoUrl ? [stage.photoUrl] : [];
          const paidNote = stage.key === 'pembayaran' && stage.done && stage.notes === 'Sudah Dibayar';
          const otherNotes = stage.notes && !paidNote ? stage.notes : null;

          return (
            <div key={stage.key} className="relative min-h-[2.5rem]">
              <div
                className={`absolute -left-[23px] top-1 w-3 h-3 rounded-full border-2 border-white ${
                  stage.done
                    ? 'bg-emerald-500'
                    : inProgress
                    ? 'bg-blue-600 animate-pulse'
                    : 'bg-slate-300'
                }`}
              />
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p
                    className={`font-bold flex items-center gap-1.5 leading-5 ${
                      stage.done ? 'text-slate-800' : inProgress ? 'text-blue-700' : 'text-slate-400'
                    }`}
                  >
                    {variant === 'customer' ? (
                      <StageIcon className="w-3.5 h-3.5 shrink-0" strokeWidth={2.3} />
                    ) : (
                      stage.icon
                    )}{' '}
                    <span className="truncate">{stage.label}</span>
                    {paidNote && (
                      <span className="shrink-0 text-[9px] font-extrabold text-emerald-700 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded-md">
                        Sudah Dibayar
                      </span>
                    )}
                  </p>

                  {stage.done ? (
                    <>
                      <p className="text-[10px] text-slate-400 font-mono leading-4 mt-0.5">
                        {formatStageTime(stage.at) || 'Waktu tidak tercatat'}
                      </p>
                      {showCrew && stage.crew && (
                        <p className="text-[9px] text-slate-400 italic leading-4">Petugas: {stage.crew}</p>
                      )}
                      {otherNotes && (
                        <p className="text-[10px] text-slate-600 mt-1 bg-slate-50 border border-slate-100 rounded-lg px-2 py-1 inline-flex items-start gap-1 max-w-full">
                          {variant === 'customer' ? (
                            <FileText className="w-3 h-3 mt-0.5 shrink-0 text-slate-400" />
                          ) : (
                            <span>📝</span>
                          )}{' '}
                          <span className="break-words">{otherNotes}</span>
                        </p>
                      )}
                    </>
                  ) : (
                    <p className={`text-[10px] font-medium leading-4 mt-0.5 ${inProgress ? 'text-blue-500' : 'text-slate-300'}`}>
                      {pendingLabel(stage.key, inProgress)}
                    </p>
                  )}
                </div>

                {photos.length > 0 && (
                  <button
                    type="button"
                    onClick={() => openPhoto(photos[0])}
                    className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[9px] font-extrabold text-slate-700 hover:bg-sky-50 hover:border-sky-200 hover:text-sky-800"
                    title={photos.length > 1 ? `${photos.length} foto` : 'Lihat foto'}
                  >
                    <ImageIcon className="w-3 h-3" />
                    {photos.length > 1 ? `Lihat ${photos.length}` : 'Lihat'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
