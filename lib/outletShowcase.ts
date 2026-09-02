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
  image_url?: string | null;
  description?: string | null;
  outlet_id?: string | null;
  target_outlet_ids?: string[] | string | null;
  is_active?: boolean | null;
  promo_code?: string | null;
  created_at?: string | null;
};

export const ALL_OUTLET_TARGET = 'ALL';

export type BannerSlide =
  | { kind: 'promo'; id: string; title: string; subtitle: string; image: string; outletId?: string; promoCode?: string; promoId?: string }
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

export const DEFAULT_GOOGLE_RATING = 4.9;

const hasNumericField = (value: unknown) => value != null && value !== '';

/** Saved `outlets.google_rating` / `google_review_count` — default 4.9 only if unset. */
export const dbGoogleStats = (outlet: Partial<ShowcaseOutlet> | null | undefined) => {
  const hasRating = hasNumericField(outlet?.google_rating);
  const hasCount = hasNumericField(outlet?.google_review_count);
  const parsedRating = Number(outlet?.google_rating);
  const parsedCount = Number(outlet?.google_review_count);
  return {
    rating: hasRating && parsedRating > 0 ? parsedRating : DEFAULT_GOOGLE_RATING,
    reviewCount: hasCount ? Math.max(0, Math.round(Number.isFinite(parsedCount) ? parsedCount : 0)) : 0,
    hasRating,
    hasCount
  };
};

export const formatGoogleReviewCount = (count: number) => String(Math.max(0, Math.round(Number(count) || 0)));

export const googleRatingBadge = (rating: number, reviewCount: number) => {
  const stars = Number.isFinite(rating) && rating > 0 ? Number(rating).toFixed(1) : String(DEFAULT_GOOGLE_RATING);
  return `⭐ ${stars} • ${formatGoogleReviewCount(reviewCount)} Ulasan Google`;
};

export const MAX_NEARBY_RADIUS_KM = 25;

