import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { message, customerPhone } = await req.json();

    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    const supabaseUrl = process.env.SUPABASE_URL || 'https://qlgbjvzabnfqmfnjdkmo.supabase.co';
    const supabaseKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs';

    if (!apiKey) {
      return Response.json({ reply: '⚠️ GEMINI_API_KEY belum terpasang di Vercel.' }, { status: 200 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Kueri data transaksi & penjemputan aktif beserta data outlet (WA Cabang/Brand)
    const [{ data: myTx }, { data: myPickup }] = await Promise.all([
      supabase
        .from('transactions')
        .select('*, outlets(whatsapp_number, name)')
        .eq('customer_phone', customerPhone)
        .neq('status', 'Selesai'),
      supabase
        .from('pickup_orders')
        .select('*, outlets(whatsapp_number, name)')
        .eq('customer_phone', customerPhone)
        .neq('status', 'Selesai')
    ]);

    // 2. Ekstraksi nomor WA CS Admin Cabang/Brand dari transaksi atau penjemputan aktif
    let targetOutletWa = '6281234567890'; // Default WA CS Pusat jika pelanggan belum ada transaksi

    const rawWa = myTx?.[0]?.outlets?.whatsapp_number || myPickup?.[0]?.outlets?.whatsapp_number;
    if (rawWa) {
      let cleaned = rawWa.trim().replace(/[^0-9]/g, '');
      if (cleaned.startsWith('0')) {
        cleaned = '62' + cleaned.slice(1);
      }
      if (cleaned) {
        targetOutletWa = cleaned;
      }
    }

    // 3. System Prompt Utuh dengan Tag WA Dinamis Per Cabang/Brand
    const systemPrompt = `Anda adalah AI Customer Service resmi dari Laundrivery Pro. 
Tugas Anda melayani pelanggan dengan ramah, komunikatif, dan solutif. Jangan gunakan format markdown berlebihan.

INFORMASI OPERASIONAL & HARGA:
- METODE PEMBAYARAN: Cash HANYA di outlet. Antar-jemput WAJIB non-tunai (Transfer/QRIS).
- CUCI KERING GOSOK: Reguler 3 hari (Rp 8.000/Kg), Oneday 1 hari (Rp 12.000/Kg), Express 6 jam (Rp 16.000/Kg), Quick 3 jam (Rp 25.000/Kg).
- SATUAN (Reguler 3 Hari): Bedcover Single (25rb), Bedcover Double (40rb), Cuci Sepatu (45rb), Kemeja (15rb), Jaket (30rb), Jas (30rb), Celana (20rb).
- ATURAN WAKTU SATUAN: Oneday (Harga Reguler x 1,5), Express (x 2), Quick (x 3). Hitungkan totalnya langsung.

TUGAS KHUSUS (TAGS KHUSUS HARUS DISISIPKAN KETIKA RELEVAN):
1. PENJEMPUTAN BARU: Jika pelanggan minta jemput, cek apakah ALAMAT LENGKAP sudah ada. Jika belum lengkap, tanyakan alamatnya dulu. Jika sudah lengkap, akhiri pesan dengan: [ORDER|alamat_lengkap]
2. CEK STATUS: Jika pelanggan bertanya status cucian & ada data transaksi/jemputan aktif, jelaskan ringkas lalu WAJIB akhiri pesan dengan tag ini: [STATUS_CARD|no_resi_atau_id|nama_layanan|status_proses]
   (Contoh tag status: [STATUS_CARD|TRX-955998|Cuci Quick 3 Jam|Diproses] atau [STATUS_CARD|JMP-8812|Penjemputan Cucian|Menunggu Jemputan])
3. KOMPLAIN / HUBUNGI ADMIN: Jika pelanggan komplain, lapor baju hilang/rusak, marah, atau meminta bicara langsung dengan admin/manusia, berikan jawaban ramah lalu WAJIB akhiri pesan dengan tag ini: [WA_HANDOFF|${targetOutletWa}]

DATA TRANSAKSI AKTIF PELANGGAN:
  * POS: ${JSON.stringify(myTx || [])}
  * Penjemputan: ${JSON.stringify(myPickup || [])}

Pertanyaan Pelanggan: "${message}"`;

    // Multi-Model Auto-Fallback
    const candidateModels = [
      'gemini-2.5-flash',
      'gemini-flash-latest',
      'gemini-2.5-flash-lite',
      'gemini-3.5-flash'
    ];

    let aiReply = '';

    for (const model of candidateModels) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey
            },
            body: JSON.stringify({ contents: [{ parts: [{ text: systemPrompt }] }] })
          }
        );

        const data = await res.json();

        if (res.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) {
          aiReply = data.candidates[0].content.parts[0].text;
          break;
        }
      } catch (err) {
        // Otomatis lanjut ke model berikutnya jika error/high demand
      }
    }

    if (!aiReply) {
      return Response.json({
        reply: `⚠️ Server Google sedang padat saat ini. Mohon coba tekan tombol lagi dalam 5 detik.`
      });
    }

    // Ekstraksi & simpan order ke Supabase
    const orderMatch = aiReply.match(/\[ORDER\|(.*?)\]/);
    if (orderMatch) {
      const alamatLengkap = orderMatch[1].trim();
      aiReply = aiReply.replace(orderMatch[0], '').trim();

      const { error: insertError } = await supabase
        .from('pickup_orders')
        .insert([
          {
            customer_phone: customerPhone,
            status: 'Menunggu Jemputan',
            alamat: alamatLengkap
          }
        ]);

      if (insertError) {
        console.error("Supabase Insert Error:", insertError);
        aiReply += "\n\n*(Catatan Sistem: Maaf, terjadi kendala saat mencatat alamat. Mohon hubungi admin)*";
      } else {
        aiReply += `\n\n✅ *(Sistem: Pesanan jemput berhasil dicatat! Tim kurir akan meluncur ke alamat: ${alamatLengkap})*`;
      }
    }

    return Response.json({ reply: aiReply });

  } catch (error: any) {
    return Response.json({ reply: `❌ Server Error: ${error.message}` }, { status: 200 });
  }
}