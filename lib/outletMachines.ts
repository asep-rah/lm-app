import { insertWithFallback, updateWithFallback } from '@/lib/safeWrite';

export type CapacityType = '15kg' | '24kg' | 'custom';

export type OutletMachineRow = {
  id: string;
  outlet_id?: string | null;
  machine_name?: string | null;
  capacity_type?: string | null;
  max_payload_kg?: number | null;
  thinq_device_id?: string | null;
  is_active?: boolean | null;
};

type Db = { from: (table: string) => any };

const LIMIT_15 = 7;
const LIMIT_24 = 10;

export const defaultPayloadKg = (type: CapacityType | string) => {
  if (type === '24kg') return LIMIT_24;
  return LIMIT_15;
};

export const capacityKgForType = (type: CapacityType | string, maxPayload?: number) => {
  if (type === '24kg') return 24;
  if (type === '15kg') return 15;
  return Number(maxPayload) >= 10 ? 24 : 15;
};

export const normalizeCapacityType = (raw?: string | null, capacityKg?: number | null): CapacityType => {
  const t = String(raw || '').toLowerCase().trim();
  if (t === '24kg' || t === '24') return '24kg';
  if (t === '15kg' || t === '15') return '15kg';
  if (t === 'custom') return 'custom';
  return Number(capacityKg) >= 20 ? '24kg' : '15kg';
};

export const mapOutletMachineToWasher = (
  machine: OutletMachineRow,
  runtime?: Record<string, any> | null
) => {
  const capacity_type = normalizeCapacityType(machine.capacity_type, runtime?.capacity_kg);
  const max_payload_kg = Number(machine.max_payload_kg) || defaultPayloadKg(capacity_type);
  return {
    id: String(machine.id),
    outlet_id: machine.outlet_id || runtime?.outlet_id || undefined,
    machine_name: String(machine.machine_name || runtime?.machine_name || 'Mesin LG'),
    capacity_kg: capacityKgForType(capacity_type, max_payload_kg),
    capacity_type,
    max_payload_kg,
    is_active: machine.is_active !== false,
    thinq_device_id: machine.thinq_device_id || runtime?.thinq_device_id || null,
    status: runtime?.status || 'IDLE',
    current_order_id: runtime?.current_order_id || null,
    last_started_at: runtime?.last_started_at || null,
    remaining_sec: runtime?.remaining_sec ?? null
  };
};

const mergeRuntime = (machines: OutletMachineRow[], runtime: any[]) => {
  const byId = new Map((runtime || []).map((w) => [String(w.id), w]));
  return (machines || []).map((m) => mapOutletMachineToWasher(m, byId.get(String(m.id))));
};

export async function listOutletMachines(db: Db, outletId: string): Promise<OutletMachineRow[]> {
  if (!outletId) return [];
  const { data, error } = await db.from('outlet_machines').select('*').eq('outlet_id', outletId).order('machine_name');
  if (!error && Array.isArray(data)) return data as OutletMachineRow[];
  const { data: washers } = await db.from('washers').select('*').eq('outlet_id', outletId);
  return (washers || []).map((w: any) => ({
    id: w.id,
    outlet_id: w.outlet_id,
    machine_name: w.machine_name,
    capacity_type: normalizeCapacityType(w.capacity_type, w.capacity_kg),
    max_payload_kg: w.max_payload_kg ?? defaultPayloadKg(normalizeCapacityType(w.capacity_type, w.capacity_kg)),
    thinq_device_id: w.thinq_device_id,
    is_active: w.is_active !== false
  }));
}

async function backfillFromWashers(db: Db, outletId: string) {
  const { data: washers } = await db.from('washers').select('*').eq('outlet_id', outletId);
  for (const w of washers || []) {
    const type = normalizeCapacityType(w.capacity_type, w.capacity_kg);
    await insertWithFallback('outlet_machines', [
      {
        id: w.id,
        outlet_id: outletId,
        machine_name: w.machine_name || 'Mesin LG',
        capacity_type: type,
        max_payload_kg: w.max_payload_kg ?? defaultPayloadKg(type),
        thinq_device_id: w.thinq_device_id || null,
        is_active: w.is_active !== false
      },
      {
        outlet_id: outletId,
        machine_name: w.machine_name || 'Mesin LG',
        capacity_type: type,
        max_payload_kg: w.max_payload_kg ?? defaultPayloadKg(type)
      }
    ]);
  }
}

