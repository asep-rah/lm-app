import { NextResponse } from 'next/server';
import { sendPushNotification } from '@/lib/pushSend';
import type { PushDispatch } from '@/lib/notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PushDispatch;
    if (!body?.title) return NextResponse.json({ ok: false, error: 'title wajib' }, { status: 400 });
    const result = await sendPushNotification(body);
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Gagal kirim push' }, { status: 500 });
  }
}
