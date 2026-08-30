import { createClient } from '@supabase/supabase-js';
import {
  FRAUD_ALERT_TEXT,
  isMaintenanceCycle,
  isShiftEndWindow,
  isStandardWashCycle,
  jakartaDate,
  parseThinqCycleType
} from '@/lib/lgThinq';

export const dynamic = 'force-dynamic';

const db = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qlgbjvzabnfqmfnjdkmo.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs'
  );

const isRunning = (status: unknown) => {
  const s = String(status || '').toUpperCase();
  return s === 'RUNNING' || s === 'WASH' || s === 'IN_PROGRESS' || s === 'ON';
};

const machineTagOf = (washer: { capacity_kg?: number }) =>
  Number(washer.capacity_kg) >= 24 ? 'LG-24KG' : 'LG-15KG';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const supabase = db();
    const deviceId = String(body.thinq_device_id || body.deviceId || '').trim();
    const washerId = String(body.washer_id || body.washerId || '').trim();
    const nextStatus = String(body.status || body.thinq_status || '').trim();
    const cycleType = parseThinqCycleType(body);
    const closing =
      Boolean(body.closing || body.pos_closing || body.posClosing || body.during_closing) ||
      String(body.context || '').toLowerCase().includes('closing');

    if (!isRunning(nextStatus) && nextStatus) {
      return Response.json({ ok: true, ignored: true, status: nextStatus || null, cycleType });
    }

    let washer: any = null;
    if (washerId) {
      const { data } = await supabase.from('washers').select('*').eq('id', washerId).maybeSingle();
      washer = data;
    } else if (deviceId) {
      const { data } = await supabase.from('washers').select('*').eq('thinq_device_id', deviceId).maybeSingle();
      washer = data;
    }
    if (!washer) {
      return Response.json({ ok: false, error: 'Washer LG tidak ditemukan' }, { status: 404 });
    }

    const orderLinked = Boolean(washer.current_order_id);
    const { data: activeCycles } = await supabase
      .from('washer_cycle_logs')
      .select('id, order_id, status')
      .eq('washer_id', washer.id)
      .eq('status', 'RUNNING')
      .limit(8);
    const hasLinkedCycle = (activeCycles || []).some((c: any) => c.order_id);

    if (orderLinked || hasLinkedCycle) {
      await supabase
        .from('washers')
        .update({ status: 'RUNNING', last_started_at: new Date().toISOString() })
        .eq('id', washer.id);
      return Response.json({
        ok: true,
        authorized: true,
        washerId: washer.id,
        orderId: washer.current_order_id,
        cycleType
      });
    }

    const inClosingWindow = isShiftEndWindow(new Date(), { closing });
    const maintenance = isMaintenanceCycle(cycleType);
    const standardWash = isStandardWashCycle(cycleType) && !maintenance;

    const todayStart = `${jakartaDate()}T00:00:00+07:00`;
    const { data: todayMaint } = await supabase
      .from('washer_cycle_logs')
      .select('id, cycle_type, status, created_at')
      .eq('washer_id', washer.id)
      .is('order_id', null)
      .gte('created_at', todayStart)
      .in('cycle_type', ['RINSE_SPIN', 'SPEED_WASH', 'QUICK_WASH', 'TUB_CLEAN'])
      .limit(40);
    const maintCountToday = (todayMaint || []).length;

    const allowShiftClean = maintenance && inClosingWindow;
    const firstMaintOutside = maintenance && !inClosingWindow && maintCountToday < 1;

    if (allowShiftClean || firstMaintOutside) {
      await supabase.from('washer_cycle_logs').insert([
        {
          washer_id: washer.id,
          order_id: null,
          cycle_type: cycleType,
          status: 'MAINTENANCE_SHIFT_CLEAN',
          bag_label: allowShiftClean
            ? `Shift-end ${cycleType}`
            : `${cycleType} (1x di luar jam closing)`,
          machine_tag: machineTagOf(washer)
        }
      ]);
      const today = jakartaDate();
      await supabase
        .from('washers')
        .update({
          status: 'RUNNING',
          last_started_at: new Date().toISOString(),
          tub_clean_used_on: cycleType === 'TUB_CLEAN' ? today : washer.tub_clean_used_on || null,
          current_order_id: null
        })
        .eq('id', washer.id);
      return Response.json({
        ok: true,
        authorized: false,
        shiftClean: true,
        cycleType,
        inClosingWindow,
        message: allowShiftClean
          ? `Maintenance ${cycleType} dicatat (MAINTENANCE_SHIFT_CLEAN) untuk ${washer.machine_name}`
          : `${cycleType} pertama hari ini di luar jam closing — belum di-flag fraud`
      });
    }

    const repeatMaintOutside = maintenance && !inClosingWindow && maintCountToday >= 1;
    const shouldFraud = standardWash || repeatMaintOutside;
    if (!shouldFraud) {
      return Response.json({ ok: true, authorized: false, ignored: true, cycleType });
    }

    const notes = FRAUD_ALERT_TEXT(washer.machine_name);
    await supabase.from('washer_cycle_logs').insert([
      {
        washer_id: washer.id,
        order_id: null,
        cycle_type: cycleType || 'NORMAL',
        status: 'UNAUTHORIZED',
        bag_label: 'UNAUTHORIZED',
        machine_tag: machineTagOf(washer)
      }
    ]);
    const { data: alert } = await supabase
      .from('unauthorized_wash_alerts')
      .insert([
        {
          outlet_id: washer.outlet_id,
          washer_id: washer.id,
          is_flagged_tub_clean: cycleType === 'TUB_CLEAN',
          notes,
          machine_name: washer.machine_name,
          is_resolved: false
        }
      ])
      .select('id')
      .maybeSingle();

    await supabase
      .from('washers')
      .update({ status: 'RUNNING', last_started_at: new Date().toISOString() })
      .eq('id', washer.id);

    return Response.json({
      ok: true,
      authorized: false,
      fraud: true,
      cycleType,
      alertId: alert?.id || null,
      message: notes
    });
  } catch (err: any) {
    return Response.json({ ok: false, error: err?.message || 'ThinQ monitor gagal' }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({
    ok: true,
    listener: 'lg-thinq-monitor',
    hint: 'POST { thinq_device_id, status: "RUNNING", cycle_type: "RINSE_SPIN"|"SPEED_WASH"|"QUICK_WASH"|"TUB_CLEAN"|"COTTON", closing?: true }'
  });
}
