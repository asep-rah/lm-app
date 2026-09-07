'use client';

import ReceiptPreview from '@/components/ReceiptPreview';
import type { ReceiptLayout } from '@/lib/receiptLayout';

type Props = {
  layout: ReceiptLayout;
  onChange: (next: ReceiptLayout) => void;
  outletName?: string;
  outletPhone?: string;
};

const FIELDS: Array<{ key: keyof ReceiptLayout; label: string; rows?: number }> = [
  { key: 'brandName', label: 'Nama di struk (kosong = nama outlet)' },
  { key: 'tagline', label: 'Tagline' },
  { key: 'csLabel', label: 'Label CS / telepon' },
  { key: 'dateLabel', label: 'Label tanggal masuk' },
  { key: 'doneLabel', label: 'Label estimasi selesai' },
  { key: 'receiptLabel', label: 'Label nomor resi' },
  { key: 'nameLabel', label: 'Label nama pelanggan' },
  { key: 'phoneLabel', label: 'Label nomor HP' },
  { key: 'totalLabel', label: 'Label total' },
  { key: 'payLabel', label: 'Label bayar' },
  { key: 'termsTitle', label: 'Judul syarat & ketentuan' },
  { key: 'terms', label: 'Isi syarat & ketentuan (juga S&K aplikasi pelanggan)', rows: 5 },
  { key: 'extraNote', label: 'Catatan tambahan footer', rows: 2 },
  { key: 'footer', label: 'Baris footer (cek cucian / URL)' }
];

export default function ReceiptLayoutEditor({ layout, onChange, outletName, outletPhone }: Props) {
  const patch = (key: keyof ReceiptLayout, value: string) => onChange({ ...layout, [key]: value });

  return (
    <div className="bg-white border rounded-2xl p-4 md:p-6 space-y-3">
      <div>
        <h3 className="font-bold text-sm mb-1">Edit Cetak Struk</h3>
        <p className="text-[10px] text-slate-500 mb-2">Semua teks statis struk bisa diubah. Nama, item, dan total tetap dari transaksi kasir. Simpan lewat tombol pengaturan.</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-2">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">{f.label}</label>
              {f.rows ? (
                <textarea
                  value={layout[f.key]}
                  onChange={(e) => patch(f.key, e.target.value)}
                  rows={f.rows}
                  className="w-full border rounded-xl p-2 text-xs font-mono"
                />
              ) : (
                <input
                  type="text"
                  value={layout[f.key]}
                  onChange={(e) => patch(f.key, e.target.value)}
                  className="w-full border rounded-xl p-2 text-xs font-semibold"
                />
              )}
            </div>
          ))}
        </div>
        <ReceiptPreview
          layout={layout}
          outletName={outletName}
          outletPhone={outletPhone}
          terms={layout.terms}
        />
      </div>
    </div>
  );
}
