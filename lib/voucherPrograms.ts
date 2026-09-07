import { insertWithFallback, updateWithFallback } from '@/lib/safeWrite';
import { supabase } from '@/lib/supabaseClient';

export type VoucherBenefitType = 'nominal' | 'percent';
export type VoucherDistribution = 'manual' | 'sistem';

export type VoucherProgram = {
  id: string;
  name: string;
  program_start: string | null;
  program_end: string | null;
  outlet_id: string | null;
  benefit_type: VoucherBenefitType;
  benefit_value: number;
  distribution: VoucherDistribution;
  quantity: number;
  redeem_start: string | null;
  redeem_end: string | null;
  is_active: boolean;
  created_at?: string | null;
};

export type VoucherCode = {
  id: string;
  program_id: string;
  code: string;
  customer_phone: string | null;
  status: string;
};

const STORE_KEY = 'laundry_voucher_store';

const num = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `vch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const parseJson = (raw: unknown, fallback: any) => {
  if (!raw) return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
};

export const mapVoucherProgram = (row?: Record<string, unknown> | null): VoucherProgram => ({
  id: String(row?.id || ''),
  name: String(row?.name || ''),
  program_start: row?.program_start ? String(row.program_start) : null,
  program_end: row?.program_end ? String(row.program_end) : null,
  outlet_id: row?.outlet_id ? String(row.outlet_id) : null,
  benefit_type: String(row?.benefit_type || 'nominal') === 'percent' ? 'percent' : 'nominal',
  benefit_value: num(row?.benefit_value),
  distribution: String(row?.distribution || 'manual') === 'sistem' ? 'sistem' : 'manual',
  quantity: Math.max(1, Math.round(num(row?.quantity, 1))),
  redeem_start: row?.redeem_start ? String(row.redeem_start) : null,
  redeem_end: row?.redeem_end ? String(row.redeem_end) : null,
  is_active: row?.is_active !== false,
  created_at: row?.created_at ? String(row.created_at) : null
});

export const benefitLabel = (p: Pick<VoucherProgram, 'benefit_type' | 'benefit_value'>) =>
  p.benefit_type === 'percent'
    ? `Diskon ${Number(p.benefit_value) || 0}%`
    : `Potongan Rp ${Math.round(Number(p.benefit_value) || 0).toLocaleString('id-ID')}`;

const randomCode = (name: string, index: number) => {
  const prefix =
    String(name || 'VCH')
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 6)
      .toUpperCase() || 'VCH';
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}${String(index + 1).padStart(3, '0')}${rand}`;
};

type LocalStore = { programs: VoucherProgram[]; codes: Record<string, VoucherCode[]> };

const readLocal = (): LocalStore => {
  if (typeof window === 'undefined') return { programs: [], codes: {} };
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || '');
    return {
      programs: Array.isArray(parsed?.programs) ? parsed.programs.map(mapVoucherProgram) : [],
      codes: parsed?.codes && typeof parsed.codes === 'object' ? parsed.codes : {}
    };
  } catch {
    return { programs: [], codes: {} };
  }
};

const writeLocal = (store: LocalStore) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
};

const mergePrograms = (a: VoucherProgram[], b: VoucherProgram[]) => {
  const map = new Map<string, VoucherProgram>();
  [...b, ...a].forEach((p) => {
    if (p?.id) map.set(p.id, p);
  });
  return [...map.values()].sort((x, y) => String(y.created_at || '').localeCompare(String(x.created_at || '')));
};

async function readSettingsStore(): Promise<LocalStore> {
  let data: Record<string, unknown> | null = null;
  const full = await supabase
    .from('app_settings')
    .select('voucher_programs, outlet_overrides, promos_data')
    .eq('id', 1)
    .maybeSingle();
  if (!full.error) data = full.data as Record<string, unknown> | null;
  else {
    const slim = await supabase.from('app_settings').select('outlet_overrides, promos_data').eq('id', 1).maybeSingle();
    data = (slim.data as Record<string, unknown> | null) || null;
  }
  const direct = parseJson(data?.voucher_programs, null);
  const nested = parseJson(data?.outlet_overrides, {})?.__voucher_programs;
  const raw = direct || nested || { programs: [], codes: {} };
  return {
    programs: Array.isArray(raw.programs) ? raw.programs.map(mapVoucherProgram) : [],
    codes: raw.codes && typeof raw.codes === 'object' ? raw.codes : {}
  };
}

