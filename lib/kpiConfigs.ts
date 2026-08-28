import { supabase } from '@/lib/supabaseClient';
import { defaultRowsForRole, KPI_ROLES, SLA_PENALTY_KEY } from '@/lib/kpiCatalog';

export type KpiConfigRow = {
  id?: string;
  month_year: string;
  role: string;
  metric_key: string;
  metric_label: string;
  target_value: number;
  weight_percentage: number;
  is_active: boolean;
  updated_by?: string | null;
};

export const fetchKpiConfigs = async (monthYear: string): Promise<KpiConfigRow[]> => {
  const { data, error } = await supabase
    .from('kpi_configs')
    .select('*')
    .eq('month_year', monthYear)
    .order('role', { ascending: true });

  if (error) {
    console.warn('[KPI CONFIG]', error.message);
    return [];
  }
  return (data || []).map((r: any) => ({
    id: r.id,
    month_year: r.month_year,
    role: r.role,
    metric_key: r.metric_key,
    metric_label: r.metric_label,
    target_value: Number(r.target_value) || 0,
    weight_percentage: Number(r.weight_percentage) || 0,
    is_active: r.is_active !== false,
    updated_by: r.updated_by
  }));
};

export const seedMonthDefaults = async (monthYear: string, updatedBy: string) => {
  const existing = await fetchKpiConfigs(monthYear);
  if (existing.length > 0) return { seeded: 0, existing: existing.length };

  const rows: KpiConfigRow[] = [];
  KPI_ROLES.forEach((role) => {
    defaultRowsForRole(role.key).forEach((m) => {
      rows.push({
        month_year: monthYear,
        role: role.key,
        ...m,
        updated_by: updatedBy
      });
    });
  });

  const { error } = await supabase.from('kpi_configs').insert(rows);
  if (error) throw error;
  return { seeded: rows.length, existing: 0 };
};

export const copyMonthConfigs = async (fromMonth: string, toMonth: string, updatedBy: string) => {
  const source = await fetchKpiConfigs(fromMonth);
  if (!source.length) throw new Error(`Tidak ada konfigurasi di ${fromMonth}`);

  const dest = await fetchKpiConfigs(toMonth);
  if (dest.length) throw new Error(`${toMonth} sudah punya konfigurasi. Hapus dulu atau edit langsung.`);

  const rows = source.map((r) => ({
    month_year: toMonth,
    role: r.role,
    metric_key: r.metric_key,
    metric_label: r.metric_label,
    target_value: r.target_value,
    weight_percentage: r.weight_percentage,
    is_active: r.is_active,
    updated_by: updatedBy
  }));

  const { error } = await supabase.from('kpi_configs').insert(rows);
  if (error) throw error;
  return rows.length;
};

export const upsertKpiConfig = async (row: KpiConfigRow) => {
  const payload = {
    month_year: row.month_year,
    role: row.role,
    metric_key: row.metric_key,
    metric_label: row.metric_label,
    target_value: Number(row.target_value) || 0,
    weight_percentage: Number(row.weight_percentage) || 0,
    is_active: row.is_active !== false,
    updated_by: row.updated_by || null,
    updated_at: new Date().toISOString()
  };

  if (row.id) {
    const { error } = await supabase.from('kpi_configs').update(payload).eq('id', row.id);
    if (error) {
      const withoutTs = { ...payload };
      delete (withoutTs as any).updated_at;
      const retry = await supabase.from('kpi_configs').update(withoutTs).eq('id', row.id);
      if (retry.error) throw retry.error;
    }
    return;
  }

  const { error } = await supabase.from('kpi_configs').insert([payload]);
  if (error) {
    const withoutTs = { ...payload };
    delete (withoutTs as any).updated_at;
    const retry = await supabase.from('kpi_configs').insert([withoutTs]);
    if (retry.error) throw retry.error;
  }
};

export const deleteKpiConfig = async (id: string) => {
  const { error } = await supabase.from('kpi_configs').delete().eq('id', id);
  if (error) throw error;
};

export const configsForRole = (rows: KpiConfigRow[], role: string) =>
  rows.filter((r) => r.role === role && r.is_active);

export const slaPenaltyConfig = (rows: KpiConfigRow[], role: string) =>
  configsForRole(rows, role).find((r) => r.metric_key === SLA_PENALTY_KEY);

export const scoredMetrics = (rows: KpiConfigRow[], role: string): KpiConfigRow[] => {
  const active = configsForRole(rows, role).filter((r) => r.metric_key !== SLA_PENALTY_KEY);
  if (active.length) return active;
  return defaultRowsForRole(role)
    .filter((r) => r.metric_key !== SLA_PENALTY_KEY)
    .map((m) => ({
      month_year: '',
      role,
      metric_key: m.metric_key,
      metric_label: m.metric_label,
      target_value: m.target_value,
      weight_percentage: m.weight_percentage,
      is_active: true
    }));
};
