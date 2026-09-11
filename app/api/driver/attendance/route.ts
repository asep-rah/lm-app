import { NextResponse } from 'next/server';
import { paymentServiceDb } from '@/lib/paymentSecurity';

export const dynamic = 'force-dynamic';

/**
 * Check-in / check-out driver lewat service role
 * (menghindari RLS anon yang menolak insert ke driver_attendance).
 */
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON tidak valid' }, { status: 400 });
  }

  const action = String(body.action || '').toLowerCase();
  const driverId = String(body.driverId || '').trim();
  const driverName = String(body.driverName || '').trim() || null;
  const outletId = String(body.outletId || '').trim();

  if (!driverId) {
    return NextResponse.json({ error: 'driverId wajib' }, { status: 400 });
  }
  if (action !== 'check_in' && action !== 'check_out' && action !== 'clock_in' && action !== 'clock_out') {
    return NextResponse.json({ error: 'action harus check_in|check_out' }, { status: 400 });
  }

  let db;
  try {
    db = paymentServiceDb();
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'SUPABASE_SERVICE_ROLE_KEY belum di-set di server' },
      { status: 503 }
    );
  }

  const now = new Date().toISOString();
  const isIn = action === 'check_in' || action === 'clock_in';

  try {
    // Tutup shift terbuka dulu (check-in ulang / check-out).
    await db
      .from('driver_attendance')
      .update({ clock_out_at: now, status: 'OFF_DUTY' })
      .eq('driver_id', driverId)
      .eq('status', 'ON_DUTY');

    if (!isIn) {
      return NextResponse.json({ ok: true, status: 'OFF_DUTY' });
    }

    if (!outletId) {
      return NextResponse.json({ error: 'outletId wajib untuk check-in' }, { status: 400 });
    }

    const row = {
      driver_id: driverId,
      driver_name: driverName,
      active_outlet_id: outletId,
      clock_in_at: now,
      clock_out_at: null,
      status: 'ON_DUTY'
    };

    let { data, error } = await db.from('driver_attendance').insert([row]).select('*').limit(1);
    if (error) {
      // Fallback kolom minimal
      const retry = await db
        .from('driver_attendance')
        .insert([{ driver_id: driverId, active_outlet_id: outletId, status: 'ON_DUTY', clock_in_at: now }])
        .select('*')
        .limit(1);
      data = retry.data;
      error = retry.error;
    }
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const saved = data?.[0] || row;
    return NextResponse.json({
      ok: true,
      status: 'ON_DUTY',
      shift: {
        id: saved.id != null ? String(saved.id) : undefined,
        driver_id: driverId,
        driver_name: driverName,
        active_outlet_id: outletId,
        clock_in_at: saved.clock_in_at || now,
        clock_out_at: null,
        status: 'ON_DUTY'
      }
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Gagal absensi driver' }, { status: 500 });
  }
}
