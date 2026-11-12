import { create } from 'zustand';
import { SILENCE_MS, clamp01, hasSound, smoothStep, type AudioLevelsPayload, type Levels } from './model';
import { createBeatDetector, type BeatDetector } from './beat';

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

/** Number of spectrum bands in an `audio-levels` event. */
export const BAND_COUNT = 32;
// The newest bands, normalised 0 to 1 from the event's 0 to 255 bytes. Written in place, so
// reading it never allocates; zeros while silent. Outside the React store on purpose: it
// changes 30 times a second and only the horizon's frame loop reads it.
const bands = new Float32Array(BAND_COUNT);
const detector = createBeatDetector();

/** The newest spectrum bands, 0 to 1 (bass first). A live view: copy it to keep a frame. */
export function audioBands(): Readonly<Float32Array> {
  return bands;
}

/** The beat detector fed by every `audio-levels` event: `count`, `lastBeatAt`, `lag`, `bass`, `beats()`. */
export function audioBeats(): Readonly<BeatDetector> {
  return detector;
}

/**
 * An `audio-levels` event arrived at `now` (milliseconds on any steady clock). `source` is the
 * frame's source time for the beat detector (see `sourceTime.ts`; default `now`); silence is
 * still judged on the arrival clock.
 */
export function ingestLevels(payload: AudioLevelsPayload | null | undefined, now: number, source = now): void {
  if (hasSound(payload)) {
    lastSoundAt = now;
    target = { bass: clamp01(payload!.bass ?? 0), mid: clamp01(payload!.mid ?? 0), high: clamp01(payload!.high ?? 0) };
    const raw = payload!.bands;
    if (Array.isArray(raw) && raw.length > 0) {
      for (let i = 0; i < BAND_COUNT; i++) bands[i] = i < raw.length ? clamp01((raw[i] ?? 0) / 255) : 0;
      detector.push(bands, source);
    }
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
    // The bands go to zero with the levels, and the beat history starts afresh next time.
    bands.fill(0);
    detector.clear();
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
  bands.fill(0);
  detector.reset();
  useAudioStore.setState({ ...QUIET });
}
