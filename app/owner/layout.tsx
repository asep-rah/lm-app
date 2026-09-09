import { Suspense } from 'react';
import OwnerNavHost from '@/components/owner/OwnerNavHost';

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="pb-28">
      <Suspense fallback={children}>
        <OwnerNavHost>{children}</OwnerNavHost>
      </Suspense>
    </div>
  );
}
