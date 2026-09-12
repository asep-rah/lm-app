import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Diagnosis Sistem',
  robots: { index: false, follow: false }
};

export default function SystemHealthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
