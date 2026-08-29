import { toast, type ToastTone } from '@/lib/toast';

export type OpsNotifyKind = 'chat' | 'payment' | 'complaint';

let audioCtx: AudioContext | null = null;
let unlocked = false;

export const unlockOpsAudio = () => {
  if (typeof window === 'undefined') return;
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    unlocked = true;
  } catch {
    /* ignore */
  }
};

const tone = (kind: OpsNotifyKind): { freq: number; dur: number; vol: number; repeats: number } => {
  if (kind === 'complaint') return { freq: 1046, dur: 0.18, vol: 0.12, repeats: 3 };
  if (kind === 'payment') return { freq: 784, dur: 0.22, vol: 0.1, repeats: 2 };
  return { freq: 880, dur: 0.16, vol: 0.08, repeats: 1 };
};

export const playOpsSound = (kind: OpsNotifyKind = 'chat') => {
  if (typeof window === 'undefined') return;
  try {
    unlockOpsAudio();
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = audioCtx || new Ctx();
    audioCtx = ctx;
    const spec = tone(kind);
    for (let i = 0; i < spec.repeats; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = kind === 'complaint' ? 'square' : 'sine';
      osc.frequency.value = spec.freq + i * 80;
      const t0 = ctx.currentTime + i * 0.22;
      gain.gain.setValueAtTime(spec.vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + spec.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + spec.dur + 0.02);
    }
  } catch {
    /* ignore */
  }
};

const lastAt: Record<string, number> = {};

export const notifyOps = (
  kind: OpsNotifyKind,
  text: string,
  persist = true,
  extra?: { onClick?: () => void }
) => {
  const now = Date.now();
  if (now - (lastAt[kind] || 0) < 800) return;
  lastAt[kind] = now;
  playOpsSound(kind);
  const toastTone: ToastTone = kind === 'complaint' ? 'err' : kind === 'payment' ? 'warn' : 'ok';
  toast(text, toastTone, { persist, kind, onClick: extra?.onClick });
};

export const isOpsAudioUnlocked = () => unlocked;
