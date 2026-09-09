export type PnlMonthRef = { year: number; month: number };

export type PnlAccount = {
  code: string;
  label: string;
  aliases?: string[];
};

export type PnlMonth = {
  ref: PnlMonthRef;
  label: string;
  revenue: Record<string, number>;
  cogs: Record<string, number>;
  opex: Record<string, number>;
  extraOpex: { label: string; amount: number }[];
  totalRevenue: number;
  totalCogs: number;
  totalOpex: number;
  labaBersih: number;
  bagiHasil: number;
  tabunganThr: number;
  sisaLaba: number;
};

export type PnlSource = {
  txs: any[];
  mems: any[];
  exps: any[];
  depreciation?: number;
  depreciationByOutlet?: Record<string, number>;
};

export const PNL_PROFIT_SHARE_RATE = 0.2;

const MONTHS_ID = [
  'JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI',
  'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'
];

export const PNL_REVENUE: PnlAccount[] = [
  { code: '400005', label: 'Pendapatan Offline', aliases: ['offline'] },
  { code: '400006', label: 'Pendapatan Online', aliases: ['online'] },
  { code: '400007', label: 'Pendapatan Ongkir', aliases: ['ongkir', 'delivery'] },
  { code: '400008', label: 'Pendapatan Lainnya', aliases: ['lainnya', 'membership', 'member', 'top up', 'deposit'] }
];

export const PNL_COGS: PnlAccount[] = [
  { code: '5201', label: 'Detergent', aliases: ['deterjen', 'detergent'] },
  { code: '5202', label: 'Gas' },
  { code: '5203', label: 'Parfume', aliases: ['parfum'] },
  { code: '5204', label: 'Plastik' },
  { code: '5205', label: 'Solasi & Thermal Paper', aliases: ['solasi', 'thermal'] },
  { code: '5206', label: 'Hanger' }
];

export const PNL_OPEX: PnlAccount[] = [
  { code: '600001', label: 'Beban Subscribe Apps', aliases: ['subscribe', 'apps'] },
  { code: '600026', label: 'CS & Promotion Levy', aliases: ['levy'] },
  { code: '600002', label: 'Beban Advertising', aliases: ['iklan', 'advertising'] },
  { code: '600016', label: 'Maintenance Mesin', aliases: ['maintenance', 'mesin'] },
  { code: '600008', label: 'Internet / Telepon', aliases: ['internet', 'telepon'] },
  { code: '600019', label: 'Beban Sewa Ruko', aliases: ['sewa ruko', 'sewa'] },
  { code: '600017', label: 'Renovasi / Perbaikan', aliases: ['renovasi', 'perbaikan'] },
  { code: '600003', label: 'Beban Listrik', aliases: ['listrik'] },
  { code: '600004', label: 'Air & PAM', aliases: ['pam', 'air'] },
  { code: '600009', label: 'Beban Gaji Crew', aliases: ['gaji'] },
  { code: '600010', label: 'Kasbon Crew', aliases: ['kasbon'] },
  { code: '600011', label: 'Fee Training', aliases: ['training'] },
  { code: '600012', label: 'Fee Perbantuan Outlet', aliases: ['perbantuan'] },
  { code: '600013', label: 'Bonus Omset Crew', aliases: ['bonus omset', 'bonus'] },
  { code: '600014', label: 'Tunjangan Crew', aliases: ['tunjangan'] },
  { code: '600015', label: 'THR Crew', aliases: ['thr'] },
  { code: '600005', label: 'Office Supply', aliases: ['office supply', 'office'] },
  { code: '600006', label: 'ATK', aliases: ['atk'] },
  { code: '600007', label: 'Perlengkapan Outlet', aliases: ['perlengkapan'] },
  { code: '600020', label: 'Transportasi', aliases: ['transport', 'bbm'] },
  { code: '600022', label: 'Vendor B2B', aliases: ['b2b', 'vendor'] },
  { code: '600023', label: 'Asuransi Outlet', aliases: ['asuransi'] },
  { code: '600024', label: 'Pajak', aliases: ['pajak'] },
  { code: '600025', label: 'Admin Bank', aliases: ['admin bank', 'biaya admin'] },
  { code: '600027', label: 'Kerugian', aliases: ['kerugian', 'selisih kas'] },
  { code: '600028', label: 'Biaya MDR', aliases: ['mdr'] },
  { code: '600029', label: 'Penyusutan Aset', aliases: ['penyusutan', 'depresiasi', 'depreciation'] }
];

