'use client';

import { ACTIVITY_TABS, type ActivitySubTab } from '@/lib/customerActivity';

export default function ActivitySegmentTabs({
  value,
  onChange,
  counts
}: {
  value: ActivitySubTab;
  onChange: (tab: ActivitySubTab) => void;
  counts?: Partial<Record<ActivitySubTab, number>>;
}) {
  return (
    <div className="bg-slate-100 p-1 rounded-2xl grid grid-cols-3 gap-1">
      {ACTIVITY_TABS.map((tab) => {
        const on = value === tab.id;
        const n = counts?.[tab.id];
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`relative py-2 rounded-xl text-[11px] font-extrabold transition-all duration-200 ${
              on ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
            {typeof n === 'number' && n > 0 && (
              <span
                className={`ml-1 inline-flex min-w-[16px] h-4 px-1 items-center justify-center rounded-full text-[9px] ${
                  on ? 'bg-blue-600 text-white' : 'bg-slate-300 text-slate-700'
                }`}
              >
                {n > 99 ? '99+' : n}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
