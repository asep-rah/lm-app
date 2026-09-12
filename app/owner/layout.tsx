import type { Metadata } from 'next';
import { Suspense } from 'react';
import OwnerNavHost from '@/components/owner/OwnerNavHost';

export const metadata: Metadata = {
  title: {
    default: 'Dashboard Owner',
    template: '%s · Owner · Laundrivery'
  },
  description: 'Area privat manajemen Laundrivery — tidak untuk diindeks mesin pencari.',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true
    }
  }
};

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="pb-28">
      <Suspense fallback={children}>
        <OwnerNavHost>{children}</OwnerNavHost>
      </Suspense>
    </div>
  );
}