export async function fetchActiveOutletWashers(db: Db, outletId: string) {
  if (!outletId) return [];
  const listed = await listOutletMachines(db, outletId);
  if (!listed.length) {
    await backfillFromWashers(db, outletId);
  }
  const machines = (listed.length ? listed : await listOutletMachines(db, outletId)).filter((m) => m.is_active !== false);
  const { data: runtime } = await db.from('washers').select('*').eq('outlet_id', outletId);
  return mergeRuntime(machines, runtime || []);
}

const washerSyncPayload = (row: {
  id: string;
  outlet_id: string;
  machine_name: string;
  capacity_type: CapacityType;
  max_payload_kg: number;
  thinq_device_id?: string | null;
  is_active: boolean;
}) => {
  const capacity_kg = capacityKgForType(row.capacity_type, row.max_payload_kg);
  return {
    id: row.id,
    outlet_id: row.outlet_id,
    machine_name: row.machine_name,
    capacity_kg,
    capacity_type: row.capacity_type,
    max_payload_kg: row.max_payload_kg,
    thinq_device_id: row.thinq_device_id || null,
    is_active: row.is_active,
    status: 'IDLE'
  };
};

export async function saveOutletMachine(row: {
  id?: string;
  outlet_id: string;
  machine_name: string;
  capacity_type: CapacityType;
  max_payload_kg: number;
  thinq_device_id?: string | null;
  is_active: boolean;
}) {
  const id = row.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`);
  const payload = {
    id,
    outlet_id: row.outlet_id,
    machine_name: row.machine_name.trim() || 'Mesin LG',
    capacity_type: row.capacity_type,
    max_payload_kg: Number(row.max_payload_kg) || defaultPayloadKg(row.capacity_type),
    thinq_device_id: row.thinq_device_id?.trim() || null,
    is_active: row.is_active !== false
  };

  if (row.id) {
    const { error } = await updateWithFallback(
      'outlet_machines',
      [
        payload,
        {
          machine_name: payload.machine_name,
          capacity_type: payload.capacity_type,
          max_payload_kg: payload.max_payload_kg,
          thinq_device_id: payload.thinq_device_id,
          is_active: payload.is_active
        },
        { machine_name: payload.machine_name, is_active: payload.is_active }
      ],
      { column: 'id', value: row.id }
    );
    if (error) return { error, id: row.id };
  } else {
    const { data, error } = await insertWithFallback('outlet_machines', [
      payload,
      {
        outlet_id: payload.outlet_id,
        machine_name: payload.machine_name,
        capacity_type: payload.capacity_type,
        max_payload_kg: payload.max_payload_kg,
        is_active: payload.is_active
      },
      { outlet_id: payload.outlet_id, machine_name: payload.machine_name }
    ]);
    if (error) return { error, id };
    const savedId = String((data?.[0] as { id?: string } | undefined)?.id || payload.id);
    payload.id = savedId;
  }

  const sync = washerSyncPayload(payload);
  if (row.id) {
    await updateWithFallback(
      'washers',
      [
        sync,
        {
          machine_name: sync.machine_name,
          capacity_kg: sync.capacity_kg,
          thinq_device_id: sync.thinq_device_id,
          is_active: sync.is_active
        },
        { machine_name: sync.machine_name, capacity_kg: sync.capacity_kg }
      ],
      { column: 'id', value: payload.id }
    );
  } else {
    await insertWithFallback('washers', [
      sync,
      {
        id: payload.id,
        outlet_id: payload.outlet_id,
        machine_name: payload.machine_name,
        capacity_kg: sync.capacity_kg,
        thinq_device_id: payload.thinq_device_id,
        status: 'IDLE'
      },
      { outlet_id: payload.outlet_id, machine_name: payload.machine_name, capacity_kg: sync.capacity_kg, status: 'IDLE' }
    ]);
  }

  return { error: null, id: payload.id };
}

export async function setOutletMachineActive(id: string, is_active: boolean) {
  const { error } = await updateWithFallback(
    'outlet_machines',
    [{ is_active }, { is_active }],
    { column: 'id', value: id }
  );
  await updateWithFallback('washers', [{ is_active }, { is_active }], { column: 'id', value: id });
  return { error };
}
