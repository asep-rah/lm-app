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
