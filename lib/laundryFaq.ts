/** Jawaban layanan laundry jika Gemini gagal — jangan biarkan widget kosong/error. */

const FAQ: { keys: string[]; answer: string }[] = [
  {
    keys: ['harga', 'tarif', 'price', 'berapa'],
    answer:
      'Kak, Cuci Kering Gosok reguler mulai Rp 8.000/kg (minimal 3 kg). Oneday +50%, Express 6 jam +100%, Quick 3 jam +200%. Satuan (bedcover, sepatu, jas) tarif terpisah. Ongkir antar-jemput mulai Rp 20.000 menyesuaikan jarak.'
  },
  {
    keys: ['jemput', 'pickup', 'antar', 'kurir', 'driver'],
    answer:
      'Laundrivery sediakan jemput-antar. Isi alamat di Beranda lalu buat order. Driver biasanya tiba 1–2 jam kerja. Ongkir mulai Rp 20.000. Kalau cucian sudah Siap Diambil, Kakak bisa tekan Minta Pengantaran Driver.'
  },
  {
    keys: ['bayar', 'qris', 'transfer', 'cash', 'pembayaran'],
    answer:
      'Pembayaran cashless via QRIS di aplikasi, atau cash di outlet. Kami tidak menerima transfer bank. Tagihan muncul setelah cucian ditimbang kasir.'
  },
  {
    keys: ['lama', 'durasi', 'kapan', 'selesai', 'express', 'quick', 'oneday'],
    answer:
      'Reguler 2–3 hari, Oneday 1 hari, Express 6 jam, Quick 3 jam (dihitung sejak cucian masuk outlet). Express dipesan setelah pukul 13.00 selesai esok hari.'
  },
  {
    keys: ['komplain', 'rusak', 'hilang', 'kotor'],
    answer:
      'Mohon maaf atas kendalanya Kak. Klaim maksimal 1×24 jam dengan video unboxing utuh. Rewash gratis bila hasil kurang rapi. Untuk ganti rugi, CS Admin yang menindaklanjuti — silakan buka tab Live CS.'
  },
  {
    keys: ['member', 'saldo', 'deposit', 'promo'],
    answer:
      'Paket member: Silver Rp 300.000 (+20rb), Gold Rp 500.000 (+50rb), Platinum Rp 900.000 (+100rb). Saldo bebas masa berlaku, top up via QRIS. Cek voucher di tab Promo dashboard.'
  }
];

export const laundryFallbackReply = (question: string) => {
  const q = String(question || '').toLowerCase();
  const hit = FAQ.find((f) => f.keys.some((k) => q.includes(k)));
  if (hit) return hit.answer;
  return 'Halo Kak, saya asisten Laundrivery. Kami layani cuci kiloan (min. 3 kg), satuan, dan jemput-antar. Ongkir mulai Rp 20.000. Pembayaran QRIS atau cash outlet. Mau tanya harga, durasi, atau cara order?';
};