export const normalizeCityName = (raw?: string | null) =>
  String(raw || '')
    .toLowerCase()
    .replace(/^(kota|kabupaten|kab\.?|kecamatan|kec\.?)\s+/gi, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const citiesMatch = (a?: string | null, b?: string | null) => {
  const x = normalizeCityName(a);
  const y = normalizeCityName(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
};

export const outletCityOf = (outlet: ShowcaseOutlet | null | undefined) => {
  const explicit = String(outlet?.city || '').trim();
  if (explicit) return explicit;
  const addr = String(outlet?.address_detail || '');
  const parts = addr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts[parts.length - 1] || '';
};

export const uniqueOutletCities = (outlets: ShowcaseOutlet[]) => {
  const map = new Map<string, string>();
  (outlets || []).forEach((o) => {
    const label = outletCityOf(o);
    const key = normalizeCityName(label);
    if (key && !map.has(key)) map.set(key, label);
  });
  return [...map.values()].sort((a, b) => a.localeCompare(b, 'id'));
};

export const displayCityName = (raw?: string | null) => {
  const t = String(raw || '').trim();
  if (!t) return '';
  return t.replace(/\b\w/g, (c) => c.toUpperCase());
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
  coords: { lat: number; lon: number } | null,
  opts?: { city?: string | null; maxKm?: number; ignoreCity?: boolean }
) => {
  const maxKm = opts?.maxKm ?? MAX_NEARBY_RADIUS_KM;
  const city = String(opts?.city || '').trim();
  const ignoreCity = Boolean(opts?.ignoreCity) || !city;
  return (outlets || [])
    .filter((o) => !isComingSoonOutlet(o))
    .filter((o) => {
      if (ignoreCity || !city) return true;
      const oc = outletCityOf(o);
      if (!oc) return true;
      return citiesMatch(oc, city);
    })
    .map((o) => ({ outlet: o, km: outletDistanceKm(o, coords) }))
    .filter(({ km }) => {
      if (!coords) return true;
      if (km == null) return false;
      return km <= maxKm;
    })
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

const splitPgTextArray = (raw: string) =>
  raw
    .replace(/^\{/, '')
    .replace(/\}$/, '')
    .split(',')
    .map((part) => part.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);

/** Normalize `target_outlet_ids` / legacy `outlet_id` into a string array. Empty → `['ALL']`. */
export const parseTargetOutletIds = (raw: unknown, fallbackOutletId?: string | null): string[] => {
  if (Array.isArray(raw) && raw.length) {
    const ids = raw.map((x) => String(x || '').trim()).filter(Boolean);
    if (ids.length) return ids;
  }
  if (typeof raw === 'string' && raw.trim()) {
    const text = raw.trim();
    if (text.startsWith('{') && text.endsWith('}')) {
      const ids = splitPgTextArray(text);
      if (ids.length) return ids;
    }
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parseTargetOutletIds(parsed, fallbackOutletId);
    } catch {
      if (text) return [text];
    }
  }
  if (fallbackOutletId) return [String(fallbackOutletId)];
  return [ALL_OUTLET_TARGET];
};

export const isAllOutletTarget = (ids: string[]) =>
  !ids.length || ids.some((id) => String(id).toUpperCase() === ALL_OUTLET_TARGET);

/** Persist form checkboxes as `['ALL']` or a unique list of outlet UUIDs. */
export const normalizeOutletIds = (ids: string[]): string[] => {
  const cleaned = [...new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (isAllOutletTarget(cleaned)) return [ALL_OUTLET_TARGET];
  return cleaned.filter((id) => id.toUpperCase() !== ALL_OUTLET_TARGET);
};

export const promoVisibleForOutlet = (promo: ShowcasePromo, activeOutletId?: string | null) => {
  const ids = parseTargetOutletIds(promo.target_outlet_ids, promo.outlet_id);
  if (isAllOutletTarget(ids)) return true;
  const active = String(activeOutletId || '').trim();
  if (!active) return false;
  return ids.includes(active);
};

/** Local high-quality laundry promo image when the owner has not uploaded a banner. */
export const DEFAULT_PROMO_BANNER_IMAGE = '/images/default-promo-banner.png';

export const DEFAULT_PROMO_SLIDE: BannerSlide = {
  kind: 'promo',
  id: 'default-promo',
  title: 'Promo Laundrivery',
  subtitle: 'Ketuk banner untuk melihat dan klaim promo.',
  image: DEFAULT_PROMO_BANNER_IMAGE
};

const promoBannerUrlOf = (p: ShowcasePromo) =>
  String(p.banner_url || p.image_url || '').trim();

/** Keep the carousel visible: use the brand placeholder when no custom banner images exist. */
export const withDefaultPromoBanner = (slides: BannerSlide[]): BannerSlide[] => {
  const list = slides || [];
  const withImages = list.filter((s) => String(s.image || '').trim());
  if (withImages.length) return withImages;
  const firstPromo = list.find((s) => s.kind === 'promo');
  return [
    firstPromo
      ? { ...firstPromo, image: DEFAULT_PROMO_BANNER_IMAGE }
      : { ...DEFAULT_PROMO_SLIDE }
  ];
};

export const bannerSlidesOf = (
  promos: ShowcasePromo[],
  outlets: ShowcaseOutlet[],
  activeOutletId?: string | null
): BannerSlide[] => {
  const promoSlides: BannerSlide[] = activePromosOf(promos)
    .filter((p) => promoVisibleForOutlet(p, activeOutletId))
    .map((p) => ({
      kind: 'promo',
      id: `promo-${p.id}`,
      title: String(p.title || 'Promo Laundrivery'),
      subtitle: String(p.description || '').trim(),
      image: promoBannerUrlOf(p),
      outletId: p.outlet_id || undefined,
      promoCode: String(p.promo_code || '').trim() || undefined,
      promoId: String(p.id)
    }));
  const soonSlides: BannerSlide[] = comingSoonOutlets(outlets).map((o) => ({
    kind: 'coming_soon',
    id: `soon-${o.id}`,
    title: `Outlet Baru: ${String(o.name || 'Coming Soon')}`,
    subtitle: String(o.opening_date_info || 'Segera dibuka').trim(),
    image: parseOutletImages(o.images)[0] || '',
    outletId: String(o.id)
  }));
  return withDefaultPromoBanner([...promoSlides, ...soonSlides]);
};

export async function fetchOutletGoogleRating(outlet: ShowcaseOutlet): Promise<{
  rating: number;
  reviewCount: number;
  mapsUrl: string;
  source: 'google' | 'fallback';
}> {
  const local = dbGoogleStats(outlet);
  const fallback = {
    rating: local.rating,
    reviewCount: local.reviewCount,
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
    const live = json.source === 'google' && json.hasPlacesKey !== false;
    if (!live) {
      const remote = dbGoogleStats({
        ...outlet,
        google_rating: json.rating ?? outlet.google_rating ?? 4.9,
        google_review_count: json.reviewCount ?? json.review_count ?? outlet.google_review_count ?? 0
      });
      return {
        rating: local.hasRating ? local.rating : remote.rating,
        reviewCount: local.hasCount ? local.reviewCount : remote.reviewCount,
        mapsUrl: String(json.mapsUrl || json.maps_url || fallback.mapsUrl),
        source: 'fallback'
      };
    }
    return {
      rating: Number(json.rating) > 0 ? Number(json.rating) : fallback.rating,
      reviewCount: Math.max(0, Number(json.reviewCount ?? json.review_count) || fallback.reviewCount),
      mapsUrl: String(json.mapsUrl || json.maps_url || fallback.mapsUrl),
      source: 'google'
    };
  } catch {
    return fallback;
  }
}
