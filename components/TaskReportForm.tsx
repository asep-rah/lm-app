'use client';

import { useState } from 'react';
import {
  MAX_ATTACHMENTS,
  submitTaskReport,
  uploadTaskAttachments,
  type TaskAttachment
} from '@/lib/taskReport';
import { toast } from '@/lib/toast';

type Props = {
  task: { id: string; title?: string };
  session: { id: string; name: string; role: string };
  onClose: () => void;
  onDone: () => void;
};

export default function TaskReportForm({ task, session, onClose, onDone }: Props) {
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  const pickFiles = (list: FileList | null) => {
    if (!list) return;
    setFiles(Array.from(list).slice(0, MAX_ATTACHMENTS));
  };

  const handleSubmit = async () => {
    if (!note.trim() && !files.length) {
      toast('Isi catatan laporan atau lampirkan berkas dulu.', 'warn');
      return;
    }
    setBusy(true);
    try {
      let attachments: TaskAttachment[] = [];
      if (files.length) {
        const up = await uploadTaskAttachments(files, `task_${task.id.slice(0, 8)}`);
        attachments = up.attachments;
        if (up.failed.length) toast(`Gagal unggah: ${up.failed.join(', ')}`, 'warn');
      }

      const res = await submitTaskReport({ task, note: note.trim(), attachments, session });
      if (!res.success) {
        toast(res.message || 'Gagal mengirim laporan', 'err');
        return;
      }
      toast(
        res.isOverdue
          ? `Laporan terkirim, SLA terlewati (−${Math.abs(res.penalty || 0)})`
          : 'Laporan terkirim, tugas selesai.',
        res.isOverdue ? 'warn' : 'ok'
      );
      onDone();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-0 md:p-4">
      <div className="w-full md:max-w-lg bg-white rounded-t-2xl md:rounded-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div>
          <h3 className="font-bold text-slate-800 text-sm">Laporan Penyelesaian</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">{task.title || 'Tugas'}</p>
        </div>

        <div>
          <label className="block text-[10px] font-bold text-slate-500 mb-1">Catatan Hasil Pekerjaan</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            placeholder="Apa yang dikerjakan, hasilnya, dan kendala bila ada..."
            className="w-full border rounded-xl p-2.5 text-xs"
          />
        </div>

        <div>
          <label className="block text-[10px] font-bold text-slate-500 mb-1">
            Lampiran <span className="font-normal text-slate-400">(maks {MAX_ATTACHMENTS} berkas)</span>
          </label>
          <input
            type="file"
            multiple
            accept="image/*,application/pdf"
            onChange={(e) => pickFiles(e.target.files)}
            className="w-full border rounded-xl p-2 text-[11px]"
          />
          {files.length > 0 && (
            <ul className="mt-2 space-y-1">
              {files.map((f) => (
                <li key={f.name} className="text-[10px] text-slate-500 truncate">
                  📎 {f.name}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 border border-slate-300 text-slate-600 font-bold py-2.5 rounded-xl text-xs disabled:opacity-60"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy}
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl text-xs disabled:opacity-60"
          >
            {busy ? 'Mengirim...' : 'Kirim & Selesaikan'}
          </button>
        </div>
      </div>
    </div>
  );
}
