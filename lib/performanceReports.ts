import { isOrderFinished } from '@/lib/customerActivity';
import { displayItemAmount, isKiloanItem, kiloanWeightOf } from '@/lib/kiloanPrice';
import { crmPhoneKey } from '@/lib/crm';
import { stageKeyOf } from '@/lib/stageTimeline';
import { supabase } from '@/lib/supabaseClient';
import { isVoidTransaction } from '@/lib/voidTx';

export const MONTHS_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember'
];

export type PeriodMode = 'bulan' | 'periode';
export type QtyKind = 'kiloan' | 'satuan' | 'luas';

export type PeriodFilter = {
  mode: PeriodMode;
  month: number;
  year: number;
  from: string;
  to: string;
  outletId: string;
};

export const defaultPeriodFilter = (): PeriodFilter => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  const last = new Date(y, m + 1, 0).getDate();
  return {
    mode: 'bulan',
    month: m,
    year: y,
    from: `${y}-${pad(m + 1)}-01`,
    to: `${y}-${pad(m + 1)}-${pad(last)}`,
    outletId: 'ALL'
  };
};

export const periodBounds = (f: PeriodFilter) => {
  if (f.mode === 'periode' && f.from && f.to) {
    const start = new Date(`${f.from}T00:00:00`);
    const end = new Date(`${f.to}T23:59:59.999`);
    return { start, end };
  }
  const start = new Date(f.year, f.month, 1);
  const end = new Date(f.year, f.month + 1, 0, 23, 59, 59, 999);
  return { start, end };
};

export const periodLabel = (f: PeriodFilter) => {
  if (f.mode === 'periode') return `${f.from || '—'} s/d ${f.to || '—'}`;
  return `${MONTHS_ID[f.month] || ''} , ${f.year}`;
};

export const inPeriod = (iso: string | null | undefined, f: PeriodFilter) => {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const { start, end } = periodBounds(f);
  return d.getTime() >= start.getTime() && d.getTime() <= end.getTime();
};

export const eachDay = (f: PeriodFilter) => {
  const { start, end } = periodBounds(f);
  const days: Date[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cur.getTime() <= last.getTime() && days.length < 62) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
};

const matchOutlet = (row: { outlet_id?: string | null }, outletId: string) =>
  outletId === 'ALL' || String(row.outlet_id || '') === outletId;

