import { insertWithFallback, updateWithFallback } from '@/lib/safeWrite';
import { isVoidTransaction } from '@/lib/voidTx';

export const RECON_STATUSES = ['MATCHED', 'DISCREPANCY_ALERT', 'UNSETTLED'] as const;
export type ReconStatus = (typeof RECON_STATUSES)[number];

export const LEAKAGE_TYPES = [
  'UNMATCHED_DEPOSIT',
  'OVERDUE_SETTLEMENT',
  'SUSPICIOUS_VOID',
  'EXCESSIVE_DISCOUNT',
  'WEIGHT_MISMATCH'
] as const;
export type LeakageType = (typeof LEAKAGE_TYPES)[number];

export const LEAKAGE_SEVERITY = ['MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type LeakageSeverity = (typeof LEAKAGE_SEVERITY)[number];

export type DailyReconRow = {
  id?: string;
  outlet_id: string | null;
  date: string;
  system_cash_total: number;
  system_qris_total: number;
  reported_cash_deposit: number;
  gateway_qris_settlement: number;
  cash_discrepancy: number;
  qris_discrepancy: number;
  status: ReconStatus;
  created_at?: string;
};

export type LeakageAlertRow = {
  id?: string;
  outlet_id: string | null;
  trx_id?: string | null;
  alert_type: LeakageType;
  severity: LeakageSeverity;
  leakage_amount: number;
  analysis_reason: string;
  is_resolved?: boolean;
};

const TOLERANCE = 1;
const DISCOUNT_CAP = 0.15;
const WEIGHT_RATIO = 0.2;
const WEIGHT_MIN_KG = 0.5;

export const wibYmd = (value: Date | string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(typeof value === 'string' ? new Date(value) : value);

export const todayWib = () => wibYmd(new Date());

export const daysBackWib = (count: number) => {
  const today = todayWib();
  const [y, m, d] = today.split('-').map(Number);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const dt = new Date(Date.UTC(y, m - 1, d - i));
    out.push(dt.toISOString().slice(0, 10));
  }
  return out;
};

export const hoursAgo = (iso: string) => (Date.now() - new Date(iso).getTime()) / 36e5;

export const txAmountOf = (row: any) =>
  Number(row?.amount ?? row?.total_amount ?? row?.amount_paid ?? 0) || 0;

export const isQrisTx = (row: any) => {
  const pm = String(row?.payment_method || '').toLowerCase();
  return pm.includes('qris') || pm.includes('mayar') || pm.includes('transfer') || Boolean(row?.mayar_payment_id);
};

export const isCashTx = (row: any) => {
  const pm = String(row?.payment_method || '').toLowerCase();
  if (pm.includes('deposit')) return false;
  if (isQrisTx(row)) return false;
  return !pm || pm.includes('cash') || pm.includes('tunai');
};

export const isPaidTx = (row: any) => {
  if (row?.is_paid === true) return true;
  const pay = String(row?.payment_status || '').toLowerCase();
  const st = String(row?.status || '').toLowerCase();
  return ['paid', 'lunas', 'verified'].includes(pay) || st === 'paid' || st.includes('lunas');
};

export const hasSupervisorNote = (row: any) =>
  /supervisor|spv|disetujui|approval|izin\s*spv/i.test(
    `${row?.notes || ''} ${row?.supervisor_note || ''} ${row?.delete_reason || ''}`
  );

export const isUuid = (value: unknown) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));

