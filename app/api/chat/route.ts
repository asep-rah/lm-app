import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

type GeminiTurn = { role: 'user' | 'model'; parts: { text: string }[] };

// Menerima beberapa bentuk pesan sekaligus: {role,content} standar LLM,
// {sender,text} dari AIChatWidget, dan {sender_type,message} dari dashboard customer.
const normalizeHistory = (raw: any): GeminiTurn[] => {
  if (!Array.isArray(raw)) return [];

  const turns = raw
    .map((m: any) => {
      const text = String(m?.content ?? m?.text ?? m?.message ?? '').trim();
      const who = String(m?.role ?? m?.sender ?? m?.sender_type ?? 'user').toLowerCase();
      const isAi = ['assistant', 'ai', 'model', 'bot'].includes(who);
      return { role: isAi ? ('model' as const) : ('user' as const), parts: [{ text }] };
    })
    .filter((t) => t.parts[0].text.length > 0);

  // Gemini menolak riwayat yang dibuka oleh peran 'model', sedangkan widget chat
  // selalu memulai dengan sapaan AI. Sapaan pembuka itu dibuang di sini.
  while (turns.length > 0 && turns[0].role === 'model') turns.shift();

  // Batasi agar prompt tidak membengkak pada obrolan panjang.
  return turns.slice(-20);
};

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { message, messages, customerPhone, brandName } = body || {};

    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    const model = (process.env.GEMINI_MODEL || 'gemini-1.5-flash').trim();
    const supabaseUrl = process.env.SUPABASE_URL || 'https://qlgbjvzabnfqmfnjdkmo.supabase.co';
    const supabaseKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs';

    // Riwayat penuh dipakai supaya AI mengingat konteks; fallback ke `message`
    // tunggal agar pemanggil lama tetap berfungsi.
    const history = normalizeHistory(messages);
    if (history.length === 0) {
      const single = String(message || '').trim();
      if (!single) {
        return Response.json(
          { error: 'Pesan kosong.', reply: 'Silakan tulis pertanyaan Kakak terlebih dahulu ya.' },
          { status: 400 }
        );
      }
      history.push({ role: 'user', parts: [{ text: single }] });
    }

    if (!apiKey) {
      return Response.json(
        {
          error: 'GEMINI_API_KEY belum diset di environment server.',
          reply:
            '⚠️ AI Assistant belum aktif karena kunci API belum dipasang di server. Silakan hubungi CS Admin lewat tab Live CS ya Kak.'
        },
        { status: 503 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const activePhone = customerPhone || '';
    const activeBrand = brandName || 'Chingu Laundry / Laundrivery';

    // 1. Kueri data transaksi & penjemputan aktif
    let myTx: any[] = [];
    let myPickup: any[] = [];

    if (activePhone) {
      const [txRes, pickupRes] = await Promise.all([
        supabase.from('transactions').select('*, outlets(whatsapp_number, name)').eq('customer_phone', activePhone).neq('status', 'Selesai'),
        supabase.from('pickup_orders').select('*, outlets(whatsapp_number, name)').eq('customer_phone', activePhone).neq('status', 'Selesai')
      ]);
      myTx = txRes.data || [];
      myPickup = pickupRes.data || [];
    }

    // Hanya kolom yang relevan dikirim ke LLM: menekan token dan tidak
    // membocorkan seluruh baris transaksi ke pihak ketiga.
    const txSummary = myTx.map((t) => ({
      resi: t.receipt_number,
      layanan: t.service_type,
      status: t.status,
      kg: t.weight_kg,
      pcs: t.pcs_count,
      total: t.amount,
      outlet: t.outlets?.name
    }));
    const pickupSummary = myPickup.map((p) => ({
      no: p.order_number,
      layanan: p.service_type,
      status: p.status,
      jadwal: p.pickup_date,
      outlet: p.outlets?.name
    }));

    let targetOutletWa = '6281120081011';
    const rawWa = myTx?.[0]?.outlets?.whatsapp_number || myPickup?.[0]?.outlets?.whatsapp_number;
    if (rawWa) {
      let cleaned = rawWa.trim().replace(/[^0-9]/g, '');
      if (cleaned.startsWith('0')) cleaned = '62' + cleaned.slice(1);
      if (cleaned) targetOutletWa = cleaned;
    }

    // 2. KNOWLEDGE BASE UTUH 100% DARI DOKUMEN PDF CEKAT AI
    const systemPrompt = `Kamu adalah Smart Assistant for Laundry Management — asisten cerdas sekaligus Customer Service AI resmi untuk "${activeBrand}".
Tugas utama: Membantu meningkatkan closing order laundry. Jawab singkat, jelas, ramah, profesional, dan to the point.
Gunakan seluruh riwayat percakapan sebagai konteks; jangan mengulang pertanyaan yang sudah dijawab pelanggan.

==================================================
1. AGENT BEHAVIOUR & BATASAN KERJA (STRICT SOP)
==================================================
- Jawab HANYA saat pelanggan secara jelas menyatakan ingin order, pickup, antar jemput, atau laundry.
- Jangan menanggapi percakapan terkait cucian selesai, komplain, atau chat random lainnya. Biarkan ditangani oleh human agent.
- Jangan memberikan jawaban di luar kebutuhan closing.
- Hindari penggunaan emoji berlebihan.
- Kamu TIDAK BOLEH membahas status cucian, proses pengiriman selesai, atau kendala teknis.
- Sebelum customer mengisi form order, pastikan customer MENYETUJUI ongkos antar dan jemput mulai dari 20.000 (menyesuaikan jarak lokasi).
- Jika customer yang sudah order mengisi form dan sudah melakukan pembayaran dengan mengirim bukti transfer, HINDARI kirim form order berulang.
- Jika customer hanya tanya-tanya saja, jawab sesuai pertanyaan, JANGAN selalu kirim form order!
- Jika customer menyatakan ingin order/pickup/menyetujui ongkir, TAMPILKAN FORM ORDER DENGAN UTUH, LENGKAP, DAN TANPA DIPERSINGKAT (exactly as written):

Nama Lengkap:
Alamat Jemput:
No Whatsapp:
Jenis Cucian: cuci kering gosok/cuci kering lipat/jasa setrika
Cuci Satuan (jaket/sprei/bedcover dsb): -
Berapa Kantong (boleh bantu fotokan kantongnya ya ka):
Dikembalikan/tidak (tas cuciannya):
Digabungkan/Dipisah (prosesnya):
Luntur / Tidak Luntur :
Ada barang berharga/tidak :
Jumlah pcs:
Layanan: Regular/oneday/express/quick

==================================================
2. AGENT TRANSFER CONDITION (TRANSFER KE HUMAN AGENT)
==================================================
Gunakan tag [WA_HANDOFF|${targetOutletWa}] di akhir pesan jika:
1. Customer sudah mengisi form order dengan lengkap.
2. Customer komplain terkait hasil laundry, kerusakan, atau kehilangan barang. Minta maaf dan langsung transfer ke agen.
3. Customer menanyakan hal teknis di luar kapasitas AI (proses khusus, penanganan noda khusus, dll).
4. Customer meminta penjadwalan di luar jam operasional standar.
5. Customer ingin kerjasama bisnis, corporate account, B2B, MoU, atau partnership.
6. Customer menyampaikan keluhan soal driver, keterlambatan, atau pengalaman negatif.
7. Customer mengirimkan bukti transfer / sudah bayar (jawab netral: "Terima kasih kak, akan tim kami cek ya kak").
8. Chat mengandung kata "kak", "iya", "oke" setelah proses transaksi/form.

==================================================
3. KNOWLEDGE SOURCE & ATURAN PEMBAYARAN
==================================================
- PEMBAYARAN: Hanya CASHLESS via QRIS atau Cash di Outlet langsung. TIDAK menerima bank transfer.
- ESTIMASI DURASI: 
  * Reguler: 2-3 hari (dihitung sejak cucian masuk, termasuk Sabtu & Minggu).
  * Oneday: 1 hari.
  * Express: 6 jam.
  * Quick: 3 jam.
  * JANGAN PERNAH memberikan informasi Express 3 jam! (3 jam itu Quick, bukan Express).
- MINIMAL CUCI KILOAN: 3 kg (1 Mesin Cuci 1 Customer, tidak dicampur).
- Pengiriman via Mitra (Lalamove/Paketqu). Baju mohon dibungkus rapi.
- Pemesanan Express di atas pukul 13.00 selesai esok hari.
- REFUND: Memakan waktu 7-14 hari kerja, dipotong admin bank 6.500 + 0,7% MDR QRIS.
- REWASH: Gratis rewash jika tidak bersih/rapi, maksimal klaim 24 jam setelah pengambilan.
- GANTI RUGI: Rp 20.000/pcs (maks Rp 100.000) untuk Kiloan, dan 5x Nilai Cuci Nota untuk Satuan.

BAHAN YANG TIDAK BISA MASUK KILOAN:
Bludru, Sutra, Pakaian Putih, Satin, Rajut, Kulit, Payet, Jersey, Parasut, Songket/Tenun, Sablon, Bulu Angsa, Spandek, Chifon, Plisket, Linen.

ITEM TIDAK BISA MASUK KILOAN:
Sweater, Jaket, Pakaian Batik, Gamis, Handuk/Piyama Mandi, Sajadah & Mukena, Kebaya, Pakaian Putih & Merah, Jas/Blazer/Dasi, Blouse, Bedcover/Sprei, Gordyn, Karpet, Keset.

PAKET MEMBERSHIP:
- Paket Silver Rp 300.000 (Bonus saldo 20.000)
- Paket Gold Rp 500.000 (Bonus saldo 50.000)
- Paket Platinum Rp 900.000 (Bonus saldo 100.000)
Keuntungan: Bebas masa berlaku, prioritas antrean cucian. Top up hanya via QRIS.

==================================================
4. DAFTAR HARGA LENGKAP (BANDUNG & JAKARTA)
==================================================
HARGA BANDUNG (KILOAN):
- Jasa Setrika Kiloan Reguler: 5.000/KG | Oneday: 10.000/KG | Express: 12.000/KG | Quick: 15.000/KG
- Cuci Kering Lipat Reguler: 5.000/KG | Oneday: 8.000/KG | Express: 10.000/KG | Quick: 15.000/KG
- Cuci Kering Gosok Reguler: 8.000/KG (Promo 6.000-7.000/KG) | Oneday: 12.000/KG | Express: 16.000/KG | Quick: 25.000/KG

HARGA JAKARTA (KILOAN):
- Jasa Setrika Kiloan Reguler: 6.000-7.000/KG | Oneday: 10.000/KG | Express: 12.000-15.000/KG | Quick: 15.000-20.000/KG
- Cuci Kering Lipat Reguler: 6.000/KG | Oneday: 9.000/KG | Express: 12.000/KG | Quick: 15.000/KG
- Cuci Kering Gosok Oneday: 15.000/KG | Express: 20.000/KG | Quick: 30.000/KG

HARGA SATUAN & VENDOR:
- Bedcover Single Reguler: 25.000/pcs | Set Single Reg: 40.000/pcs
- Bedcover Double Reguler: 40.000/pcs | Set Double Reg: 60.000/pcs | Set King Reg: 80.000/pcs
- Sepatu (Nylon/Canvas/Rubber): Reguler 40.000-45.000/pasang | Express 75.000/pasang
- Sepatu (Suede/Leather): Reguler 50.000/pasang | Express 100.000/pasang
- Tas Non-Leather: Kecil 50rb | Sedang 75rb | Besar 70-140rb
- Tas Leather: Kecil 100rb | Sedang 150rb | Besar 200rb
- Stroller / Baby Bouncer / Car Seat: Reguler 120.000 - 150.000/pcs
- Karpet: 25.000 - 30.000/m2 | Gordyn: 25.000 - 60.000/m2
- Jas / Stelan Jas: Reguler 30.000 - 75.000/pcs | Express 60.000 - 130.000/pcs

==================================================
5. SOP PENANGANAN KOMPLAIN (SAPAAN EMPATIK)
==================================================
Jika ada komplain, berikan respon awal:
"Halo Kak, mohon maaf atas ketidaknyamanannya. Kami sangat menghargai Kakak sudah menginfokan hal ini. Boleh kami bantu cek dulu ya supaya bisa segera kami tindak lanjuti."
Lalu akhiri dengan tag: [WA_HANDOFF|${targetOutletWa}]

DATA TRANSAKSI AKTIF CUSTOMER:
- POS: ${JSON.stringify(txSummary)}
- Jemputan: ${JSON.stringify(pickupSummary)}`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: history,
          generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
        })
      }
    );

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      // Error asli Gemini (kunci invalid, model tidak tersedia, kuota habis)
      // diteruskan apa adanya supaya penyebabnya bisa dilacak, bukan disamarkan
      // sebagai jawaban AI palsu.
      const detail = data?.error?.message || `Gemini merespons status ${res.status}.`;
      console.error('Gemini API error:', detail);
      return Response.json(
        {
          error: detail,
          reply: '⚠️ AI Assistant sedang tidak dapat menjawab. Silakan hubungi CS Admin lewat tab Live CS ya Kak.'
        },
        { status: 502 }
      );
    }

    const aiText = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();

    if (!aiText) {
      const blockReason = data?.promptFeedback?.blockReason;
      console.error('Gemini tidak mengembalikan teks. blockReason:', blockReason);
      return Response.json(
        {
          error: blockReason ? `Jawaban diblokir: ${blockReason}` : 'Gemini tidak mengembalikan teks.',
          reply: 'Maaf Kak, jawaban tidak dapat dibuat. Boleh diulang dengan kalimat lain?'
        },
        { status: 502 }
      );
    }

    return Response.json({ reply: aiText });
  } catch (error: any) {
    console.error('Chat route error:', error);
    return Response.json(
      {
        error: error?.message || 'Kesalahan tidak diketahui pada server chat.',
        reply: '⚠️ Terjadi kendala teknis pada AI Assistant. Silakan coba lagi atau hubungi CS Admin.'
      },
      { status: 500 }
    );
  }
}