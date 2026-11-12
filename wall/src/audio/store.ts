import { create } from 'zustand';
import { SILENCE_MS, clamp01, hasSound, smoothStep, type AudioLevelsPayload, type Levels } from './model';

export interface AudioState extends Levels {
  /** True while sound arrived in the last 0.35 seconds. */
  playing: boolean;
}

const QUIET: AudioState = { bass: 0, mid: 0, high: 0, playing: false };

export const useAudioStore = create<AudioState>(() => ({ ...QUIET }));

// Raw targets and the time sound last arrived. Time based, never counted in events.
let target: Levels = { bass: 0, mid: 0, high: 0 };
let lastSoundAt = -Infinity;
let lastTickAt: number | null = null;

/** An `audio-levels` event arrived at `now` (milliseconds on any steady clock). */
export function ingestLevels(payload: AudioLevelsPayload | null | undefined, now: number): void {
  if (hasSound(payload)) {
    lastSoundAt = now;
    target = { bass: clamp01(payload!.bass ?? 0), mid: clamp01(payload!.mid ?? 0), high: clamp01(payload!.high ?? 0) };
  }
  // An empty event changes nothing here: silence is decided by the clock in `tickAudio`.
}

/** Advance smoothing and silence to `now`. Call about 30 times a second while the page is visible. */
export function tickAudio(now: number): void {
  const dt = lastTickAt === null ? 0 : Math.min(0.25, Math.max(0, (now - lastTickAt) / 1000));
  lastTickAt = now;
  const playing = now - lastSoundAt <= SILENCE_MS;
  if (!playing) {
    // Past the silence deadline the levels are zero at once, as in the old visualizer.
    target = { bass: 0, mid: 0, high: 0 };
    const z = useAudioStore.getState();
    if (z.bass !== 0 || z.mid !== 0 || z.high !== 0 || z.playing) useAudioStore.setState({ ...QUIET });
    return;
  }
  const goal: Levels = target;
  const s = useAudioStore.getState();
  const next: AudioState = {
    bass: smoothStep(s.bass, goal.bass, dt),
    mid: smoothStep(s.mid, goal.mid, dt),
    high: smoothStep(s.high, goal.high, dt),
    playing,
  };
  if (next.bass !== s.bass || next.mid !== s.mid || next.high !== s.high || next.playing !== s.playing) {
    useAudioStore.setState(next);
  }
}

/** Forget everything (tests, and a capture restart). */
export function resetAudio(): void {
  target = { bass: 0, mid: 0, high: 0 };
  lastSoundAt = -Infinity;
  lastTickAt = null;
  useAudioStore.setState({ ...QUIET });
}
