'use client';

export default function CustomerHeader() {
  return (
    <div className="bg-white rounded-2xl p-3.5 shadow-sm border border-slate-200/80 flex items-center mb-4">
      <div className="flex items-center gap-2.5 min-w-0">
        {/* Official mark from /public/images/Logo-Laundrivery.png */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/Logo-Laundrivery.png"
          alt="Laundrivery"
          width={160}
          height={40}
          className="h-10 w-auto max-h-10 object-contain object-left shrink-0"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
        <div className="min-w-0">
          <h1 className="text-base font-extrabold text-slate-900 tracking-tight leading-none">Laundrivery</h1>
          <p className="text-[10px] text-blue-600 font-bold tracking-wide uppercase mt-0.5">Express Laundry Delivery</p>
        </div>
      </div>
    </div>
  );
}