export const money = (n: number) => `Rp ${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;

export const reconStatusLabel = (status: string) => {
  if (status === 'MATCHED') return 'Matched';
  if (status === 'DISCREPANCY_ALERT') return 'Unmatched';
  return 'Belum settle';
};

export const leakageTypeLabel = (type: string) => {
  if (type === 'UNMATCHED_DEPOSIT') return 'Setoran tidak cocok';
  if (type === 'OVERDUE_SETTLEMENT') return 'Setoran terlambat';
  if (type === 'SUSPICIOUS_VOID') return 'Void mencurigakan';
  if (type === 'EXCESSIVE_DISCOUNT') return 'Diskon berlebih';
  if (type === 'WEIGHT_MISMATCH') return 'Selisih timbangan';
  return type;
};

export const classifyRecon = (row: {
  cash_discrepancy: number;
  qris_discrepancy: number;
  system_cash_total: number;
  reported_cash_deposit: number;
  date: string;
  oldestCashAt?: string | null;
}): ReconStatus => {
  const cashGap = Math.abs(row.cash_discrepancy);
  const qrisGap = Math.abs(row.qris_discrepancy);
  if (cashGap <= TOLERANCE && qrisGap <= TOLERANCE) return 'MATCHED';
  const isPastDay = row.date < todayWib();
  const overdueCash =
    row.system_cash_total > TOLERANCE &&
    row.reported_cash_deposit <= TOLERANCE &&
    (isPastDay || (row.oldestCashAt ? hoursAgo(row.oldestCashAt) >= 24 : false));
  if (overdueCash || cashGap > TOLERANCE || (isPastDay && qrisGap > TOLERANCE)) return 'DISCREPANCY_ALERT';
  return 'UNSETTLED';
};

export const analyseRecon = (
  row: DailyReconRow,
  outletName: string,
  extras?: { cashCount?: number }
) => {
  const name = outletName || 'Outlet';
  const n = extras?.cashCount || 0;
  if (row.status === 'MATCHED') {
    return `${name}: kas & QRIS ${row.date} sudah cocok.`;
  }
  if (row.system_cash_total > TOLERANCE && row.reported_cash_deposit <= TOLERANCE) {
    return `Potensi Kebocoran: Kasir belum menyetorkan uang tunai ${money(row.system_cash_total)} dari ${n || 'beberapa'} transaksi hari ${row.date}.`;
  }
  if (Math.abs(row.cash_discrepancy) > TOLERANCE) {
    const dir = row.cash_discrepancy > 0 ? 'kurang disetor' : 'lebih disetor dibanding sistem';
    return `Potensi Kebocoran: Setoran tunai ${name} ${dir} ${money(Math.abs(row.cash_discrepancy))} (sistem ${money(row.system_cash_total)} vs setoran ${money(row.reported_cash_deposit)}).`;
  }
  if (Math.abs(row.qris_discrepancy) > TOLERANCE) {
    return `Settlement QRIS ${name} belum cocok: sistem ${money(row.system_qris_total)} vs gateway ${money(row.gateway_qris_settlement)} (selisih ${money(Math.abs(row.qris_discrepancy))}).`;
  }
  return `${name}: rekonsiliasi ${row.date} masih UNSETTLED.`;
};

type AnyClient = {
  from: (table: string) => any;
};

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

const upsertRecon = async (client: AnyClient, row: DailyReconRow) => {
  const payload = {
    outlet_id: row.outlet_id,
    date: row.date,
    system_cash_total: round2(row.system_cash_total),
    system_qris_total: round2(row.system_qris_total),
    reported_cash_deposit: round2(row.reported_cash_deposit),
    gateway_qris_settlement: round2(row.gateway_qris_settlement),
    cash_discrepancy: round2(row.cash_discrepancy),
    qris_discrepancy: round2(row.qris_discrepancy),
    status: row.status
  };
  const { data: existing } = await client
    .from('daily_reconciliations')
    .select('id')
    .eq('outlet_id', row.outlet_id)
    .eq('date', row.date)
    .maybeSingle();
  if (existing?.id) {
    const { error } = await client.from('daily_reconciliations').update(payload).eq('id', existing.id);
    return { id: existing.id, error };
  }
  const { data, error } = await client.from('daily_reconciliations').insert([payload]).select('id');
  return { id: data?.[0]?.id || null, error };
};

const openAlertsOf = async (client: AnyClient) => {
  const { data } = await client
    .from('financial_leakage_alerts')
    .select('id, outlet_id, trx_id, alert_type, analysis_reason, is_resolved')
    .eq('is_resolved', false)
    .limit(800);
  return data || [];
};

const alreadyOpen = (
  open: any[],
  type: LeakageType,
  outletId: string | null,
  trxId?: string | null,
  dayTag?: string
) =>
  open.some((a) => {
    if (a.alert_type !== type) return false;
    if (String(a.outlet_id || '') !== String(outletId || '')) return false;
    if (trxId) return String(a.trx_id || '') === String(trxId);
    if (dayTag) return String(a.analysis_reason || '').includes(`[${dayTag}]`);
    return true;
  });

const insertAlert = async (client: AnyClient, open: any[], row: LeakageAlertRow) => {
  const dayTag = String(row.analysis_reason || '').match(/\[([^\]]+)\]/)?.[1];
  if (alreadyOpen(open, row.alert_type, row.outlet_id, row.trx_id, dayTag)) return { skipped: true };
  const payload = {
    outlet_id: row.outlet_id,
    trx_id: row.trx_id && isUuid(row.trx_id) ? row.trx_id : null,
    alert_type: row.alert_type,
    severity: row.severity,
    leakage_amount: round2(row.leakage_amount),
    analysis_reason: row.analysis_reason,
    is_resolved: false
  };
  const attempts = [
    payload,
    { ...payload, trx_id: undefined },
    {
      outlet_id: payload.outlet_id,
      alert_type: payload.alert_type,
      severity: payload.severity,
      leakage_amount: payload.leakage_amount,
      analysis_reason: payload.analysis_reason
    }
  ];
  let lastErr: { message: string } | null = null;
  for (const attempt of attempts) {
    const clean = Object.fromEntries(Object.entries(attempt).filter(([, v]) => v !== undefined));
    const { data, error } = await client.from('financial_leakage_alerts').insert([clean]).select('id, outlet_id, trx_id, alert_type, analysis_reason');
    if (!error) {
      if (data?.[0]) open.push(data[0]);
      return { skipped: false, error: null, id: data?.[0]?.id };
    }
    lastErr = { message: error.message };
  }
  return { skipped: false, error: lastErr, id: null };
};

export async function runFinanceReconEngine(
  client: AnyClient,
  opts?: { days?: number }
): Promise<{
  ok: boolean;
  days: string[];
  reconUpserts: number;
  alertsCreated: number;
  error?: string;
}> {
  const days = daysBackWib(Math.max(2, Math.min(14, opts?.days || 3)));
  const from = `${days[0]}T00:00:00+07:00`;

  const [{ data: outlets }, txRes, depRes, pickupRes] = await Promise.all([
    client.from('outlets').select('id, name'),
    client.from('transactions').select('*').gte('created_at', from).limit(4000),
    client.from('cash_deposits').select('id, outlet_id, amount_cash, created_at').gte('created_at', from).limit(2000),
    client.from('pickup_orders').select('id, estimated_weight, outlet_id').limit(2000)
  ]);
  const txs = txRes.error ? [] : txRes.data;
  const deposits = depRes.error ? [] : depRes.data;
  const pickups = pickupRes.error ? [] : pickupRes.data;

  const outletList = outlets || [];
  const names = Object.fromEntries(outletList.map((o: any) => [o.id, o.name]));
  const pickupById = Object.fromEntries((pickups || []).map((p: any) => [p.id, p]));
  const open = await openAlertsOf(client);

  let reconUpserts = 0;
  let alertsCreated = 0;
  const lastErr: string[] = [];

  const outletIds = [
    ...new Set(
      [
        ...outletList.map((o: any) => o.id),
        ...(txs || []).map((t: any) => t.outlet_id),
        ...(deposits || []).map((d: any) => d.outlet_id)
      ].filter(Boolean)
    )
  ];

  for (const outletId of outletIds) {
    const name = names[outletId] || 'Outlet';
    for (const date of days) {
      const dayTx = (txs || []).filter((t: any) => t.outlet_id === outletId && wibYmd(t.created_at) === date);
      const live = dayTx.filter((t: any) => !isVoidTransaction(t));
      const cashRows = live.filter(isCashTx);
      const qrisRows = live.filter(isQrisTx);
      const systemCash = cashRows.reduce((s: number, t: any) => s + txAmountOf(t), 0);
      const systemQris = qrisRows.reduce((s: number, t: any) => s + txAmountOf(t), 0);
      const gatewayQris = qrisRows.filter(isPaidTx).reduce((s: number, t: any) => s + txAmountOf(t), 0);
      const dayDeps = (deposits || []).filter((d: any) => d.outlet_id === outletId && wibYmd(d.created_at) === date);
      const reported = dayDeps.reduce((s: number, d: any) => s + (Number(d.amount_cash) || 0), 0);
      const oldestCashAt = cashRows.map((t: any) => t.created_at).sort()[0] || null;
      const cashDisc = systemCash - reported;
      const qrisDisc = systemQris - gatewayQris;
      const status = classifyRecon({
        cash_discrepancy: cashDisc,
        qris_discrepancy: qrisDisc,
        system_cash_total: systemCash,
        reported_cash_deposit: reported,
        date,
        oldestCashAt
      });
      const row: DailyReconRow = {
        outlet_id: outletId,
        date,
        system_cash_total: systemCash,
        system_qris_total: systemQris,
        reported_cash_deposit: reported,
        gateway_qris_settlement: gatewayQris,
        cash_discrepancy: cashDisc,
        qris_discrepancy: qrisDisc,
        status
      };
      const saved = await upsertRecon(client, row);
      if (saved.error) lastErr.push(saved.error.message);
      else reconUpserts += 1;

      const reason = `[${date}] ${analyseRecon(row, name, { cashCount: cashRows.length })}`;

      if (status === 'DISCREPANCY_ALERT' && Math.abs(cashDisc) > TOLERANCE) {
        const overdue = systemCash > TOLERANCE && reported <= TOLERANCE;
        const type: LeakageType = overdue ? 'OVERDUE_SETTLEMENT' : 'UNMATCHED_DEPOSIT';
        if (!alreadyOpen(open, type, outletId, null, date)) {
          const res = await insertAlert(client, open, {
            outlet_id: outletId,
            alert_type: type,
            severity: Math.abs(cashDisc) >= 300000 ? 'CRITICAL' : Math.abs(cashDisc) >= 100000 ? 'HIGH' : 'MEDIUM',
            leakage_amount: Math.abs(cashDisc),
            analysis_reason: reason
          });
          if (!res.skipped && !res.error) alertsCreated += 1;
        }
      }

      if (status === 'DISCREPANCY_ALERT' && Math.abs(qrisDisc) > TOLERANCE && date < todayWib()) {
        if (!alreadyOpen(open, 'OVERDUE_SETTLEMENT', outletId, null, `${date}-qris`)) {
          const res = await insertAlert(client, open, {
            outlet_id: outletId,
            alert_type: 'OVERDUE_SETTLEMENT',
            severity: Math.abs(qrisDisc) >= 300000 ? 'HIGH' : 'MEDIUM',
            leakage_amount: Math.abs(qrisDisc),
            analysis_reason: `[${date}-qris] Settlement QRIS ${name} tertunggak ${money(Math.abs(qrisDisc))} (belum cocok dengan webhook Mayar).`
          });
          if (!res.skipped && !res.error) alertsCreated += 1;
        }
      }
    }
  }

  for (const t of txs || []) {
    if (!isVoidTransaction(t)) continue;
    if (!(isPaidTx(t) || t.delete_requested)) continue;
    if (!alreadyOpen(open, 'SUSPICIOUS_VOID', t.outlet_id, t.id)) {
      const res = await insertAlert(client, open, {
        outlet_id: t.outlet_id || null,
        trx_id: t.id,
        alert_type: 'SUSPICIOUS_VOID',
        severity: 'CRITICAL',
        leakage_amount: txAmountOf(t),
        analysis_reason: `Void setelah tag lunas: ${t.receipt_number || t.id} · ${money(txAmountOf(t))} · ${names[t.outlet_id] || 'Outlet'}. Transaksi sudah berstatus bayar lalu dibatalkan/diajukan hapus.`
      });
      if (!res.skipped && !res.error) alertsCreated += 1;
    }
  }

  for (const t of txs || []) {
    if (isVoidTransaction(t)) continue;
    const disc = Number(t.discount_amount) || 0;
    const pctVal = String(t.discount_type || '').toLowerCase().includes('percent') ? Number(t.discount_value) || 0 : 0;
    const gross = txAmountOf(t) + disc;
    const pct = pctVal > 0 ? pctVal / 100 : gross > 0 ? disc / gross : 0;
    if (pct <= DISCOUNT_CAP && disc <= 0) continue;
    if (pct <= DISCOUNT_CAP) continue;
    if (hasSupervisorNote(t)) continue;
    if (!alreadyOpen(open, 'EXCESSIVE_DISCOUNT', t.outlet_id, t.id)) {
      const res = await insertAlert(client, open, {
        outlet_id: t.outlet_id || null,
        trx_id: t.id,
        alert_type: 'EXCESSIVE_DISCOUNT',
        severity: pct >= 0.3 ? 'HIGH' : 'MEDIUM',
        leakage_amount: disc || txAmountOf(t) * pct,
        analysis_reason: `Diskon manual ${(pct * 100).toFixed(0)}% pada ${t.receipt_number || t.id} tanpa catatan supervisor (batas 15%).`
      });
      if (!res.skipped && !res.error) alertsCreated += 1;
    }
  }

  for (const t of txs || []) {
    if (isVoidTransaction(t) || !t.pickup_id) continue;
    const pickup = pickupById[t.pickup_id];
    const est = Number(pickup?.estimated_weight) || 0;
    const act = Number(t.weight_kg) || 0;
    if (est < WEIGHT_MIN_KG || act <= 0) continue;
    const gap = Math.abs(act - est);
    if (gap < WEIGHT_MIN_KG || gap / est < WEIGHT_RATIO) continue;
    if (!alreadyOpen(open, 'WEIGHT_MISMATCH', t.outlet_id, t.id)) {
      const leak = act < est && txAmountOf(t) > 0 ? (gap / est) * txAmountOf(t) : 0;
      const res = await insertAlert(client, open, {
        outlet_id: t.outlet_id || null,
        trx_id: t.id,
        alert_type: 'WEIGHT_MISMATCH',
        severity: leak >= 50000 ? 'HIGH' : 'MEDIUM',
        leakage_amount: leak,
        analysis_reason: `Timbangan ${t.receipt_number || t.id}: estimasi ${est} kg vs kasir ${act} kg (selisih ${gap.toFixed(1)} kg).`
      });
      if (!res.skipped && !res.error) alertsCreated += 1;
    }
  }

  return {
    ok: lastErr.length === 0,
    days,
    reconUpserts,
    alertsCreated,
    error: lastErr[0]
  };
}

export async function resolveLeakageAlert(alertId: string, actorId?: string) {
  const payload: Record<string, unknown>[] = [{ is_resolved: true }];
  if (isUuid(actorId)) payload.unshift({ is_resolved: true, resolved_by: actorId });
  return updateWithFallback('financial_leakage_alerts', payload, { column: 'id', value: alertId });
}

export async function applyReconAdjustment(
  row: DailyReconRow & { id: string },
  patch: { reported_cash_deposit?: number; gateway_qris_settlement?: number }
) {
  const reported = patch.reported_cash_deposit ?? (Number(row.reported_cash_deposit) || 0);
  const gateway = patch.gateway_qris_settlement ?? (Number(row.gateway_qris_settlement) || 0);
  const cashDisc = Number(row.system_cash_total) - reported;
  const qrisDisc = Number(row.system_qris_total) - gateway;
  const next: DailyReconRow = {
    ...row,
    reported_cash_deposit: reported,
    gateway_qris_settlement: gateway,
    cash_discrepancy: cashDisc,
    qris_discrepancy: qrisDisc,
    status: classifyRecon({
      cash_discrepancy: cashDisc,
      qris_discrepancy: qrisDisc,
      system_cash_total: Number(row.system_cash_total) || 0,
      reported_cash_deposit: reported,
      date: row.date
    })
  };
  const { error } = await updateWithFallback(
    'daily_reconciliations',
    [
      {
        reported_cash_deposit: round2(next.reported_cash_deposit),
        gateway_qris_settlement: round2(next.gateway_qris_settlement),
        cash_discrepancy: round2(next.cash_discrepancy),
        qris_discrepancy: round2(next.qris_discrepancy),
        status: next.status
      }
    ],
    { column: 'id', value: row.id }
  );
  return { error, row: next };
}

export async function escalateLeakageToSupervisor(opts: {
  outletName: string;
  reason: string;
  amount: number;
  outletId?: string | null;
}) {
  const due = new Date();
  due.setHours(due.getHours() + 8);
  const title = `Investigasi kebocoran · ${opts.outletName}`;
  const description = `${opts.reason} · ${money(opts.amount)}`;
  return insertWithFallback('system_tasks', [
    {
      title,
      description,
      assigned_to_role: 'supervisor',
      sla_hours: 8,
      due_date: due.toISOString(),
      kpi_penalty_points: 10,
      status: 'pending',
      source_type: 'FINANCE_LEAKAGE',
      source_id: opts.outletId || null
    },
    {
      title,
      description,
      assigned_to_role: 'supervisor',
      due_date: due.toISOString(),
      status: 'pending'
    },
    { title, description, assigned_to_role: 'supervisor', status: 'pending' }
  ]);
}
