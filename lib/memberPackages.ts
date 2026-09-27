/**
 * Paket member/top up deposit yang dijual kasir di POS (sumber tunggal untuk
 * POS dan /api/staff/membership-log; server menghitung harga, saldo, dan komisi
 * dari nama paket, bukan dari angka kiriman browser).
 */
export type MemberPackage = { name: string; price: number; balanceAdded: number; commission: number };

export const POS_MEMBER_PACKAGES: readonly MemberPackage[] = [
  { name: 'Silver', price: 300000, balanceAdded: 320000, commission: 5000 },
  { name: 'Gold', price: 500000, balanceAdded: 550000, commission: 10000 },
  { name: 'Platinum', price: 900000, balanceAdded: 1000000, commission: 20000 }
];

export const posMemberPackageOf = (name: unknown): MemberPackage | null =>
  POS_MEMBER_PACKAGES.find((p) => p.name === String(name || '').trim()) || null;
