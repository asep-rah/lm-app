/** Transaksi batal/cancel tidak masuk omset, ROI, atau KPI. */
export const isVoidTransaction = (row: { status?: unknown; delete_requested?: unknown } | null | undefined) => {
  const s = String(row?.status || '').toLowerCase();
  return s.includes('batal') || s.includes('cancel') || s.includes('void');
};
