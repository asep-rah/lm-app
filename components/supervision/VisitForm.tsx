'use client';

import { useState } from 'react';
import {
  CHECKLIST_ITEMS,
  CHECKLIST_VERDICTS,
  failingItems,
  saveVisit,
  scoreTone,
  visitScore,
  type Checklist,
  type ChecklistVerdict,
  type VisitIssue
} from '@/lib/supervisionVisit';
import { uploadTaskAttachments, type TaskAttachment } from '@/lib/taskReport';
import { toast } from '@/lib/toast';

const URGENCIES = ['Normal', 'Mendesak', 'Kritis'];

const TONE_BG: Record<string, string> = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
  slate: 'bg-slate-50 text-slate-500 border-slate-200'
};

type Props = {
  outlets: { id: string; name: string }[];
  session: { id: string; name: string };
  onClose: () => void;
  onSaved: () => void;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function VisitForm({ outlets, session, onClose, onSaved }: Props) {
  const [outletId, setOutletId] = useState(outlets[0]?.id || '');
  const [visitDate, setVisitDate] = useState(todayIso());
  const [checklist, setChecklist] = useState<Checklist>({});
  const [omsetNote, setOmsetNote] = useState('');
  const [omsetPlan, setOmsetPlan] = useState('');
  const [staffNote, setStaffNote] = useState('');
  const [issues, setIssues] = useState<VisitIssue[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  const score = visitScore(checklist);
  const tone = scoreTone(score);
  const perluPerhatian = failingItems(checklist);

  const setVerdict = (key: string, value: ChecklistVerdict) =>
    setChecklist((prev) => ({ ...prev, [key]: value }));

  const addIssue = (category = '') =>
    setIssues((prev) => [...prev, { category, description: '', urgency: 'Normal' }]);

  const patchIssue = (idx: number, patch: Partial<VisitIssue>) =>
    setIssues((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const removeIssue = (idx: number) => setIssues((prev) => prev.filter((_, i) => i !== idx));

  const handleSave = async (submit: boolean) => {
    if (!outletId) {
      toast('Pilih outlet dulu.', 'warn');
      return;
    }
    const isiTemuan = issues.filter((i) => i.description.trim());
    if (submit && isiTemuan.length !== issues.length) {
      toast('Ada temuan yang deskripsinya masih kosong.', 'warn');
      return;
    }

    setBusy(true);
    try {
      let photos: TaskAttachment[] = [];
      if (files.length) {
        const up = await uploadTaskAttachments(files, `supervisi_${visitDate}`);
        photos = up.attachments;
        if (up.failed.length) toast(`Gagal unggah: ${up.failed.join(', ')}`, 'warn');
      }

      const res = await saveVisit({
        visit: {
          outlet_id: outletId,
          visit_date: visitDate,
          checklist,
          omset_note: omsetNote.trim(),
          omset_action_plan: omsetPlan.trim(),
          staff_note: staffNote.trim(),
          issues_found: isiTemuan,
          photos
        },
        session,
        submit
      });

      if (res.error) {
        toast('Gagal menyimpan: ' + res.error.message, 'err');
        return;
      }
      toast(
        submit
          ? res.taskId
            ? 'Laporan terkirim, tugas tindak lanjut dibuat.'
            : 'Laporan supervisi terkirim.'
          : 'Draft tersimpan.',
        'ok'
      );
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40">
      <div className="w-full md:max-w-2xl bg-white rounded-t-2xl md:rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-3 flex items-center justify-between">
          <h3 className="font-bold text-slate-800 text-sm">Laporan Kunjungan Outlet</h3>
          <span className={`text-[11px] font-bold px-2 py-1 rounded-lg border ${TONE_BG[tone]}`}>
            {score == null ? 'Belum dinilai' : `Skor ${score}`}
          </span>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Outlet</label>
              <select
                value={outletId}
                onChange={(e) => setOutletId(e.target.value)}
                className="w-full border rounded-xl p-2.5 text-xs bg-white"
              >
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Tanggal Kunjungan</label>
              <input
                type="date"
                value={visitDate}
                max={todayIso()}
                onChange={(e) => setVisitDate(e.target.value)}
                className="w-full border rounded-xl p-2.5 text-xs"
              />
            </div>
          </div>

          <div>
            <p className="text-[10px] font-bold text-slate-500 mb-2">Checklist Kondisi Outlet</p>
            <div className="space-y-2">
              {CHECKLIST_ITEMS.map((item) => (
                <div key={item.key} className="rounded-xl border border-slate-200 p-3">
                  <p className="text-xs font-semibold text-slate-800">{item.label}</p>
                  <p className="text-[10px] text-slate-400 mb-2">{item.hint}</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {CHECKLIST_VERDICTS.map((v) => {
                      const active = checklist[item.key] === v.value;
                      return (
                        <button
                          key={v.value}
                          type="button"
                          onClick={() => setVerdict(item.key, v.value)}
                          className={`text-[10px] font-semibold py-2 rounded-lg border transition-colors ${
                            active
                              ? v.value === 'ok'
                                ? 'bg-emerald-600 text-white border-emerald-600'
                                : v.value === 'perlu_perbaikan'
                                ? 'bg-amber-500 text-white border-amber-500'
                                : 'bg-rose-600 text-white border-rose-600'
                              : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                          }`}
                        >
                          {v.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 mt-2">
              Poin yang dilewati tidak ikut dihitung dalam skor.
            </p>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Catatan Omset</label>
            <textarea
              value={omsetNote}
              onChange={(e) => setOmsetNote(e.target.value)}
              rows={2}
              placeholder="Tren omset, penyebab naik/turun..."
              className="w-full border rounded-xl p-2.5 text-xs"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Rencana Peningkatan Omset</label>
            <textarea
              value={omsetPlan}
              onChange={(e) => setOmsetPlan(e.target.value)}
              rows={2}
              placeholder="Langkah konkret yang disepakati dengan kepala toko..."
              className="w-full border rounded-xl p-2.5 text-xs"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Perihal Karyawan</label>
            <textarea
              value={staffNote}
              onChange={(e) => setStaffNote(e.target.value)}
              rows={2}
              placeholder="Kedisiplinan, kebutuhan pelatihan, kendala personal..."
              className="w-full border rounded-xl p-2.5 text-xs"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-slate-500">Temuan / Kendala</p>
              <button
                type="button"
                onClick={() => addIssue()}
                className="text-[10px] font-semibold text-indigo-600 hover:underline"
              >
                + Tambah temuan
              </button>
            </div>

            {perluPerhatian.length > 0 && (
              <div className="mb-2 rounded-xl bg-amber-50 border border-amber-200 p-2.5">
                <p className="text-[10px] text-amber-800 font-semibold mb-1.5">
                  Poin ini dinilai bermasalah — tambahkan sebagai temuan?
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {perluPerhatian.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => addIssue(item.label)}
                      className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-white border border-amber-300 text-amber-800"
                    >
                      + {item.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              {issues.map((issue, idx) => (
                <div key={idx} className="rounded-xl border border-slate-200 p-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={issue.category}
                      onChange={(e) => patchIssue(idx, { category: e.target.value })}
                      placeholder="Kategori (mis. Mesin)"
                      className="border rounded-lg p-2 text-[11px]"
                    />
                    <select
                      value={issue.urgency}
                      onChange={(e) => patchIssue(idx, { urgency: e.target.value })}
                      className="border rounded-lg p-2 text-[11px] bg-white"
                    >
                      {URGENCIES.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>
                  <textarea
                    value={issue.description}
                    onChange={(e) => patchIssue(idx, { description: e.target.value })}
                    rows={2}
                    placeholder="Deskripsi temuan..."
                    className="w-full border rounded-lg p-2 text-[11px]"
                  />
                  <button
                    type="button"
                    onClick={() => removeIssue(idx)}
                    className="text-[10px] font-semibold text-rose-600 hover:underline"
                  >
                    Hapus temuan
                  </button>
                </div>
              ))}
              {issues.length === 0 && (
                <p className="text-[11px] text-slate-400">Belum ada temuan dicatat.</p>
              )}
            </div>
            {issues.length > 0 && (
              <p className="text-[10px] text-slate-400 mt-2">
                Saat laporan dikirim, temuan ini otomatis menjadi tugas tindak lanjut supervisor.
              </p>
            )}
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Foto Kondisi Outlet</label>
            <input
              type="file"
              multiple
              accept="image/*"
              capture="environment"
              onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, 5))}
              className="w-full border rounded-xl p-2 text-[11px]"
            />
            {files.length > 0 && (
              <p className="text-[10px] text-slate-500 mt-1">{files.length} foto dipilih</p>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-slate-100 px-5 py-3 flex gap-2">
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
            onClick={() => handleSave(false)}
            disabled={busy}
            className="flex-1 border border-slate-300 text-slate-700 font-bold py-2.5 rounded-xl text-xs disabled:opacity-60"
          >
            Simpan Draft
          </button>
          <button
            type="button"
            onClick={() => handleSave(true)}
            disabled={busy}
            className="flex-1 bg-slate-900 hover:bg-black text-white font-bold py-2.5 rounded-xl text-xs disabled:opacity-60"
          >
            {busy ? 'Menyimpan...' : 'Kirim Laporan'}
          </button>
        </div>
      </div>
    </div>
  );
}
