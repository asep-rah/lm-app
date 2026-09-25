/**
 * Outlet "penuh" is a MANUAL switch (outlets.is_overcapacity), set only by the
 * owner or a supervisor through /api/staff/outlet-capacity. There is no
 * automatic rule from the number of open orders any more: counting "not
 * Selesai" rows also counted delivered/cancelled/void orders forever and
 * closed outlets by mistake.
 */
/** The outlet fields these rules read (rows are otherwise untyped Supabase data). */
import { SERVICE_RADIUS_KM } from '@/lib/serviceArea';

export type OutletLike = {
  id?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  is_overcapacity?: boolean | null;
  is_coming_soon?: boolean | null;
};

export const isOutletOverCapacity = (outlet: OutletLike | null | undefined) => outlet?.is_overcapacity === true;

const distKm = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

const hasCoords = (o: OutletLike) => {
  const lat = Number(o?.latitude);
  const lon = Number(o?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0;
};

const kmFrom = (coords: { lat: number; lon: number }, o: OutletLike) =>
  distKm(coords.lat, coords.lon, Number(o.latitude), Number(o.longitude));

/**
 * Cabang terdekat dari pin pelanggan (default 3): tidak coming soon, tidak
 * ditandai penuh, punya titik lokasi, dan dalam jangkauan layanan
 * (SERVICE_RADIUS_KM, garis lurus).
 */
export const pickNearestOpenOutlets = <T extends OutletLike>(
  outlets: T[],
  coords: { lat: number; lon: number } | null,
  limit = 3,
  radiusKm = SERVICE_RADIUS_KM
): T[] => {
  if (!coords) return [];
  return (outlets || [])
    .filter((o) => !o?.is_coming_soon)
    .filter((o) => !isOutletOverCapacity(o))
    .filter(hasCoords)
    .map((o) => ({ o, km: kmFrom(coords, o) }))
    .filter((x) => x.km <= radiusKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, limit)
    .map((x) => x.o);
};

/** Jarak garis lurus (km) ke cabang aktif terdekat — dipakai untuk pesan "di luar jangkauan". */
export const nearestServingOutletKm = (outlets: OutletLike[], coords: { lat: number; lon: number } | null): number | null => {
  if (!coords) return null;
  const kms = (outlets || [])
    .filter((o) => !o?.is_coming_soon && hasCoords(o))
    .map((o) => kmFrom(coords, o));
  return kms.length ? Math.min(...kms) : null;
};

/**
 * Why the order form shows no outlet — so the customer sees the real reason:
 * 'out_of_range' the pin is farther than SERVICE_RADIUS_KM from every active outlet;
 * 'full'         every active outlet in range was marked penuh by owner/supervisor;
 * 'no_outlet'    no active outlet with a location (none yet / coming soon / no coordinates).
 */
export const noOutletReason = (
  outlets: OutletLike[],
  coords: { lat: number; lon: number } | null = null,
  radiusKm = SERVICE_RADIUS_KM
): 'full' | 'no_outlet' | 'out_of_range' => {
  const serving = (outlets || []).filter((o) => !o?.is_coming_soon && hasCoords(o));
  if (!serving.length) return 'no_outlet';
  const inRange = coords ? serving.filter((o) => kmFrom(coords, o) <= radiusKm) : serving;
  if (!inRange.length) return 'out_of_range';
  return inRange.every(isOutletOverCapacity) ? 'full' : 'no_outlet';
};

export const nearestOpenOutlet = <T extends OutletLike>(
  outlets: T[],
  coords: { lat: number; lon: number } | null,
  distKmFn: (a: number, b: number, c: number, d: number) => number
) => {
  const notSoon = (outlets || []).filter((o) => !o?.is_coming_soon);
  const open = notSoon.filter((o) => !isOutletOverCapacity(o));
  const pool = open.length ? open : notSoon.length ? notSoon : outlets || [];
  if (!pool.length) return null;
  if (!coords) return pool[0];
  return [...pool].sort((a, b) => {
    const da = a.latitude && a.longitude ? distKmFn(coords.lat, coords.lon, Number(a.latitude), Number(a.longitude)) : 9999;
    const db = b.latitude && b.longitude ? distKmFn(coords.lat, coords.lon, Number(b.latitude), Number(b.longitude)) : 9999;
    return da - db;
  })[0];
};

/** Roles allowed to mark an outlet penuh / open it again. */
export const OUTLET_CAPACITY_ROLES = ['owner', 'supervisor'] as const;
export const canSetOutletCapacity = (role: unknown) =>
  (OUTLET_CAPACITY_ROLES as readonly string[]).includes(String(role || '').toLowerCase().trim());
