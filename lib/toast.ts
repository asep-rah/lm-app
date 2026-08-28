export type ToastTone = 'ok' | 'warn' | 'err';

export type ToastPayload = { text: string; tone: ToastTone };

type Listener = (msg: ToastPayload) => void;

const listeners = new Set<Listener>();

export const toast = (text: string, tone: ToastTone = 'ok') => {
  listeners.forEach((fn) => fn({ text, tone }));
};

export const subscribeToast = (fn: Listener) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
