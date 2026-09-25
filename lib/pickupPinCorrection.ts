/**
 * Driver pin correction: the assigned driver, standing at the customer's
 * gate, saves the phone's GPS as the pickup point. The order's pin and the
 * customer's saved address are updated so the next pickup lands right.
 *
 * Pure rules (browser + server). Writes go through /api/staff/pickup-pin
 * (signed staff session, driver role re-read from employees, audited).
 */
import { sameDriverName } from '@/lib/driverChat';
import {
  PIN_CORRECTION_MAX_ACCURACY_M,
  SERVICE_RADIUS_KM,
  distanceKm,
  isWithinServiceRadius,
  toLatLon,
  type LatLon
} from '@/lib/serviceArea';

/** Only while the driver is on the way to / at the customer (before the laundry is picked up). */
export const PIN_CORRECTION_STATUSES = ['Driver Menuju Lokasi'] as const;

type OrderLike = { status?: unknown; driver_name?: unknown } | null | undefined;

export const canCorrectPickupPin = (order: OrderLike, driverName: unknown) =>
  Boolean(order) &&
  (PIN_CORRECTION_STATUSES as readonly string[]).includes(String(order?.status ?? '')) &&
  sameDriverName(order?.driver_name, driverName);

export type PinCorrectionCheck =
  | { ok: true; point: LatLon; accuracyM: number }
  | { ok: false; status: number; error: string };

export const checkPinCorrection = (input: {
  order: OrderLike;
  driverName: unknown;
  lat: unknown;
  lon: unknown;
  accuracyM: unknown;
  outlet?: { latitude?: unknown; longitude?: unknown } | null;
}): PinCorrectionCheck => {
  if (!input.order || !sameDriverName(input.order.driver_name, input.driverName)) {
    return { ok: false, status: 404, error: 'Pesanan ini bukan tugas Anda.' };
  }
  if (!canCorrectPickupPin(input.order, input.driverName)) {
    return { ok: false, status: 409, error: 'Titik hanya bisa diperbaiki saat Anda menuju / berada di lokasi pelanggan.' };
  }
  const point = toLatLon(input.lat, input.lon);
  if (!point) return { ok: false, status: 400, error: 'Lokasi GPS tidak valid.' };
  const acc = Number(input.accuracyM);
  if (!Number.isFinite(acc) || acc < 0) return { ok: false, status: 400, error: 'Akurasi GPS tidak diketahui. Coba lagi.' };
  if (acc > PIN_CORRECTION_MAX_ACCURACY_M) {
    return {
      ok: false,
      status: 400,
      error: `GPS kurang akurat (±${Math.round(acc)} m, maksimal ${PIN_CORRECTION_MAX_ACCURACY_M} m). Pindah ke area terbuka lalu coba lagi.`
    };
  }
  const outletPt = toLatLon(input.outlet?.latitude, input.outlet?.longitude);
  if (outletPt && !isWithinServiceRadius(point, outletPt)) {
    return {
      ok: false,
      status: 400,
      error: `Lokasi ini ±${distanceKm(point, outletPt).toFixed(1).replace('.', ',')} km dari outlet (maksimal ${SERVICE_RADIUS_KM} km). Periksa GPS Anda.`
    };
  }
  return { ok: true, point, accuracyM: acc };
};
