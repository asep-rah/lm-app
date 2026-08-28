/** Katalog metrik 7 role. metric_key di sini = kunci actual yang dihitung dari Supabase. */

export type MetricDirection = 'higher' | 'lower';

export type CatalogMetric = {
  key: string;
  label: string;
  direction: MetricDirection;
  defaultTarget: number;
  defaultWeight: number;
  unit?: string;
};

export const KPI_ROLES: { key: string; label: string }[] = [
  { key: 'kasir', label: '🛒 Kasir / POS' },
  { key: 'kurir_cs', label: '🛵 Kurir & CS' },
  { key: 'supervisor', label: '🛡️ Supervisor Operasional' },
  { key: 'admin_ops', label: '📦 Admin Ops' },
  { key: 'digital_marketing', label: '🚀 Digital Marketing' },
  { key: 'finance', label: '💰 Finance' },
  { key: 'owner_relation', label: '🤝 Owner Relation' }
];

export const KPI_CATALOG: Record<string, CatalogMetric[]> = {
  kasir: [
    { key: 'tx_count', label: 'Jumlah transaksi', direction: 'higher', defaultTarget: 150, defaultWeight: 60, unit: 'trx' },
    { key: 'process_hours', label: 'Avg. waktu proses (jam)', direction: 'lower', defaultTarget: 0.5, defaultWeight: 40, unit: 'jam' }
  ],
  kurir_cs: [
    { key: 'pickup_done', label: 'Pickup selesai', direction: 'higher', defaultTarget: 40, defaultWeight: 30, unit: 'order' },
    { key: 'pickup_sla_pct', label: 'SLA on-time %', direction: 'higher', defaultTarget: 95, defaultWeight: 30, unit: '%' },
    { key: 'pickup_speed_hours', label: 'Avg. kecepatan jemput (jam)', direction: 'lower', defaultTarget: 2, defaultWeight: 20, unit: 'jam' },
    { key: 'tasks_completed', label: 'Task Head selesai', direction: 'higher', defaultTarget: 8, defaultWeight: 0, unit: 'task' },
    { key: 'complaints', label: 'Komplain outlet', direction: 'lower', defaultTarget: 0, defaultWeight: 20, unit: 'kasus' },
    { key: 'cs_resolved', label: 'Chat CS resolved', direction: 'higher', defaultTarget: 80, defaultWeight: 0, unit: 'chat' },
    { key: 'cs_reply_hours', label: 'Avg. CS first reply (jam)', direction: 'lower', defaultTarget: 0.05, defaultWeight: 0, unit: 'jam' }
  ],
  supervisor: [
    { key: 'approval_hours', label: 'Avg. waktu approve PR (jam)', direction: 'lower', defaultTarget: 4, defaultWeight: 20, unit: 'jam' },
    { key: 'issue_hours', label: 'Avg. resolusi kendala (jam)', direction: 'lower', defaultTarget: 8, defaultWeight: 15, unit: 'jam' },
    { key: 'task_sla_pct', label: 'Task SLA %', direction: 'higher', defaultTarget: 90, defaultWeight: 25, unit: '%' },
    { key: 'mom_growth_pct', label: 'MoM revenue growth %', direction: 'higher', defaultTarget: 5, defaultWeight: 20, unit: '%' },
    { key: 'new_customers', label: 'Pelanggan baru', direction: 'higher', defaultTarget: 20, defaultWeight: 20, unit: 'org' }
  ],
  admin_ops: [
    { key: 'exec_hours', label: 'Avg. PR Approved → Paid (jam)', direction: 'lower', defaultTarget: 12, defaultWeight: 40, unit: 'jam' },
    { key: 'fulfill_pct', label: 'Inventory fulfillment %', direction: 'higher', defaultTarget: 90, defaultWeight: 40, unit: '%' },
    { key: 'pr_paid_count', label: 'PR Paid', direction: 'higher', defaultTarget: 8, defaultWeight: 20, unit: 'PR' }
  ],
  digital_marketing: [
    { key: 'redemptions', label: 'Promo voucher redemptions', direction: 'higher', defaultTarget: 300, defaultWeight: 60, unit: 'x' },
    { key: 'conversion_pct', label: 'Campaign conversion %', direction: 'higher', defaultTarget: 20, defaultWeight: 40, unit: '%' }
  ],
  finance: [
    { key: 'recon_pct', label: 'Cash vs Bank match %', direction: 'higher', defaultTarget: 95, defaultWeight: 70, unit: '%' },
    { key: 'opex_recorded', label: 'OPEX tercatat (Rp)', direction: 'higher', defaultTarget: 1, defaultWeight: 30, unit: 'Rp' }
  ],
  owner_relation: [
    { key: 'response_pct', label: 'Response rate query %', direction: 'higher', defaultTarget: 90, defaultWeight: 60, unit: '%' },
    { key: 'reply_hours', label: 'Avg. waktu balas (jam)', direction: 'lower', defaultTarget: 2, defaultWeight: 40, unit: 'jam' }
  ]
};

/** Baris khusus: target_value = poin penalti per tugas overdue; weight tidak dihitung ke rata-rata metrik. */
export const SLA_PENALTY_KEY = 'sla_penalty_points';

export const currentMonthYear = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export const shiftMonthYear = (monthYear: string, delta: number) => {
  const [y, m] = monthYear.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1 + delta, 1);
  return currentMonthYear(dt);
};

export const catalogMetric = (role: string, key: string): CatalogMetric | undefined =>
  (KPI_CATALOG[role] || []).find((m) => m.key === key);

export const defaultRowsForRole = (role: string) => {
  const metrics = KPI_CATALOG[role] || [];
  return [
    ...metrics.map((m) => ({
      metric_key: m.key,
      metric_label: m.label,
      target_value: m.defaultTarget,
      weight_percentage: m.defaultWeight,
      is_active: true
    })),
    {
      metric_key: SLA_PENALTY_KEY,
      metric_label: 'Poin penalti SLA per tugas overdue',
      target_value: 10,
      weight_percentage: 0,
      is_active: true
    }
  ];
};

export const scoreAgainstTarget = (
  actual: number,
  target: number,
  direction: MetricDirection
): number => {
  const a = Number(actual) || 0;
  const t = Number(target);

  if (direction === 'lower') {
    if (!t || t <= 0) return a <= 0 ? 100 : Math.max(0, 100 - a * 25);
    if (a <= t) return 100;
    return Math.max(0, Math.round((t / a) * 100));
  }

  if (!t || t <= 0) return a > 0 ? 100 : 0;
  return Math.min(100, Math.round((a / t) * 100));
};
