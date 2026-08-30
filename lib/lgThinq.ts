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
  cycleSlots?: Array<{ washerId?: string | null; washerName?: string | null; machineMode?: MachineMode | null }>;
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
  batchTotal?: number;
};

/** Operational payload — not drum nameplate. */
export const OP_LIMIT_LG15_KG = 7;
export const OP_LIMIT_LG24_KG = 10;

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

export const itemWeightKg = (item: CartMachineItem) => {
  if (item.type === 'kg' || Number(item.weight) > 0) return Number(item.qty ?? item.weight) || 0;
  return Number(item.weight) || 0;
};

export const isBedcoverLike = (item?: CartMachineItem | null) => {
  const name = [item?.name, item?.category, item?.service_type].map((v) => String(v || '').toLowerCase()).join(' ');
  return /bedcover|selimut|sprei|gordyn|karpet/.test(name);
};

/** King / Double / Bedcover Big — never allowed on LG 15kg. */
export const isBedcoverDouble = (item?: CartMachineItem | null) => {
  const hay = [item?.name, item?.category, item?.service_type, item?.service_name]
    .map((v) => String(v || '').toLowerCase())
    .join(' ');
  return (
    /bedcover\s*(double|king|big|besar|queen)/.test(hay) ||
    /bedcover\s*big/.test(hay) ||
    (hay.includes('bedcover') && /(double|king|besar|queen)/.test(hay))
  );
};

export const isBedcoverItem = (item?: CartMachineItem | null) => {
  const hay = [item?.name, item?.category, item?.service_type, item?.service_name]
    .map((v) => String(v || '').toLowerCase())
    .join(' ');
  return hay.includes('bedcover');
};

export const isBedcoverSingle = (item?: CartMachineItem | null) =>
  isBedcoverItem(item) && !isBedcoverDouble(item);

export const isSpreiSingle = (item?: CartMachineItem | null) => {
  const hay = [item?.name, item?.category, item?.service_type, item?.service_name]
    .map((v) => String(v || '').toLowerCase())
    .join(' ');
  if (!hay.includes('sprei')) return false;
  return !/(double|king|big|queen|besar)/.test(hay);
};

export const isLightWashItem = (item?: CartMachineItem | null) => {
  if (!item || isNoMachineService(item) || isBedcoverDouble(item)) return false;
  if (isSpreiSingle(item) || isBedcoverSingle(item)) return true;
  const w = itemWeightKg(item);
  if (w > OP_LIMIT_LG15_KG) return false;
  if (isBedcoverLike(item) && !isSpreiSingle(item)) return false;
  return w > 0 || item.type === 'pcs' || Number(item.pcs) > 0;
};

export const bedcoverPieceCount = (item?: CartMachineItem | null) => {
  if (!item || !isBedcoverItem(item)) return 1;
  const pcs = Number(item.pcs);
  if (Number.isFinite(pcs) && pcs > 0) return Math.max(1, Math.round(pcs));
  const qty = Number(item.qty);
  if (item.type !== 'kg' && Number.isFinite(qty) && qty >= 1) return Math.max(1, Math.round(qty));
  return 1;
};

export const BEDCOVER_ONE_PCS_BADGE =
  '⚠️ SOP Laundry: Bedcover Wajib Dicuci 1 Pcs Per Siklus (Tidak Boleh Digabung)';

export const BEDCOVER_DOUBLE_BADGE = '🔒 Wajib LG 24kg (Ukuran Bedcover Double)';

export const isLargeWasher = (washer?: Pick<WasherRow, 'capacity_kg'> | null) =>
  Number(washer?.capacity_kg) >= 20;

export const inferMachineMode = (item: CartMachineItem): MachineMode => {
  if (isNoMachineService(item)) return 'NO_MACHINE_REQUIRED';
  if (isBedcoverDouble(item)) return 'LG_24';
  if (isBedcoverSingle(item) || isSpreiSingle(item) || isLightWashItem(item)) return 'LG_15';
  if (item.machineMode === 'LG_24' || item.machineMode === 'LG_15') return item.machineMode;
  return recommendModeForWeight(itemWeightKg(item), item);
};

