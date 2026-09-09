export type LatLng = { lat: number; lng: number };

export const haversineKm = (a: LatLng, b: LatLng) => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

/** Tarif Lalamove-style: base 3 km, lalu +2rb/km, dikali 2 untuk pulang-pergi. */
export const ongkirRoundTripFromOneWayKm = (oneWayKm: number) => {
  const km = Math.max(0, Number(oneWayKm) || 0);
  let oneWay = 9000;
  if (km > 3) oneWay += Math.ceil(km - 3) * 2000;
  return oneWay * 2;
};

const osrmUrl = (base: string, a: LatLng, b: LatLng) =>
  `${base}/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`;

const OSRM_BASES = [
  'https://router.project-osrm.org/route/v1/driving',
  'https://routing.openstreetmap.de/routed-car/route/v1/driving'
];

const parseOsrmKm = (json: any) => {
  if (json?.code && String(json.code).toUpperCase() !== 'OK') return null;
  const meters = Number(json?.routes?.[0]?.distance);
  if (!Number.isFinite(meters) || meters <= 0) return null;
  return Math.round((meters / 1000) * 10) / 10;
};

/** Jarak rute jalan (bukan garis lurus). Fallback haversine jika router gagal. */
export async function roadDistanceKm(from: LatLng, to: LatLng): Promise<number> {
  for (const base of OSRM_BASES) {
    try {
      const res = await fetch(osrmUrl(base, from, to), {
        headers: { Accept: 'application/json', 'User-Agent': 'Laundrivery/1.0' }
      });
      if (!res.ok) continue;
      const km = parseOsrmKm(await res.json());
      if (km != null) return km;
    } catch {
      /* coba endpoint berikutnya */
    }
  }
  return Math.round(haversineKm(from, to) * 10) / 10;
}

export async function fetchCustomerRoadKm(from: LatLng, to: LatLng): Promise<number> {
  try {
    const q = new URLSearchParams({
      fromLat: String(from.lat),
      fromLng: String(from.lng),
      toLat: String(to.lat),
      toLng: String(to.lng)
    });
    const res = await fetch(`/api/road-distance?${q}`);
    if (res.ok) {
      const km = Number((await res.json())?.km);
      if (Number.isFinite(km) && km > 0) return Math.round(km * 10) / 10;
    }
  } catch {
    /* fallback garis lurus */
  }
  return Math.round(haversineKm(from, to) * 10) / 10;
}