const KNOWN_ACCOUNTS = [...PNL_COGS, ...PNL_OPEX];

export const expenseCoaLabel = (a: PnlAccount) => `${a.code} · ${a.label}`;

export const EXPENSE_COA_GROUPS = [
  { title: 'Beban Pokok Penjualan', accounts: PNL_COGS },
  { title: 'Beban Operasional', accounts: PNL_OPEX }
];

export const EXPENSE_COA_OPTIONS = EXPENSE_COA_GROUPS.flatMap((g) =>
  g.accounts.map((a) => expenseCoaLabel(a))
);

export const monthLabel = (ref: PnlMonthRef) => `${MONTHS_ID[ref.month]} ${ref.year}`;

export const shiftMonth = (year: number, month: number, delta: number): PnlMonthRef => {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
};

export const pnlCompareMonths = (period: string, now = new Date()): [PnlMonthRef, PnlMonthRef] => {
  const y = now.getFullYear();
  const m = now.getMonth();
  if (period === 'LAST_MONTH') {
    return [shiftMonth(y, m, -2), shiftMonth(y, m, -1)];
  }
  return [shiftMonth(y, m, -1), { year: y, month: m }];
};

const inMonth = (iso: string, ref: PnlMonthRef) => {
  const d = new Date(iso);
  return d.getFullYear() === ref.year && d.getMonth() === ref.month;
};

const matchAccount = (category: string, accounts: PnlAccount[]): PnlAccount | null => {
  const cat = String(category || '').toLowerCase();
  if (!cat) return null;
  const byCode = accounts.find((a) => cat.includes(a.code.toLowerCase()));
  if (byCode) return byCode;
  let best: PnlAccount | null = null;
  let bestLen = 0;
  for (const a of accounts) {
    for (const key of [a.label, ...(a.aliases || [])]) {
      const k = key.toLowerCase();
      if (k.length > bestLen && cat.includes(k)) {
        best = a;
        bestLen = k.length;
      }
    }
  }
  return best;
};

const zeroMap = (accounts: PnlAccount[]) =>
  Object.fromEntries(accounts.map((a) => [a.code, 0])) as Record<string, number>;

export function shareRateOf(rates: Record<string, number> | undefined, outletId: string, fallbackPct = 20) {
  const n = Number(rates?.[outletId]);
  const pct = Number.isFinite(n) ? n : fallbackPct;
  return Math.max(0, Math.min(100, pct)) / 100;
}

