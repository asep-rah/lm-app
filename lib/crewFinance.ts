const monthsBetween = (from: Date, to: Date) => {
  const y = to.getFullYear() - from.getFullYear();
  const m = to.getMonth() - from.getMonth();
  const raw = y * 12 + m + (to.getDate() >= from.getDate() ? 0 : -1);
  return Math.max(0, raw);
};

export const loanTotalOf = (loan: any) =>
  Number(loan?.total_loan ?? loan?.amount ?? loan?.remaining_amount) || 0;

export const loanMonthlyOf = (loan: any) => Number(loan?.monthly_deduction) || 0;

export const isLoanRejected = (loan: any) =>
  /reject|tolak/i.test(String(loan?.status || ''));

export const isLoanPending = (loan: any) => {
  const s = String(loan?.status || '').toLowerCase();
  if (isLoanRejected(loan)) return false;
  if (s === 'pending' || s.includes('menunggu')) return true;
  if (loan?.approved_by) return false;
  if (s === 'active' || s === 'approved' || s === 'paid' || s.includes('lunas')) return false;
  return s === '' || s === 'new';
};

export const isLoanApproved = (loan: any) => {
  if (isLoanRejected(loan) || isLoanPending(loan)) return false;
  const s = String(loan?.status || '').toLowerCase();
  return Boolean(loan?.approved_by) || ['active', 'approved', 'paid', 'lunas', 'settled'].includes(s);
};

export function loanProgress(loan: any, now = new Date()) {
  const total = loanTotalOf(loan);
  const monthly = loanMonthlyOf(loan);
  const start = new Date(loan?.approved_at || loan?.created_at || now.toISOString());
  const elapsed = Number.isNaN(start.getTime()) ? 0 : monthsBetween(start, now);
  const paidStored = Number(loan?.paid_amount ?? loan?.amount_paid);
  const paid = Number.isFinite(paidStored) && paidStored > 0
    ? Math.min(total, paidStored)
    : monthly > 0
      ? Math.min(total, elapsed * monthly)
      : 0;
  const remainingRp = Math.max(0, total - paid);
  const plannedMonths = monthly > 0 ? Math.ceil(total / monthly) : remainingRp > 0 ? 1 : 0;
  const remainingMonths = monthly > 0 ? Math.ceil(remainingRp / monthly) : remainingRp > 0 ? 1 : 0;
  const paidMonths = Math.max(0, plannedMonths - remainingMonths);
  const statusPaid =
    remainingRp <= 0 || /lunas|paid|settled/i.test(String(loan?.status || ''));
  return {
    total,
    monthly,
    paid,
    remainingRp,
    remainingMonths,
    plannedMonths,
    paidMonths,
    elapsed,
    statusPaid,
    label: statusPaid ? 'Lunas' : 'Belum lunas'
  };
}

export const idr = (n: number) => `Rp ${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;
