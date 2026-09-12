import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Laporan Laba Rugi',
  robots: { index: false, follow: false }
};

export default function LabaRugiLayout({ children }: { children: React.ReactNode }) {
  return children;
}
