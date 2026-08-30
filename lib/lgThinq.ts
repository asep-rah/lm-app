import { insertWithFallback, updateWithFallback } from '@/lib/safeWrite';
import { uuidOrNull } from '@/lib/outletUuid';

export type MachineMode = 'LG_24' | 'LG_15' | 'MANUAL';

export type CartMachineItem = {
  name?: string;
  qty?: number;
  type?: string;
  weight?: number;
  machineMode?: MachineMode;
  note?: string;
};

export type WasherBatch = {
  batchIndex: number;
  bagLabel: string;
  machineMode: MachineMode;
  machineTag: string;
  itemName: string;
  qty: number;
};

export const MACHINE_OPTIONS: { value: MachineMode; label: string }[] = [
  { value: 'LG_24', label: 'LG ThinQ 24 kg' },
  { value: 'LG_15', label: 'LG ThinQ 15 kg' },
  { value: 'MANUAL', label: 'Tanpa Mesin / Process Manual (Dry Clean / Hand Wash / Satuan)' }
];

export const machineTagOf = (mode: MachineMode) =>
  mode === 'LG_24' ? 'LG-24KG' : mode === 'LG_15' ? 'LG-15KG' : 'MANUAL';

export const inferMachineMode = (item: CartMachineItem): MachineMode => {
  if (item.machineMode) return item.machineMode;
  const name = String(item.name || '').toLowerCase();
  if (/dry.?clean|hand.?wash|satuan|setrika|sepatu/.test(name)) return 'MANUAL';
  if (/bedcover|selimut|sprei|gordyn|karpet/.test(name)) return 'LG_24';
  return 'LG_15';
};

export const capacityOf = (mode: MachineMode) => (mode === 'LG_24' ? 24 : mode === 'LG_15' ? 15 : 0);

export function planWasherBatches(
  items: CartMachineItem[],
  opts: { splitPerBag?: boolean; bagCount?: number }
): WasherBatch[] {
  const list = items?.length ? items : [{ name: 'Cucian', qty: 1, type: 'kg', machineMode: 'LG_15' as MachineMode }];
  const split = Boolean(opts.splitPerBag);
  const bags = Math.max(1, Number(opts.bagCount) || list.length || 1);
  const batches: WasherBatch[] = [];

  if (split) {
    const physical = Math.max(bags, list.length);
    for (let i = 0; i < physical; i += 1) {
      const item = list[i] || list[list.length - 1];
      const mode = inferMachineMode(item);
      batches.push({
        batchIndex: i + 1,
        bagLabel: `KANTONG ${i + 1} DARI ${physical}`,
        machineMode: mode,
        machineTag: machineTagOf(mode),
        itemName: String(item.name || 'Cucian'),
        qty: Number(item.qty) || 1
      });
    }
    return batches;
  }

  const groups = new Map<MachineMode, CartMachineItem[]>();
  list.forEach((item) => {
    const mode = inferMachineMode(item);
    const arr = groups.get(mode) || [];
    arr.push(item);
    groups.set(mode, arr);
  });

  groups.forEach((group, mode) => {
    const names = group.map((g) => g.name).filter(Boolean).join(' + ') || 'Cucian';
    const weight = group.reduce((s, g) => s + (Number(g.qty) || 0), 0);
    if (mode === 'MANUAL') {
      group.forEach((g, i) => {
        batches.push({
          batchIndex: batches.length + 1,
          bagLabel: `MANUAL ${i + 1}`,
          machineMode: 'MANUAL',
          machineTag: 'MANUAL',
          itemName: String(g.name || 'Manual'),
          qty: Number(g.qty) || 1
        });
      });
      return;
    }
    const cap = capacityOf(mode);
    const chunks = cap > 0 ? Math.max(1, Math.ceil(weight / cap)) : 1;
    for (let i = 0; i < chunks; i += 1) {
      batches.push({
        batchIndex: batches.length + 1,
        bagLabel: chunks > 1 ? `BATCH ${i + 1}/${chunks}` : `MESIN ${machineTagOf(mode)}`,
        machineMode: mode,
        machineTag: machineTagOf(mode),
        itemName: names,
        qty: weight / chunks
      });
    }
  });

  return batches.map((b, i) => ({ ...b, batchIndex: i + 1 }));
}

type Db = { from: (table: string) => any };

export async function ensureDefaultWashers(db: Db, outletId: string) {
  if (!outletId) return [];
  const { data } = await db.from('washers').select('*').eq('outlet_id', outletId);
  if (data?.length) return data;
  const rows = [
    { outlet_id: outletId, machine_name: 'LG ThinQ 24 kg', capacity_kg: 24, status: 'IDLE', thinq_device_id: `lg24-${outletId.slice(0, 8)}` },
    { outlet_id: outletId, machine_name: 'LG ThinQ 15 kg', capacity_kg: 15, status: 'IDLE', thinq_device_id: `lg15-${outletId.slice(0, 8)}` }
  ];
  const { data: inserted } = await db.from('washers').insert(rows).select('*');
  return inserted || [];
}

