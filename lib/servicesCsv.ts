/** CSV export/import for Owner Dynamic Services (`app_settings.dynamic_services`). */

export type ServiceType = 'kg' | 'pcs';

export type DynamicService = {
  id: string;
  name: string;
  type: ServiceType;
  price: number;
  commissions: {
    sortir: number;
    cuci: number;
    kering: number;
    setrika: number;
    packing: number;
  };
};

export const SERVICES_CSV_HEADERS = [
  'id',
  'name',
  'type',
  'price',
  'comm_sortir',
  'comm_cuci',
  'comm_kering',
  'comm_setrika',
  'comm_packing'
] as const;

export type ServicesCsvMergeMode = 'merge' | 'replace';

export type ServicesCsvParseIssue = {
  row: number;
  message: string;
};

export type ServicesCsvMergeResult = {
  services: DynamicService[];
  added: number;
  updated: number;
  skipped: number;
  issues: ServicesCsvParseIssue[];
};

const csvCell = (v: string | number) =>
  typeof v === 'number'
    ? String(Number.isFinite(v) ? v : 0)
    : `"${String(v ?? '').replace(/"/g, '""')}"`;

const num = (v: unknown, fallback = 0) => {
  const n = Number(String(v ?? '').trim().replace(/,/g, ''));
  return Number.isFinite(n) ? n : fallback;
};

const normalizeType = (raw: string): ServiceType | null => {
  const t = String(raw || '')
    .trim()
    .toLowerCase();
  if (t === 'kg' || t === 'kilo' || t === 'kiloan') return 'kg';
  if (t === 'pcs' || t === 'pc' || t === 'satuan' || t === 'unit') return 'pcs';
  return null;
};

/** Split one CSV line into fields (supports quoted commas / escaped quotes). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function stripBom(text: string) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function normalizeHeader(h: string) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

export function serializeServicesCsv(services: DynamicService[]): string {
  const lines = [SERVICES_CSV_HEADERS.join(',')];
  for (const s of services || []) {
    const c = s?.commissions || ({} as DynamicService['commissions']);
    lines.push(
      [
        csvCell(s?.id || ''),
        csvCell(s?.name || ''),
        csvCell(s?.type === 'pcs' ? 'pcs' : 'kg'),
        csvCell(num(s?.price)),
        csvCell(num(c.sortir)),
        csvCell(num(c.cuci)),
        csvCell(num(c.kering)),
        csvCell(num(c.setrika)),
        csvCell(num(c.packing))
      ].join(',')
    );
  }
  return lines.join('\n');
}

export function servicesCsvTemplate(): string {
  return serializeServicesCsv([
    {
      id: '',
      name: 'Cuci Kering Setrika',
      type: 'kg',
      price: 8000,
      commissions: { sortir: 100, cuci: 200, kering: 150, setrika: 250, packing: 100 }
    }
  ]);
}

export function downloadServicesCsv(filename: string, csv: string) {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function rowToPartial(
  cells: string[],
  idx: Record<string, number>,
  rowNum: number
): { service?: Omit<DynamicService, 'id'> & { id: string }; issue?: ServicesCsvParseIssue } {
  const get = (key: string) => {
    const i = idx[key];
    return i === undefined ? '' : String(cells[i] ?? '').trim();
  };

  const name = get('name');
  const type = normalizeType(get('type'));
  const price = num(get('price'));
  const id = get('id');

  if (!name) {
    return { issue: { row: rowNum, message: 'nama kosong' } };
  }
  if (!type) {
    return { issue: { row: rowNum, message: `type harus kg|pcs (dapat: "${get('type')}")` } };
  }
  if (price < 0) {
    return { issue: { row: rowNum, message: 'harga negatif' } };
  }

  return {
    service: {
      id,
      name,
      type,
      price,
      commissions: {
        sortir: Math.max(0, num(get('comm_sortir'))),
        cuci: Math.max(0, num(get('comm_cuci'))),
        kering: Math.max(0, num(get('comm_kering'))),
        setrika: Math.max(0, num(get('comm_setrika'))),
        packing: Math.max(0, num(get('comm_packing')))
      }
    }
  };
}

/**
 * Parse CSV text into service rows (does not merge with existing).
 * Invalid rows are skipped and listed in `issues`.
 */
