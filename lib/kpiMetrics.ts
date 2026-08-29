import { supabase } from '@/lib/supabaseClient';
import { isStaffOnlyMessage, threadKeyOf } from '@/lib/csChat';
import { isVoidTransaction } from '@/lib/voidTx';
import { overdueCountForRole, overduePenaltyForRole, isTaskCompleted } from '@/lib/taskRoles';
import { isPrPaid, prApprovedAt, prPaidAt } from '@/lib/cmsRequisition';
import {
  catalogMetric,
  currentMonthYear,
  defaultRowsForRole,
  KPI_ROLES,
  scoreAgainstTarget
} from '@/lib/kpiCatalog';
import { fetchKpiConfigs, scoredMetrics, slaPenaltyConfig, type KpiConfigRow } from '@/lib/kpiConfigs';

export type KpiMetricLine = {
  key: string;
  label: string;
  actual: number;
  target: number;
  weight: number;
  pct: number;
  unit?: string;
};

export type KpiCard = {
  role: string;
  roleKey: string;
  val: string;
  status: string;
  desc: string;
  color: string;
  healthy: boolean;
  score: number;
  metrics: KpiMetricLine[];
  penalty: number;
};

const healthyColor = 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10';
const warnColor = 'border-amber-500/30 text-amber-400 bg-amber-500/10';
const dangerColor = 'border-rose-500/30 text-rose-400 bg-rose-500/10';

const iso = (d: Date) => d.toISOString();

const hoursBetween = (from: any, to: any): number | null => {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (isNaN(a) || isNaN(b) || b < a) return null;
  return (b - a) / 3_600_000;
};

const avg = (nums: number[]) => {
  if (!nums.length) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
};