async function writeSettingsStore(store: LocalStore) {
  const { data } = await supabase.from('app_settings').select('outlet_overrides, promos_data').eq('id', 1).maybeSingle();
  const overrides = parseJson(data?.outlet_overrides, {});
  const nextOverrides = { ...overrides, __voucher_programs: store };
  const promoRows = Object.values(store.codes)
    .flat()
    .map((c) => {
      const program = store.programs.find((p) => p.id === c.program_id);
      return {
        id: c.id,
        title: program?.name || c.code,
        code: c.code,
        type: program?.benefit_type === 'percent' ? 'percent' : 'nominal',
        value: program?.benefit_value || 0,
        desc: program ? benefitLabel(program) : '',
        is_active: program?.is_active !== false && c.status === 'available',
        max_quota: 1,
        used_count: c.status === 'redeemed' || c.status === 'claimed' ? 1 : 0,
        source: 'voucher',
        program_id: c.program_id
      };
    });
  const existingPromos = parseJson(data?.promos_data, []).filter((p: any) => p?.source !== 'voucher');
  const promoPayload = [...existingPromos, ...promoRows];
  await updateWithFallback(
    'app_settings',
    [
      { voucher_programs: store, outlet_overrides: nextOverrides, promos_data: promoPayload },
      { voucher_programs: store, promos_data: promoPayload },
      { outlet_overrides: nextOverrides, promos_data: promoPayload },
      { outlet_overrides: JSON.stringify(nextOverrides), promos_data: JSON.stringify(promoPayload) },
      { outlet_overrides: nextOverrides },
      { promos_data: promoPayload }
    ],
    { column: 'id', value: 1 }
  );
}

async function publishClaimableCodes(program: VoucherProgram, codes: VoucherCode[]) {
  for (const row of codes) {
    await insertWithFallback('promos', [
      {
        title: program.name,
        code: row.code,
        description: benefitLabel(program),
        discount_type: program.benefit_type,
        discount_value: program.benefit_value,
        type: program.benefit_type,
        value: program.benefit_value,
        is_active: program.is_active,
        max_quota: 1,
        used_count: 0
      },
      {
        title: program.name,
        code: row.code,
        description: benefitLabel(program),
        type: program.benefit_type,
        value: program.benefit_value,
        is_active: true
      },
      { title: row.code, code: row.code, is_active: true }
    ]);
  }
}

export async function loadVoucherPrograms(): Promise<VoucherProgram[]> {
  const table = await supabase.from('voucher_programs').select('*').order('created_at', { ascending: false });
  const fromTable = !table.error && table.data ? table.data.map((row) => mapVoucherProgram(row)) : [];
  const fromSettings = await readSettingsStore();
  const local = readLocal();
  return mergePrograms(fromTable, mergePrograms(fromSettings.programs, local.programs));
}

export async function loadVoucherCodes(programId: string): Promise<VoucherCode[]> {
  const table = await supabase
    .from('voucher_codes')
    .select('id, program_id, code, customer_phone, status')
    .eq('program_id', programId)
    .order('created_at', { ascending: true });
  if (!table.error && table.data?.length) {
    return table.data.map((row) => ({
      id: String(row.id),
      program_id: String(row.program_id),
      code: String(row.code),
      customer_phone: row.customer_phone ? String(row.customer_phone) : null,
      status: String(row.status || 'available')
    }));
  }
  const settings = await readSettingsStore();
  const local = readLocal();
  return settings.codes[programId] || local.codes[programId] || [];
}

