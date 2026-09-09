import type { NextConfig } from "next";

const longCache = [
  { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
];

const nextConfig: NextConfig = {
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.supabase.in" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "maps.googleapis.com" },
      { protocol: "https", hostname: "*.googleusercontent.com" },
    ],
  },
  headers: async () => [
    { source: "/images/:path*", headers: longCache },
    { source: "/assets/:path*", headers: longCache },
    { source: "/icon-192.png", headers: longCache },
    { source: "/icon-512.png", headers: longCache },
    { source: "/apple-touch-icon.png", headers: longCache },
    {
      source: "/manifest.json",
      headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
    },
  ],
};

export default nextConfig;
