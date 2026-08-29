export type ToastTone = 'ok' | 'warn' | 'err';

export type ToastPayload = {
  text: string;
  tone: ToastTone;
  persist?: boolean;
  kind?: string;
  onClick?: () => void;
};

type Listener = (msg: ToastPayload) => void;

const listeners = new Set<Listener>();

export const toast = (
  text: string,
  tone: ToastTone = 'ok',
  opts?: { persist?: boolean; kind?: string; onClick?: () => void }
) => {
  listeners.forEach((fn) =>
    fn({ text, tone, persist: opts?.persist, kind: opts?.kind, onClick: opts?.onClick })
  );
};

export const subscribeToast = (fn: Listener) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

const PENDING_TOAST_KEY = 'lm_pending_toast';

/** Simpan toast agar tetap tampil setelah full-page redirect. */
export const queueToast = (text: string, tone: ToastTone = 'ok') => {
  try {
    sessionStorage.setItem(PENDING_TOAST_KEY, JSON.stringify({ text, tone }));
  } catch {
    /* ignore quota / private mode */
  }
};

export const flushQueuedToast = () => {
  if (typeof window === 'undefined') return;
  try {
    const raw = sessionStorage.getItem(PENDING_TOAST_KEY);
    if (!raw) return;
    sessionStorage.removeItem(PENDING_TOAST_KEY);
    const parsed = JSON.parse(raw);
    if (parsed?.text) toast(String(parsed.text), parsed.tone || 'ok');
  } catch {
    /* ignore */
  }
};