export function buildPnlMonth(source: PnlSource, ref: PnlMonthRef, shareRate = PNL_PROFIT_SHARE_RATE): PnlMonth {
  const revenue = zeroMap(PNL_REVENUE);
  const cogs = zeroMap(PNL_COGS);
  const opex = zeroMap(PNL_OPEX);
  const extraMap: Record<string, number> = {};
  let tabunganThr = 0;

  (source.txs || []).filter((t) => inMonth(t.created_at, ref)).forEach((t) => {
    const amt = Number(t.amount) || 0;
    const fee = Number(t.delivery_fee) || 0;
    const laundry = Math.max(0, amt - fee);
    const online = String(t.order_type || '').toLowerCase() === 'online';
    if (online) revenue['400006'] += laundry;
    else revenue['400005'] += laundry;
    revenue['400007'] += fee;
  });

  (source.mems || []).filter((m) => inMonth(m.created_at, ref)).forEach((m) => {
    revenue['400008'] += Number(m.price) || 0;
  });

  (source.exps || []).filter((e) => inMonth(e.created_at, ref)).forEach((e) => {
    const amt = Number(e.amount) || 0;
    const cat = String(e.category || '');
    if (/tabungan\s*thr/i.test(cat)) {
      tabunganThr += amt;
      return;
    }
    const acc = matchAccount(cat, KNOWN_ACCOUNTS);
    if (acc && cogs[acc.code] != null) {
      cogs[acc.code] += amt;
      return;
    }
    if (acc && opex[acc.code] != null) {
      opex[acc.code] += amt;
      return;
    }
    const label = cat.trim() || 'Pengeluaran lain';
    extraMap[label] = (extraMap[label] || 0) + amt;
  });

  if ((source.depreciation || 0) > 0) opex['600029'] += Number(source.depreciation) || 0;

  const extraOpex = Object.entries(extraMap)
    .map(([label, amount]) => ({ label, amount }))
    .sort((a, b) => a.label.localeCompare(b.label, 'id'));

  const totalRevenue = Object.values(revenue).reduce((s, n) => s + n, 0);
  const totalCogs = Object.values(cogs).reduce((s, n) => s + n, 0);
  const totalOpex = Object.values(opex).reduce((s, n) => s + n, 0) + extraOpex.reduce((s, r) => s + r.amount, 0);
  const labaBersih = totalRevenue - totalCogs - totalOpex;
  const bagiHasil = labaBersih > 0 ? Math.round(labaBersih * shareRate) : 0;

  return {
    ref,
    label: monthLabel(ref),
    revenue,
    cogs,
    opex,
    extraOpex,
    totalRevenue,
    totalCogs,
    totalOpex,
    labaBersih,
    bagiHasil,
    tabunganThr,
    sisaLaba: labaBersih - bagiHasil - tabunganThr
  };
}

const addMaps = (a: Record<string, number>, b: Record<string, number>) => {
  const out = { ...a };
  Object.entries(b).forEach(([k, v]) => {
    out[k] = (out[k] || 0) + v;
  });
  return out;
};

export function mergePnlMonths(parts: PnlMonth[], ref: PnlMonthRef): PnlMonth {
  const extraMap: Record<string, number> = {};
  const base: PnlMonth = {
    ref,
    label: monthLabel(ref),
    revenue: {},
    cogs: {},
    opex: {},
    extraOpex: [],
    totalRevenue: 0,
    totalCogs: 0,
    totalOpex: 0,
    labaBersih: 0,
    bagiHasil: 0,
    tabunganThr: 0,
    sisaLaba: 0
  };
  parts.forEach((p) => {
    base.revenue = addMaps(base.revenue, p.revenue);
    base.cogs = addMaps(base.cogs, p.cogs);
    base.opex = addMaps(base.opex, p.opex);
    p.extraOpex.forEach((x) => {
      extraMap[x.label] = (extraMap[x.label] || 0) + x.amount;
    });
    base.totalRevenue += p.totalRevenue;
    base.totalCogs += p.totalCogs;
    base.totalOpex += p.totalOpex;
    base.labaBersih += p.labaBersih;
    base.bagiHasil += p.bagiHasil;
    base.tabunganThr += p.tabunganThr;
    base.sisaLaba += p.sisaLaba;
  });
  base.extraOpex = Object.entries(extraMap)
    .map(([label, amount]) => ({ label, amount }))
    .sort((a, b) => a.label.localeCompare(b.label, 'id'));
  return base;
}

