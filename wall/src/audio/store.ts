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

/** Rows per second in the band history. */
export const HISTORY_HZ = 30;
/** Seconds of band history kept (the echo spreads 7 seconds across its lines). */
export const HISTORY_S = 7;
/** Rows in the band history ring. */
export const HISTORY_ROWS = HISTORY_HZ * HISTORY_S;
const ROW_MS = 1000 / HISTORY_HZ;

/**
 * The last `HISTORY_S` seconds of the spectrum for the Unwind echo: `HISTORY_ROWS` rows of
 * `BAND_COUNT` bands, each band smoothed with the levels' attack and release (`smoothStep`).
 * `data` is a ring, row `head` is the newest and `rows` counts the rows written (up to the
 * ring's size). Written in place by `tickAudio`; never allocated after start.
 */
export interface BandHistory {
  readonly data: Float32Array;
  readonly head: number;
  readonly rows: number;
}

const history = { data: new Float32Array(HISTORY_ROWS * BAND_COUNT), head: -1, rows: 0 };
const smoothed = new Float32Array(BAND_COUNT);
/**
 * The calming stage, for the band history only (the levels and the beat detector never see it):
 * a second, slower smoothing over each band (`CALM_SMOOTH_S`), then a direction hold, so that once
 * a band turns from rising to falling or back it may not turn again for `CALM_HOLD_MS`. Together
 * they keep the echo from changing the picture's brightness more than three times a second,
 * however fast the music pumps.
 */
export const CALM_SMOOTH_S = 0.12;
export const CALM_HOLD_MS = 170;
const slow = new Float32Array(BAND_COUNT);
const calm = new Float32Array(BAND_COUNT);
const calmDir = new Int8Array(BAND_COUNT);
const calmTurnAt = new Float64Array(BAND_COUNT).fill(-Infinity);
let nextRowAt = -Infinity;
// Rows written since sound was last heard: once a whole ring of silence is in, writing stops.
let quietRows = 0;
let historyPaused = false;

/** The band history (a live view; see `BandHistory`). */
export function bandHistory(): BandHistory {
  return history;
}

/** Empty the band history (the page was hidden: its old spectrum must not replay on return). */
export function clearBandHistory(): void {
  clearHistory();
}

function clearHistory(): void {
  history.data.fill(0);
  history.head = -1;
  history.rows = 0;
  smoothed.fill(0);
  slow.fill(0);
  calm.fill(0);
  calmDir.fill(0);
  calmTurnAt.fill(-Infinity);
  nextRowAt = -Infinity;
  quietRows = HISTORY_ROWS;
}

/**
 * Stop (true) or restart (false) the band history. While stopped nothing is written (the
 * display is idle or off, so nobody sees it); restarting clears it, so the echo never shows
 * a spectrum from before the pause.
 */
export function pauseBandHistory(paused: boolean): void {
  if (paused === historyPaused) return;
  historyPaused = paused;
  if (!paused) clearHistory();
}

/**
 * Smooth the bands toward the newest frame (zeros while silent) and write rows at
 * `HISTORY_HZ` up to `now`. After a gap (a hidden page, a pause) it starts again at `now`
 * rather than filling the gap. When the music stops the rows release to zero, so the lines
 * settle outward over the history's span; then writing stops until sound returns.
 */
function advanceHistory(now: number, dt: number, playing: boolean): void {
  if (historyPaused) return;
  if (playing) quietRows = 0;
  else if (quietRows >= HISTORY_ROWS) return;
  const k = 1 - Math.exp(-Math.max(0, dt) / CALM_SMOOTH_S);
  for (let i = 0; i < BAND_COUNT; i++) {
    smoothed[i] = smoothStep(smoothed[i], playing ? bands[i] : 0, dt);
    slow[i] += (smoothed[i] - slow[i]) * k;
    if (Math.abs(slow[i] - smoothed[i]) < 0.005) slow[i] = smoothed[i];
    const delta = slow[i] - calm[i];
    if (delta === 0) continue;
    const dir = delta > 0 ? 1 : -1;
    if (dir !== calmDir[i]) {
      // A turn: allowed only once the last turn is `CALM_HOLD_MS` old; until then the band holds still.
      if (now - calmTurnAt[i] < CALM_HOLD_MS) continue;
      calmDir[i] = dir;
      calmTurnAt[i] = now;
    }
    calm[i] = slow[i];
  }
  if (now - nextRowAt > 250) nextRowAt = now;
  while (now >= nextRowAt) {
    history.head = (history.head + 1) % HISTORY_ROWS;
    history.data.set(calm, history.head * BAND_COUNT);
    if (history.rows < HISTORY_ROWS) history.rows++;
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
  advanceHistory(now, dt, playing);
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