export const parseItems = (raw: unknown): any[] => {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

export const isLuasName = (name: string) =>
  /karpet|carpet|gordyn|gorden|curtain|luas|\bm2\b|m²|meter\s*persegi/.test(String(name || '').toLowerCase());

export const isExpressTx = (tx: any) =>
  /express|ekspres|one\s*day|oneday|quick|kilat|1\s*hari/.test(
    `${tx?.duration || ''} ${tx?.service_type || ''}`
  );

export const classifyLine = (item: any, fallbackName = ''): QtyKind => {
  const name = String(item?.name || item?.service_type || fallbackName || '');
  if (isLuasName(name)) return 'luas';
  const unit = String(item?.type || item?.unit || '').toLowerCase();
  if (unit === 'pcs' || unit === 'satuan' || unit === 'item') return 'satuan';
  if (unit === 'kg' || unit === 'kiloan') return 'kiloan';
  if (kiloanWeightOf(item) > 0 || isKiloanItem(item)) return 'kiloan';
  return 'satuan';
};

export type QtyBag = { kg: number; pcs: number; m2: number; amount: number };

export const emptyQty = (): QtyBag => ({ kg: 0, pcs: 0, m2: 0, amount: 0 });

export const addQty = (a: QtyBag, b: Partial<QtyBag>): QtyBag => ({
  kg: a.kg + (Number(b.kg) || 0),
  pcs: a.pcs + (Number(b.pcs) || 0),
  m2: a.m2 + (Number(b.m2) || 0),
  amount: a.amount + (Number(b.amount) || 0)
});

const lineQty = (item: any, fallbackName: string, fallbackAmount: number): QtyBag => {
  const kind = classifyLine(item, fallbackName);
  const amount = displayItemAmount(item) || fallbackAmount;
  if (kind === 'luas') {
    const m2 = Number(item?.qty ?? item?.pcs ?? item?.area ?? item?.m2) || 1;
    return { kg: 0, pcs: 0, m2, amount };
  }
  if (kind === 'kiloan') {
    return { kg: kiloanWeightOf(item) || Number(item?.qty) || 0, pcs: 0, m2: 0, amount };
  }
  return { kg: 0, pcs: Number(item?.qty ?? item?.pcs) || 1, m2: 0, amount };
};

export type SplitQty = {
  kiloan: QtyBag;
  satuan: QtyBag;
  luas: QtyBag;
};

export const emptySplit = (): SplitQty => ({ kiloan: emptyQty(), satuan: emptyQty(), luas: emptyQty() });

export const qtyOfTransaction = (tx: any): QtyBag => {
  const split = splitQtyOfTransaction(tx);
  return addQty(addQty(split.kiloan, split.satuan), split.luas);
};

export const splitQtyOfTransaction = (tx: any): SplitQty => {
  const items = parseItems(tx?.items);
  const out = emptySplit();
  if (items.length) {
    items.forEach((item) => {
      const q = lineQty(item, tx?.service_type, 0);
      const kind = classifyLine(item, tx?.service_type);
      out[kind] = addQty(out[kind], q);
    });
    return out;
  }
  const name = String(tx?.service_type || '');
  const amount = Number(tx?.amount) || 0;
  if (isLuasName(name)) {
    out.luas = { kg: 0, pcs: 0, m2: Number(tx?.pcs_count) || 1, amount };
    return out;
  }
  const kg = Number(tx?.weight_kg) || 0;
  const pcs = Number(tx?.pcs_count) || 0;
  if (kg > 0 && pcs > 0) {
    out.kiloan = { kg, pcs: 0, m2: 0, amount: Math.round(amount / 2) };
    out.satuan = { kg: 0, pcs, m2: 0, amount: amount - out.kiloan.amount };
    return out;
  }
  if (kg > 0) out.kiloan = { kg, pcs: 0, m2: 0, amount };
  else if (pcs > 0) out.satuan = { kg: 0, pcs, m2: 0, amount };
  else out.kiloan = { kg: 0, pcs: 0, m2: 0, amount };
  return out;
};

export const isDeletedNota = (tx: any) =>
  isVoidTransaction(tx) || Boolean(tx?.delete_requested) || String(tx?.status || '').toLowerCase().includes('hapus');

export const isCollectedNota = (tx: any) => {
  if (isDeletedNota(tx)) return false;
  if (isOrderFinished(tx)) return true;
  return stageKeyOf(tx?.status) === 'selesai';
};

export const isDeliveredNota = (tx: any) => {
  if (!isCollectedNota(tx)) return false;
  const t = String(tx?.order_type || '').toLowerCase();
  return t.includes('online') || t.includes('delivery') || t.includes('antar');
};

export type PerformanceBundle = {
  outlets: { id: string; name: string }[];
  txs: any[];
  allTxs: any[];
  mems: any[];
  exps: any[];
  employees: any[];
  logs: any[];
  services: any[];
  outletOverrides: Record<string, any>;
};

const safeJson = (raw: unknown, fallback: any) => {
  if (!raw) return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
};

export async function loadPerformanceBundle(): Promise<PerformanceBundle> {
  const outletsRes = await supabase.from('outlets').select('id, name').order('name');
  const empRes = await supabase.from('employees').select('id, name, role, outlet_id, username, phone, whatsapp, outlets(name)');
  const empFallback =
    empRes.error
      ? await supabase.from('employees').select('id, name, role, outlet_id, username')
      : empRes;

  const txFull = await supabase
    .from('transactions')
    .select(
      'id, outlet_id, amount, delivery_fee, order_type, service_type, duration, customer_name, customer_phone, receipt_number, created_at, status, items, weight_kg, pcs_count, payment_method, discount_amount, delete_requested, by_sortir'
    )
    .order('created_at', { ascending: false })
    .limit(8000);
  const txRes = txFull.error
    ? await supabase
        .from('transactions')
        .select(
          'id, outlet_id, amount, delivery_fee, order_type, service_type, customer_name, customer_phone, receipt_number, created_at, status, weight_kg, pcs_count'
        )
        .order('created_at', { ascending: false })
        .limit(8000)
    : txFull;

  const [mems, exps, logs, settings] = await Promise.all([
    supabase.from('membership_logs').select('id, outlet_id, price, package_name, customer_phone, order_type, created_at').limit(4000),
    supabase.from('expenses').select('id, outlet_id, amount, category, description, created_at').limit(4000),
    supabase
      .from('work_logs')
      .select('id, transaction_id, employee_name, stage, service_type, weight_kg, pcs_count, created_at')
      .order('created_at', { ascending: false })
      .limit(8000),
    supabase.from('app_settings').select('dynamic_services, outlet_overrides').eq('id', 1).maybeSingle()
  ]);

  return {
    outlets: outletsRes.data || [],
    services: safeJson(settings.data?.dynamic_services, []),
    outletOverrides: safeJson(settings.data?.outlet_overrides, {}),
    txs: txRes.data || [],
    allTxs: txRes.data || [],
    mems: mems.data || [],
    exps: exps.data || [],
    employees: empFallback.data || [],
    logs: logs.data || []
  };
}

export const scopedTxs = (bundle: PerformanceBundle, f: PeriodFilter, includeDeleted = false) =>
  bundle.txs.filter((t) => inPeriod(t.created_at, f) && matchOutlet(t, f.outletId) && (includeDeleted || !isDeletedNota(t)));

export const scopedMems = (bundle: PerformanceBundle, f: PeriodFilter) =>
  bundle.mems.filter((m) => inPeriod(m.created_at, f) && matchOutlet(m, f.outletId));

export const scopedExps = (bundle: PerformanceBundle, f: PeriodFilter) =>
  bundle.exps.filter((e) => inPeriod(e.created_at, f) && matchOutlet(e, f.outletId));

export const scopedLogs = (bundle: PerformanceBundle, f: PeriodFilter) => {
  const txIds = new Set(scopedTxs(bundle, f, true).map((t) => String(t.id)));
  return bundle.logs.filter((l) => {
    if (inPeriod(l.created_at, f)) {
      if (f.outletId === 'ALL') return true;
      const tx = bundle.txs.find((t) => String(t.id) === String(l.transaction_id));
      return tx ? matchOutlet(tx, f.outletId) : false;
    }
    return txIds.has(String(l.transaction_id || ''));
  });
};

export const idr = (n: number) => `Rp ${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;
export const qtyFmt = (n: number, digits = 0) =>
  (Number(n) || 0).toLocaleString('id-ID', { maximumFractionDigits: digits, minimumFractionDigits: digits });

export type RevenueDay = { day: number; label: string; kiloan: number; satuan: number; luas: number };

export function revenueByDay(bundle: PerformanceBundle, f: PeriodFilter) {
  const days = eachDay(f);
  const series: RevenueDay[] = days.map((d) => ({
    day: d.getDate(),
    label: String(d.getDate()),
    kiloan: 0,
    satuan: 0,
    luas: 0
  }));
  const totals = { kiloan: emptyQty(), satuan: emptyQty(), luas: emptyQty(), fee: 0, omset: 0 };
  scopedTxs(bundle, f).forEach((tx) => {
    const d = new Date(tx.created_at);
    const idx = days.findIndex(
      (x) => x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth() && x.getDate() === d.getDate()
    );
    const split = splitQtyOfTransaction(tx);
    const amount = Number(tx.amount) || split.kiloan.amount + split.satuan.amount + split.luas.amount;
    totals.omset += amount;
    totals.fee += Number(tx.delivery_fee) || 0;
    totals.kiloan = addQty(totals.kiloan, split.kiloan);
    totals.satuan = addQty(totals.satuan, split.satuan);
    totals.luas = addQty(totals.luas, split.luas);
    if (idx >= 0) {
      series[idx].kiloan += split.kiloan.amount;
      series[idx].satuan += split.satuan.amount;
      series[idx].luas += split.luas.amount;
    }
  });
  const dayCount = Math.max(1, days.length);
  return { series, totals, dayCount };
}

export function costByItem(bundle: PerformanceBundle, f: PeriodFilter) {
  const days = eachDay(f);
  const map = new Map<string, { name: string; total: number; points: number[] }>();
  scopedExps(bundle, f).forEach((e) => {
    const name = String(e.category || e.description || 'Lainnya').trim() || 'Lainnya';
    if (!map.has(name)) map.set(name, { name, total: 0, points: days.map(() => 0) });
    const row = map.get(name)!;
    const amt = Number(e.amount) || 0;
    row.total += amt;
    const d = new Date(e.created_at);
    const idx = days.findIndex(
      (x) => x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth() && x.getDate() === d.getDate()
    );
    if (idx >= 0) row.points[idx] += amt;
  });
  return {
    days: days.map((d) => String(d.getDate())),
    items: [...map.values()].sort((a, b) => b.total - a.total).slice(0, 8)
  };
}

export function serviceRows(bundle: PerformanceBundle, f: PeriodFilter) {
  const map = new Map<string, { name: string; outlet: string; qty: string; qtyNum: number; total: number }>();
  scopedTxs(bundle, f).forEach((tx) => {
    const outlet = bundle.outlets.find((o) => o.id === tx.outlet_id)?.name || 'Outlet';
    const items = parseItems(tx.items);
    const rows = items.length
      ? items.map((item) => {
          const q = lineQty(item, tx.service_type, 0);
          const name = String(item.name || tx.service_type || 'Layanan');
          const unit = q.m2 ? `${qtyFmt(q.m2, 1)} M²` : q.kg ? `${qtyFmt(q.kg, 1)} KG` : `${qtyFmt(q.pcs)} PCS`;
          return { name, outlet, unit, qtyNum: q.m2 || q.kg || q.pcs, total: q.amount || 0 };
        })
      : [
          (() => {
            const q = qtyOfTransaction(tx);
            const unit = q.m2 ? `${qtyFmt(q.m2, 1)} M²` : q.kg ? `${qtyFmt(q.kg, 1)} KG` : `${qtyFmt(q.pcs || 1)} PCS`;
            return {
              name: String(tx.service_type || 'Layanan'),
              outlet,
              unit,
              qtyNum: q.m2 || q.kg || q.pcs || 1,
              total: Number(tx.amount) || 0
            };
          })()
        ];
    rows.forEach((r) => {
      const key = `${r.name}::${r.outlet}`;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, { name: r.name, outlet: r.outlet, qty: r.unit, qtyNum: r.qtyNum, total: r.total });
        return;
      }
      prev.qtyNum += r.qtyNum;
      prev.total += r.total;
      const kind = prev.qty.includes('M²') ? 'M²' : prev.qty.includes('KG') ? 'KG' : 'PCS';
      prev.qty = `${qtyFmt(prev.qtyNum, kind === 'PCS' ? 0 : 1)} ${kind}`;
    });
  });
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, 50);
}

export function outletStats(bundle: PerformanceBundle, f: PeriodFilter) {
  const live = scopedTxs(bundle, f);
  const deleted = bundle.txs.filter((t) => inPeriod(t.created_at, f) && matchOutlet(t, f.outletId) && isDeletedNota(t));
  const qty = live.reduce((acc, tx) => addQty(acc, qtyOfTransaction(tx)), emptyQty());
  const regular = live.filter((t) => !String(t.payment_method || '').toLowerCase().includes('deposit'));
  const depositPay = live.filter((t) => String(t.payment_method || '').toLowerCase().includes('deposit'));
  const mems = scopedMems(bundle, f);
  const topup = mems.filter((m) => /top\s*up|deposit/i.test(String(m.package_name || '')));
  const memberReg = mems.filter((m) => !/top\s*up|deposit/i.test(String(m.package_name || '')));
  const regularAmt = regular.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const depositAmt =
    depositPay.reduce((s, t) => s + (Number(t.amount) || 0), 0) + topup.reduce((s, m) => s + (Number(m.price) || 0), 0);
  const memberAmt = memberReg.reduce((s, m) => s + (Number(m.price) || 0), 0);

  const expressAll = live.filter(isExpressTx);
  const normalAll = live.filter((t) => !isExpressTx(t));
  const expressDone = expressAll.filter(isCollectedNota);
  const normalDone = normalAll.filter(isCollectedNota);
  const delivered = live.filter(isDeliveredNota);
  const deliveredAll = live.filter((t) => {
    const typ = String(t.order_type || '').toLowerCase();
    return typ.includes('online') || typ.includes('delivery') || typ.includes('antar');
  });

  const collected = live.filter(isCollectedNota);
  const phones = live.map((t) => crmPhoneKey(t.customer_phone)).filter(Boolean);
  const unique = new Set(phones);
  const { start } = periodBounds(f);
  const prior = new Set(
    bundle.allTxs
      .filter((t) => {
        const d = new Date(t.created_at);
        return !Number.isNaN(d.getTime()) && d.getTime() < start.getTime() && matchOutlet(t, f.outletId);
      })
      .map((t) => crmPhoneKey(t.customer_phone))
      .filter(Boolean)
  );
  let returning = 0;
  unique.forEach((p) => {
    if (prior.has(p)) returning += 1;
  });
  const fresh = Math.max(0, unique.size - returning);

  return {
    qty,
    omzet: {
      regularCount: regular.length,
      regularAmt,
      depositCount: depositPay.length + topup.length,
      depositAmt,
      memberCount: memberReg.length,
      memberAmt,
      nota: live.length,
      total: regularAmt + depositAmt + memberAmt
    },
    work: {
      delivered: delivered.length,
      deliveredAll: deliveredAll.length,
      normalDone: normalDone.length,
      normalAll: normalAll.length,
      expressDone: expressDone.length,
      expressAll: expressAll.length
    },
    visits: { total: unique.size, fresh, returning },
    deleted: {
      total: deleted.length,
      regular: deleted.filter((t) => !String(t.payment_method || '').toLowerCase().includes('deposit')).length,
      deposit: deleted.filter((t) => String(t.payment_method || '').toLowerCase().includes('deposit')).length
    },
    collected: {
      total: collected.length,
      regular: collected.filter((t) => !String(t.payment_method || '').toLowerCase().includes('deposit')).length,
      deposit: collected.filter((t) => String(t.payment_method || '').toLowerCase().includes('deposit')).length
    },
    lists: {
      regular,
      deposit: [...depositPay, ...topup],
      member: memberReg,
      deleted,
      collected,
      delivered,
      normalDone,
      expressDone
    }
  };
}

const STAFF_STAGES = [
  { key: 'sortir', label: 'Sortir', tone: 'bg-orange-100 text-orange-700' },
  { key: 'cuci', label: 'Cuci', tone: 'bg-emerald-100 text-emerald-700' },
  { key: 'kering', label: 'Kering', tone: 'bg-green-200 text-green-800' },
  { key: 'setrika', label: 'Setrika', tone: 'bg-teal-100 text-teal-800' },
  { key: 'packing', label: 'Pengemasan', tone: 'bg-sky-100 text-sky-700' },
  { key: 'finishing', label: 'Finishing', tone: 'bg-blue-100 text-blue-700' }
] as const;

const finishingKey = (key: string) => key === 'siap' || key === 'selesai' || key === 'finishing';

export function employeePhoneOf(emp: any) {
  return String(emp?.phone || emp?.whatsapp || (/^0|62/.test(String(emp?.username || '')) ? emp.username : '') || '—');
}

const PAID_KEYS = ['sortir', 'cuci', 'kering', 'setrika', 'packing'];

export function productionWageOf(log: any, bundle: PerformanceBundle, outletId?: string) {
  const stageKey = stageKeyOf(log?.stage);
  if (!PAID_KEYS.includes(stageKey)) return 0;
  const svcName = String(log?.service_type || '').trim().toLowerCase();
  const services = Array.isArray(bundle.services) ? bundle.services : [];
  const svcDef = services.find((s: any) => String(s?.name || '').trim().toLowerCase() === svcName);
  if (!svcDef) return 0;
  const tx = bundle.txs.find((t) => String(t.id) === String(log.transaction_id));
  const oid = String(outletId || tx?.outlet_id || '');
  const comms =
    bundle.outletOverrides?.[oid]?.[svcDef.id]?.commissions ||
    svcDef.commissions ||
    {};
  const matched = Object.keys(comms).find((k) => k.toLowerCase() === stageKey);
  const commVal = Number(matched ? comms[matched] : 0) || 0;
  const kg = Number(log.weight_kg) || 0;
  const pcs = Number(log.pcs_count) || 0;
  const unit = String(svcDef.type || '').toLowerCase() === 'pcs' || isLuasName(svcDef.name) ? pcs : kg;
  return Math.round(unit * commVal);
}

export function employeePerf(bundle: PerformanceBundle, f: PeriodFilter, emp: any, paidOnly: boolean) {
  const name = String(emp?.name || '').trim().toLowerCase();
  const logs = scopedLogs(bundle, f).filter((l) => String(l.employee_name || '').trim().toLowerCase() === name);
  const cashierTxs = scopedTxs(bundle, f).filter(
    (t) => String(t.by_sortir || '').trim().toLowerCase() === name
  );
  const usedLogs = paidOnly
    ? logs.filter((l) => PAID_KEYS.includes(stageKeyOf(l.stage)))
    : logs;
  const txIds = new Set(usedLogs.map((l) => String(l.transaction_id || '')).filter(Boolean));
  cashierTxs.forEach((t) => txIds.add(String(t.id)));
  const related = bundle.txs.filter((t) => txIds.has(String(t.id)));
  const services = new Set(usedLogs.map((l) => String(l.service_type || '').trim()).filter(Boolean));
  related.forEach((t) => {
    if (t.service_type) services.add(String(t.service_type));
  });
  const qty = related.reduce((acc, tx) => addQty(acc, qtyOfTransaction(tx)), emptyQty());
  const outletHint = String(emp?.outlet_id || '');
  const stageRows = STAFF_STAGES.map((row) => {
    const rows = usedLogs.filter((l) => {
      const k = stageKeyOf(l.stage);
      return row.key === 'finishing' ? finishingKey(k) : k === row.key;
    });
    const kg = rows.reduce((s, l) => s + (Number(l.weight_kg) || 0), 0);
    const pcs = rows.reduce((s, l) => s + (Number(l.pcs_count) || 0), 0);
    const luas = rows.reduce((s, l) => s + (isLuasName(String(l.service_type || '')) ? Number(l.pcs_count) || 0 : 0), 0);
    const wage = rows.reduce((s, l) => s + productionWageOf(l, bundle, outletHint), 0);
    return { ...row, kg, m2: luas, pcs, load: 0, wage };
  });
  const wage = usedLogs.reduce((s, l) => s + productionWageOf(l, bundle, outletHint), 0);
  return {
    nota: txIds.size,
    stages: usedLogs.length,
    layanan: services.size,
    nominal: related.reduce((s, t) => s + (Number(t.amount) || 0), 0),
    wage,
    qty,
    stageRows,
    logs: usedLogs
  };
}
