import { insertWithFallback, updateWithFallback } from '@/lib/safeWrite';
import { uuidOrNull } from '@/lib/outletUuid';

export type MachineMode = 'LG_24' | 'LG_15' | 'MANUAL' | 'NO_MACHINE_REQUIRED';

export type CartMachineItem = {
  id?: string;
  cart_item_id?: string;
  service_name?: string;
  name?: string;
  qty?: number;
  type?: string;
  weight?: number;
  pcs?: number;
  category?: string;
  service_type?: string;
  machineMode?: MachineMode | null;
  washerId?: string | null;
  washerName?: string | null;
  note?: string;
};

export type WasherRow = {
  id: string;
  outlet_id?: string;
  machine_name?: string;
  capacity_kg?: number;
  status?: string;
  current_order_id?: string | null;
  last_started_at?: string | null;
  remaining_sec?: number | null;
  thinq_device_id?: string | null;
};

export type WasherBatch = {
  batchIndex: number;
  bagLabel: string;
  machineMode: MachineMode;
  machineTag: string;
  itemName: string;
  qty: number;
  washerId?: string | null;
};

export type BagQrPayload = {
  orderId?: string;
  washerId?: string;
  bagIndex?: number;
  receipt?: string;
  raw: string;
};

export const MACHINE_OPTIONS: { value: MachineMode; label: string }[] = [
  { value: 'LG_24', label: 'LG ThinQ 24 kg' },
  { value: 'LG_15', label: 'LG ThinQ 15 kg' }
];

export const isNoMachineService = (item: CartMachineItem) => {
  if (item.machineMode === 'NO_MACHINE_REQUIRED') return true;
  const hay = [item.name, item.category, item.service_type].map((v) => String(v || '').toLowerCase()).join(' ');
  return /jasa\s*setrika|only\s*ironing|dry\s*clean\s*manual|dry.?clean|ironing|\biron\b|setrika|gosok\s*saja|setrika\s*saja/.test(
    hay
  );
};

export const needsWasherCycle = (item: CartMachineItem) => !isNoMachineService(item);

export const machineTagOf = (mode?: MachineMode | null) => {
  if (mode === 'LG_24') return 'LG-24KG';
  if (mode === 'LG_15') return 'LG-15KG';
  if (mode === 'NO_MACHINE_REQUIRED' || !mode) return 'NO_MACHINE';
  return 'MANUAL';
};

export const inferMachineMode = (item: CartMachineItem): MachineMode => {
  if (isNoMachineService(item)) return 'NO_MACHINE_REQUIRED';
  if (item.machineMode === 'LG_24' || item.machineMode === 'LG_15') return item.machineMode;
  const name = String(item.name || item.category || '').toLowerCase();
  if (/bedcover|selimut|sprei|gordyn|karpet/.test(name)) return 'LG_24';
  return 'LG_15';
};

