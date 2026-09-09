import { NextResponse } from 'next/server';
import { haversineKm, roadDistanceKm } from '@/lib/roadDistance';

export const dynamic = 'force-dynamic';

const cache = new Map<string, { km: number; at: number }>();
const TTL_MS = 10 * 60 * 1000;

const num = (v: string | null) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const keyOf = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  `${a.lat.toFixed(4)},${a.lng.toFixed(4)}>${b.lat.toFixed(4)},${b.lng.toFixed(4)}`;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const fromLat = num(url.searchParams.get('fromLat'));
  const fromLng = num(url.searchParams.get('fromLng'));
  const toLat = num(url.searchParams.get('toLat'));
  const toLng = num(url.searchParams.get('toLng'));
  if (fromLat == null || fromLng == null || toLat == null || toLng == null) {
    return NextResponse.json({ error: 'fromLat, fromLng, toLat, toLng wajib' }, { status: 400 });
  }

  const from = { lat: fromLat, lng: fromLng };
  const to = { lat: toLat, lng: toLng };
  const key = keyOf(from, to);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json({ km: hit.km, cached: true });
  }

  const km = await roadDistanceKm(from, to);
  cache.set(key, { km, at: Date.now() });
  return NextResponse.json({
    km,
    straightKm: Math.round(haversineKm(from, to) * 10) / 10
  });
}
