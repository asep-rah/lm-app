import { parseOrderItems } from '@/lib/posQueue';

const uniq = (urls: Array<string | null | undefined>) => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const s = String(raw || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
};

const asList = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map((x) => String(x || '').trim()).filter(Boolean);
  if (typeof v === 'string' && v.trim().startsWith('[')) {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p.map((x) => String(x || '').trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
};

export const intakePhotosOf = (order: any): string[] => {
  const items = parseOrderItems(order?.items);
  return uniq([
    ...(asList(order?.sortir_photo_urls)),
    order?.sortir_photo_url,
    ...items.flatMap((it: any) => [...asList(it?.sortir_photo_urls), it?.sortir_photo_url, it?.photo_url])
  ]);
};

export const packingPhotosOf = (order: any): string[] => {
  const items = parseOrderItems(order?.items);
  return uniq([
    ...(asList(order?.packing_photo_urls)),
    order?.packing_photo_url,
    ...items.flatMap((it: any) => [...asList(it?.packing_photo_urls), it?.packing_photo_url, it?.dikemas_photo_url])
  ]);
};

export const intakePcsOf = (order: any) => {
  const items = parseOrderItems(order?.items);
  const fromItem = items.find((it: any) => Number(it?.intake_pcs || it?.total_pcs) > 0);
  return (
    Number(order?.intake_pcs) ||
    Number(order?.total_pcs) ||
    Number(fromItem?.intake_pcs) ||
    Number(fromItem?.total_pcs) ||
    Number(order?.pcs_count) ||
    0
  );
};

export const PCS_MISMATCH_ALERT = '⚠️ JUMLAH PCS TIDAK COCOK! Cek kembali sebelum kemas.';