export const assignmentBadge = (item: CartMachineItem, rowIndex: number) => {
  const name = String(item.name || 'Layanan').trim() || 'Layanan';
  const kg =
    item.type === 'kg' || Number(item.weight) > 0
      ? `${Number(item.qty ?? item.weight) || 0} Kg`
      : '';
  const pcs =
    Number(item.pcs) > 0
      ? `${Number(item.pcs)} Pcs`
      : item.type === 'pcs'
        ? `${Number(item.qty) || 0} Pcs`
        : '';
  const qtyLabel = [kg, pcs].filter(Boolean).join(' / ') || `${Number(item.qty) || 1}`;
  const note = String(item.note || '')
    .replace(/\s*\d+\s*pcs\s*/gi, ' ')
    .replace(/\s*·\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const ident = note || item.washerName || `Kantong ${rowIndex}`;
  return `${name} - ${qtyLabel} (${ident})`;
};

export const capacityOf = (mode: MachineMode) => (mode === 'LG_24' ? 24 : mode === 'LG_15' ? 15 : 0);

export const itemWeightKg = (item: CartMachineItem) => {
  if (item.type === 'kg' || Number(item.weight) > 0) return Number(item.qty ?? item.weight) || 0;
  return Number(item.weight) || 0;
};

export const modeFromCapacity = (kg?: number): MachineMode => (Number(kg) >= 24 ? 'LG_24' : 'LG_15');

export const estimatedCycleMs = (washer: Pick<WasherRow, 'capacity_kg'>) =>
  (Number(washer.capacity_kg) >= 24 ? 58 : 48) * 60 * 1000;

export const isWasherIdle = (washer?: Pick<WasherRow, 'status'> | null) =>
  String(washer?.status || 'IDLE').toUpperCase() === 'IDLE';

export const remainingMs = (washer: WasherRow, now = Date.now()) => {
  if (isWasherIdle(washer)) return 0;
  if (washer.remaining_sec != null && Number.isFinite(Number(washer.remaining_sec))) {
    return Math.max(0, Number(washer.remaining_sec) * 1000);
  }
  const started = Date.parse(String(washer.last_started_at || ''));
  if (!Number.isFinite(started)) return estimatedCycleMs(washer);
  return Math.max(0, started + estimatedCycleMs(washer) - now);
};

export const progressPct = (washer: WasherRow, now = Date.now()) => {
  if (isWasherIdle(washer)) return 0;
  const total = estimatedCycleMs(washer);
  return Math.min(100, Math.max(0, ((total - remainingMs(washer, now)) / total) * 100));
};

export const remainingLabel = (washer: WasherRow, now = Date.now()) => {
  if (isWasherIdle(washer)) return 'Kosong';
  const mins = Math.max(1, Math.ceil(remainingMs(washer, now) / 60000));
  return `Sisa ${mins} mnt`;
};

export const washerCapKg = (washer?: Pick<WasherRow, 'capacity_kg'> | null) =>
  Number(washer?.capacity_kg) >= 24 ? 24 : 15;

export const washerDisplayName = (washer?: WasherRow | null, peers: WasherRow[] = []) => {
  if (!washer) return 'Mesin LG';
  const cap = washerCapKg(washer);
  const same = [...peers]
    .filter((p) => washerCapKg(p) === cap)
    .sort((a, b) => String(a.machine_name || '').localeCompare(String(b.machine_name || '')) || String(a.id).localeCompare(String(b.id)));
  const n = Math.max(1, same.findIndex((p) => p.id === washer.id) + 1);
  return `Mesin LG ${cap}kg #${n}`;
};

/** Pilih mesin terbaik: muat kapasitas, prioritas IDLE, lalu timer tersisa paling pendek. */
export function suggestWasher(
  weightKg: number,
  washers: WasherRow[],
  prefer?: MachineMode | null
): WasherRow | null {
  const list = washers || [];
  if (!list.length) return null;
  const need24 = prefer === 'LG_24' || Number(weightKg) > 15;
  const candidates = list.filter((w) => {
    const cap = Number(w.capacity_kg) || 0;
    if (need24) return cap >= 24;
    return cap >= Math.min(15, Number(weightKg) || 0) || cap === 15 || cap === 24;
  });
  const pool = candidates.length ? candidates : list;
  const score = (w: WasherRow) => {
    const idleRank = isWasherIdle(w) ? 0 : 1;
    const rem = remainingMs(w);
    const waste = Math.max(0, Number(w.capacity_kg) - Math.max(Number(weightKg) || 0, 1));
    const preferFit = need24 ? (Number(w.capacity_kg) >= 24 ? 0 : 1e8) : Number(w.capacity_kg) === 15 ? 0 : 400;
    return idleRank * 1e12 + rem + waste * 80 + preferFit;
  };
  return [...pool].sort((a, b) => score(a) - score(b))[0] || null;
}

export const suggestBadge = (washer: WasherRow | null, peers: WasherRow[] = []) => {
  if (!washer) return '🟢 Rekomendasi POS: menunggu status mesin';
  return `🟢 Rekomendasi POS: ${washerDisplayName(washer, peers)} (${remainingLabel(washer)})`;
};

export const encodeBagQr = (opts: {
  orderId?: string;
  washerId?: string;
  bagIndex?: number;
  receipt?: string;
}) =>
  ['LM', opts.orderId || '', opts.washerId || '', String(opts.bagIndex || 1), opts.receipt || '']
    .join('|')
    .replace(/\|+$/, '');

export const parseBagQr = (raw: string): BagQrPayload | null => {
  const t = String(raw || '').trim();
  if (!t) return null;
  if (/^LM(-BAG)?\|/i.test(t)) {
    const parts = t.split('|');
    return {
      orderId: parts[1] || undefined,
      washerId: parts[2] || undefined,
      bagIndex: Number(parts[3]) || undefined,
      receipt: parts[4] || undefined,
      raw: t
    };
  }
  try {
    const j = JSON.parse(t);
    if (j && (j.orderId || j.washerId || j.receipt || j.order_id)) {
      return {
        orderId: String(j.orderId || j.order_id || ''),
        washerId: String(j.washerId || j.washer_id || ''),
        bagIndex: Number(j.bagIndex || j.bag_index) || undefined,
        receipt: String(j.receipt || j.receipt_number || ''),
        raw: t
      };
    }
  } catch {
    /* not json */
  }
  return { orderId: t, receipt: t, raw: t };
};

export function verifyBagAgainstMachine(
  scanned: BagQrPayload | null,
  expected: { washerId?: string | null; orderId?: string | null; receipt?: string | null }
): { ok: true } | { ok: false; reason: 'mismatch' | 'empty'; scannedWasherId?: string } {
  if (!scanned) return { ok: false, reason: 'empty' };
  const expWasher = String(expected.washerId || '').trim();
  const scanWasher = String(scanned.washerId || '').trim();
  const expOrder = String(expected.orderId || '').trim();
  const expReceipt = String(expected.receipt || '').trim().toLowerCase();
  const scanOrder = String(scanned.orderId || '').trim();
  const scanReceipt = String(scanned.receipt || '').trim().toLowerCase();

  if (scanWasher && expWasher && scanWasher !== expWasher) {
    return { ok: false, reason: 'mismatch', scannedWasherId: scanWasher };
  }
  if (scanOrder && expOrder && scanOrder !== expOrder && scanReceipt !== expReceipt) {
    const receiptHit = expReceipt && (scanOrder.toLowerCase() === expReceipt || scanReceipt === expReceipt);
    if (!receiptHit) return { ok: false, reason: 'mismatch', scannedWasherId: scanWasher || undefined };
  }
  if (scanWasher && expWasher && scanWasher === expWasher) return { ok: true };
  if (!scanWasher && (scanOrder === expOrder || (expReceipt && (scanReceipt === expReceipt || scanOrder.toLowerCase() === expReceipt)))) {
    return { ok: true };
  }
  if (scanWasher && !expWasher) return { ok: true };
  if (!scanWasher && !scanOrder && !scanReceipt) return { ok: false, reason: 'empty' };
  if (!expWasher && (scanOrder || scanReceipt)) return { ok: true };
  return { ok: false, reason: 'mismatch', scannedWasherId: scanWasher || undefined };
}

export function planWasherBatches(
  items: CartMachineItem[],
  opts: { splitPerBag?: boolean; bagCount?: number }
): WasherBatch[] {
  const raw = items?.length ? items : [{ name: 'Cucian', qty: 1, type: 'kg', machineMode: 'LG_15' as MachineMode }];
  const list = raw.filter((it) => needsWasherCycle(it) && inferMachineMode(it) !== 'NO_MACHINE_REQUIRED');
  if (!list.length) return [];
  const split = Boolean(opts.splitPerBag);
  const bags = Math.max(1, Number(opts.bagCount) || list.length || 1);
  const batches: WasherBatch[] = [];

  if (split) {
    const physical = Math.max(bags, list.length);
    for (let i = 0; i < physical; i += 1) {
      const item = list[i] || list[list.length - 1];
      const mode = inferMachineMode(item);
      if (mode === 'NO_MACHINE_REQUIRED') continue;
      batches.push({
        batchIndex: i + 1,
        bagLabel: `KANTONG ${i + 1} DARI ${physical}`,
        machineMode: mode,
        machineTag: machineTagOf(mode),
        itemName: String(item.name || 'Cucian'),
        qty: Number(item.qty) || 1,
        washerId: item.washerId || null
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
    if (mode === 'NO_MACHINE_REQUIRED' || mode === 'MANUAL') return;
    const names = group.map((g) => g.name).filter(Boolean).join(' + ') || 'Cucian';
    const weight = group.reduce((s, g) => s + (Number(g.qty) || 0), 0);
    const cap = capacityOf(mode);
    const chunks = cap > 0 ? Math.max(1, Math.ceil(weight / cap)) : 1;
    for (let i = 0; i < chunks; i += 1) {
      batches.push({
        batchIndex: batches.length + 1,
        bagLabel: chunks > 1 ? `BATCH ${i + 1}/${chunks}` : `MESIN ${machineTagOf(mode)}`,
        machineMode: mode,
        machineTag: machineTagOf(mode),
        itemName: names,
        qty: weight / chunks,
        washerId: group.find((g) => g.washerId)?.washerId || null
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
    if (batch.machineMode === 'NO_MACHINE_REQUIRED' || batch.machineTag === 'NO_MACHINE') continue;
    const preferred = (washers || []).find((w: any) => batch.washerId && String(w.id) === String(batch.washerId));
    const washer =
      preferred ||
      suggestWasher(Number(batch.qty) || cap, washers || [], batch.machineMode) ||
      (washers || []).find((w: any) => Number(w.capacity_kg) === cap && String(w.status || 'IDLE') === 'IDLE') ||
      (washers || []).find((w: any) => Number(w.capacity_kg) === cap);

    const status = 'PENDING';
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
  }
  return { error: null, cycles, batches };
}

export async function startVerifiedWasherCycle(opts: {
  db?: Db;
  cycleId?: string | null;
  washerId?: string | null;
  orderId?: string | null;
  startedBy?: string;
}) {
  const db = opts.db;
  if (!db) return { error: { message: 'DB kosong' } };
  const actor = uuidOrNull(opts.startedBy);
  if (opts.cycleId) {
    await updateWithFallback(
      'washer_cycle_logs',
      [
        { status: 'RUNNING', started_by_user_id: actor },
        { status: 'RUNNING' }
      ],
      { column: 'id', value: opts.cycleId }
    );
  }
  if (opts.washerId) {
    await updateWithFallback(
      'washers',
      [
        {
          status: 'RUNNING',
          current_order_id: opts.orderId || null,
          last_started_at: new Date().toISOString()
        },
        { status: 'RUNNING', current_order_id: opts.orderId || null }
      ],
      { column: 'id', value: opts.washerId }
    );
  }
  return { error: null };
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

export const hasIncompleteWashCycles = (cycles: any[]) =>
  (cycles || []).some((c) => {
    const st = String(c.status || '').toUpperCase();
    return st === 'RUNNING' || st === 'PENDING' || st === 'QUEUED';
  });

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
  `⚠️ ALERT FRAUD: Mesin LG ${machineName || 'ThinQ'} menyala tanpa transaksi aktif!`;
