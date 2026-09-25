/**
 * Pickup location rules shared by the customer form, the order server and the
 * driver pin correction (pure — browser + server).
 *
 * Service radius: an outlet only serves pickup pins within
 * SERVICE_RADIUS_KM, measured in a straight line from the pin to the outlet
 * (not road distance, so the check is the same in the browser and on the
 * server and does not depend on a routing service).
 */

/** Jangkauan layanan jemput: jarak garis lurus maksimum pin → outlet (ditetapkan owner). */
export const SERVICE_RADIUS_KM = 30;
/** GPS lebih kasar dari ini dianggap kurang akurat: pelanggan diminta menggeser pin ke gerbang. */
export const GPS_ACCURACY_WARN_M = 50;
/** Driver hanya boleh menyimpan koreksi titik dengan GPS seakurat ini. */
export const PIN_CORRECTION_MAX_ACCURACY_M = 50;
/** Pin yang digeser lebih jauh dari ini dari hasil pencarian → peringatan "periksa lagi". */
export const SEARCH_DRIFT_WARN_M = 300;

export type LatLon = { lat: number; lon: number };

const finite = (v: unknown) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Valid map point (not 0,0, inside lat/lon ranges) or null. */
export const toLatLon = (lat: unknown, lon: unknown): LatLon | null => {
  const a = finite(lat);
  const b = finite(lon);
  if (a == null || b == null) return null;
  if (a < -90 || a > 90 || b < -180 || b > 180) return null;
  if (Math.abs(a) < 0.00001 && Math.abs(b) < 0.00001) return null;
  return { lat: a, lon: b };
};

/** Great-circle distance in kilometres. */
export const distanceKm = (a: LatLon, b: LatLon) => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

export const distanceM = (a: LatLon, b: LatLon) => distanceKm(a, b) * 1000;

export const isWithinServiceRadius = (pin: LatLon, outlet: LatLon, radiusKm = SERVICE_RADIUS_KM) =>
  distanceKm(pin, outlet) <= radiusKm;

/** 'good' ≤ GPS_ACCURACY_WARN_M, 'poor' above it, 'unknown' when the device gave no value. */
export const gpsAccuracyLevel = (accuracyM: unknown): 'good' | 'poor' | 'unknown' => {
  const m = finite(accuracyM);
  if (m == null || m < 0) return 'unknown';
  return m <= GPS_ACCURACY_WARN_M ? 'good' : 'poor';
};

/** "±12 m" / "±1,2 km" for the customer. */
export const formatMeters = (m: number) =>
  m < 1000 ? `±${Math.round(m)} m` : `±${(m / 1000).toFixed(1).replace('.', ',')} km`;

type OutletRow = { latitude?: unknown; longitude?: unknown; is_overcapacity?: boolean | null; is_coming_soon?: boolean | null } | null;

/**
 * Server check of a new pickup order against its outlet: the pin is required,
 * the outlet must be open (not coming soon / not marked penuh) and the pin
 * within the service radius. Outlets without a location cannot be checked for
 * distance and are accepted (as before).
 */
export const checkPickupServiceArea = (
  pin: { latitude?: unknown; longitude?: unknown },
  outlet: OutletRow
): { ok: true } | { ok: false; status: number; error: string } => {
  if (!outlet) return { ok: false, status: 400, error: 'Outlet tidak ditemukan.' };
  if (outlet.is_coming_soon === true) return { ok: false, status: 400, error: 'Outlet ini belum melayani pesanan (coming soon).' };
  if (outlet.is_overcapacity === true) {
    return { ok: false, status: 409, error: 'Outlet sedang penuh dan ditutup sementara. Pilih outlet lain atau coba lagi nanti.' };
  }
  const p = toLatLon(pin.latitude, pin.longitude);
  if (!p) return { ok: false, status: 400, error: 'Pasang titik jemput di peta terlebih dahulu.' };
  const o = toLatLon(outlet.latitude, outlet.longitude);
  if (o && !isWithinServiceRadius(p, o)) {
    const km = distanceKm(p, o).toFixed(1).replace('.', ',');
    return {
      ok: false,
      status: 400,
      error: `Titik jemput di luar jangkauan outlet (±${km} km, maksimal ${SERVICE_RADIUS_KM} km).`
    };
  }
  return { ok: true };
};
