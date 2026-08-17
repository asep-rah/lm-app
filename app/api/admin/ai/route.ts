import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { mode, userQuery } = await req.json();

    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    const supabaseUrl = process.env.SUPABASE_URL || 'https://qlgbjvzabnfqmfnjdkmo.supabase.co';
    const supabaseKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs';

    if (!apiKey) {
      return Response.json({ reply: '⚠️ GEMINI_API_KEY belum terpasang di Vercel.' }, { status: 200 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Ambil data transaksi beserta Nama Outlet asli dari database Supabase
    const [{ data: transactions }, { data: pickups }, { data: outlets }] = await Promise.all([
      supabase.from('transactions').select('*, outlets(name)'),
      supabase.from('pickup_orders').select('*, outlets(name)'),
      supabase.from('outlets').select('id, name, city')
    ]);

    // Format data agar AI membaca Nama Outlet manusiawi, bukan ID UUID
    const cleanTxs = (transactions || []).map((t: any) => ({
      ...t,
      nama_outlet: t.outlets?.name || 'Outlet Utama/Pusat'
    }));

    const cleanPickups = (pickups || []).map((p: any) => ({
      ...p,
      nama_outlet: p.outlets?.name || 'Outlet Utama/Pusat'
    }));

    const systemPromptRules = `
ATURAN FORMAT DOKUMEN EXECUTIVE (WAJIB DIPATUHI):
1. DILARANG KERAS menampilkan kode ID/UUID Database (seperti '9d70da45', '17d1ee5a', '11111111'). Anda WAJIB menggunakan NAMA OUTLET yang sebenarnya (misal: "Outlet Pasirkaliki", "Outlet Utama", "Outlet Dipatiukur").
2. DILARANG menggunakan simbol pagar Markdown seperti '#', '##', '###', atau '####'.
3. DILARANG membuat simbol bintang bertumpuk seperti '****Teks****'. Gunakan hanya satu pasang bintang '**Teks**' untuk menebalkan kata penting.
4. Format jawaban harus sangat rapi, bersih, eksekutif, serta mudah dibaca oleh Owner.
`;

    let systemPrompt = '';

    if (mode === 'churn') {
      systemPrompt = `Anda adalah AI Retention Specialist dari Laundrivery Pro.
Tugas Anda menganalisis data pelanggan pasif (churn) dan buat ucapan promosi perangkul.

${systemPromptRules}

DATA TRANSAKSI SAAT INI:
- POS Transactions: ${JSON.stringify(cleanTxs)}
- Pickup Orders: ${JSON.stringify(cleanPickups)}
- Daftar Outlet Cabang: ${JSON.stringify(outlets || [])}`;
    } else {
      systemPrompt = `Anda adalah AI Business Analyst profesional untuk Owner Laundrivery Pro.
Tugas Anda menganalisis performa bisnis berdasarkan data transaksi berikut dan menjawab pertanyaan Owner dengan singkat, padat, serta berbasis data keuangan real.

${systemPromptRules}

DATA OPERASIONAL SAAT INI:
- POS Transactions: ${JSON.stringify(cleanTxs)}
- Pickup Orders: ${JSON.stringify(cleanPickups)}
- Daftar Outlet Cabang: ${JSON.stringify(outlets || [])}

Pertanyaan/Instruksi Owner: "${userQuery || 'Berikan laporan eksekutif singkat tentang kesehatan bisnis minggu ini, total omset, dan saran strategis.'}"`;
    }

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
        // Fallback otomatis
      }
    }

    return Response.json({ reply: aiReply || '⚠️ Server AI sibuk, silakan coba lagi.' });

  } catch (error: any) {
    return Response.json({ reply: `❌ Server Error: ${error.message}` }, { status: 200 });
  }
}