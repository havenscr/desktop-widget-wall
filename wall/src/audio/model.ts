/** Seconds of non-silent audio missing before the levels count as silence (the old app's rule). */
export const SILENCE_MS = 350;
/** Smoothing time constants in seconds: quick to rise, slower to fall. */
export const ATTACK_S = 0.06;
export const RELEASE_S = 0.35;

/** The `audio-levels` event payload. Silence arrives as an empty `waveform` (and `bands`). */
export interface AudioLevelsPayload {
  bass?: number;
  mid?: number;
  high?: number;
  bands?: number[];
  waveform?: number[];
}

export interface Levels {
  bass: number;
  mid: number;
  high: number;
}

export const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** True when the payload carries sound. Rust sends an empty waveform while the endpoint is silent. */
export function hasSound(p: AudioLevelsPayload | null | undefined): boolean {
  return !!p && Array.isArray(p.waveform) && p.waveform.length > 0;
}

/** One smoothing step toward `target` over `dt` seconds (exponential, attack faster than release). */
export function smoothStep(current: number, target: number, dt: number): number {
  const tau = target > current ? ATTACK_S : RELEASE_S;
  const k = 1 - Math.exp(-Math.max(0, dt) / tau);
  const next = current + (target - current) * k;
  return Math.abs(next - target) < 0.01 ? target : next;
}

/** One loudness number, bass weighted. */
export function loudness(l: Levels): number {
  return clamp01(l.bass * 0.6 + l.mid * 0.28 + l.high * 0.12);
}
