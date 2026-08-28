export const dynamic = 'force-dynamic';

const CS_DRAFT_PROMPT = `Kamu asisten draf balasan CS laundry (Laundrivery).
Tulis TEPAT 3 draf singkat, ramah, Bahasa Indonesia, siap kirim ke pelanggan.
Pisahkan draf hanya dengan baris --- (tanpa nomor, tanpa judul).
Jangan bahas hal di luar cucian/jemput/tagihan/komplain.`;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const last = String(body.lastCustomerMessage || body.message || '').trim();
    const history = Array.isArray(body.messages) ? body.messages.slice(-8) : [];
    if (!last) return Response.json({ drafts: [] });

    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    const model = (process.env.GEMINI_MODEL || 'gemini-2.0-flash').trim();
    if (!apiKey) return Response.json({ drafts: [], error: 'no_key' }, { status: 503 });

    const histText = history
      .map((m: any) => `${m.sender_type === 'cs' ? 'CS' : 'Pelanggan'}: ${m.message}`)
      .join('\n');

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `${CS_DRAFT_PROMPT}\n\nRiwayat:\n${histText}\n\nPesan terakhir pelanggan:\n${last}`
                }
              ]
            }
          ]
        })
      }
    );

    const data = await res.json().catch(() => ({}));
    const text = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    const drafts = text
      .split(/\n---\n|\n---\s*\n|^---$/m)
      .map((s) => s.replace(/^---\s*|\s*---$/g, '').trim())
      .filter(Boolean)
      .slice(0, 3);

    return Response.json({ drafts: drafts.length ? drafts : text ? [text] : [] });
  } catch (err: any) {
    console.error('CS suggest:', err);
    return Response.json({ drafts: [], error: err.message || 'fail' }, { status: 500 });
  }
}
