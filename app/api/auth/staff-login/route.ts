import { NextResponse } from 'next/server';
import { hashStaffPassword, isHashedStaffPassword, verifyStaffPassword } from '@/lib/staffPassword';
import { paymentServiceDb } from '@/lib/paymentSecurity';
import { setStaffSessionCookie } from '@/lib/staffAuth/server';

export const dynamic = 'force-dynamic';

const EMP_LOGIN_SELECT =
  'id, name, role, outlet_id, username, password, access_outlets, assigned_outlet_ids, basic_salary, outlets(id, name)';

const EMP_LOGIN_SELECT_MIN =
  'id, name, role, outlet_id, username, password, access_outlets, assigned_outlet_ids, basic_salary';

/** Login staf server-side — password dicek di server; plaintext legacy di-upgrade ke hash. */
export async function POST(req: Request) {
  let body: { username?: string; password?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body tidak valid' }, { status: 400 });
  }

  const username = String(body.username || '').toLowerCase().trim();
  const password = String(body.password || '');
  if (!username || !password) {
    return NextResponse.json({ error: 'Username dan password wajib' }, { status: 400 });
  }

  let db;
  try {
    db = paymentServiceDb();
  } catch (e: any) {
    return NextResponse.json(
      {
        error:
          e?.message ||
          'Server belum punya SUPABASE_SERVICE_ROLE_KEY — login staf tidak bisa membaca password'
      },
      { status: 503 }
    );
  }

  try {
    // Cocokkan username tanpa peduli huruf besar/kecil (DB bisa "Owner" / "owner")
    let user: Record<string, unknown> | null = null;
    let queryErr: { message?: string } | null = null;

    const primary = await db
      .from('employees')
      .select(EMP_LOGIN_SELECT)
      .ilike('username', username)
      .limit(1);

    if (primary.error) {
      queryErr = primary.error;
      const fallback = await db
        .from('employees')
        .select(EMP_LOGIN_SELECT_MIN)
        .ilike('username', username)
        .limit(1);
      if (fallback.error) {
        return NextResponse.json(
          {
            error: `Gagal baca employees: ${fallback.error.message}. Cek SUPABASE_SERVICE_ROLE_KEY di Vercel.`
          },
          { status: 500 }
        );
      }
      user = (fallback.data?.[0] as Record<string, unknown>) || null;
    } else {
      user = (primary.data?.[0] as Record<string, unknown>) || null;
    }

    if (!user) {
      // Coba exact eq jika ilike kosong (edge case)
      const exact = await db
        .from('employees')
        .select(EMP_LOGIN_SELECT_MIN)
        .eq('username', username)
        .maybeSingle();
      if (exact.error && !queryErr) {
        return NextResponse.json(
          { error: `Gagal baca employees: ${exact.error.message}` },
          { status: 500 }
        );
      }
      user = (exact.data as Record<string, unknown>) || null;
    }

    if (!user) {
      return NextResponse.json(
        {
          error:
            'Username tidak ditemukan di tabel employees. Cek di Supabase: Table Editor → employees → kolom username (harus ada baris owner).'
        },
        { status: 401 }
      );
    }

    const stored = String(user.password || '');
    if (!stored) {
      return NextResponse.json(
        {
          error:
            'Password kosong di database untuk user ini. Reset password lewat SQL atau hubungi admin.'
        },
        { status: 401 }
      );
    }

    if (!verifyStaffPassword(stored, password)) {
      return NextResponse.json({ error: 'Password salah' }, { status: 401 });
    }

    // Upgrade plaintext → scrypt pada login sukses
    if (!isHashedStaffPassword(stored)) {
      try {
        await db
          .from('employees')
          .update({ password: hashStaffPassword(password) })
          .eq('id', user.id);
      } catch {
        /* non-fatal */
      }
    }

    const { password: _pw, ...safe } = user;
    const res = NextResponse.json({ user: safe });
    // Identitas staf terverifikasi untuk API yang membutuhkannya (cookie HttpOnly).
    setStaffSessionCookie(res, { sid: String(user.id || ''), role: String(user.role || '') });
    return res;
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Login gagal' }, { status: 500 });
  }
}