const fmtHours = (h: number) => {
  if (!h || !isFinite(h)) return '—';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} mnt`;
  return `${h.toFixed(1)} jam`;
};

const pct = (part: number, whole: number) => {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
};

const tone = (score: number, good = 90, ok = 70) =>
  score >= good ? healthyColor : score >= ok ? warnColor : dangerColor;

const applyPenalty = (score: number, penalty: number) =>
  Math.max(0, Math.round(Number(score) || 0) - Math.max(0, Number(penalty) || 0));

const isHealthy = (score: number, good = 90) => score >= good;

const safeSelect = async (table: string, columns: string, extra?: (q: any) => any) => {
  let q = supabase.from(table).select(columns);
  if (extra) q = extra(q);
  const { data, error } = await q;
  if (error) {
    console.warn(`[KPI] ${table}:`, error.message);
    return [] as any[];
  }
  return data || [];
};

const isPickupDone = (status: any) => {
  const s = String(status || '').toLowerCase();
  if (s.includes('batal') || s.includes('cancel')) return false;
  return (
    s.includes('tiba') ||
    s.includes('terkirim') ||
    s.includes('delivered') ||
    s.includes('completed') ||
    (s.includes('selesai') && !s.includes('siap'))
  );
};

const pickupFinishMs = (row: any): number | null => {
  for (const key of ['picked_up_at', 'arrived_outlet_at', 'delivered_at', 'accepted_at']) {
    const t = new Date(row?.[key]).getTime();
    if (!isNaN(t) && t > 0) return t;
  }
  return null;
};

const isPickupOnTrack = (row: any, now: number) => {
  const status = String(row.status || '').toLowerCase();
  if (status.includes('batal') || status.includes('cancel')) return true;
  const created = new Date(row.created_at).getTime();
  const finish = pickupFinishMs(row);
  const slaMs = 2 * 3_600_000;
  if (finish !== null && !isNaN(created)) return finish - created <= slaMs;
  if (isPickupDone(row.status)) return true;
  if (isNaN(created)) return true;
  return now - created <= slaMs;
};

const fmtActual = (key: string, n: number, unit?: string) => {
  if (key.includes('hours')) return fmtHours(n);
  if (unit === '%' || key.endsWith('_pct')) return `${Math.round(n)}%`;
  if (unit === 'Rp' || key === 'opex_recorded') return `Rp ${Math.round(n).toLocaleString('id-ID')}`;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
};

const fallbackConfigs = (monthYear: string): KpiConfigRow[] =>
  KPI_ROLES.flatMap((role) =>
    defaultRowsForRole(role.key).map((m) => ({
      month_year: monthYear,
      role: role.key,
      ...m
    }))
  );

export const fetchRoleKpis = async (
  monthYear = currentMonthYear()
): Promise<{ cards: KpiCard[]; healthyCount: number; monthYear: string; fromConfig: boolean }> => {
  const [y, m] = monthYear.split('-').map(Number);
  const thisStart = new Date(y, (m || 1) - 1, 1);
  const nextStart = new Date(y, m || 1, 1);
  const lastStart = new Date(y, (m || 1) - 2, 1);
  const now = Date.now();

  try {
  const [
    txsThisAll,
    txsLast,
    workLogs,
    pickups,
    requisitions,
    issues,
    tasks,
    customersThis,
    customersLast,
    inventory,
    promos,
    discountedTx,
    closings,
    chats,
    chatSessions,
    expenses,
    storedConfigs,
    reviews
  ] = await Promise.all([
    safeSelect('transactions', 'id, amount, created_at, customer_phone, discount_amount, payment_method, status', (q) =>
      q.gte('created_at', iso(thisStart)).lt('created_at', iso(nextStart))
    ),
    safeSelect('transactions', 'id, amount, created_at, status', (q) =>
      q.gte('created_at', iso(lastStart)).lt('created_at', iso(thisStart))
    ),
    safeSelect('work_logs', 'transaction_id, created_at', (q) =>
      q.gte('created_at', iso(thisStart)).lt('created_at', iso(nextStart)).order('created_at', { ascending: true })
    ),
    safeSelect('pickup_orders', '*', (q) =>
      q.gte('created_at', iso(thisStart)).lt('created_at', iso(nextStart))
    ),
    safeSelect('purchase_requests', '*'),
    safeSelect('outlet_issues', 'id, status, created_at, resolved_at, category'),
    safeSelect('system_tasks', 'id, status, due_date, completed_at, assigned_to_role, kpi_penalty_points'),
    safeSelect('customers', 'id, created_at', (q) =>
      q.gte('created_at', iso(thisStart)).lt('created_at', iso(nextStart))
    ),
    safeSelect('customers', 'id, created_at', (q) =>
      q.gte('created_at', iso(lastStart)).lt('created_at', iso(thisStart))
    ),
    safeSelect('inventory', 'id, stock_ml_gram'),
    safeSelect('promos', 'id, used_count, max_quota, is_active'),
    safeSelect('transactions', 'id', (q) =>
      q.gte('created_at', iso(thisStart)).lt('created_at', iso(nextStart)).gt('discount_amount', 0)
    ),
    safeSelect('cash_closings', 'id, cash_difference, created_at', (q) =>
      q.gte('created_at', iso(thisStart)).lt('created_at', iso(nextStart))
    ),
    safeSelect('support_chats', '*', (q) =>
      q.order('created_at', { ascending: true }).limit(800)
    ),
    safeSelect('support_chat_sessions', '*'),
    safeSelect('expenses', 'id, amount, category, created_at', (q) =>
      q.gte('created_at', iso(thisStart)).lt('created_at', iso(nextStart))
    ),
    fetchKpiConfigs(monthYear),
    safeSelect('order_reviews', 'rating, outlet_id, created_at', (q) =>
      q.gte('created_at', iso(thisStart)).lt('created_at', iso(nextStart))
    )
  ]);

  const txsThis = (txsThisAll || []).filter((t: { status?: unknown }) => !isVoidTransaction(t));

  const fromConfig = storedConfigs.length > 0;
  const configs = fromConfig ? storedConfigs : fallbackConfigs(monthYear);

  const byTx: Record<string, number[]> = {};
  workLogs.forEach((l: any) => {
    const id = l.transaction_id;
    const t = new Date(l.created_at).getTime();
    if (!id || isNaN(t)) return;
    (byTx[id] ||= []).push(t);
  });
  const processHours = Object.values(byTx)
    .map((times) => {
      if (times.length < 2) return null;
      return (Math.max(...times) - Math.min(...times)) / 3_600_000;
    })
    .filter((n): n is number => n !== null && n > 0 && n < 72);
  const avgProcess = avg(processHours);

  const pickupDone = pickups.filter(
    (p: any) => isPickupDone(p.status) && !String(p.status || '').toLowerCase().includes('batal')
  );
  const pickupOnTime = pickups.filter((p: any) => isPickupOnTrack(p, now));
  const pickupSla = pct(pickupOnTime.length, pickups.length || pickupOnTime.length);
  const pickupSpeeds = pickupDone
    .map((p: any) => hoursBetween(p.created_at, p.picked_up_at || p.arrived_outlet_at || p.delivered_at || p.accepted_at))
    .filter((n: number | null): n is number => n !== null && n > 0 && n < 48);
  const avgPickupSpeed = avg(pickupSpeeds);
  const courierTasksDone = tasks.filter((t: any) => {
    const role = String(t.assigned_to_role || '').toLowerCase();
    const at = new Date(t.completed_at || t.created_at).getTime();
    const inMonth = at >= thisStart.getTime() && at < nextStart.getTime();
    return inMonth && isTaskCompleted(t.status) && ['driver', 'courier', 'kurir', 'cs', 'head_cs'].includes(role);
  }).length;
  const complaints = issues.filter((i: any) => {
    const c = String(i.category || i.description || i.status || '').toLowerCase();
    const created = new Date(i.created_at).getTime();
    const inMonth = created >= thisStart.getTime() && created < nextStart.getTime();
    return inMonth && (c.includes('komplain') || c.includes('pelanggan') || c.includes('pending_resolution'));
  }).length;

  const approvedReqs = requisitions.filter((r: any) => prApprovedAt(r));
  const approvalHours = approvedReqs
    .map((r: any) => hoursBetween(r.created_at, prApprovedAt(r)))
    .filter((n: number | null): n is number => n !== null);
  const resolvedIssues = issues.filter((i: any) => i.resolved_at || String(i.status || '').toLowerCase().includes('selesai'));
  const issueHours = resolvedIssues
    .map((i: any) => hoursBetween(i.created_at, i.resolved_at || i.created_at))
    .filter((n: number | null): n is number => n !== null);
  const supervisorTasks = tasks.filter((t: any) =>
    ['supervisor'].includes(String(t.assigned_to_role || '').toLowerCase())
  );
  const tasksOnTime = supervisorTasks.filter((t: any) => {
    if (String(t.status || '').toLowerCase() === 'completed') {
      const due = t.due_date ? new Date(t.due_date).getTime() : Infinity;
      const done = t.completed_at ? new Date(t.completed_at).getTime() : now;
      return done <= due;
    }
    if (!t.due_date) return true;
    return new Date(t.due_date).getTime() >= now;
  });
  const taskSlaRaw = pct(tasksOnTime.length, supervisorTasks.length) || 100;

  const revThis = txsThis.reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0);
  const revLast = (txsLast || [])
    .filter((t: any) => !isVoidTransaction(t))
    .reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0);
  const mom = revLast > 0 ? Math.round(((revThis - revLast) / revLast) * 100) : revThis > 0 ? 100 : 0;
  const newCustThis = customersThis.length || new Set(txsThis.map((t: any) => t.customer_phone).filter(Boolean)).size;

  const paidReqs = requisitions.filter((r: any) => isPrPaid(r) || prPaidAt(r));
  const execHours = paidReqs
    .map((r: any) => hoursBetween(prApprovedAt(r) || r.created_at, prPaidAt(r)))
    .filter((n: number | null): n is number => n !== null);
  const awaiting = requisitions.filter((r: any) => String(r.status || '').includes('Awaiting'));
  const fulfillFromReq = pct(paidReqs.length, paidReqs.length + awaiting.length);
  const inStock = inventory.filter((i: any) => Number(i.stock_ml_gram) > 0).length;
  const invRate = inventory.length ? pct(inStock, inventory.length) : fulfillFromReq;

  const redemptions = promos.reduce((s: number, p: any) => s + (Number(p.used_count) || 0), 0);
  const promoQuota = promos.reduce((s: number, p: any) => s + (Number(p.max_quota) || 0), 0);
  const conversion = promoQuota > 0 ? pct(redemptions, promoQuota) : pct(discountedTx.length, txsThis.length);

  const matchedClosings = closings.filter((c: any) => Number(c.cash_difference) === 0).length;
  const cashTx = txsThis.filter((t: any) => String(t.payment_method || '').toLowerCase().includes('cash'));
  const bankTx = txsThis.filter((t: any) => {
    const pm = String(t.payment_method || '').toLowerCase();
    return pm.includes('qris') || pm.includes('transfer') || pm.includes('bank') || pm.includes('xendit');
  });
  const closeMatch = closings.length ? pct(matchedClosings, closings.length) : null;
  const mixOk = txsThis.length ? pct(cashTx.length + bankTx.length, txsThis.length) : 100;
  const recon = closeMatch ?? mixOk;
  const expTotal = expenses.reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);

  const sortedChats = [...chats].sort(
    (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const customerMsgs = sortedChats.filter((c: any) => {
    if (isStaffOnlyMessage(c)) return false;
    const who = String(c.sender_type || c.sender || '').toLowerCase();
    return who === 'customer' || who === 'user' || who === 'investor';
  });
  let replied = 0;
  const replyHours: number[] = [];
  customerMsgs.forEach((msg: any) => {
    const t0 = new Date(msg.created_at).getTime();
    const reply = sortedChats.find((c: any) => {
      const who = String(c.sender_type || c.sender || '').toLowerCase();
      const isStaff = who === 'cs' || who === 'admin' || who === 'owner';
      const sameThread =
        (c.order_id && msg.order_id && c.order_id === msg.order_id) ||
        (c.customer_phone && msg.customer_phone && c.customer_phone === msg.customer_phone);
      return isStaff && sameThread && new Date(c.created_at).getTime() > t0;
    });
    if (reply) {
      replied += 1;
      const h = hoursBetween(msg.created_at, reply.created_at);
      if (h !== null) replyHours.push(h);
    }
  });
  const responseRate = pct(replied, customerMsgs.length);

  const inMonthTs = (v: any) => {
    const t = new Date(v).getTime();
    return !isNaN(t) && t >= thisStart.getTime() && t < nextStart.getTime();
  };
  const csResolved = (chatSessions || []).filter(
    (s: any) => s.is_resolved && inMonthTs(s.resolved_at || s.last_message_at)
  ).length;
  const sessionReplyHours = (chatSessions || [])
    .map((s: any) => hoursBetween(s.first_customer_at, s.first_cs_at))
    .filter((n: number | null): n is number => n !== null && n > 0 && n < 72);
  const threadFirstReply: number[] = [];
  const chatByThread: Record<string, any[]> = {};
  sortedChats.forEach((c: any) => {
    const k = threadKeyOf(c);
    if (!k || k === 'unknown') return;
    (chatByThread[k] ||= []).push(c);
  });
  Object.values(chatByThread).forEach((list) => {
    const firstCust = list.find((c: any) => {
      const who = String(c.sender_type || '').toLowerCase();
      return who === 'customer' || who === 'user';
    });
    if (!firstCust || !inMonthTs(firstCust.created_at)) return;
    const firstCs = list.find((c: any) => {
      const who = String(c.sender_type || '').toLowerCase();
      return (
        ['cs', 'admin', 'owner'].includes(who) &&
        new Date(c.created_at).getTime() > new Date(firstCust.created_at).getTime()
      );
    });
    if (!firstCs) return;
    const h = hoursBetween(firstCust.created_at, firstCs.created_at);
    if (h !== null && h > 0 && h < 72) threadFirstReply.push(h);
  });
  const csReplyHours = avg(sessionReplyHours.length ? sessionReplyHours : threadFirstReply.length ? threadFirstReply : replyHours);

  const csatAvg = avg(
    (reviews || [])
      .map((r: any) => Number(r.rating) || 0)
      .filter((n: number) => n >= 1 && n <= 5)
  );

  const actuals: Record<string, Record<string, number>> = {
    kasir: { tx_count: txsThis.length, process_hours: avgProcess },
    kurir_cs: {
      pickup_done: pickupDone.length,
      pickup_sla_pct: pickupSla,
      pickup_speed_hours: avgPickupSpeed,
      tasks_completed: courierTasksDone,
      complaints,
      cs_resolved: csResolved,
      cs_reply_hours: csReplyHours
    },
    supervisor: {
      approval_hours: avg(approvalHours),
      issue_hours: avg(issueHours),
      task_sla_pct: taskSlaRaw,
      mom_growth_pct: mom,
      new_customers: newCustThis
    },
    admin_ops: { exec_hours: avg(execHours), fulfill_pct: invRate, pr_paid_count: paidReqs.length },
    digital_marketing: { redemptions, conversion_pct: conversion },
    finance: { recon_pct: recon, opex_recorded: expTotal },
    owner_relation: {
      response_pct: customerMsgs.length ? responseRate : 100,
      reply_hours: avg(replyHours),
      csat_avg: csatAvg
    }
  };

  const headlines: Record<string, (score: number) => { val: string; desc: string }> = {
    kasir: (score) => ({
      val: `${txsThis.length} Transaksi`,
      desc: `Target tertimbang ${score}% · avg proses ${fmtHours(avgProcess)}`
    }),
    kurir_cs: (score) => ({
      val: `${pickupDone.length}/${pickups.length} jemput · ${csResolved} chat`,
      desc: `SLA ${pickupSla}% · avg jemput ${fmtHours(avgPickupSpeed)} · avg balas CS ${fmtHours(csReplyHours)} · resolved ${csResolved}`
    }),
    supervisor: (score) => ({
      val: `Approve ${fmtHours(avg(approvalHours))}`,
      desc: `MoM ${mom >= 0 ? '+' : ''}${mom}% · pelanggan baru ${newCustThis} · skor ${score}%`
    }),
    admin_ops: (score) => ({
      val: `Eksekusi ${fmtHours(avg(execHours))}`,
      desc: `${paidReqs.length} PR Paid · fulfill ${invRate}%`
    }),
    digital_marketing: (score) => ({
      val: `${redemptions} Redeem`,
      desc: `Konversi ${conversion}% dari ${txsThis.length} trx`
    }),
    finance: (score) => ({
      val: `${recon}% Match`,
      desc: `OPEX Rp ${Number(expTotal).toLocaleString('id-ID')}`
    }),
    owner_relation: (score) => ({
      val: csatAvg ? `⭐ ${csatAvg.toFixed(1)} CSAT` : customerMsgs.length ? `${responseRate}% Response` : '0 Query',
      desc: `${replied}/${customerMsgs.length} query dibalas · avg ${fmtHours(avg(replyHours))} · rating ${csatAvg ? csatAvg.toFixed(1) : '—'} · skor ${score}%`
    })
  };

  const cards: KpiCard[] = KPI_ROLES.map((role) => {
    const roleActuals = actuals[role.key] || {};
    const metricRows = scoredMetrics(configs, role.key);
    const lines: KpiMetricLine[] = metricRows.map((row) => {
      const cat = catalogMetric(role.key, row.metric_key);
      const direction = cat?.direction || 'higher';
      const actual = Number(roleActuals[row.metric_key] ?? 0);
      const target = Number(row.target_value) || 0;
      const weight = Number(row.weight_percentage) || 0;
      return {
        key: row.metric_key,
        label: row.metric_label,
        actual,
        target,
        weight,
        pct: scoreAgainstTarget(actual, target, direction),
        unit: cat?.unit
      };
    });

    const totalWeight = lines.reduce((s, l) => s + l.weight, 0) || 0;
    const weighted =
      totalWeight > 0
        ? Math.round(lines.reduce((s, l) => s + l.pct * (l.weight / totalWeight), 0))
        : lines.length
        ? Math.round(avg(lines.map((l) => l.pct)))
        : 0;

    const overdueRaw = overduePenaltyForRole(tasks, role.key, now);
    const overdueN = overdueCountForRole(tasks, role.key, now);
    const slaCfg = slaPenaltyConfig(configs, role.key);
    const penalty = slaCfg?.is_active
      ? overdueN * (Number(slaCfg.target_value) || 0)
      : overdueRaw;
    const score = applyPenalty(weighted, penalty);
    const head = (headlines[role.key] || (() => ({ val: `${score}%`, desc: '' })))(score);

    return {
      role: role.label,
      roleKey: role.key,
      val: head.val,
      status: `${score}% vs target`,
      desc: `${head.desc}${penalty > 0 ? ` · −${penalty} SLA overdue` : ''}${fromConfig ? '' : ' · default catalog'}`,
      color: tone(score),
      healthy: isHealthy(score),
      score,
      metrics: lines,
      penalty
    };
  });

  return {
    cards,
    healthyCount: cards.filter((c) => c.healthy).length,
    monthYear,
    fromConfig
  };
  } catch (err) {
    console.warn('[KPI] fetchRoleKpis gagal:', err);
    return {
      cards: KPI_ROLES.map((role) => ({
        role: role.label,
        roleKey: role.key,
        val: '—',
        status: '0% vs target',
        desc: 'Sumber data kosong atau tabel belum siap',
        color: warnColor,
        healthy: false,
        score: 0,
        metrics: [],
        penalty: 0
      })),
      healthyCount: 0,
      monthYear,
      fromConfig: false
    };
  }
};
