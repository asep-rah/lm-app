/**
 * Display-only disambiguation for saved addresses that share a label
 * (e.g. two "Rumah"). Never changes the stored label/address.
 */

type LabeledAddress = { id: string; label: string; full_address: string };

const normLabel = (s: string) => String(s || '').trim().toLowerCase();

const titleCase = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

/** Short street hint: first address segment without house number, max ~22 chars. */
export const addressHint = (fullAddress: string, max = 22): string => {
  const first = String(fullAddress || '').split(',')[0] || '';
  const cleaned = first
    .replace(/\b(no|nomor|nomer)\.?\s*[\w/-]+/gi, ' ')
    .replace(/\s*·\s*patokan:.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  const t = titleCase(cleaned);
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

export const addressDisplayLabel = (row: LabeledAddress, rows: LabeledAddress[]): string => {
  const label = String(row.label || 'Alamat').trim() || 'Alamat';
  const same = rows.filter((r) => normLabel(r.label) === normLabel(label));
  if (same.length <= 1) return label;
  const hint = addressHint(row.full_address);
  const withHint = hint ? `${label} · ${hint}` : label;
  const clash = same.filter((r) => (addressHint(r.full_address) || '') === hint);
  if (clash.length <= 1) return withHint;
  return `${withHint} #${clash.findIndex((r) => r.id === row.id) + 1}`;
};
