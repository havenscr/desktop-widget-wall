/**
 * One song through the whole chain, as the wall runs it, with no device anywhere:
 *
 * capture (30 Hz analyser frames, a little arrival jitter; in silence one empty frame then a 1 Hz
 * heartbeat) -> the native stream loop (ticks at `sendHz`, the beat detector pushed on each new
 * frame, `levels_from_bands`, `Engine.step`, panels sent at most every 33 ms) -> recorded frames.
 *
 * In parallel the page's audio store (`ingestLevels`, `tickAudio`) runs on the same frames, for the
 * drop detector and the slow energy, which the vibe effects read. The light engine has no drop input.
 */
import { analyse, type AnalyzerFrame } from './analyzer';
import { SR, type Song } from './songs';
import { Engine, levelsFromBands, lum, tuningFor } from './engine';
import { createBeatDetector, BEAT_BANDS } from '../../src/audio/beat';
import { audioDrops, audioEnergy, ingestLevels, resetAudio, tickAudio } from '../../src/audio/store';
import { SYNTHWAVE, type IntensityId } from '../../src/studio/lightsync/model';
import type { Rgb } from '../../src/studio/lightsync/preview';

export const FRAME_MS = 1000 / 30;
const PANEL_EVERY_MS = 33;
const FRAME_STALE_MS = 500;

export interface Layout {
  name: string;
  panels: { id: number; x: number; y: number; up?: boolean }[];
}

export interface Captured {
  /** Arrival time (ms) of each analyser frame. */
  at: number[];
  frames: AnalyzerFrame[];
}

/** Analyse a song once; every preset reads the same frames. */
export function capture(song: Song, seed = 7): Captured {
  let s = seed;
  const jitter = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s / 0x7fffffff - 0.5) * 8;
  };
  const at: number[] = [];
  const frames: AnalyzerFrame[] = [];
  let silentSince = -Infinity;
  for (let k = 0; k * FRAME_MS < song.seconds * 1000; k++) {
    const t = k * FRAME_MS;
    const f = analyse(song.audio, Math.floor((t / 1000) * SR));
    if (f.silent) {
      // One empty event, then a 1 Hz heartbeat (as the capture side does for the page).
      if (silentSince === -Infinity) silentSince = t;
      else if (Math.floor((t - silentSince) / 1000) === Math.floor((t - FRAME_MS - silentSince) / 1000)) continue;
    } else silentSince = -Infinity;
    at.push(t + 4 + jitter());
    frames.push(f);
  }
  return { at, frames };
}

export interface Tick {
  t: number;
  beat: boolean;
  /** The beat restarted the pulse (false: refused by `minPulseGapMs`). */
  pulseStart: boolean;
  /** Onset time of the beat this tick confirmed. */
  onset: number;
  bassEnv: number;
  highEnv: number;
  pulse: number;
  plays: Rgb[];
  playB: number[];
  /** The panels as last sent (held between sends). */
  panels: Rgb[];
  panelB: number[];
  sentPanels: boolean;
  /** Newest analyser frame's bands (bytes), for the spectrogram. */
  bands: number[];
  energy: number;
}

export interface RunResult {
  song: Song;
  preset: IntensityId;
  ticks: Tick[];
  drops: { t: number; strength: number }[];
  heldPlays: number[];
  heldPanels: number[];
  floor: number;
  brightness: number;
}

export function run(song: Song, cap: Captured, preset: IntensityId, layout: Layout): RunResult {
  const tuning = tuningFor(preset, SYNTHWAVE);
  const engine = new Engine(tuning.s.floor);
  const detector = createBeatDetector();
  const xy = layout.panels.map((p) => [p.x, p.y] as const);
  const tickMs = 1000 / tuning.s.sendHz;
  resetAudio();

  const ticks: Tick[] = [];
  const drops: RunResult['drops'] = [];
  let next = 0;
  let bands: number[] = [];
  let lastFrameAt = 0;
  let lastTick = 0;
  let lastPanel = -Infinity;
  let panels: Rgb[] = layout.panels.map(() => [0, 0, 0]);
  let panelB: number[] = layout.panels.map(() => 0);
  let seenDrops = 0;
  let pageNext = 0;
  const end = song.seconds * 1000;
  for (let t = 0; t <= end; t += tickMs) {
    // The page receives every frame as an event and ticks its store with it.
    while (pageNext < cap.at.length && cap.at[pageNext] <= t) {
      const f = cap.frames[pageNext];
      const a = cap.at[pageNext];
      ingestLevels(f.silent ? { bass: 0, mid: 0, high: 0, bands: [], waveform: [] } : { bass: f.bass, mid: f.mid, high: f.high, bands: f.bands, waveform: [0] }, a);
      tickAudio(a);
      pageNext++;
    }
    // A page tick also runs without events (silence), about 30 times a second.
    if (pageNext === 0 || t - cap.at[pageNext - 1] > FRAME_MS) tickAudio(t);
    const d = audioDrops();
    if (d.count > seenDrops) {
      drops.push({ t: d.lastAt, strength: d.strength });
      seenDrops = d.count;
    }

    // The native loop: only the newest frame since the last tick is seen.
    let beat = false;
    let fresh = -1;
    while (next < cap.at.length && cap.at[next] <= t) fresh = next++;
    if (fresh >= 0) {
      bands = cap.frames[fresh].bands;
      lastFrameAt = t;
      const unit = Array.from({ length: 32 }, (_, i) => (i < bands.length ? bands[i] / 255 : 0));
      beat = detector.push(unit.slice(0, BEAT_BANDS), t, t);
    }
    if (t - lastFrameAt > FRAME_STALE_MS) bands = [];
    const [bass, high] = levelsFromBands(bands);
    const pulseStart = beat && !(engine.kickAgeMs < tuning.s.minPulseGapMs);
    const out = engine.step(tuning, { bass, high, beat, beatLagMs: beat ? t - detector.lastBeatAt : 0, dtMs: t - lastTick }, 4, xy);
    lastTick = t;
    let sentPanels = false;
    if (out.panels.length && t - lastPanel >= PANEL_EVERY_MS) {
      panels = out.panels;
      panelB = engine.panels.map((p) => p.b);
      lastPanel = t;
      sentPanels = true;
    }
    ticks.push({
      t,
      beat,
      pulseStart,
      onset: beat ? detector.lastBeatAt : NaN,
      bassEnv: engine.bassEnv,
      highEnv: engine.highEnv,
      pulse: engine.pulse,
      plays: out.plays,
      playB: engine.plays.map((p) => p.b),
      panels,
      panelB,
      sentPanels,
      bands,
      energy: audioEnergy(),
    });
  }
  return { song, preset, ticks, drops, heldPlays: engine.plays.map((p) => p.held), heldPanels: engine.panels.map((p) => p.held), floor: tuning.s.floor, brightness: tuning.s.brightness };
}

export { lum };