export function parseServicesCsv(text: string): {
  rows: (Omit<DynamicService, 'id'> & { id: string })[];
  issues: ServicesCsvParseIssue[];
} {
  const cleaned = stripBom(String(text || '')).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = cleaned.split('\n').filter((l) => l.trim() !== '');
  if (!lines.length) {
    return { rows: [], issues: [{ row: 0, message: 'file kosong' }] };
  }

  const headerCells = parseCsvLine(lines[0]).map(normalizeHeader);
  const idx: Record<string, number> = {};
  headerCells.forEach((h, i) => {
    if (h) idx[h] = i;
  });

  const required = ['name', 'type', 'price'];
  for (const key of required) {
    if (idx[key] === undefined) {
      return {
        rows: [],
        issues: [{ row: 1, message: `header wajib hilang: ${key}` }]
      };
    }
  }

  const rows: (Omit<DynamicService, 'id'> & { id: string })[] = [];
  const issues: ServicesCsvParseIssue[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (cells.every((c) => !String(c || '').trim())) continue;
    const { service, issue } = rowToPartial(cells, idx, i + 1);
    if (issue) {
      issues.push(issue);
      continue;
    }
    if (service) rows.push(service);
  }

  return { rows, issues };
}

function newServiceId() {
  return `svc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Merge parsed CSV rows into existing services.
 * - Match by `id` when present; else by name (case-insensitive).
 * - New rows get `svc_*` id when id empty / unknown.
 * - `replace`: drop services not present in CSV (matched by id or name).
 */
export function mergeServicesFromCsv(
  existing: DynamicService[],
  csvText: string,
  mode: ServicesCsvMergeMode = 'merge'
): ServicesCsvMergeResult {
  const { rows, issues } = parseServicesCsv(csvText);
  const base = Array.isArray(existing) ? [...existing] : [];
  const byId = new Map<string, number>();
  const byName = new Map<string, number>();

  base.forEach((s, i) => {
    if (s?.id) byId.set(String(s.id), i);
    const n = String(s?.name || '')
      .trim()
      .toLowerCase();
    if (n && !byName.has(n)) byName.set(n, i);
  });

  let added = 0;
  let updated = 0;
  const touched = new Set<number>();

  for (const row of rows) {
    const nameKey = row.name.trim().toLowerCase();
    let idxMatch = row.id && byId.has(row.id) ? byId.get(row.id)! : undefined;
    if (idxMatch === undefined && nameKey && byName.has(nameKey)) {
      idxMatch = byName.get(nameKey)!;
    }

    if (idxMatch !== undefined) {
      const prev = base[idxMatch];
      base[idxMatch] = {
        ...prev,
        name: row.name,
        type: row.type,
        price: row.price,
        commissions: { ...row.commissions }
      };
      touched.add(idxMatch);
      updated++;
      byName.set(nameKey, idxMatch);
    } else {
      const id = row.id && !byId.has(row.id) ? row.id : newServiceId();
      const next: DynamicService = {
        id,
        name: row.name,
        type: row.type,
        price: row.price,
        commissions: { ...row.commissions }
      };
      const newIdx = base.length;
      base.push(next);
      byId.set(id, newIdx);
      byName.set(nameKey, newIdx);
      touched.add(newIdx);
      added++;
    }
  }

  let services = base;
  if (mode === 'replace') {
    services = base.filter((_, i) => touched.has(i));
  }

  return {
    services,
    added,
    updated,
    skipped: issues.length,
    issues
  };
}
