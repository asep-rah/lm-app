import { isVoidTransaction } from '@/lib/voidTx';
import { isTaskCompleted, isTaskOverdueOpen } from '@/lib/taskRoles';

export type CopilotPeriod = 'THIS_MONTH' | 'LAST_MONTH' | 'THIS_YEAR' | 'ALL';

export type CopilotMetrics = {
  grossRevenue: number;
  opex: number;
  opexRatio: number;
  netProfit: number;
  txCount: number;
  aov: number;
  uniqueCustomers: number;
  repeatRate: number;
  washFrequencyDays: number;
  slaScore: number;
  slaOpenOverdue: number;
  slaCompleted: number;
  peakHour: number | null;
  peakHourLabel: string;
  peakHours: { hour: number; count: number }[];
  serviceMix: { name: string; count: number; share: number }[];
};

export type CopilotInsight = {
  title: string;
  body: string;
  tone: 'ok' | 'warn' | 'info';
};

export type PassiveCustomer = {
  name: string;
  phone: string;
  lastVisit: string;
  daysSince: number;
  visits: number;
  aov: number;
  waUrl: string;
  draft: string;
};

export type GrowthBullet = {
  title: string;
  body: string;
  offer?: string;
};

export type GrowthAction = {
  id: string;
  title: string;
  detail: string;
  impact: string;
};

export type TransactionGrowthReport = {
  metrics: CopilotMetrics;
  summary: string;
  insights: CopilotInsight[];
  patterns: GrowthBullet[];
  crossSell: GrowthBullet[];
  winBack: PassiveCustomer[];
  actions: GrowthAction[];
  source: 'rules' | 'ai';
};

export const periodRangeOf = (period: CopilotPeriod, now = new Date()) => {
  const end = new Date(now);
  const start = new Date(now);
  if (period === 'THIS_MONTH') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'LAST_MONTH') {
    start.setMonth(start.getMonth() - 1, 1);
    start.setHours(0, 0, 0, 0);
    end.setDate(1);
    end.setHours(0, 0, 0, 0);
  } else if (period === 'THIS_YEAR') {
    start.setTime(end.getTime() - 365 * 24 * 60 * 60 * 1000);
  } else {
    start.setTime(0);
  }
  return { start, end };
};

export const inPeriod = (raw: unknown, start: Date, end: Date) => {
  const t = new Date(String(raw || '')).getTime();
  if (Number.isNaN(t)) return false;
  return t >= start.getTime() && t < end.getTime();
};

export const parseIdList = (raw: unknown): string[] => {
  if (!raw) return [];
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(v)) return v.map((x) => String(x || '').trim()).filter(Boolean);
  } catch {
    /* ignore */
  }
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

/** null = semua cabang; [] = supervisor tanpa cabang terpetakan. */
export function resolveScopedOutletIds(opts: {
  scope?: string;
  outletId?: string | null;
  accessOutlets?: unknown;
  supervisorName?: string;
  mapping?: Record<string, string>;
}): string[] | null {
  const single = String(opts.outletId || '').trim();
  const access = parseIdList(opts.accessOutlets);
  if (String(opts.scope || '').toLowerCase() === 'supervisor') {
    const want = String(opts.supervisorName || '').toLowerCase().trim();
    const fromMap = Object.entries(opts.mapping || {})
      .filter(([, name]) => String(name || '').toLowerCase().trim() === want && want)
      .map(([id]) => id);
    return Array.from(
      new Set([...access, ...fromMap, ...(single && single !== 'ALL' ? [single] : [])])
    );
  }
  if (single && single !== 'ALL') return [single];
  return access.length ? access : null;
}

export const idr = (n: number) => `Rp ${Math.round(n || 0).toLocaleString('id-ID')}`;

export const waDigits = (phone?: string) => {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0')) d = `62${d.slice(1)}`;
  if (d.startsWith('8')) d = `62${d}`;
  return d;
};

