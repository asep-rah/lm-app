import { NextResponse } from 'next/server';
import { clearStaffSessionCookie } from '@/lib/staffAuth/server';

export const dynamic = 'force-dynamic';

/** Hapus cookie sesi staf (dipanggil saat staf keluar dari portal). */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  clearStaffSessionCookie(res);
  return res;
}