export async function createWasherCycles(opts: {
  db?: Db;
  orderId: string;
  outletId: string;
  items: CartMachineItem[];
  splitPerBag?: boolean;
  bagCount?: number;
  startedBy?: string;
}) {
  const db = opts.db;
  if (!db || !opts.orderId) return { error: { message: 'Order kosong' }, cycles: [] as any[] };
  const batches = planWasherBatches(opts.items, { splitPerBag: opts.splitPerBag, bagCount: opts.bagCount });
  const washers = await ensureDefaultWashers(db, opts.outletId);
  const actor = uuidOrNull(opts.startedBy);
  const cycles: any[] = [];

  for (const batch of batches) {
    const cap = capacityOf(batch.machineMode);
    const washer =
      batch.machineMode === 'MANUAL'
        ? null
        : (washers || []).find((w: any) => Number(w.capacity_kg) === cap && String(w.status || 'IDLE') === 'IDLE') ||
          (washers || []).find((w: any) => Number(w.capacity_kg) === cap);

    const status = batch.machineMode === 'MANUAL' ? 'COMPLETED' : 'RUNNING';
    const { data, error } = await insertWithFallback('washer_cycle_logs', [
      {
        washer_id: washer?.id || null,
        order_id: opts.orderId,
        started_by_user_id: actor,
        cycle_type: 'WASH',
        status,
        batch_index: batch.batchIndex,
        bag_label: batch.bagLabel,
        machine_tag: batch.machineTag
      },
      {
        washer_id: washer?.id || null,
        order_id: opts.orderId,
        cycle_type: 'WASH',
        status,
        batch_index: batch.batchIndex
      },
      { order_id: opts.orderId, status, cycle_type: 'WASH' }
    ]);
    if (!error && data?.[0]) cycles.push(data[0]);
    if (washer?.id && status === 'RUNNING') {
      await updateWithFallback(
        'washers',
        [
          { status: 'RUNNING', current_order_id: opts.orderId, last_started_at: new Date().toISOString() },
          { status: 'RUNNING', current_order_id: opts.orderId }
        ],
        { column: 'id', value: washer.id }
      );
    }
  }
  return { error: null, cycles, batches };
}

export const machineCyclesAllDone = (cycles: any[]) => {
  const list = cycles || [];
  if (!list.length) return true;
  return list.every((c) => {
    const st = String(c.status || '').toUpperCase();
    return st === 'COMPLETED' || st === 'MAINTENANCE_TUB_CLEAN' || st === 'MAINTENANCE_SHIFT_CLEAN';
  });
};

export const hasOpenMachineCycles = (cycles: any[]) =>
  (cycles || []).some((c) => String(c.status || '').toUpperCase() === 'RUNNING');

const jakartaParts = (now = new Date()) => {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return { hour: Number(parts.hour), minute: Number(parts.minute) };
};

/** 45 menit sebelum jam closing POS (default 21:00 WIB) atau saat proses closing. */
export const isShiftEndWindow = (
  now = new Date(),
  opts?: { closing?: boolean; closeHour?: number; leadMinutes?: number }
) => {
  if (opts?.closing) return true;
  const { hour, minute } = jakartaParts(now);
  const lead = opts?.leadMinutes ?? 45;
  const closeHour = opts?.closeHour ?? 21;
  const mins = hour * 60 + minute;
  const windowStart = closeHour * 60 - lead;
  return mins >= windowStart || hour < 6;
};

export const MAINTENANCE_CYCLE_TYPES = ['RINSE_SPIN', 'SPEED_WASH', 'QUICK_WASH', 'TUB_CLEAN'] as const;
export const STANDARD_WASH_TYPES = ['COTTON', 'DUVET', 'NORMAL', 'WASH', 'STANDARD', 'BEDDING', 'HEAVY'] as const;

export const normalizeCycleType = (raw: unknown) =>
  String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

export const parseThinqCycleType = (body: Record<string, unknown>) => {
  const raw =
    body.cycle_type ||
    body.cycleType ||
    body.course ||
    body.wash_mode ||
    body.washMode ||
    body.program ||
    body.flag;
  const n = normalizeCycleType(raw);
  if (['RINSE_SPIN', 'RINSESPIN', 'RINSE', 'SPIN'].includes(n) || n.includes('RINSE')) return 'RINSE_SPIN';
  if (['SPEED_WASH', 'SPEEDWASH', 'SPEED'].includes(n) || n.includes('SPEED')) return 'SPEED_WASH';
  if (['QUICK_WASH', 'QUICKWASH', 'QUICK'].includes(n) || n.includes('QUICK')) return 'QUICK_WASH';
  if (['TUB_CLEAN', 'TUBCLEAN', 'TUB'].includes(n) || n.includes('TUB')) return 'TUB_CLEAN';
  if (['DUVET', 'BEDDING', 'BEDCOVER'].includes(n) || n.includes('DUVET')) return 'DUVET';
  if (['COTTON'].includes(n) || n.includes('COTTON')) return 'COTTON';
  if (['NORMAL', 'STANDARD', 'WASH', 'HEAVY'].includes(n) || n.includes('NORMAL')) return 'NORMAL';
  if (Boolean(body.tub_clean || body.tubClean)) return 'TUB_CLEAN';
  return n || 'NORMAL';
};

export const isMaintenanceCycle = (cycleType: string) =>
  (MAINTENANCE_CYCLE_TYPES as readonly string[]).includes(normalizeCycleType(cycleType)) ||
  ['RINSE_SPIN', 'SPEED_WASH', 'QUICK_WASH', 'TUB_CLEAN'].includes(cycleType);

export const isStandardWashCycle = (cycleType: string) => {
  const n = normalizeCycleType(cycleType);
  if (isMaintenanceCycle(n)) return false;
  return (STANDARD_WASH_TYPES as readonly string[]).includes(n) || !n;
};

export const jakartaDate = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    now
  );

export const FRAUD_ALERT_TEXT = (machineName: string) =>
  `⚠️ ALERT FRAUD: Mesin Menyala Tanpa Transaksi${machineName ? ` — LG ${machineName}` : ''}`;