export function buildPnlByOutlets(
  source: PnlSource,
  ref: PnlMonthRef,
  outletIds: string[],
  rates?: Record<string, number>
): PnlMonth {
  const depOf = (id: string) =>
    Number(source.depreciationByOutlet?.[id] ?? (outletIds.length === 1 ? source.depreciation : 0)) || 0;
  if (!outletIds.length) return buildPnlMonth(source, ref);
  if (outletIds.length === 1) {
    return buildPnlMonth(
      { ...source, depreciation: depOf(outletIds[0]) },
      ref,
      shareRateOf(rates, outletIds[0])
    );
  }
  const known = new Set(outletIds);
  const parts = outletIds.map((id) =>
    buildPnlMonth(
      {
        txs: source.txs.filter((t) => t.outlet_id === id),
        mems: source.mems.filter((m) => m.outlet_id === id),
        exps: source.exps.filter((e) => e.outlet_id === id),
        depreciation: depOf(id)
      },
      ref,
      shareRateOf(rates, id)
    )
  );
  const leftover = buildPnlMonth(
    {
      txs: source.txs.filter((t) => !t.outlet_id || !known.has(t.outlet_id)),
      mems: source.mems.filter((m) => !m.outlet_id || !known.has(m.outlet_id)),
      exps: source.exps.filter((e) => !e.outlet_id || !known.has(e.outlet_id))
    },
    ref,
    PNL_PROFIT_SHARE_RATE
  );
  return mergePnlMonths([...parts, leftover], ref);
}

const csvCell = (v: string | number) =>
  typeof v === 'number' ? String(Math.round(v)) : `"${String(v).replace(/"/g, '""')}"`;

export function buildPnlCsv(opts: {
  outletName: string;
  adminName?: string;
  left: PnlMonth;
  right: PnlMonth;
}): string {
  const { outletName, adminName, left, right } = opts;
  const extraLabels = Array.from(
    new Set([...left.extraOpex.map((x) => x.label), ...right.extraOpex.map((x) => x.label)])
  );
  const extraAmt = (month: PnlMonth, label: string) =>
    month.extraOpex.find((x) => x.label === label)?.amount || 0;

  const lines: string[] = [
    `${csvCell(`LAPORAN LABA RUGI - ${outletName}`)},,`,
    `${csvCell('Nama Outlet')},${csvCell(outletName)},`,
    `${csvCell('Nama Admin')},${csvCell(adminName || '-')},`,
    `${csvCell('Periode')},${csvCell(`${left.label} vs ${right.label}`)},`,
    `${csvCell('Tanggal Cetak')},${csvCell(new Date().toLocaleString('id-ID'))},`,
    '',
    `${csvCell('KODE')},${csvCell('AKUN')},${csvCell(left.label)},${csvCell(right.label)}`,
    `${csvCell('')},${csvCell('PENDAPATAN')},,`
  ];

  PNL_REVENUE.forEach((a) => {
    lines.push(`${csvCell(a.code)},${csvCell(a.label)},${csvCell(left.revenue[a.code] || 0)},${csvCell(right.revenue[a.code] || 0)}`);
  });
  lines.push(`${csvCell('')},${csvCell('Total Pendapatan')},${csvCell(left.totalRevenue)},${csvCell(right.totalRevenue)}`);

  lines.push(`${csvCell('')},${csvCell('BEBAN POKOK PENJUALAN')},,`);
  PNL_COGS.forEach((a) => {
    lines.push(`${csvCell(a.code)},${csvCell(a.label)},${csvCell(left.cogs[a.code] || 0)},${csvCell(right.cogs[a.code] || 0)}`);
  });
  lines.push(`${csvCell('')},${csvCell('Total Beban Pokok Penjualan')},${csvCell(left.totalCogs)},${csvCell(right.totalCogs)}`);

  lines.push(`${csvCell('')},${csvCell('BEBAN OPERASIONAL')},,`);
  PNL_OPEX.forEach((a) => {
    lines.push(`${csvCell(a.code)},${csvCell(a.label)},${csvCell(left.opex[a.code] || 0)},${csvCell(right.opex[a.code] || 0)}`);
  });
  extraLabels.forEach((label) => {
    lines.push(`${csvCell('')},${csvCell(label)},${csvCell(extraAmt(left, label))},${csvCell(extraAmt(right, label))}`);
  });
  lines.push(`${csvCell('')},${csvCell('Total Beban Operasional')},${csvCell(left.totalOpex)},${csvCell(right.totalOpex)}`);

  lines.push(`${csvCell('')},${csvCell('LABA BERSIH')},${csvCell(left.labaBersih)},${csvCell(right.labaBersih)}`);
  lines.push(
    `${csvCell('')},${csvCell('BAGI HASIL PENGELOLAAN')},${csvCell(left.bagiHasil)},${csvCell(right.bagiHasil)}`
  );
  lines.push(`${csvCell('')},${csvCell('TABUNGAN THR CREW')},${csvCell(left.tabunganThr)},${csvCell(right.tabunganThr)}`);
  lines.push(`${csvCell('')},${csvCell('LABA BERSIH SETELAH BAGI HASIL')},${csvCell(left.sisaLaba)},${csvCell(right.sisaLaba)}`);

  return lines.join('\n');
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const idr = (n: number) => Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 });

