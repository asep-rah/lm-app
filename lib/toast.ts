export type ToastTone = 'ok' | 'warn' | 'err';

export type ToastPayload = {
  text: string;
  tone: ToastTone;
  persist?: boolean;
  kind?: string;
};

type Listener = (msg: ToastPayload) => void;

const listeners = new Set<Listener>();

export const toast = (
  text: string,
  tone: ToastTone = 'ok',
  opts?: { persist?: boolean; kind?: string }
) => {
  listeners.forEach((fn) => fn({ text, tone, persist: opts?.persist, kind: opts?.kind }));
};

export const subscribeToast = (fn: Listener) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