export const waPromoUrl = (phone: string, text: string) => {
  const d = waDigits(phone);
  if (!d) return '';
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
};

const phoneKey = (row: any) => String(row?.customer_phone || row?.phone || '').replace(/\D/g, '');

const serviceNameOf = (row: any) =>
  String(row?.service_type || row?.service || row?.package_name || 'Layanan').trim() || 'Layanan';

const isShoe = (s: string) => /sepatu|shoe/i.test(s);
const isBedcover = (s: string) => /bedcover|bed cover|selimut|sprei/i.test(s);
const isExpress = (s: string) => /express|kilat|1 hari|satu hari/i.test(s);

export function buildCopilotMetrics(
  txs: any[],
  expenses: any[],
  tasks: any[]
): CopilotMetrics {
  const live = (txs || []).filter((t) => !isVoidTransaction(t));
  const grossRevenue = live.reduce((s, t) => s + (Number(t.amount ?? t.price) || 0), 0);
  const opex = (expenses || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const txCount = live.length;
  const aov = txCount ? grossRevenue / txCount : 0;

  const byPhone = new Map<string, Date[]>();
  live.forEach((t) => {
    const k = phoneKey(t);
    if (!k) return;
    const list = byPhone.get(k) || [];
    list.push(new Date(t.created_at));
    byPhone.set(k, list);
  });
  const uniqueCustomers = byPhone.size;
  let repeats = 0;
  let gapSum = 0;
  let gapN = 0;
  byPhone.forEach((dates) => {
    const sorted = dates.filter((d) => !Number.isNaN(d.getTime())).sort((a, b) => a.getTime() - b.getTime());
    if (sorted.length >= 2) repeats += 1;
    for (let i = 1; i < sorted.length; i += 1) {
      gapSum += (sorted[i].getTime() - sorted[i - 1].getTime()) / 86400000;
      gapN += 1;
    }
  });
  const repeatRate = uniqueCustomers ? (repeats / uniqueCustomers) * 100 : 0;
  const washFrequencyDays = gapN ? gapSum / gapN : 0;

  const hourCounts = Array.from({ length: 24 }, () => 0);
  live.forEach((t) => {
    const d = new Date(t.created_at);
    if (!Number.isNaN(d.getTime())) hourCounts[d.getHours()] += 1;
  });
  let peakHour: number | null = null;
  let peakN = 0;
  hourCounts.forEach((n, h) => {
    if (n > peakN) {
      peakN = n;
      peakHour = h;
    }
  });
  const peakHours = hourCounts
    .map((count, hour) => ({ hour, count }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const mixMap = new Map<string, number>();
  live.forEach((t) => {
    const name = serviceNameOf(t);
    mixMap.set(name, (mixMap.get(name) || 0) + 1);
  });
  const serviceMix = Array.from(mixMap.entries())
    .map(([name, count]) => ({ name, count, share: txCount ? (count / txCount) * 100 : 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const taskList = tasks || [];
  const completed = taskList.filter((t) => isTaskCompleted(t.status)).length;
  const overdue = taskList.filter((t) => isTaskOverdueOpen(t)).length;
  const scored = completed + overdue;
  const slaScore = scored ? Math.max(0, Math.min(100, Math.round((completed / scored) * 100))) : 82;

  return {
    grossRevenue,
    opex,
    opexRatio: grossRevenue > 0 ? opex / grossRevenue : opex > 0 ? 1 : 0,
    netProfit: grossRevenue - opex,
    txCount,
    aov,
    uniqueCustomers,
    repeatRate,
    washFrequencyDays,
    slaScore,
    slaOpenOverdue: overdue,
    slaCompleted: completed,
    peakHour,
    peakHourLabel:
      peakHour == null ? 'Belum ada pola jam' : `${String(peakHour).padStart(2, '0')}:00–${String((peakHour + 1) % 24).padStart(2, '0')}:00`,
    peakHours,
    serviceMix
  };
}

export function buildPassiveCustomers(txs: any[], now = new Date()): PassiveCustomer[] {
  const live = (txs || []).filter((t) => !isVoidTransaction(t));
  const byPhone = new Map<string, any[]>();
  live.forEach((t) => {
    const k = phoneKey(t);
    if (k.length < 8) return;
    const list = byPhone.get(k) || [];
    list.push(t);
    byPhone.set(k, list);
  });

  const rows: PassiveCustomer[] = [];
  byPhone.forEach((list) => {
    const sorted = [...list].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    const last = sorted[0];
    const lastAt = new Date(last.created_at);
    if (Number.isNaN(lastAt.getTime())) return;
    const daysSince = Math.floor((now.getTime() - lastAt.getTime()) / 86400000);
    if (daysSince < 21) return;
    const spent = sorted.reduce((s, t) => s + (Number(t.amount ?? t.price) || 0), 0);
    const name = String(last.customer_name || 'Pelanggan').trim() || 'Pelanggan';
    const phone = String(last.customer_phone || '');
    const draft = `Halo ${name}, cucian Anda sudah ${daysSince} hari tidak masuk. Ada promo paket kiloan + Bedcover minggu ini di Laundrivery. Mau kami jemput hari ini?`;
    rows.push({
      name,
      phone,
      lastVisit: lastAt.toISOString(),
      daysSince,
      visits: sorted.length,
      aov: spent / sorted.length,
      waUrl: waPromoUrl(phone, draft),
      draft
    });
  });
  return rows.sort((a, b) => b.daysSince - a.daysSince).slice(0, 12);
}

export function buildGrowthReport(metrics: CopilotMetrics, txs: any[]): TransactionGrowthReport {
  const opexWarn = metrics.opexRatio >= 0.38;
  const insights: CopilotInsight[] = [
    {
      title: 'Ringkasan performa',
      body: `${metrics.txCount} transaksi · omset ${idr(metrics.grossRevenue)} · AOV ${idr(metrics.aov)} · repeat ${metrics.repeatRate.toFixed(0)}%.`,
      tone: 'info'
    },
    {
      title: opexWarn ? 'Peringatan efisiensi OPEX' : 'OPEX terkendali',
      body: opexWarn
        ? `Beban ${idr(metrics.opex)} sudah ${(metrics.opexRatio * 100).toFixed(0)}% dari omset. Tahan pengeluaran non-inti minggu ini.`
        : `OPEX ${idr(metrics.opex)} (${(metrics.opexRatio * 100).toFixed(0)}% omset). Ruang untuk promo retensi masih aman.`,
      tone: opexWarn ? 'warn' : 'ok'
    },
    {
      title: 'Skor SLA operasional',
      body:
        metrics.slaOpenOverdue > 0
          ? `Skor ${metrics.slaScore}/100 · ${metrics.slaOpenOverdue} tugas lewat SLA. Selesaikan dulu agar omset tidak tersendat di antrean.`
          : `Skor ${metrics.slaScore}/100. Antrean relatif sehat untuk mendorong upsell Express.`,
      tone: metrics.slaScore < 70 ? 'warn' : 'ok'
    }
  ];

  const freq =
    metrics.washFrequencyDays > 0
      ? `${metrics.washFrequencyDays.toFixed(1)} hari`
      : 'belum cukup data ulang';

  const patterns: GrowthBullet[] = [
    {
      title: 'Frekuensi cuci',
      body: `Pelanggan kembali rata-rata setiap ${freq}. Target ideal 10–14 hari — kirim reminder di hari ke-12.`
    },
    {
      title: 'Rata-rata keranjang (AOV)',
      body: `AOV ${idr(metrics.aov)} dari ${metrics.txCount} nota. Naikkan keranjang dengan add-on Bedcover atau Express di kasir.`
    },
    {
      title: 'Waktu puncak',
      body: `Jam tersibuk ${metrics.peakHourLabel}. Siapkan shift penuh dan tawarkan Express saat antrean sudah bergerak.`
    }
  ];

  const shoeShare = metrics.serviceMix.filter((s) => isShoe(s.name)).reduce((s, x) => s + x.share, 0);
  const bedShare = metrics.serviceMix.filter((s) => isBedcover(s.name)).reduce((s, x) => s + x.share, 0);
  const expShare = metrics.serviceMix.filter((s) => isExpress(s.name)).reduce((s, x) => s + x.share, 0);

  const crossSell: GrowthBullet[] = [
    {
      title: 'Paket Bedcover',
      body:
        bedShare < 8
          ? `Share Bedcover baru ${bedShare.toFixed(0)}%. Tawarkan bundling kiloan + Bedcover di weekend.`
          : `Bedcover sudah ${bedShare.toFixed(0)}% mix. Pertahankan bundle weekend.`,
      offer: 'Bundle Kiloan + Bedcover hemat 15% (weekend)'
    },
    {
      title: 'Cuci Sepatu',
      body:
        shoeShare < 5
          ? `Cuci Sepatu hampir tidak tampil (${shoeShare.toFixed(0)}%). Pasang tes di kasir: "Sepatu ikut dicuci?"`
          : `Cuci Sepatu ${shoeShare.toFixed(0)}% — naikkan dengan paket 2 pasang.`,
      offer: 'Cuci Sepatu 2 pasang + parfum'
    },
    {
      title: 'Express 1 Hari',
      body:
        expShare < 10
          ? `Express hanya ${expShare.toFixed(0)}%. Dorong di jam puncak ${metrics.peakHourLabel} untuk pelanggan buru-buru.`
          : `Express ${expShare.toFixed(0)}% sudah jalan. Jaga SLA agar janji 1 hari tidak pecah.`,
      offer: 'Upgrade Express 1 Hari (+fee kasir)'
    }
  ];

  const winBack = buildPassiveCustomers(txs);
  const lift = Math.round(winBack.length * Math.max(metrics.aov, 35000) * 0.45);

  const actions: GrowthAction[] = [
    {
      id: 'shift-peak',
      title: 'Perkuat shift jam puncak',
      detail: `Pastikan kasir + produksi penuh di ${metrics.peakHourLabel}. Jangan tolak kiloan karena antrean.`,
      impact: 'Cegah omset hilang di jam tersibuk'
    },
    {
      id: 'wa-winback',
      title: `Kirim promo WhatsApp ke ${winBack.length} pelanggan pasif`,
      detail: 'Gunakan draf win-back di tab retensi. Target yang >21 hari tidak cuci.',
      impact: `Potensi +${idr(lift)} minggu ini`
    },
    {
      id: 'bundle-bedcover',
      title: 'Aktifkan bundle Bedcover weekend',
      detail: 'Kasir wajib mention Bedcover pada setiap nota >3 kg di Jumat–Minggu.',
      impact: 'Naikkan AOV 8–15%'
    },
    {
      id: 'express-upsell',
      title: 'Script upsell Express 1 Hari',
      detail: 'Jika pelanggan datang sebelum 11.00, tawarkan Express sebelum input nota.',
      impact: 'Margin lebih tinggi per keranjang'
    }
  ];

  const summary = opexWarn
    ? `Omset ${idr(metrics.grossRevenue)} dengan OPEX tinggi (${(metrics.opexRatio * 100).toFixed(0)}%). Prioritas: retensi WhatsApp + tahan belanja, bukan diskon massal.`
    : `Omset ${idr(metrics.grossRevenue)}, AOV ${idr(metrics.aov)}, SLA ${metrics.slaScore}/100. Fokus naikkan keranjang (Bedcover/Express) dan tarik ${winBack.length} pelanggan pasif.`;

  return {
    metrics,
    summary,
    insights,
    patterns,
    crossSell,
    winBack,
    actions,
    source: 'rules'
  };
}

type Db = { from: (table: string) => any };

export async function loadAnalyticsBundle(
  db: Db,
  outletIds: string[] | null,
  period: CopilotPeriod
) {
  const { start, end } = periodRangeOf(period);
  const since = new Date(start.getTime() - 90 * 86400000).toISOString();

  const txSelect =
    'id, amount, created_at, customer_phone, customer_name, service_type, outlet_id, status, order_type';
  let txq = db.from('transactions').select(txSelect).gte('created_at', since).limit(4000);
  let memq = db.from('membership_logs').select('id, price, created_at, customer_phone, package_name, outlet_id, order_type').gte('created_at', since).limit(2000);
  let expq = db.from('expenses').select('id, amount, created_at, outlet_id, category').gte('created_at', since).limit(2000);
  const taskq = db.from('system_tasks').select('id, status, due_date, completed_at, assigned_to_role, outlet_id').limit(400);

  if (outletIds !== null && !outletIds.length) {
    return { txs: [], historyTxs: [], expenses: [], tasks: [], start, end };
  }
  if (outletIds && outletIds.length) {
    txq = txq.in('outlet_id', outletIds);
    memq = memq.in('outlet_id', outletIds);
    expq = expq.in('outlet_id', outletIds);
  }

  const settle = async (q: PromiseLike<{ data: any; error: any }>) => {
    try {
      const { data, error } = await q;
      if (error) return [];
      return data || [];
    } catch {
      return [];
    }
  };

  const [txRows, memRows, expRows, taskRows] = await Promise.all([settle(txq), settle(memq), settle(expq), settle(taskq)]);

  const asMem = (rows: any[]) =>
    rows.map((m) => ({
      ...m,
      amount: Number(m.price) || 0,
      service_type: m.package_name || 'Membership'
    }));

  const historyTxs = [...(txRows as any[]), ...asMem(memRows as any[])];
  const txs = historyTxs.filter((t) => inPeriod(t.created_at, start, end));
  const expenses = (expRows as any[]).filter((e) => inPeriod(e.created_at, start, end));
  const tasks = (taskRows as any[]).filter((t) => !outletIds?.length || !t.outlet_id || outletIds.includes(t.outlet_id));

  return { txs, historyTxs, expenses, tasks, start, end };
}

export type ExecutiveContext = {
  overall: {
    omset: number;
    netProfit: number;
    aov: number;
    opex: number;
    opexRatioPct: number;
    txCount: number;
    uniqueCustomers: number;
    repeatRatePct: number;
    slaScore: number;
    slaOpenOverdue: number;
    washFrequencyDays: number;
    peakHourLabel: string;
    passiveCustomers: number;
  };
  outlets: {
    name: string;
    omset: number;
    transactions: number;
    opex: number;
    profit: number;
    slaScore: number;
    supervisor: string;
  }[];
  opexCategories: { category: string; amount: number }[];
  supervisors: { name: string; outlets: number; omset: number; opex: number; profit: number }[];
};

export function buildExecutiveContext(
  metrics: CopilotMetrics,
  txs: any[],
  expenses: any[],
  tasks: any[],
  outlets: { id: string; name?: string }[],
  mapping: Record<string, string>,
  historyTxs: any[]
): ExecutiveContext {
  const nameOf = (id: string) => {
    const hit = (outlets || []).find((o) => String(o.id) === String(id));
    return String(hit?.name || '').trim() || 'Outlet';
  };

  const byId: Record<
    string,
    { name: string; omset: number; transactions: number; opex: number; slaDone: number; slaOver: number; supervisor: string }
  > = {};
  (outlets || []).forEach((o) => {
    byId[o.id] = {
      name: nameOf(o.id),
      omset: 0,
      transactions: 0,
      opex: 0,
      slaDone: 0,
      slaOver: 0,
      supervisor: String(mapping[o.id] || 'Belum diatur')
    };
  });

  (txs || []).filter((t) => !isVoidTransaction(t)).forEach((t) => {
    const id = String(t.outlet_id || '');
    if (!id) return;
    if (!byId[id]) {
      byId[id] = {
        name: nameOf(id),
        omset: 0,
        transactions: 0,
        opex: 0,
        slaDone: 0,
        slaOver: 0,
        supervisor: String(mapping[id] || 'Belum diatur')
      };
    }
    byId[id].omset += Number(t.amount ?? t.price) || 0;
    byId[id].transactions += 1;
  });

  (expenses || []).forEach((e) => {
    const id = String(e.outlet_id || '');
    if (!id) return;
    if (!byId[id]) {
      byId[id] = {
        name: nameOf(id),
        omset: 0,
        transactions: 0,
        opex: 0,
        slaDone: 0,
        slaOver: 0,
        supervisor: String(mapping[id] || 'Belum diatur')
      };
    }
    byId[id].opex += Number(e.amount) || 0;
  });

  (tasks || []).forEach((t) => {
    const id = String(t.outlet_id || '');
    if (!id || !byId[id]) return;
    if (isTaskCompleted(t.status)) byId[id].slaDone += 1;
    if (isTaskOverdueOpen(t)) byId[id].slaOver += 1;
  });

  const outletRows = Object.values(byId)
    .map((o) => {
      const scored = o.slaDone + o.slaOver;
      return {
        name: o.name,
        omset: Math.round(o.omset),
        transactions: o.transactions,
        opex: Math.round(o.opex),
        profit: Math.round(o.omset - o.opex),
        slaScore: scored ? Math.max(0, Math.min(100, Math.round((o.slaDone / scored) * 100))) : metrics.slaScore,
        supervisor: o.supervisor
      };
    })
    .sort((a, b) => b.profit - a.profit);

  const catMap = new Map<string, number>();
  (expenses || []).forEach((e) => {
    const cat = String(e.category || e.notes || 'Lainnya').trim() || 'Lainnya';
    catMap.set(cat, (catMap.get(cat) || 0) + (Number(e.amount) || 0));
  });
  const opexCategories = Array.from(catMap.entries())
    .map(([category, amount]) => ({ category, amount: Math.round(amount) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);

  const supMap: Record<string, { name: string; outlets: number; omset: number; opex: number; profit: number }> = {};
  outletRows.forEach((o) => {
    const name = o.supervisor || 'Belum diatur';
    if (!supMap[name]) supMap[name] = { name, outlets: 0, omset: 0, opex: 0, profit: 0 };
    supMap[name].outlets += 1;
    supMap[name].omset += o.omset;
    supMap[name].opex += o.opex;
    supMap[name].profit += o.profit;
  });

  return {
    overall: {
      omset: Math.round(metrics.grossRevenue),
      netProfit: Math.round(metrics.netProfit),
      aov: Math.round(metrics.aov),
      opex: Math.round(metrics.opex),
      opexRatioPct: Math.round(metrics.opexRatio * 100),
      txCount: metrics.txCount,
      uniqueCustomers: metrics.uniqueCustomers,
      repeatRatePct: Math.round(metrics.repeatRate),
      slaScore: metrics.slaScore,
      slaOpenOverdue: metrics.slaOpenOverdue,
      washFrequencyDays: Number(metrics.washFrequencyDays.toFixed(1)),
      peakHourLabel: metrics.peakHourLabel,
      passiveCustomers: buildPassiveCustomers(historyTxs || txs).length
    },
    outlets: outletRows.slice(0, 20),
    opexCategories,
    supervisors: Object.values(supMap).sort((a, b) => b.profit - a.profit)
  };
}

export const OWNER_ASK_SYSTEM = `You are an expert Executive Business Advisor & Data Analyst for Laundrivery ERP. Answer the owner's question precisely using ONLY the provided real-time app data context. Keep answers clear, structured with bullet points, concise (under 200 words), and highly actionable.

Rules:
- Use outlet names, never database UUIDs.
- Answer in Bahasa Indonesia unless the question is in English.
- Bold the key number or recommendation with **like this**.
- Do not invent outlets, amounts, or customers that are not in the context.`;

export function fallbackOwnerAsk(question: string, ctx: ExecutiveContext): string {
  const q = question.toLowerCase();
  const topProfit = ctx.outlets[0];
  const worstOpex = [...ctx.outlets].sort((a, b) => b.opex - a.opex || a.omset - b.omset)[0];
  const opexHeavy = [...ctx.outlets]
    .filter((o) => o.omset > 0)
    .sort((a, b) => b.opex / Math.max(b.omset, 1) - a.opex / Math.max(a.omset, 1))[0];
  const topCat = ctx.opexCategories[0];
  const topSup = ctx.supervisors[0];

  if (/profit|untung|paling untung/.test(q)) {
    return [
      `**Outlet paling profit:** ${topProfit ? `${topProfit.name} (${idr(topProfit.profit)})` : 'belum ada data'}.`,
      topProfit ? `- Omset ${idr(topProfit.omset)} · OPEX ${idr(topProfit.opex)} · ${topProfit.transactions} transaksi` : '',
      `- Repeat order jaringan ${ctx.overall.repeatRatePct}% · SLA ${ctx.overall.slaScore}/100`,
      `- Aksi: salin script upsell Express & Bedcover dari cabang ini ke outlet profit terendah.`
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (/opex|pengeluaran|boros/.test(q)) {
    return [
      `**OPEX periode ini ${idr(ctx.overall.opex)}** (${ctx.overall.opexRatioPct}% dari omset).`,
      topCat ? `- Kategori terbesar: **${topCat.category}** ${idr(topCat.amount)}` : '- Belum ada rincian kategori.',
      opexHeavy ? `- Rasio OPEX tertinggi: **${opexHeavy.name}**` : '',
      worstOpex ? `- Nominal OPEX terbesar: ${worstOpex.name} ${idr(worstOpex.opex)}` : '',
      `- Aksi: tahan belanja non-inti di cabang tersebut dan audit nota ${topCat?.category || 'OPEX'} minggu ini.`
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (/repeat|retensi|langganan|kembali/.test(q)) {
    return [
      `**Repeat order ${ctx.overall.repeatRatePct}%** dari ${ctx.overall.uniqueCustomers} pelanggan.`,
      `- Frekuensi cuci rata-rata ${ctx.overall.washFrequencyDays} hari.`,
      `- ${ctx.overall.passiveCustomers} pelanggan pasif (>21 hari) siap di-WA.`,
      `- Aksi: reminder hari ke-12 + promo bundle Bedcover untuk yang sudah 21 hari absen.`
    ].join('\n');
  }

  return [
    `**Omset ${idr(ctx.overall.omset)} · Profit ${idr(ctx.overall.netProfit)} · AOV ${idr(ctx.overall.aov)}.**`,
    topProfit ? `- Cabang terkuat: **${topProfit.name}** profit ${idr(topProfit.profit)}` : '',
    topSup ? `- Supervisor teratas: **${topSup.name}** (${topSup.outlets} cabang)` : '',
    `- Repeat ${ctx.overall.repeatRatePct}% · SLA ${ctx.overall.slaScore}/100 · jam puncak ${ctx.overall.peakHourLabel}`,
    `- Aksi minggu ini: upsell Express di jam puncak + WA ${ctx.overall.passiveCustomers} pelanggan pasif.`
  ]
    .filter(Boolean)
    .join('\n');
}

async function generateOwnerAskText(prompt: string): Promise<string> {
  const geminiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  const openaiKey = (process.env.OPENAI_API_KEY || '').trim();

  if (geminiKey) {
    const models = Array.from(
      new Set([process.env.GEMINI_MODEL, 'gemini-2.0-flash', 'gemini-flash-latest'].filter(Boolean) as string[])
    ).slice(0, 2);
    for (const model of models) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
            signal: ctrl.signal
          }
        );
        if (!res.ok) continue;
        const json = await res.json().catch(() => ({}));
        const text = String(json?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
        if (text) return text;
      } catch {
        /* next */
      } finally {
        clearTimeout(timer);
      }
    }
  }

  if (openaiKey) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          temperature: 0.3,
          max_tokens: 350,
          messages: [
            { role: 'system', content: OWNER_ASK_SYSTEM },
            { role: 'user', content: prompt }
          ]
        }),
        signal: ctrl.signal
      });
      const json = await res.json().catch(() => ({}));
      const text = String(json?.choices?.[0]?.message?.content || '').trim();
      if (text) return text;
    } catch {
      /* fallback */
    } finally {
      clearTimeout(timer);
    }
  }

  return '';
}

export async function answerOwnerQuestion(question: string, ctx: ExecutiveContext): Promise<{ reply: string; source: 'ai' | 'rules' }> {
  const prompt = `${OWNER_ASK_SYSTEM}

REAL-TIME DATA CONTEXT (JSON):
${JSON.stringify(ctx)}

OWNER QUESTION:
${question}`;

  const ai = await generateOwnerAskText(prompt);
  if (ai) return { reply: ai.slice(0, 1600), source: 'ai' };
  return { reply: fallbackOwnerAsk(question, ctx), source: 'rules' };
}

export async function enhanceGrowthWithGemini(
  report: TransactionGrowthReport,
  apiKey: string
): Promise<TransactionGrowthReport> {
  const compact = {
    metrics: {
      grossRevenue: report.metrics.grossRevenue,
      aov: Math.round(report.metrics.aov),
      repeatRate: Math.round(report.metrics.repeatRate),
      opexRatio: Number(report.metrics.opexRatio.toFixed(2)),
      slaScore: report.metrics.slaScore,
      peakHourLabel: report.metrics.peakHourLabel,
      washFrequencyDays: Number(report.metrics.washFrequencyDays.toFixed(1)),
      txCount: report.metrics.txCount
    },
    services: report.metrics.serviceMix,
    passiveCount: report.winBack.length
  };

  const prompt = `Anda analis omset laundry Indonesia. Balas HANYA JSON valid tanpa markdown:
{"summary":"1-2 kalimat","patterns":[{"title":"","body":""}],"crossSell":[{"title":"","body":"","offer":""}],"actions":[{"id":"","title":"","detail":"","impact":""}]}
Wajib 3 pola (frekuensi, AOV, jam puncak), 3 cross-sell (Bedcover, Cuci Sepatu, Express 1 Hari), 4 aksi minggu ini.
Data: ${JSON.stringify(compact)}`;

  const models = Array.from(
    new Set([process.env.GEMINI_MODEL, 'gemini-2.0-flash', 'gemini-flash-latest'].filter(Boolean) as string[])
  ).slice(0, 2);

  for (const model of models) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
          signal: ctrl.signal
        }
      );
      if (!res.ok) continue;
      const json = await res.json().catch(() => ({}));
      const text = String(json?.candidates?.[0]?.content?.parts?.[0]?.text || '');
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) continue;
      const parsed = JSON.parse(match[0]);
      return {
        ...report,
        summary: String(parsed.summary || report.summary),
        patterns: Array.isArray(parsed.patterns) && parsed.patterns.length ? parsed.patterns : report.patterns,
        crossSell: Array.isArray(parsed.crossSell) && parsed.crossSell.length ? parsed.crossSell : report.crossSell,
        actions: Array.isArray(parsed.actions) && parsed.actions.length ? parsed.actions : report.actions,
        source: 'ai'
      };
    } catch {
      /* next model */
    } finally {
      clearTimeout(timer);
    }
  }
  return report;
}