export function printPnlPdf(opts: { outletName: string; adminName?: string; left: PnlMonth; right: PnlMonth }) {
  const { outletName, adminName, left, right } = opts;
  const extraLabels = Array.from(
    new Set([...left.extraOpex.map((x) => x.label), ...right.extraOpex.map((x) => x.label)])
  );
  const extraAmt = (month: PnlMonth, label: string) => month.extraOpex.find((x) => x.label === label)?.amount || 0;
  const row = (code: string, label: string, a: number, b: number, strong = false) =>
    `<tr class="${strong ? 'tot' : ''}"><td>${code}</td><td>${label}</td><td class="n">${idr(a)}</td><td class="n">${idr(b)}</td></tr>`;
  const head = (title: string) => `<tr class="sec"><td colspan="4">${title}</td></tr>`;
  const rows = [
    head('PENDAPATAN'),
    ...PNL_REVENUE.map((a) => row(a.code, a.label, left.revenue[a.code] || 0, right.revenue[a.code] || 0)),
    row('', 'Total Pendapatan', left.totalRevenue, right.totalRevenue, true),
    head('BEBAN POKOK PENJUALAN'),
    ...PNL_COGS.map((a) => row(a.code, a.label, left.cogs[a.code] || 0, right.cogs[a.code] || 0)),
    row('', 'Total Beban Pokok Penjualan', left.totalCogs, right.totalCogs, true),
    head('BEBAN OPERASIONAL'),
    ...PNL_OPEX.map((a) => row(a.code, a.label, left.opex[a.code] || 0, right.opex[a.code] || 0)),
    ...extraLabels.map((label) => row('', label, extraAmt(left, label), extraAmt(right, label))),
    row('', 'Total Beban Operasional', left.totalOpex, right.totalOpex, true),
    row('', 'LABA BERSIH', left.labaBersih, right.labaBersih, true),
    row('', 'BAGI HASIL PENGELOLAAN', left.bagiHasil, right.bagiHasil),
    row('', 'TABUNGAN THR CREW', left.tabunganThr, right.tabunganThr),
    row('', 'LABA BERSIH SETELAH BAGI HASIL', left.sisaLaba, right.sisaLaba, true)
  ].join('');

  const w = window.open('', '_blank', 'width=920,height=720');
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>Laporan Laba Rugi ${outletName}</title>
    <style>
      body{font-family:Arial,sans-serif;color:#111;padding:24px}
      h1{font-size:18px;margin:0 0 4px}
      p{font-size:12px;margin:0 0 12px;color:#444}
      table{width:100%;border-collapse:collapse;font-size:11px}
      th,td{border:1px solid #ccc;padding:6px 8px}
      th{background:#1e293b;color:#fff}
      .n{text-align:right}
      .sec td{background:#ffe4e6;font-weight:800}
      .tot td{background:#d1fae5;font-weight:800}
    </style></head><body>
    <h1>LAPORAN LABA RUGI — ${outletName}</h1>
    <p>${adminName || 'Owner'} · ${left.label} vs ${right.label} · Dicetak ${new Date().toLocaleString('id-ID')}</p>
    <table><thead><tr><th>Kode</th><th>Akun</th><th>${left.label}</th><th>${right.label}</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <script>window.onload=function(){window.print();}</script>
    </body></html>`);
  w.document.close();
}
