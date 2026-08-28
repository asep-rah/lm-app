import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import ToastHost from "@/components/ui/ToastHost";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Laundry Management System",
  description: "Sistem Manajemen Laundry Terintegrasi",
  manifest: "/manifest.json", 
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode; }>) {
  return (
    <html lang="id">
      <body className={`${inter.className} bg-slate-50 text-slate-900 antialiased`}>
        <ToastHost />
        {children}
      </body>
    </html>
  );
}