export const recommendModeForWeight = (weightKg: number, item?: CartMachineItem | null): MachineMode => {
  if (item && isNoMachineService(item)) return 'NO_MACHINE_REQUIRED';
  if (isBedcoverDouble(item)) return 'LG_24';
  if (isBedcoverSingle(item) || isSpreiSingle(item)) return 'LG_15';
  const w = Number(weightKg) || 0;
  if (isSpreiSingle(item) || (isLightWashItem(item) && w <= OP_LIMIT_LG15_KG)) return 'LG_15';
  if ((isBedcoverLike(item) && !isSpreiSingle(item)) || (w > OP_LIMIT_LG15_KG && w <= OP_LIMIT_LG24_KG)) return 'LG_24';
  if (w > OP_LIMIT_LG24_KG) return 'LG_24';
  return 'LG_15';
};

export const WORKLOAD_BALANCING_THRESHOLD_MINUTES = 30;

export const pendingCycleMinutes = (cycle?: { duration_minutes?: number | null }, washer?: WasherRow | null) => {
  const logged = Number(cycle?.duration_minutes);
  if (logged > 0) return logged;
  return Math.round(estimatedCycleMs(washer || { capacity_kg: 15 }) / 60000);
};

export const machineWorkloadMinutes = (
  washer: WasherRow,
  pendingCycles: Array<{ washer_id?: string | null; status?: string; duration_minutes?: number | null }> = [],
  now = Date.now()
) => {
  const running = remainingMs(washer, now) / 60000;
  const queued = (pendingCycles || [])
    .filter((c) => String(c.washer_id) === String(washer.id))
    .filter((c) => ['PENDING', 'QUEUED'].includes(String(c.status || '').toUpperCase()))
    .reduce((s, c) => s + pendingCycleMinutes(c, washer), 0);
  return running + queued;
};

export const workloadByWasherId = (
  washers: WasherRow[],
  pendingCycles: Array<{ washer_id?: string | null; status?: string; duration_minutes?: number | null }> = [],
  now = Date.now()
) => {
  const map = new Map<string, number>();
  (washers || []).forEach((w) => map.set(String(w.id), machineWorkloadMinutes(w, pendingCycles, now)));
  return map;
};

export const exceedsOpLimit = (weightKg: number) => Number(weightKg) > OP_LIMIT_LG24_KG;

export const opLimitOf = (mode?: MachineMode | null) =>
  mode === 'LG_24' ? OP_LIMIT_LG24_KG : OP_LIMIT_LG15_KG;

