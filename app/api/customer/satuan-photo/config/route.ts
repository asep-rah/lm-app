import { NextResponse, type NextRequest } from 'next/server';
import { readSession } from '@/lib/customerAuth/server';
import { satuanPhotoConfig } from '@/lib/satuanPhotoServer';

export const dynamic = 'force-dynamic';

/** Apakah foto item satuan diwajibkan, dan apakah sesi customer ini boleh mengunggah. */
export async function GET(req: NextRequest) {
  const { enabled } = satuanPhotoConfig();
  const canUpload = enabled && Boolean(readSession(req));
  return NextResponse.json({ enabled, canUpload }, { headers: { 'Cache-Control': 'no-store' } });
}
