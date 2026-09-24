import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";
import { buildDeployEnvOf, resolveSupabaseTarget } from "./lib/supabaseTarget";

const longCache = [
  { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
];

const deployEnv = buildDeployEnvOf(process.env);

const baseConfig: NextConfig = {
  // Baked into client & server bundles so runtime code knows which
  // deployment it is (lib/supabaseTarget.ts decides the allowed database).
  env: { NEXT_PUBLIC_LM_DEPLOY_ENV: deployEnv },
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
    {
      source: "/owner",
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
    },
    {
      source: "/owner/:path*",
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
    },
  ],
};

/**
 * Fail closed: a preview/dev build whose Supabase env is empty, invalid or
 * points at the production project does not build at all.
 */
export default function nextConfig(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD || phase === PHASE_DEVELOPMENT_SERVER) {
    const target = resolveSupabaseTarget({
      deployEnv,
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    });
    if (!target.ok) {
      throw new Error(
        `[supabase] Build ${deployEnv} dihentikan: ${target.reason} ` +
          "Isi NEXT_PUBLIC_SUPABASE_URL & NEXT_PUBLIC_SUPABASE_ANON_KEY dengan proyek staging/lokal (bukan produksi)."
      );
    }
    console.log(`[supabase] ${deployEnv} build → project ${target.projectRef}${target.isProductionDb ? " (PRODUKSI)" : ""}`);
  }
  return baseConfig;
}
