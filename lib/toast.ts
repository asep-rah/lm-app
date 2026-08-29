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
