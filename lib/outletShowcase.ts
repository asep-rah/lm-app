export type ShowcaseOutlet = {
  id: string;
  name?: string;
  city?: string;
  latitude?: number | null;
  longitude?: number | null;
  address_detail?: string | null;
  images?: string[] | string | null;
  operating_hours?: string | null;
  is_coming_soon?: boolean | null;
  opening_date_info?: string | null;
  google_place_id?: string | null;
  google_rating?: number | null;
  google_review_count?: number | null;
  google_maps_url?: string | null;
  [key: string]: unknown;
};

export type ShowcasePromo = {
  id: string;
  title?: string | null;
  banner_url?: string | null;
  description?: string | null;
  outlet_id?: string | null;
  is_active?: boolean | null;
  created_at?: string | null;
};

export type BannerSlide =
  | { kind: 'promo'; id: string; title: string; subtitle: string; image: string; outletId?: string }
  | { kind: 'coming_soon'; id: string; title: string; subtitle: string; image: string; outletId: string };

export const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export const parseOutletImages = (raw: unknown): string[] => {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x || '').trim()).filter((x) => x.startsWith('http') || x.startsWith('data:'));
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parseOutletImages(parsed);
    } catch {
      if (raw.startsWith('http') || raw.startsWith('data:')) return [raw.trim()];
    }
  }
  return [];
};

export const isComingSoonOutlet = (outlet: ShowcaseOutlet | null | undefined) =>
  Boolean(outlet?.is_coming_soon);

export const outletAddressOf = (outlet: ShowcaseOutlet | null | undefined) =>
  String(outlet?.address_detail || outlet?.city || '').trim();

export const mapsDirectionsUrl = (outlet: ShowcaseOutlet | null | undefined) => {
  if (!outlet) return '';
  const maps = String(outlet.google_maps_url || '').trim();
  if (maps.startsWith('http')) return maps;
  const lat = Number(outlet.latitude);
  const lon = Number(outlet.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
  }
  const placeId = String(outlet.google_place_id || '').trim();
  if (placeId) {
    return `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(placeId)}`;
  }
  const q = outletAddressOf(outlet) || String(outlet.name || '').trim();
  if (!q) return '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
};

export const formatGoogleReviewCount = (count: number) => {
  const n = Math.max(0, Math.round(Number(count) || 0));
  if (n >= 100) return `${n}+`;
  return String(n);
};

export const googleRatingBadge = (rating: number, reviewCount: number) => {
  const stars = Number.isFinite(rating) ? Number(rating).toFixed(1) : '5.0';
  return `⭐ ${stars} • ${formatGoogleReviewCount(reviewCount)} Ulasan Google`;
};

export const distanceLabelKm = (km: number | null) => {
  if (km == null || !Number.isFinite(km)) return '';
  return `${km.toFixed(1)} km dari lokasi Anda`;
};

export const outletDistanceKm = (
  outlet: ShowcaseOutlet,
  coords: { lat: number; lon: number } | null
) => {
  if (!coords) return null;
  const lat = Number(outlet.latitude);
  const lon = Number(outlet.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat === 0 || lon === 0) return null;
  return Math.round(haversineKm(coords.lat, coords.lon, lat, lon) * 10) / 10;
};

export const nearbyActiveOutlets = (
  outlets: ShowcaseOutlet[],
  coords: { lat: number; lon: number } | null
) => {
  return (outlets || [])
    .filter((o) => !isComingSoonOutlet(o))
    .map((o) => ({ outlet: o, km: outletDistanceKm(o, coords) }))
    .sort((a, b) => {
      if (a.km == null && b.km == null) return String(a.outlet.name || '').localeCompare(String(b.outlet.name || ''));
      if (a.km == null) return 1;
      if (b.km == null) return -1;
      return a.km - b.km;
    });
};

export const comingSoonOutlets = (outlets: ShowcaseOutlet[]) =>
  (outlets || []).filter(isComingSoonOutlet);

export const activePromosOf = (rows: ShowcasePromo[]) =>
  (rows || []).filter((p) => p.is_active !== false);

export const bannerSlidesOf = (promos: ShowcasePromo[], outlets: ShowcaseOutlet[]): BannerSlide[] => {
  const promoSlides: BannerSlide[] = activePromosOf(promos).map((p) => ({
    kind: 'promo',
    id: `promo-${p.id}`,
    title: String(p.title || 'Promo Laundrivery'),
    subtitle: String(p.description || '').trim(),
    image: String(p.banner_url || '').trim(),
    outletId: p.outlet_id || undefined
  }));
  const soonSlides: BannerSlide[] = comingSoonOutlets(outlets).map((o) => ({
    kind: 'coming_soon',
    id: `soon-${o.id}`,
    title: `Outlet Baru: ${String(o.name || 'Coming Soon')}`,
    subtitle: String(o.opening_date_info || 'Segera dibuka').trim(),
    image: parseOutletImages(o.images)[0] || '',
    outletId: String(o.id)
  }));
  return [...promoSlides, ...soonSlides];
};

export async function fetchOutletGoogleRating(outlet: ShowcaseOutlet): Promise<{
  rating: number;
  reviewCount: number;
  mapsUrl: string;
  source: 'google' | 'fallback';
}> {
  const fallback = {
    rating: Number(outlet.google_rating) > 0 ? Number(outlet.google_rating) : 5,
    reviewCount: Math.max(0, Number(outlet.google_review_count) || 0),
    mapsUrl: mapsDirectionsUrl(outlet),
    source: 'fallback' as const
  };
  try {
    const qs = new URLSearchParams();
    if (outlet.id) qs.set('outletId', String(outlet.id));
    if (outlet.google_place_id) qs.set('placeId', String(outlet.google_place_id));
    const res = await fetch(`/api/outlets/google-rating?${qs.toString()}`);
    if (!res.ok) return fallback;
    const json = await res.json();
    return {
      rating: Number(json.rating) > 0 ? Number(json.rating) : fallback.rating,
      reviewCount: Math.max(0, Number(json.reviewCount ?? json.review_count) || fallback.reviewCount),
      mapsUrl: String(json.mapsUrl || json.maps_url || fallback.mapsUrl),
      source: json.source === 'google' ? 'google' : 'fallback'
    };
  } catch {
    return fallback;
  }
}
