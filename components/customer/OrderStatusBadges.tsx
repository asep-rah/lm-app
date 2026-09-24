'use client';

import { CheckCircle2, Clock, Receipt, Wallet } from 'lucide-react';
import type { CustomerPaymentBadge, CustomerProgress } from '@/lib/customerOrderView';

const PAY_TONE: Record<CustomerPaymentBadge['tone'], string> = {
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  pending: 'bg-amber-50 text-amber-800 border-amber-200',
  unpaid: 'bg-slate-100 text-slate-700 border-slate-200',
  estimate: 'bg-slate-50 text-slate-600 border-slate-200'
};

/** Payment state badge — deliberately separate from laundry progress. */
export function PaymentBadge({ payment }: { payment: CustomerPaymentBadge }) {
  const Icon = payment.tone === 'paid' ? CheckCircle2 : payment.tone === 'estimate' ? Receipt : Wallet;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${PAY_TONE[payment.tone]}`}
    >
      <Icon className="w-3 h-3" strokeWidth={2.4} />
      {payment.label}
    </span>
  );
}

/** Laundry progress: label + step bar (payment step excluded). */
export function ProgressBar({ progress }: { progress: CustomerProgress }) {
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-extrabold text-brand-800 inline-flex items-center gap-1">
          <Clock className="w-3.5 h-3.5" /> {progress.label}
        </span>
        {progress.total > 0 && (
          <span className="text-[10px] font-bold text-slate-500">
            {progress.done}/{progress.total} tahap
          </span>
        )}
      </div>
      {progress.total > 0 && (
        <div
          className="h-1.5 rounded-full bg-slate-100 overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.done}
          aria-label={`Progres cucian: ${progress.label}`}
        >
          <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
