'use client';

import { Navigation } from 'lucide-react';
import { coordsOf, openGoogleMapsNav } from '@/lib/mapsNav';

export default function GoogleMapsNavButton({
  order,
  address,
  className
}: {
  order: any;
  address?: string;
  className?: string;
}) {
  const hasPin = Boolean(coordsOf(order) || coordsOf(order?.customer_addresses));
  return (
    <button
      type="button"
      onClick={() => openGoogleMapsNav(order, address)}
      className={
        className ||
        'w-full bg-sky-600 hover:bg-sky-700 text-white font-black text-[11px] py-2.5 rounded-xl inline-flex items-center justify-center gap-1.5 shadow-sm'
      }
    >
      <Navigation className="w-3.5 h-3.5" />
      Navigasi Google Maps{hasPin ? '' : ' (alamat)'}
    </button>
  );
}
