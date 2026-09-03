import CsPortalHeader from '@/components/cs/CsPortalHeader';
import CsPortalProvider from '@/components/cs/CsPortalProvider';

export default function CsLayout({ children }: { children: React.ReactNode }) {
  return (
    <CsPortalProvider>
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <CsPortalHeader />
        <div className="flex-1 min-h-0">{children}</div>
      </div>
    </CsPortalProvider>
  );
}
