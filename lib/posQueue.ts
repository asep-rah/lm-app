import { stageKeyOf } from '@/lib/stageTimeline';

export function parseOrderItems(raw: unknown): any[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') return [];
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const itemStatuses = (order: any): string[] => {
  const items = parseOrderItems(order?.items);
  if (items.length === 0) return [String(order?.status || '')];
  return items.map((it) => String(it?.status || order?.status || ''));
};

export const isHandoverDoneStatus = (status: any) => stageKeyOf(status) === 'selesai';
export const isReadyPickupStatus = (status: any) => stageKeyOf(status) === 'siap';

export const isProductionStatus = (status: any) => {
  const key = stageKeyOf(status);
  return key !== 'siap' && key !== 'selesai';
};

export type QueueBucket = 'proses' | 'ambil' | 'selesai';

/** Proses = masih produksi. Ambil = semua item sudah packing+racking. Selesai = sudah diserahkan/diantar. */
export const classifyQueueOrder = (order: any): QueueBucket => {
  if (isHandoverDoneStatus(order?.status)) return 'selesai';
  const statuses = itemStatuses(order);
  if (statuses.some(isProductionStatus)) return 'proses';
  if (statuses.every((s) => isReadyPickupStatus(s) || isHandoverDoneStatus(s))) return 'ambil';
  return 'proses';
};

export const slaDueMs = (order: any, now = Date.now()): number => {
  const created = new Date(order?.created_at || now).getTime();
  const base = Number.isFinite(created) ? created : now;
  const dur = String(order?.duration || '').toLowerCase();
  let hours = 72;
  if (dur.includes('3 jam') || dur.includes('quick')) hours = 3;
  else if (dur.includes('6 jam') || dur.includes('express')) hours = 6;
  else if (dur.includes('1 hari') || dur.includes('oneday') || dur.includes('24 jam')) hours = 24;
  return base + hours * 3600000;
};

export const isExpressDuration = (duration: any) => {
  const d = String(duration || '').toLowerCase();
  return d.includes('express') || d.includes('quick') || d.includes('6 jam') || d.includes('3 jam');
};

export const slaRemainingLabel = (due: number, now = Date.now()) => {
  const diff = due - now;
  const absH = Math.max(0, Math.round(Math.abs(diff) / 3600000));
  const absD = Math.max(0, Math.round(Math.abs(diff) / 86400000));
  if (diff < 0) {
    return { overdue: true, label: absH < 24 ? `Terlambat ${absH} jam` : `Terlambat ${absD} hari` };
  }
  return { overdue: false, label: absH < 24 ? `SLA ${absH} jam lagi` : `SLA ${absD} hari lagi` };
};

export const sortProsesBySla = (orders: any[], now = Date.now()) =>
  [...orders].sort((a, b) => slaDueMs(a, now) - slaDueMs(b, now));

/** Satu kartu induk per transaksi/resi. Item tidak dipecah jadi kartu terpisah. */
export const coalesceProsesCards = (orders: any[]): any[] => {
  const byId = new Map<string, any>();
  for (const o of orders || []) {
    const id = String(o?.id || '');
    if (!id || byId.has(id)) continue;
    byId.set(id, { ...o, items: parseOrderItems(o.items) });
  }
  const byResi = new Map<string, any>();
  for (const o of byId.values()) {
    const resi = String(o.receipt_number || o.id);
    const existing = byResi.get(resi);
    if (!existing) {
      byResi.set(resi, o);
      continue;
    }
    const mergedItems = [...parseOrderItems(existing.items), ...parseOrderItems(o.items)];
    byResi.set(resi, {
      ...existing,
      items: mergedItems,
      weight_kg: Number(existing.weight_kg || 0) + Number(o.weight_kg || 0),
      pcs_count: Number(existing.pcs_count || 0) + Number(o.pcs_count || 0)
    });
  }
  return [...byResi.values()];
};

export const formatEstSelesai = (order: any) => {
  const due = slaDueMs(order);
  const d = new Date(due);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

export const formatTrxId = (order: any) => {
  const raw = String(order?.receipt_number || order?.order_number || '').trim();
  if (raw) return raw;
  const tail = String(order?.id || '').replace(/-/g, '').slice(-6).toUpperCase();
  return tail ? `TRX-${tail}` : 'TRX------';
};

const searchHaystack = (order: any) => {
  const items = parseOrderItems(order?.items);
  const itemNames = items.map((it) => it?.name || it?.service_type || '').join(' ');
  return [
    order?.customer_name,
    order?.customer_phone,
    order?.phone_number,
    order?.receipt_number,
    order?.id,
    order?.service_type,
    order?.service_name,
    itemNames
  ]
    .map((v) => String(v || '').toLowerCase())
    .join(' ');
};

export const matchesQueueSearch = (order: any, query: string) => {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return searchHaystack(order).includes(q);
};

export const rackDisplay = (order: any) => {
  const items = parseOrderItems(order?.items);
  const locs = items.map((it) => it?.rack_location || it?.rack_number).filter(Boolean);
  const pkgs = items.map((it) => it?.package_count).filter(Boolean);
  const loc =
    (locs.length ? Array.from(new Set(locs)).join(', ') : null) ||
    order?.rack_location ||
    order?.rack_number ||
    '-';
  const pkg =
    (pkgs.length ? pkgs.join(' + ') : null) ||
    order?.package_count ||
    (order?.bag_count ? `${order.bag_count} Pack` : '-');
  const notes =
    items.map((it) => it?.rack_notes).filter(Boolean).join(' · ') ||
    order?.rack_notes ||
    '';
  return { loc: String(loc), pkg: String(pkg), notes: String(notes) };
};

export const parseBagCount = (packageCount: string) => {
  const m = String(packageCount || '').match(/\d+/);
  const n = m ? parseInt(m[0], 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 1;
};
