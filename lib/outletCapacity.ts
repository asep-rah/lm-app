const PENDING_OVERLOAD = 20;

export const isOutletOverCapacity = (outlet: any, pendingCount = 0) => {
  if (outlet?.is_overcapacity === true) return true;
  return Number(pendingCount) >= PENDING_OVERLOAD;
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