export const splitPayloadKg = (
  weightKg: number,
  item?: CartMachineItem | null
): Array<{ qty: number; machineMode: MachineMode }> => {
  const w = Math.round((Number(weightKg) || 0) * 10) / 10;
  const hard24 = isBedcoverDouble(item);
  if (isBedcoverSingle(item)) {
    if (w <= OP_LIMIT_LG24_KG) return [{ qty: w || 1, machineMode: 'LG_15' }];
  }
  const bed = hard24 || isBedcoverLike(item);
  if (w <= 0) return [{ qty: 0, machineMode: bed ? 'LG_24' : 'LG_15' }];
  if (hard24) {
    if (w <= OP_LIMIT_LG24_KG) return [{ qty: w, machineMode: 'LG_24' }];
    const parts: Array<{ qty: number; machineMode: MachineMode }> = [];
    let remain = w;
    while (remain > OP_LIMIT_LG24_KG) {
      parts.push({ qty: OP_LIMIT_LG24_KG, machineMode: 'LG_24' });
      remain = Math.round((remain - OP_LIMIT_LG24_KG) * 10) / 10;
    }
    if (remain > 0) parts.push({ qty: remain, machineMode: 'LG_24' });
    return parts;
  }
  if (w <= OP_LIMIT_LG15_KG && !bed) return [{ qty: w, machineMode: 'LG_15' }];
  if (w <= OP_LIMIT_LG24_KG) return [{ qty: w, machineMode: 'LG_24' }];
  const parts: Array<{ qty: number; machineMode: MachineMode }> = [];
  let remain = w;
  while (remain > OP_LIMIT_LG24_KG) {
    parts.push({ qty: OP_LIMIT_LG15_KG, machineMode: 'LG_15' });
    remain = Math.round((remain - OP_LIMIT_LG15_KG) * 10) / 10;
  }
  if (remain > 0) {
    parts.push({
      qty: remain,
      machineMode: remain > OP_LIMIT_LG15_KG || bed ? 'LG_24' : 'LG_15'
    });
  }
  return parts;
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

export const capacityOf = (mode: MachineMode) => (mode === 'LG_24' ? OP_LIMIT_LG24_KG : mode === 'LG_15' ? OP_LIMIT_LG15_KG : 0);

export const modeFromCapacity = (kg?: number): MachineMode => (Number(kg) >= 24 ? 'LG_24' : 'LG_15');

export const estimatedCycleMs = (washer: Pick<WasherRow, 'capacity_kg'>) =>
  (Number(washer.capacity_kg) >= 24 ? 58 : 48) * 60 * 1000;

export const estimatedCycleMinutes = (washer?: Pick<WasherRow, 'capacity_kg'> | null) =>
  Math.round(estimatedCycleMs(washer || { capacity_kg: 15 }) / 60000);

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

export const washerShortTag = (washer?: WasherRow | null, peers: WasherRow[] = []) => {
  if (!washer) return 'LG';
  const cap = washerCapKg(washer);
  const same = [...peers]
    .filter((p) => washerCapKg(p) === cap)
    .sort((a, b) => String(a.machine_name || '').localeCompare(String(b.machine_name || '')) || String(a.id).localeCompare(String(b.id)));
  const n = Math.max(1, same.findIndex((p) => p.id === washer.id) + 1);
  return `LG ${cap}kg #${n}`;
};

export const washerDisplayName = (washer?: WasherRow | null, peers: WasherRow[] = []) => {
  if (!washer) return 'Mesin LG';
  return `Mesin ${washerShortTag(washer, peers)}`;
};

export const washerCompactOptionLabel = (
  washer: WasherRow,
  peers: WasherRow[] = [],
  opts?: { disabled?: boolean; shorterQueue?: boolean }
) => {
  const tag = washerShortTag(washer, peers);
  if (opts?.disabled) return `🔒 ${tag} (Tidak Muat / Khusus 24kg)`;
  if (opts?.shorterQueue && isWasherIdle(washer)) return `🟢 ${tag} (Kosong / Antrean Lebih Pendek)`;
  if (opts?.shorterQueue) {
    const mins = Math.max(1, Math.ceil(remainingMs(washer) / 60000));
    return `🟢 ${tag} (Sisa ${mins}m / Antrean Lebih Pendek)`;
  }
  if (isWasherIdle(washer)) return `🟢 ${tag} (Kosong)`;
  const mins = Math.max(1, Math.ceil(remainingMs(washer) / 60000));
  return `🔴 ${tag} (Sisa ${mins}m)`;
};

export const SLOT_SPLIT_BANNER =
  '💡 Tipe Bedcover & Kilokan >7kg otomatis dialokasikan ke slot mesin terpisah.';

/** Pilih mesin terbaik: batas operasional 7/10 kg, prioritas IDLE, lalu timer tersisa paling pendek. */
export function suggestWasher(
  weightKg: number,
  washers: WasherRow[],
  prefer?: MachineMode | null,
  excludeIds?: Iterable<string>
): WasherRow | null {
  const taken = new Set(excludeIds || []);
  const list = (washers || []).filter((w) => !taken.has(String(w.id)));
  if (!list.length) return null;
  const need24 = prefer === 'LG_24' || Number(weightKg) > OP_LIMIT_LG15_KG;
  const typed = list.filter((w) => (need24 ? washerCapKg(w) === 24 : washerCapKg(w) === 15));
  const pool = (typed.length ? typed : list).slice();
  const score = (w: WasherRow) => {
    const idleRank = isWasherIdle(w) ? 0 : 1;
    const rem = remainingMs(w);
    const typeFit = need24 === (washerCapKg(w) === 24) ? 0 : 1e8;
    return idleRank * 1e12 + rem + typeFit;
  };
  return pool.sort((a, b) => score(a) - score(b))[0] || null;
}

export type BalancedAssign = {
  index: number;
  slotIndex: number;
  washer: WasherRow | null;
  machineMode: MachineMode;
  loadBalanced: boolean;
  queueDiverted: boolean;
  shorterQueue: boolean;
  queue15: number;
  queue24: number;
};

const pickShortestQueue = (pool: WasherRow[], acc: Map<string, number>) => {
  const list = (pool || []).slice();
  if (!list.length) return null;
  return list.sort((a, b) => {
    const dq = Number(acc.get(String(a.id)) || 0) - Number(acc.get(String(b.id)) || 0);
    if (dq !== 0) return dq;
    if (isWasherIdle(a) !== isWasherIdle(b)) return isWasherIdle(a) ? -1 : 1;
    return String(a.id).localeCompare(String(b.id));
  })[0];
};

const classQueueMinutes = (washers: WasherRow[], acc: Map<string, number>, kg: 15 | 24) => {
  const list = (washers || []).filter((w) => washerCapKg(w) === kg);
  if (!list.length) return Number.POSITIVE_INFINITY;
  return Math.min(...list.map((w) => Number(acc.get(String(w.id)) || 0)));
};

/**
 * Row-by-row intra-cart queue: each assignment adds estimated cycle minutes
 * to that washer (on top of live ThinQ / pending load). Light items and
 * Sprei Single take LG 15kg whenever its accumulated queue is shorter.
 */
export function balanceWasherAssignments(
  items: CartMachineItem[],
  washers: WasherRow[],
  reservedIds?: Iterable<string>,
  workloads?: Map<string, number>
): BalancedAssign[] {
  const reserved = new Set<string>([...(reservedIds || [])].map(String));
  const acc = new Map<string, number>();
  (washers || []).forEach((w) => acc.set(String(w.id), Number(workloads?.get(String(w.id)) || 0)));

  const pool15 = (washers || []).filter((w) => washerCapKg(w) === 15);
  const pool24 = (washers || []).filter(isLargeWasher);

  return expandWashSlots(items || []).map((slot) => {
    const item = slot.item;
    const index = slot.sourceIndex;
    const weight = itemWeightKg(item);
    const hard24 = isBedcoverDouble(item);
    const light = isSpreiSingle(item) || isLightWashItem(item);
    const prefer = hard24
      ? 'LG_24'
      : isBedcoverSingle(item) || isSpreiSingle(item) || light
        ? 'LG_15'
        : recommendModeForWeight(weight, item);
    const queue15 = classQueueMinutes(washers, acc, 15);
    const queue24 = classQueueMinutes(washers, acc, 24);
    let washer: WasherRow | null = null;
    let loadBalanced = false;
    let queueDiverted = false;
    let shorterQueue = false;

    if (item.washerId && reserved.has(String(item.washerId))) {
      washer = (washers || []).find((w) => String(w.id) === String(item.washerId)) || null;
      if (washer && hard24 && !isLargeWasher(washer)) washer = null;
    }

    if (!washer && hard24) {
      washer = pickShortestQueue(pool24, acc);
    } else if (!washer && light && queue15 <= queue24) {
      washer = pickShortestQueue(pool15, acc);
      shorterQueue = queue15 < queue24 || prefer === 'LG_15';
    } else if (!washer && light && queue24 < queue15) {
      washer = pickShortestQueue(pool24, acc);
      loadBalanced = true;
      queueDiverted = queue15 >= WORKLOAD_BALANCING_THRESHOLD_MINUTES;
    } else if (!washer) {
      const preferredPool = prefer === 'LG_24' ? pool24 : pool15;
      const otherPool = prefer === 'LG_24' ? pool15 : pool24;
      washer = pickShortestQueue(preferredPool, acc) || pickShortestQueue(otherPool, acc);
      if (washer && washerCapKg(washer) !== (prefer === 'LG_24' ? 24 : 15)) loadBalanced = true;
    }

    if (!washer && hard24) washer = pool24[0] || null;
    if (!washer) washer = pickShortestQueue(washers || [], acc);

    if (washer) {
      acc.set(String(washer.id), Number(acc.get(String(washer.id)) || 0) + estimatedCycleMinutes(washer));
    }

    return {
      index,
      slotIndex: slot.slotIndex,
      washer,
      machineMode: washer ? (isLargeWasher(washer) ? 'LG_24' : 'LG_15') : prefer,
      loadBalanced,
      queueDiverted,
      shorterQueue,
      queue15,
      queue24
    };
  });
}

export const washerOptionLabel = (
  washer: WasherRow,
  peers: WasherRow[] = [],
  opts?: { recommended?: boolean; loadBalanced?: boolean; queueDiverted?: boolean; onePieceCycle?: boolean }
) => {
  const cap = washerCapKg(washer);
  const max = cap >= 24 ? OP_LIMIT_LG24_KG : OP_LIMIT_LG15_KG;
  const status = isWasherIdle(washer) ? 'Kosong' : remainingLabel(washer);
  const name = washerDisplayName(washer, peers);
  if (opts?.queueDiverted) return `${name} - ${status} (Distribusi Antrean Cepat - Beban 15kg >= 30m)`;
  if (opts?.loadBalanced) return `${name} - ${status} (Load Balancing Paralel)`;
  if (opts?.onePieceCycle) return `${name} - ${status} (Rekomendasi - 1 Pcs Per Siklus)`;
  const rec = opts?.recommended ? ` (Rekomendasi - Maks ${max}kg)` : ` (Maks ${max}kg)`;
  return `${name} - ${status}${rec}`;
};

export const suggestBadge = (
  washer: WasherRow | null,
  peers: WasherRow[] = [],
  opts?: { loadBalanced?: boolean; queueDiverted?: boolean; onePieceCycle?: boolean }
) => {
  if (!washer) return '🟢 Rekomendasi POS: menunggu status mesin';
  return `🟢 ${washerOptionLabel(washer, peers, { recommended: true, ...opts })}`;
};

export const eligibleWashersForItem = (item: CartMachineItem, washers: WasherRow[]) => {
  if (isBedcoverDouble(item)) return (washers || []).filter(isLargeWasher);
  return washers || [];
};

export type WashSlot = {
  sourceIndex: number;
  slotIndex: number;
  slotTotal: number;
  item: CartMachineItem;
};

const baseBedcoverName = (item: CartMachineItem) =>
  String(item.name || item.service_name || 'Bedcover').replace(/\s*\(Pcs #\d+ of \d+\)\s*/i, '').trim();

export function expandWashSlots(items: CartMachineItem[]): WashSlot[] {
  const out: WashSlot[] = [];
  (items || []).forEach((item, sourceIndex) => {
    if (!needsWasherCycle(item)) return;
    const isolate = isBedcoverItem(item);
    const n = isolate ? bedcoverPieceCount(item) : 1;
    const base = baseBedcoverName(item);
    for (let i = 0; i < n; i += 1) {
      const slot = item.cycleSlots?.[i];
      out.push({
        sourceIndex,
        slotIndex: i,
        slotTotal: n,
        item: {
          ...item,
          name: isolate && n > 1 ? `${base} (Pcs #${i + 1} of ${n})` : item.name,
          qty: isolate ? 1 : item.qty,
          pcs: isolate ? 1 : item.pcs,
          type: isolate ? 'pcs' : item.type,
          weight: isolate ? 0 : item.weight,
          washerId: slot?.washerId ?? (i === 0 ? item.washerId : null),
          washerName: slot?.washerName ?? (i === 0 ? item.washerName : null),
          machineMode: slot?.machineMode || (isBedcoverSingle(item) ? 'LG_15' : item.machineMode)
        }
      });
    }
  });
  return out;
}

export const washSlotTitle = (slot: WashSlot) => {
  const name = baseBedcoverName(slot.item) || String(slot.item.name || 'Layanan').trim() || 'Layanan';
  const tag = slot.slotTotal > 1 ? `(#${slot.slotIndex + 1}/${slot.slotTotal})` : '';
  const isPcs = slot.item.type === 'pcs' || Number(slot.item.pcs) > 0;
  const qty = isPcs
    ? `${Number(slot.item.pcs || slot.item.qty) || 1} Pcs`
    : `${Number(slot.item.qty ?? slot.item.weight) || 0} Kg`;
  return `${[name, tag].filter(Boolean).join(' ')} • ${qty}`;
};

export const isWasherDisabledForItem = (item: CartMachineItem, washer: WasherRow) => {
  if (isBedcoverDouble(item) && !isLargeWasher(washer)) return true;
  if (isBedcoverSingle(item)) return false;
  return washerCapKg(washer) === 15 && itemWeightKg(item) > OP_LIMIT_LG15_KG;
};

export function applyCycleSlot(
  item: CartMachineItem,
  slotIndex: number,
  patch: { washerId?: string | null; washerName?: string | null; machineMode?: MachineMode | null }
): { cycleSlots: NonNullable<CartMachineItem['cycleSlots']>; washerId?: string | null; washerName?: string | null; machineMode?: MachineMode | null } {
  const n = isBedcoverItem(item) ? bedcoverPieceCount(item) : 1;
  const slots = Array.from({ length: Math.max(n, (item.cycleSlots || []).length, slotIndex + 1) }, (_, i) => {
    const existing = item.cycleSlots?.[i];
    if (existing) return { ...existing };
    if (i === 0) return { washerId: item.washerId, washerName: item.washerName, machineMode: item.machineMode };
    return {};
  });
  slots[slotIndex] = { ...slots[slotIndex], ...patch };
  return {
    cycleSlots: slots,
    washerId: slots[0]?.washerId ?? item.washerId ?? null,
    washerName: slots[0]?.washerName ?? item.washerName ?? null,
    machineMode: slots[0]?.machineMode ?? item.machineMode ?? null
  };
}

export const PARALLEL_WASH_NOTICE =
  '⚡ POS Recommendation: Optimal parallel washing configured using both LG 15kg & LG 24kg to minimize total wait time.';

export const OVER_LIMIT_BADGE = '⚠️ Melebihi Maks 10kg (Bagi ke 2 Mesin/Kloter)';

export const formatWibHm = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(d);
};

export const machineShortOf = (tagOrMode?: string | null) => {
  const t = String(tagOrMode || '').toUpperCase();
  if (t.includes('24')) return 'LG 24kg';
  if (t.includes('15')) return 'LG 15kg';
  return 'LG';
};

export const formatBatchAuditLine = (cycle: any, total = 0) => {
  const n = Number(cycle?.batch_index) || 1;
  const kg = Number(cycle?.split_weight_kg ?? cycle?.qty) || 0;
  const machine = machineShortOf(cycle?.machine_tag || cycle?.machineMode);
  const start = formatWibHm(cycle?.started_at);
  const end = cycle?.completed_at ? formatWibHm(cycle.completed_at) : cycle?.status === 'RUNNING' ? 'berjalan' : '—';
  const kgBit = kg ? `${kg}kg - ${machine}` : machine;
  const extra = total > 1 ? '' : '';
  return `⏱️ Batch ${n}${extra} (${kgBit}): ${start} - ${end} WIB`;
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

  const pushParts = (item: CartMachineItem, weight: number, labelBase: string) => {
    const parts = splitPayloadKg(weight, item);
    parts.forEach((part, i) => {
      batches.push({
        batchIndex: batches.length + 1,
        bagLabel:
          parts.length > 1 ? `Batch ${i + 1} of ${parts.length}` : labelBase,
        machineMode: part.machineMode,
        machineTag: machineTagOf(part.machineMode),
        itemName: String(item.name || 'Cucian'),
        qty: part.qty,
        washerId: item.washerId || null
      });
    });
  };

  const pushBedcoverPieces = (item: CartMachineItem) => {
    const n = bedcoverPieceCount(item);
    const base = baseBedcoverName(item);
    const mode = isBedcoverDouble(item) ? 'LG_24' : 'LG_15';
    for (let i = 0; i < n; i += 1) {
      const slot = item.cycleSlots?.[i];
      const slotMode = (slot?.machineMode === 'LG_24' || slot?.machineMode === 'LG_15' ? slot.machineMode : mode) as MachineMode;
      batches.push({
        batchIndex: batches.length + 1,
        bagLabel: `Pcs #${i + 1} of ${n}`,
        machineMode: isBedcoverDouble(item) ? 'LG_24' : slotMode,
        machineTag: machineTagOf(isBedcoverDouble(item) ? 'LG_24' : slotMode),
        itemName: n > 1 ? `${base} (Pcs #${i + 1} of ${n})` : base,
        qty: 1,
        washerId: slot?.washerId || (i === 0 ? item.washerId : null) || null
      });
    }
  };

  const others: CartMachineItem[] = [];
  list.forEach((item) => {
    if (isBedcoverItem(item)) {
      pushBedcoverPieces(item);
      return;
    }
    if (split) {
      if (inferMachineMode(item) === 'NO_MACHINE_REQUIRED') return;
      const physical = Math.max(bags, list.filter((it) => !isBedcoverItem(it)).length || 1);
      pushParts(item, itemWeightKg(item) || Number(item.qty) || 1, `KANTONG ${others.length + 1} DARI ${physical}`);
      others.push(item);
      return;
    }
    others.push(item);
  });

  if (!split && others.length) {
    const totalWeight = others.reduce((s, g) => s + itemWeightKg(g), 0);
    const names = others.map((g) => g.name).filter(Boolean).join(' + ') || 'Cucian';
    const parts = splitPayloadKg(totalWeight || others.reduce((s, g) => s + (Number(g.qty) || 0), 0), others[0]);
    parts.forEach((part, i) => {
      batches.push({
        batchIndex: batches.length + 1,
        bagLabel: parts.length > 1 ? `Batch ${i + 1} of ${parts.length}` : `MESIN ${machineTagOf(part.machineMode)}`,
        machineMode: part.machineMode,
        machineTag: machineTagOf(part.machineMode),
        itemName: names,
        qty: part.qty,
        washerId: others.find((g) => g.washerId)?.washerId || null,
        batchTotal: parts.length
      });
    });
  }

  return batches.map((b, i) => ({ ...b, batchIndex: i + 1, batchTotal: batches.length }));
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
    const drum = batch.machineMode === 'LG_24' ? 24 : 15;
    if (batch.machineMode === 'NO_MACHINE_REQUIRED' || batch.machineTag === 'NO_MACHINE') continue;
    const pool = batch.machineMode === 'LG_24' ? (washers || []).filter(isLargeWasher) : washers || [];
    const preferred = pool.find((w: any) => batch.washerId && String(w.id) === String(batch.washerId) && (batch.machineMode !== 'LG_24' || isLargeWasher(w)));
    const usedIds = cycles.map((c: any) => c.washer_id).filter(Boolean);
    const washer =
      preferred ||
      suggestWasher(Number(batch.qty) || capacityOf(batch.machineMode), pool, batch.machineMode, usedIds) ||
      pool.find((w: any) => !usedIds.includes(w.id) && Number(w.capacity_kg) === drum && String(w.status || 'IDLE') === 'IDLE') ||
      pool.find((w: any) => !usedIds.includes(w.id) && isWasherIdle(w)) ||
      pool.find((w: any) => Number(w.capacity_kg) === drum);

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
        machine_tag: batch.machineTag,
        split_weight_kg: batch.qty,
        batch_total: batch.batchTotal || batches.length
      },
      {
        washer_id: washer?.id || null,
        order_id: opts.orderId,
        cycle_type: 'WASH',
        status,
        batch_index: batch.batchIndex,
        bag_label: batch.bagLabel,
        machine_tag: batch.machineTag,
        split_weight_kg: batch.qty
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
  const now = new Date().toISOString();
  if (opts.cycleId) {
    await updateWithFallback(
      'washer_cycle_logs',
      [
        { status: 'RUNNING', started_at: now, started_by_user_id: actor },
        { status: 'RUNNING', started_at: now },
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

export async function completeWasherCycles(opts: {
  db?: Db;
  cycleId?: string | null;
  washerId?: string | null;
}) {
  const db = opts.db;
  if (!db) return { error: { message: 'DB kosong' } };
  const now = new Date();
  const nowIso = now.toISOString();
  let rows: any[] = [];
  if (opts.cycleId) {
    const { data } = await db.from('washer_cycle_logs').select('*').eq('id', opts.cycleId).limit(1);
    rows = data || [];
  } else if (opts.washerId) {
    const { data } = await db
      .from('washer_cycle_logs')
      .select('*')
      .eq('washer_id', opts.washerId)
      .eq('status', 'RUNNING');
    rows = data || [];
  }
  for (const row of rows) {
    const started = Date.parse(String(row.started_at || row.created_at || ''));
    const mins = Number.isFinite(started) ? Math.max(1, Math.round((now.getTime() - started) / 60000)) : null;
    await updateWithFallback(
      'washer_cycle_logs',
      [
        { status: 'COMPLETED', completed_at: nowIso, duration_minutes: mins },
        { status: 'COMPLETED', completed_at: nowIso },
        { status: 'COMPLETED' }
      ],
      { column: 'id', value: row.id }
    );
  }
  if (opts.washerId) {
    await updateWithFallback(
      'washers',
      [
        { status: 'IDLE', current_order_id: null },
        { status: 'IDLE' }
      ],
      { column: 'id', value: opts.washerId }
    );
  }
  return { error: null, completed: rows.length };
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
