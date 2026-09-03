import type { GeoPoint } from '@/lib/mapsNav';

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const NOMINATIM_HEADERS = { Accept: 'application/json', 'Accept-Language': 'id' };

const streetLabelOf = (j: any): string => {
  const a = j?.address || {};
  const parts = [
    [a.road, a.house_number].filter(Boolean).join(' '),
    a.neighbourhood || a.suburb || a.village || a.hamlet,
    a.city || a.town || a.municipality || a.county,
    a.state
  ]
    .map((p) => String(p || '').trim())
    .filter(Boolean);
  if (parts.length) return parts.join(', ');
  return String(j?.display_name || '').trim();
};

/** Reverse-geocode GPS to a readable street address (for the address field). */
export async function reverseGeocodeAddress(lat: number, lon: number): Promise<string> {
  try {
    const url = `${NOMINATIM}/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;
    const res = await fetch(url, { headers: NOMINATIM_HEADERS });
    if (res.ok) {
      const label = streetLabelOf(await res.json());
      if (label) return label;
    }
  } catch {
    /* try bigdatacloud */
  }
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=id`;
    const res = await fetch(url);
    if (!res.ok) return '';
    const j = await res.json();
    return [j.locality, j.city, j.principalSubdivision, j.countryName].map((x: unknown) => String(x || '').trim()).filter(Boolean).join(', ');
  } catch {
    return '';
  }
}

/** Forward-geocode typed address → pin on the map (Indonesia). */
export async function geocodeAddress(query: string): Promise<(GeoPoint & { label: string }) | null> {
  const q = String(query || '').replace(/\s+/g, ' ').trim();
  if (q.length < 8) return null;
  try {
    const url = `${NOMINATIM}/search?format=jsonv2&q=${encodeURIComponent(q)}&countrycodes=id&limit=1&addressdetails=1`;
    const res = await fetch(url, { headers: NOMINATIM_HEADERS });
    if (!res.ok) return null;
    const rows = await res.json();
    const hit = Array.isArray(rows) ? rows[0] : null;
    const lat = Number(hit?.lat);
    const lng = Number(hit?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng, label: streetLabelOf(hit) || q };
  } catch {
    return null;
  }
}

/** Reverse-geocode GPS to a city name for nearby-outlet filtering. */

export async function reverseGeocodeCity(lat: number, lon: number): Promise<string> {
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=id`;
    const res = await fetch(url);
    if (res.ok) {
      const j = await res.json();
      const city = String(j.city || j.locality || j.principalSubdivision || '').trim();
      if (city) return city;
    }
  } catch {
    /* try nominatim */
  }
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&accept-language=id`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return '';
    const j = await res.json();
    const a = j.address || {};
    return String(a.city || a.town || a.municipality || a.county || a.state || '').trim();
  } catch {
    return '';
  }
}
