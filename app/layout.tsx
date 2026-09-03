import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import ToastHost from "@/components/ui/ToastHost";
import PushPermissionBanner from "@/components/PushPermissionBanner";
import OutletGroupChatDrawer from "@/components/OutletGroupChatDrawer";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Laundrivery - Express Laundry Delivery",
  description: "Sistem Manajemen Laundry Terintegrasi",
  applicationName: "Laundrivery",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Laundrivery",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#2563eb",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode; }>) {
  return (
    <html lang="id">
      <body className={`${inter.className} bg-slate-50 text-slate-900 antialiased`}>
        <ToastHost />
        {children}
        <PushPermissionBanner />
        <OutletGroupChatDrawer />
      </body>
    </html>
  );
}