import { create } from 'zustand';
import { SILENCE_MS, clamp01, hasSound, smoothStep, type AudioLevelsPayload, type Levels } from './model';
import { createBeatDetector, type BeatDetector } from './beat';
import { APP_DANCE_PARAMS, clearDance, createDance, stepDance, type DanceParams } from './dance';
import { lineSettings } from '../horizon/linesSettings';

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

/** Rows per second in the band history. */
export const HISTORY_HZ = 30;
/** Seconds of band history kept (the echo spreads 7 seconds across its lines). */
export const HISTORY_S = 7;
/** Rows in the band history ring. */
export const HISTORY_ROWS = HISTORY_HZ * HISTORY_S;
const ROW_MS = 1000 / HISTORY_HZ;

/**
 * The last `HISTORY_S` seconds of the shaped line heights for the Unwind echo (`stepDance`):
 * `HISTORY_ROWS` rows of `BAND_COUNT` heights, 0 to 1.8. `data` is a ring, row `head` is the newest
 * and `rows` counts the rows written (up to the ring's size). Written in place; never allocated
 * after start.
 */
export interface BandHistory {
  readonly data: Float32Array;
  readonly head: number;
  readonly rows: number;
}

const dancing = { data: new Float32Array(HISTORY_ROWS * BAND_COUNT), head: -1, rows: 0 };
const dance = createDance();
const danceRaw = new Float32Array(BAND_COUNT);
const danceParams: DanceParams = { ...APP_DANCE_PARAMS };
let nextRowAt = -Infinity;
// Rows written since sound was last heard: once a whole ring of silence is in, writing stops.
let quietRows = 0;
let historyPaused = false;

/** The shaped line heights history (a live view; see `BandHistory`). */
export function danceHistory(): BandHistory {
  return dancing;
}

/** The kick, 0 to 1: how hard the lowest bands were hit just now. */
export function danceKick(): number {
  return dance.kick;
}

/** Empty the history (the page was hidden: its old spectrum must not replay on return). */
export function clearDanceHistory(): void {
  clearHistory();
}

function clearHistory(): void {
  dancing.data.fill(0);
  dancing.head = -1;
  dancing.rows = 0;
  clearDance(dance);
  nextRowAt = -Infinity;
  quietRows = HISTORY_ROWS;
}

/**
 * Stop (true) or restart (false) the history. While stopped nothing is written (the display is
 * idle or off, so nobody sees it); restarting clears it, so the echo never shows a spectrum from
 * before the pause.
 */
export function pauseDanceHistory(paused: boolean): void {
  if (paused === historyPaused) return;
  historyPaused = paused;
  if (!paused) clearHistory();
}

/**
 * Write shaped rows at `HISTORY_HZ` up to `now`, from the newest bands (zeros while silent). After
 * a gap (a hidden page, a pause) it starts again at `now` rather than filling the gap. When the
 * music stops the rows fall to zero, so the lines settle outward over the history's span; then
 * writing stops until sound returns.
 */
function advanceHistory(now: number, playing: boolean): void {
  if (historyPaused) return;
  if (playing) quietRows = 0;
  else if (quietRows >= HISTORY_ROWS) {
    // A whole ring of silence is in: the followers and peaks start afresh with the next sound.
    if (dance.peak !== 0.1 || dance.kick !== 0) clearDance(dance);
    return;
  }
  if (now - nextRowAt > 250) nextRowAt = now;
  while (now >= nextRowAt) {
    dancing.head = (dancing.head + 1) % HISTORY_ROWS;
    if (playing) for (let i = 0; i < BAND_COUNT; i++) danceRaw[i] = bands[i];
    else danceRaw.fill(0);
    const smooth = (lineSettings().smooth - 50) / 50;
    const lively = (lineSettings().lively - 50) / 50;
    const releaseScale = Math.pow(4, smooth);
    danceParams.levelRelease = APP_DANCE_PARAMS.levelRelease * releaseScale;
    danceParams.fastRelease = APP_DANCE_PARAMS.fastRelease * releaseScale;
    danceParams.base = APP_DANCE_PARAMS.base;
    danceParams.hit = APP_DANCE_PARAMS.hit * Math.pow(2, lively);
    danceParams.limit = APP_DANCE_PARAMS.limit * Math.pow(2, 0.75 * lively);
    stepDance(dance, danceRaw, 1 / HISTORY_HZ, dancing.data, dancing.head * BAND_COUNT, danceParams);
    if (dancing.rows < HISTORY_ROWS) dancing.rows++;
    if (!playing) quietRows++;
    nextRowAt += ROW_MS;
  }
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
      detector.push(bands, source, now);
    }
  }
  // An empty event changes nothing here: silence is decided by the clock in `tickAudio`.
}

/** Advance smoothing and silence to `now`. Call about 30 times a second while the page is visible. */
export function tickAudio(now: number): void {
  const dt = lastTickAt === null ? 0 : Math.min(0.25, Math.max(0, (now - lastTickAt) / 1000));
  lastTickAt = now;
  const playing = now - lastSoundAt <= SILENCE_MS;
  advanceHistory(now, playing);
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
  historyPaused = false;
  clearHistory();
  useAudioStore.setState({ ...QUIET });
}
