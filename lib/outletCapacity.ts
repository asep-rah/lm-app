const PENDING_OVERLOAD = 20;

export const isOutletOverCapacity = (outlet: any, pendingCount = 0) => {
  if (outlet?.is_overcapacity === true) return true;
  return Number(pendingCount) >= PENDING_OVERLOAD;
};

const distKm = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

/** 3 cabang terdekat dari pin pelanggan: tidak coming soon, tidak overload, siap semua durasi. */
export const pickNearestOpenOutlets = (
  outlets: any[],
  coords: { lat: number; lon: number } | null,
  pendingByOutlet: Record<string, number> = {},
  limit = 3
) => {
  if (!coords) return [];
  return (outlets || [])
    .filter((o) => !o?.is_coming_soon)
    .filter((o) => !isOutletOverCapacity(o, pendingByOutlet[o.id] || 0))
    .map((o) => {
      const lat = Number(o.latitude);
      const lon = Number(o.longitude);
      const km =
        Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0
          ? distKm(coords.lat, coords.lon, lat, lon)
          : null;
      return { o, km };
    })
    .filter((x): x is { o: any; km: number } => x.km != null)
    .sort((a, b) => a.km - b.km)
    .slice(0, limit)
    .map((x) => x.o);
};

export const nearestOpenOutlet = (
  outlets: any[],
  coords: { lat: number; lon: number } | null,
  pendingByOutlet: Record<string, number>,
  distKm: (a: number, b: number, c: number, d: number) => number
) => {
  const notSoon = (outlets || []).filter((o) => !o?.is_coming_soon);
  const open = notSoon.filter((o) => !isOutletOverCapacity(o, pendingByOutlet[o.id] || 0));
  const pool = open.length ? open : notSoon.length ? notSoon : outlets || [];
  if (!pool.length) return null;
  if (!coords) return pool[0];
  return [...pool].sort((a, b) => {
    const da = a.latitude && a.longitude ? distKm(coords.lat, coords.lon, Number(a.latitude), Number(a.longitude)) : 9999;
    const db = b.latitude && b.longitude ? distKm(coords.lat, coords.lon, Number(b.latitude), Number(b.longitude)) : 9999;
    return da - db;
  })[0];
};
