import { NextResponse } from 'next/server';
import { hashStaffPassword } from '@/lib/staffPassword';
import { insertAuditLog, paymentServiceDb } from '@/lib/paymentSecurity';
import { requirePaymentOpsAuth } from '@/lib/requirePaymentOpsAuth';
import { sanitizePublicError } from '@/lib/supabaseEnv';

export const dynamic = 'force-dynamic';

const EMP_SAFE =
  'id, name, role, outlet_id, username, basic_salary, access_outlets, assigned_outlet_ids, created_at, outlets(id, name)';
const EMP_SAFE_MIN =
  'id, name, role, outlet_id, username, basic_salary, access_outlets, assigned_outlet_ids, created_at';
const EMP_SAFE_BARE = 'id, name, role, outlet_id, username, basic_salary, created_at';

async function authOwner(req: Request, body: Record<string, unknown> = {}) {
  const url = new URL(req.url);
  // Prefer staffRole/actorRole so create/update `role` (karyawan baru) tidak menimpa auth owner.
  return requirePaymentOpsAuth(
    req,
    {
      staffId: String(body.staffId || url.searchParams.get('staffId') || ''),
      agentName: String(body.agentName || url.searchParams.get('agentName') || 'Owner'),
      role: String(
        body.staffRole ||
          body.actorRole ||
          url.searchParams.get('staffRole') ||
          url.searchParams.get('role') ||
          'owner'
      )
    },
    'resync'
  );
}

function fail(error: unknown, status = 500) {
  return NextResponse.json({ error: sanitizePublicError(error) }, { status });
}

/** List karyawan tanpa kolom password. */
export async function GET(req: Request) {
  const auth = await authOwner(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = paymentServiceDb();
    let data: any[] | null = null;
    let error: { message?: string } | null = null;
    for (const cols of [EMP_SAFE, EMP_SAFE_MIN, EMP_SAFE_BARE]) {
      const res = await db.from('employees').select(cols).order('created_at', { ascending: false });
      if (!res.error) {
        data = res.data;
        error = null;
        break;
      }
      error = res.error;
    }
    if (error) return fail(error.message, 500);
    return NextResponse.json({ employees: data || [] });
  } catch (e: any) {
    return fail(e?.message || 'Gagal muat karyawan', 500);
  }
}

/** Create / update / delete karyawan; password selalu di-hash di server. */
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body tidak valid' }, { status: 400 });
  }

  const auth = await authOwner(req, body);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const op = String(body.op || 'create').toLowerCase();
  const db = paymentServiceDb();

  try {
    if (op === 'delete') {
      const id = String(body.id || '').trim();
      if (!id) return NextResponse.json({ error: 'id wajib' }, { status: 400 });
      const { error } = await db.from('employees').delete().eq('id', id);
      if (error) return fail(error.message, 400);
      await insertAuditLog({
        action: 'EMPLOYEE_DELETE',
        user_id: auth.staffId,
        user_name: auth.agentName,
        role: auth.role,
        entity_type: 'employees',
        entity_id: id
      });
      return NextResponse.json({ ok: true });
    }

    if (op === 'update') {
      const id = String(body.id || '').trim();
      if (!id) return NextResponse.json({ error: 'id wajib' }, { status: 400 });
      const patch: Record<string, unknown> = {};
      for (const key of [
        'name',
        'role',
        'outlet_id',
        'username',
        'basic_salary',
        'access_outlets',
        'assigned_outlet_ids'
      ]) {
        if (body[key] !== undefined) patch[key] = body[key];
      }
      const plainPw = String(body.password || '').trim();
      if (plainPw) patch.password = hashStaffPassword(plainPw);

      const { error } = await db.from('employees').update(patch).eq('id', id);
      if (error) return fail(error.message, 400);
      await insertAuditLog({
        action: 'EMPLOYEE_UPDATE',
        user_id: auth.staffId,
        user_name: auth.agentName,
        role: auth.role,
        entity_type: 'employees',
        entity_id: id,
        meta: { passwordChanged: Boolean(plainPw), fields: Object.keys(patch).filter((k) => k !== 'password') }
      });
      return NextResponse.json({ ok: true });
    }

    // create
    const name = String(body.name || '').trim();
    const username = String(body.username || '').toLowerCase().trim();
    const password = String(body.password || '');
    const role = String(body.role || 'kasir').toLowerCase().trim();
    if (!name || !username || !password) {
      return NextResponse.json({ error: 'name, username, password wajib' }, { status: 400 });
    }

    const { data: exists } = await db.from('employees').select('id').eq('username', username).maybeSingle();
    if (exists) return NextResponse.json({ error: 'Username sudah digunakan' }, { status: 409 });

    const row: Record<string, unknown> = {
      name,
      username,
      password: hashStaffPassword(password),
      role,
      outlet_id: body.outlet_id === undefined ? null : body.outlet_id,
      basic_salary: Number(body.basic_salary) || 0
    };
    if (body.access_outlets !== undefined) row.access_outlets = body.access_outlets;
    if (body.assigned_outlet_ids !== undefined) row.assigned_outlet_ids = body.assigned_outlet_ids;
    // phone/whatsapp opsional — banyak DB production belum punya kolom ini

    const attempts = [
      row,
      {
        name,
        username,
        password: row.password,
        role,
        outlet_id: row.outlet_id,
        basic_salary: row.basic_salary,
        access_outlets: row.access_outlets
      },
      {
        name,
        username,
        password: row.password,
        role,
        outlet_id: row.outlet_id,
        basic_salary: row.basic_salary
      },
      {
        name,
        username,
        password: row.password,
        role,
        outlet_id: row.outlet_id
      }
    ];

    let lastErr: string | null = null;
    let created: any = null;
    for (const attempt of attempts) {
      const clean = Object.fromEntries(Object.entries(attempt).filter(([, v]) => v !== undefined));
      let rowErr: string | null = null;
      for (const cols of [EMP_SAFE_MIN, EMP_SAFE_BARE, 'id, name, role, username']) {
        const { data, error } = await db.from('employees').insert([clean]).select(cols).maybeSingle();
        if (!error) {
          created = data;
          rowErr = null;
          break;
        }
        rowErr = error.message;
        lastErr = error.message;
        if (!/does not exist/i.test(error.message)) break;
      }
      if (created) break;
      if (rowErr && !/does not exist/i.test(rowErr)) break;
    }
    if (!created) return fail(lastErr || 'Gagal insert', 400);

    await insertAuditLog({
      action: 'EMPLOYEE_CREATE',
      user_id: auth.staffId,
      user_name: auth.agentName,
      role: auth.role,
      entity_type: 'employees',
      entity_id: String(created.id || username)
    });
    return NextResponse.json({ ok: true, employee: created });
  } catch (e: any) {
    return fail(e?.message || 'Gagal simpan karyawan', 500);
  }
}
