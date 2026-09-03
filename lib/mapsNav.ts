export type GeoPoint = { lat: number; lng: number };

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const coordsOf = (row: any): GeoPoint | null => {
  const lat = num(row?.latitude ?? row?.lat ?? row?.pickup_lat ?? row?.customer_addresses?.latitude);
  const lng = num(row?.longitude ?? row?.lon ?? row?.lng ?? row?.pickup_lng ?? row?.customer_addresses?.longitude);
  if (lat == null || lng == null) return null;
  if (Math.abs(lat) < 0.00001 && Math.abs(lng) < 0.00001) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
};

export const googleMapsDirUrl = (row: any, fallbackAddress?: string) => {
  const pt = coordsOf(row);
  if (pt) return `https://www.google.com/maps/dir/?api=1&destination=${pt.lat},${pt.lng}`;
  const address = String(
    fallbackAddress ||
      row?.formatted_address ||
      row?.address ||
      row?.pickup_address ||
      row?.customer_addresses?.full_address ||
      ''
  )
    .replace(/^Alamat:\s*/i, '')
    .trim();
  if (!address || address === 'Alamat belum diisi') return '';
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
};

export const openGoogleMapsNav = (row: any, fallbackAddress?: string) => {
  const url = googleMapsDirUrl(row, fallbackAddress);
  if (!url) {
    alert('Alamat / pin lokasi pelanggan belum diatur.');
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
};
