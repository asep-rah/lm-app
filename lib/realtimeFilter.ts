/**
 * Filter Supabase Realtime (`postgres_changes`) supaya browser hanya menerima
 * baris miliknya sendiri, bukan seluruh tabel. Satu listener = satu kolom, jadi
 * pencocokan "nomor ATAU thread" dipasang sebagai dua listener.
 *
 * Nilai disaring ketat (nomor: digit dengan + opsional; thread: p:/t:/o: + id)
 * agar string filter selalu valid — filter yang tidak valid membuat channel
 * gagal dan update realtime berhenti diam-diam.
 */

const PHONE_RE = /^\+?\d{6,20}$/;
const THREAD_RE = /^[pto]:[A-Za-z0-9+_-]{1,80}$/;

/** `kolom=in.(a,b,c)` dari varian nomor; null bila tidak ada nomor valid. Maks 100 nilai (batas Realtime). */
export const phoneInFilter = (column: string, phones: string[]): string | null => {
  const clean = [...new Set(phones.map((p) => String(p ?? '').trim()).filter((p) => PHONE_RE.test(p)))].slice(0, 100);
  return clean.length ? `${column}=in.(${clean.join(',')})` : null;
};

/** `thread_key=eq.p:62…`; null bila kunci thread tidak valid. */
export const threadKeyFilter = (threadKey: string): string | null => {
  const k = String(threadKey ?? '').trim();
  return THREAD_RE.test(k) ? `thread_key=eq.${k}` : null;
};

/**
 * Callback yang dipanggil paling banyak sekali per `waitMs` (trailing). Dipakai
 * agar beberapa event realtime beruntun memicu satu kali muat-ulang saja.
 */
export const debounce = <A extends unknown[]>(fn: (...args: A) => void, waitMs: number) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  };
  run.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return run;
};
