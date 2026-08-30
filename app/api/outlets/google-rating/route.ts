import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qlgbjvzabnfqmfnjdkmo.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs'
);

const mapsUrlFrom = (row: {
  google_maps_url?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  google_place_id?: string | null;
  address_detail?: string | null;
  city?: string | null;
  name?: string | null;
}) => {
  const maps = String(row.google_maps_url || '').trim();
  if (maps.startsWith('http')) return maps;
  const lat = Number(row.latitude);
  const lon = Number(row.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
  }
  const placeId = String(row.google_place_id || '').trim();
  if (placeId) return `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(placeId)}`;
  const q = String(row.address_detail || row.city || row.name || '').trim();
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : '';
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const outletId = String(url.searchParams.get('outletId') || url.searchParams.get('outlet_id') || '').trim();
  let placeId = String(url.searchParams.get('placeId') || url.searchParams.get('place_id') || '').trim();

  let fallback = {
    rating: 4.9,
    reviewCount: 0,
    mapsUrl: '',
    placeId: '',
    source: 'fallback' as const,
    hasPlacesKey: false
  };

  if (outletId) {
    const { data } = await supabase.from('outlets').select('*').eq('id', outletId).maybeSingle();
    if (data) {
      const savedRating = data.google_rating;
      const savedCount = data.google_review_count;
      fallback = {
        rating: savedRating != null && Number(savedRating) > 0 ? Number(savedRating) : 4.9,
        reviewCount: savedCount != null ? Math.max(0, Math.round(Number(savedCount) || 0)) : 0,
        mapsUrl: mapsUrlFrom(data),
        placeId: String(data.google_place_id || '').trim(),
        source: 'fallback',
        hasPlacesKey: false
      };
      if (!placeId) placeId = fallback.placeId;
    }
  }

  const apiKey = String(
    process.env.GOOGLE_PLACES_API_KEY ||
      process.env.GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_MAPS_SERVER_KEY ||
      ''
  ).trim();

  if (!apiKey) {
    return NextResponse.json({ ...fallback, hasPlacesKey: false, source: 'fallback' });
  }
  if (!placeId) {
    return NextResponse.json({ ...fallback, hasPlacesKey: true, source: 'fallback' });
  }

  try {
    const qs = new URLSearchParams({
      place_id: placeId,
      fields: 'rating,user_ratings_total,url',
      key: apiKey
    });
    const res = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?${qs.toString()}`, {
      cache: 'no-store'
    });
    const json = await res.json().catch(() => ({}));
    const result = json?.result || {};
    const liveRating = Number(result.rating);
    const liveCount = Number(result.user_ratings_total);
    if (json?.status === 'OK' && (liveRating > 0 || liveCount > 0)) {
      return NextResponse.json({
        rating: liveRating > 0 ? liveRating : fallback.rating,
        reviewCount: liveCount > 0 ? liveCount : fallback.reviewCount,
        mapsUrl: String(result.url || fallback.mapsUrl || ''),
        placeId,
        source: 'google',
        hasPlacesKey: true
      });
    }
  } catch {
    /* Places API unreachable — keep DB fallback */
  }

  return NextResponse.json({ ...fallback, hasPlacesKey: Boolean(apiKey), source: 'fallback' });
}
