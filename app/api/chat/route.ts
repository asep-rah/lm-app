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
    const activePhone = customerPhone || '';

    // 1. Kueri data transaksi & penjemputan aktif
    let myTx: any[] = [];
    let myPickup: any[] = [];

    if (activePhone) {
      const [txRes, pickupRes] = await Promise.all([
        supabase
          .from('transactions')
          .select('*, outlets(whatsapp_number, name)')
          .eq('customer_phone', activePhone)
          .neq('status', 'Selesai'),
        supabase
          .from('pickup_orders')
          .select('*, outlets(whatsapp_number, name)')
          .eq('customer_phone', activePhone)
          .neq('status', 'Selesai')
      ]);
      myTx = txRes.data || [];
      myPickup = pickupRes.data || [];
    }

    // 2. Ekstraksi nomor WA CS Admin Cabang
    let targetOutletWa = '6281120081011';
    const rawWa = myTx?.[0]?.outlets?.whatsapp_number || myPickup?.[0]?.outlets?.whatsapp_number;
    if (rawWa) {
      let cleaned = rawWa.trim().replace(/[^0-9]/g, '');
      if (cleaned.startsWith('0')) cleaned = '62' + cleaned.slice(1);
      if (cleaned) targetOutletWa = cleaned;
    }

    // 3. System Prompt
    const systemPrompt = `Anda adalah AI Customer Service resmi dari Laundrivery Pro. 
Tugas Anda melayani pelanggan dengan ramah, komunikatif, dan solutif. Jangan gunakan format markdown berlebihan.

INFORMASI OPERASIONAL & HARGA:
- METODE PEMBAYARAN: Cash HANYA di outlet. Antar-jemput WAJIB non-tunai (Transfer/QRIS).
- CUCI KERING GOSOK: Reguler 3 hari (Rp 8.000/Kg), Oneday 1 hari (Rp 12.000/Kg), Express 6 jam (Rp 16.000/Kg), Quick 3 jam (Rp 25.000/Kg).
- SATUAN (Reguler 3 Hari): Bedcover Single (25rb), Bedcover Double (40rb), Cuci Sepatu (45rb), Kemeja (15rb), Jaket (30rb), Jas (30rb), Celana (20rb).
- ATURAN WAKTU SATUAN: Oneday (Harga Reguler x 1,5), Express (x 2), Quick (x 3). Hitungkan totalnya langsung.

TUGAS KHUSUS:
1. PENJEMPUTAN BARU: Jika pelanggan minta jemput, cek apakah ALAMAT LENGKAP sudah ada. Jika belum lengkap, tanyakan alamatnya dulu. Jika sudah lengkap, akhiri pesan dengan: [ORDER|alamat_lengkap]
2. CEK STATUS: Jika pelanggan bertanya status cucian & ada data transaksi/jemputan aktif, jelaskan ringkas lalu WAJIB akhiri pesan dengan tag ini: [STATUS_CARD|no_resi_atau_id|nama_layanan|status_proses]
3. KOMPLAIN / HUBUNGI ADMIN: Jika pelanggan komplain, lapor baju hilang/rusak, atau minta bicara langsung dengan admin, berikan jawaban ramah lalu WAJIB akhiri pesan dengan tag ini: [WA_HANDOFF|${targetOutletWa}]

DATA TRANSAKSI AKTIF PELANGGAN:
  * POS: ${JSON.stringify(myTx)}
  * Penjemputan: ${JSON.stringify(myPickup)}

Pertanyaan Pelanggan: "${message}"`;

    // Model resmi yang aktif
    const candidateModels = [
      'gemini-1.5-flash',
      'gemini-1.5-pro'
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
        // Lanjut ke model berikutnya
      }
    }

    if (!aiReply) {
      return Response.json({
        reply: `Halo Kak! Layanan Laundrivery menyediakan Antar-Jemput Express & Reguler. Ada yang bisa kami bantu?`
      });
    }

    // Simpan order otomatis jika ada tag [ORDER|...]
    const orderMatch = aiReply.match(/\[ORDER\|(.*?)\]/);
    if (orderMatch && activePhone) {
      const alamatLengkap = orderMatch[1].trim();
      aiReply = aiReply.replace(orderMatch[0], '').trim();

      await supabase
        .from('pickup_orders')
        .insert([
          {
            customer_phone: activePhone,
            status: 'Menunggu Jemputan',
            notes: `Alamat: ${alamatLengkap}`
          }
        ]);
      aiReply += `\n\n✅ *(Sistem: Pesanan penjemputan dicatat ke alamat: ${alamatLengkap})*`;
    }

    return Response.json({ reply: aiReply });

  } catch (error: any) {
    return Response.json({ reply: `Halo Kak! Ada yang bisa kami bantu seputar layanan Laundrivery?` }, { status: 200 });
  }
}