export async function saveVoucherProgram(
  input: Omit<VoucherProgram, 'id' | 'created_at' | 'is_active'> & { is_active?: boolean }
): Promise<{ error: { message: string } | null; program: VoucherProgram | null; codes: VoucherCode[] }> {
  const quantity = Math.max(1, Math.round(Number(input.quantity) || 1));
  if (!String(input.name || '').trim()) return { error: { message: 'Nama voucher wajib diisi' }, program: null, codes: [] };
  if (!input.program_start || !input.program_end) {
    return { error: { message: 'Tanggal program wajib diisi' }, program: null, codes: [] };
  }
  if (!input.benefit_value) return { error: { message: 'Benefit voucher belum diatur' }, program: null, codes: [] };

  const program: VoucherProgram = {
    id: newId(),
    name: String(input.name || '').trim(),
    program_start: input.program_start || null,
    program_end: input.program_end || null,
    outlet_id: input.outlet_id || null,
    benefit_type: input.benefit_type === 'percent' ? 'percent' : 'nominal',
    benefit_value: num(input.benefit_value),
    distribution: input.distribution === 'sistem' ? 'sistem' : 'manual',
    quantity,
    redeem_start: input.redeem_start || null,
    redeem_end: input.redeem_end || null,
    is_active: input.is_active !== false,
    created_at: new Date().toISOString()
  };

  const unique = new Set<string>();
  const codes: VoucherCode[] = [];
  for (let i = 0; i < quantity; i += 1) {
    let code = randomCode(program.name, i);
    while (unique.has(code)) code = randomCode(program.name, unique.size);
    unique.add(code);
    codes.push({
      id: newId(),
      program_id: program.id,
      code,
      customer_phone: null,
      status: 'available'
    });
  }

  const payload = { ...program };
  const inserted = await insertWithFallback<Record<string, unknown>>(
    'voucher_programs',
    [payload, { name: payload.name, program_start: payload.program_start, program_end: payload.program_end, benefit_type: payload.benefit_type, benefit_value: payload.benefit_value, quantity }],
    { select: '*' }
  );
  const savedProgram = inserted.data?.[0] ? mapVoucherProgram(inserted.data[0]) : program;
  if (inserted.data?.[0]?.id && String(inserted.data[0].id) !== program.id) {
    codes.forEach((c) => {
      c.program_id = savedProgram.id;
    });
  }
  if (!inserted.error) {
    for (const row of codes) {
      await insertWithFallback('voucher_codes', [
        { id: row.id, program_id: row.program_id, code: row.code, status: 'available' },
        { program_id: row.program_id, code: row.code, status: 'available' },
        { program_id: row.program_id, code: row.code }
      ]);
    }
  }

  const settings = await readSettingsStore();
  const nextStore: LocalStore = {
    programs: mergePrograms([savedProgram], settings.programs),
    codes: { ...settings.codes, [savedProgram.id]: codes }
  };
  await writeSettingsStore(nextStore);
  writeLocal({ ...readLocal(), programs: mergePrograms([savedProgram], readLocal().programs), codes: { ...readLocal().codes, [savedProgram.id]: codes } });
  await publishClaimableCodes(savedProgram, codes);

  return { error: null, program: savedProgram, codes };
}

export async function setVoucherProgramActive(id: string, isActive: boolean) {
  await updateWithFallback('voucher_programs', [{ is_active: isActive }], { column: 'id', value: id });
  const settings = await readSettingsStore();
  const local = readLocal();
  const next: LocalStore = {
    programs: mergePrograms(settings.programs, local.programs).map((p) => (p.id === id ? { ...p, is_active: isActive } : p)),
    codes: { ...local.codes, ...settings.codes }
  };
  await writeSettingsStore(next);
  writeLocal(next);
  return { error: null };
}

export function printVoucherPdf(program: VoucherProgram, codes: VoucherCode[], outletName = 'Semua outlet') {
  if (typeof window === 'undefined') return;
  const cards = codes
    .map(
      (c) => `<article class="card">
      <p class="brand">Laundrivery</p>
      <h2>${program.name}</h2>
      <p class="benefit">${benefitLabel(program)}</p>
      <p class="code">${c.code}</p>
      <p class="meta">Redeem ${program.redeem_start || '-'} s/d ${program.redeem_end || '-'}</p>
      <p class="meta">${outletName}</p>
    </article>`
    )
    .join('');
  const w = window.open('', '_blank', 'width=920,height=720');
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>Voucher ${program.name}</title>
    <style>
      body{font-family:Arial,sans-serif;background:#f8fafc;color:#0f172a;padding:16px}
      h1{font-size:18px;margin:0 0 12px}
      .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
      .card{border:2px dashed #0284c7;background:#fff;border-radius:16px;padding:16px;page-break-inside:avoid}
      .brand{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#0284c7;font-weight:800;margin:0}
      h2{margin:6px 0;font-size:16px}
      .benefit{margin:0;font-weight:800;color:#0369a1}
      .code{margin:10px 0;font-size:22px;font-weight:900;letter-spacing:.08em}
      .meta{margin:2px 0;font-size:11px;color:#64748b}
      @media print{.grid{grid-template-columns:repeat(2,1fr)}}
    </style></head><body>
    <h1>${codes.length} voucher · ${program.name}</h1>
    <div class="grid">${cards}</div>
    <script>window.onload=function(){window.print();}</script>
    </body></html>`);
  w.document.close();
}
