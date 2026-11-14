import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HorizonCanvas } from './HorizonCanvas';
import { drawHorizon, type HorizonOptions } from './index';
import { CAMERAS } from './cameras';
import { recordingContext } from './canvasStub';
import { usePlaceStore } from '../state/places';
import { BAND_COUNT, HISTORY_ROWS, danceHistory, danceKick, ingestLevels, resetAudio, tickAudio } from '../audio/store';
import { sampleDance } from '../audio/spectrum';
import { DEFAULT_LINES, resetLinesStore, useLinesStore } from './linesSettings';
import { LINE_PALETTES } from './lineTypes';
import { echoOptions } from './echo';
import { liveTint } from '../music/coverTint';

vi.mock('../ui/useIdle', () => ({ useIdle: vi.fn(() => false) }));
vi.mock('./index', async (original) => ({
  ...(await original<typeof import('./index')>()),
  drawHorizon: vi.fn(),
}));

const NOON = new Date(2026, 10, 11, 12, 0).getTime();
const draw = vi.mocked(drawHorizon);
const LOUD = { bass: 0.9, mid: 0.5, high: 0.3, bands: [1], waveform: [0.1] };
const BYTES = Array.from({ length: 32 }, (_, i) => (i < 4 ? 240 : 120));

let frames: Map<number, FrameRequestCallback>;
let nextId: number;
let rec: ReturnType<typeof recordingContext>;

function runFrame(ts: number) {
  const id = Math.max(...frames.keys());
  const cb = frames.get(id)!;
  frames.delete(id);
  act(() => cb(ts));
}

function feedBands(from: number, to: number) {
  for (let t = from; t <= to; t += 33) {
    ingestLevels({ ...LOUD, bands: BYTES }, t);
    tickAudio(t);
  }
}

/** A hit in the newest history row only: every older row is 0. */
function hitNow(level: number) {
  const h = danceHistory() as { data: Float32Array; head: number; rows: number };
  h.data.fill(0);
  h.rows = HISTORY_ROWS;
  for (let b = 0; b < BAND_COUNT; b++) h.data[h.head * BAND_COUNT + b] = level;
}

/** Play on Unwind for 2.5 s so the lines have lifted from rest. */
function playUnwind(): number {
  usePlaceStore.setState({ active: 'unwind' });
  feedBands(0, 2000);
  render(<HorizonCanvas now={() => NOON} />);
  let ts = 100;
  for (; ts <= 2500; ts += 100) {
    act(() => feedBands(2000 + ts, 2000 + ts + 99));
    runFrame(ts);
  }
  return ts;
}

/** The fillRects drawn by a new type (after its clip), as [x, y, w, h]. */
function rects(log: string[]): number[][] {
  const from = log.indexOf('clip(evenodd)');
  if (from < 0) return [];
  return log.slice(from, log.indexOf('restore()', from)).filter((l) => l.startsWith('fillRect(')).map((l) => l.slice(9, -1).split(',').map(Number));
}

beforeEach(() => {
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  localStorage.clear();
  resetLinesStore();
  usePlaceStore.setState({ active: 'work' });
  resetAudio();
  frames = new Map();
  nextId = 1;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    const id = nextId++;
    frames.set(id, cb);
    return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => void frames.delete(id));
  rec = recordingContext();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => rec.ctx as never);
  window.history.replaceState(null, '', '/');
  draw.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the Lines setting in the frame', () => {
  it('defaults: the echo is exactly the old call, its sample reads t - tau unchanged, and nothing else is drawn', () => {
    const ts = playUnwind();
    rec.log.length = 0;
    runFrame(ts);
    const o = draw.mock.lastCall![1] as HorizonOptions;
    const e = o.echo!;
    // The old path's call: echoOptions(camera, loud, t, gate, rest, default look, default opacity, kick, live tint).
    const old = echoOptions(CAMERAS.unwind, 1, e.t!, 1, e.rest ?? 0, undefined, undefined, danceKick(), liveTint(performance.now()))!;
    expect({ ...e, sample: undefined, drift: undefined, n: undefined, swell: undefined }).toEqual({ ...old, sample: undefined, drift: undefined, n: undefined, swell: undefined });
    for (const u of [0, 0.3, 0.7, 1]) for (const tau of [0, 0.4, 1.5]) expect(e.sample!(u, tau)).toBe(sampleDance(u, e.t! - tau));
    // After the picture only the reflection's own calls follow: no new type, no rest line.
    expect(rec.log.some((l) => l === 'clip(evenodd)')).toBe(false);
    expect(rec.log.some((l) => l.startsWith('quadraticCurveTo('))).toBe(false);
  });

  it('a new type reads the NEWEST history row: bars at a hit stand about 100 px tall', () => {
    useLinesStore.getState().setLines({ type: 'bars' });
    const ts = playUnwind();
    hitNow(1.2);
    rec.log.length = 0;
    runFrame(ts);
    const tallest = Math.max(...rects(rec.log).map((r) => 505 - r[1]));
    expect(tallest).toBeGreaterThan(80);
    // While a new type plays the ridgelines are not drawn.
    expect(draw.mock.lastCall![1].echo).toBeUndefined();
  });

  it('the oldest history row alone leaves the bars flat', () => {
    useLinesStore.getState().setLines({ type: 'bars' });
    const ts = playUnwind();
    const h = danceHistory() as { data: Float32Array; head: number; rows: number };
    h.data.fill(0);
    const oldest = (h.head + 1) % HISTORY_ROWS;
    for (let b = 0; b < BAND_COUNT; b++) h.data[oldest * BAND_COUNT + b] = 1.2;
    rec.log.length = 0;
    runFrame(ts);
    // The bars' caps (3 px tall) sit on the horizon; only markers from earlier hits float above.
    const tallest = Math.max(...rects(rec.log).filter((r) => r[3] === 3).map((r) => 505 - r[1]));
    expect(tallest).toBeLessThan(5);
  });

  it('Colours reach the Mountains: Sunset passes the Sunset stops', () => {
    useLinesStore.getState().setLines({ colours: 'sunset' });
    playUnwind();
    const tint = draw.mock.lastCall![1].echo!.tint!;
    expect([tint.left, tint.centre, tint.right]).toEqual([LINE_PALETTES.sunset.left, LINE_PALETTES.sunset.centre, LINE_PALETTES.sunset.right]);
  });

  it('Flat at rest: Mountains rest at 0.6 in the flat look; a new type draws one calm line and no ridgelines', () => {
    useLinesStore.getState().setLines({ rest: 'flat' });
    usePlaceStore.setState({ active: 'unwind' });
    render(<HorizonCanvas now={() => NOON} />);
    for (let ts = 100; ts <= 600; ts += 100) runFrame(ts);
    expect(draw.mock.lastCall![1].echo).toMatchObject({ rest: 1, restA: 0.6, look: 'flat' });
    cleanup();
    useLinesStore.getState().setLines({ type: 'ribbon' });
    draw.mockClear();
    render(<HorizonCanvas now={() => NOON} />);
    rec.log.length = 0;
    for (let ts = 100; ts <= 600; ts += 100) runFrame(ts);
    expect(draw.mock.lastCall![1].echo).toBeUndefined();
    expect(rec.log).toContain('lineWidth=1.6');
  });

  it('a new type at rest with Ridge and levels: the wall resting lines fade in under it', () => {
    useLinesStore.getState().setLines({ type: 'skyline' });
    usePlaceStore.setState({ active: 'unwind' });
    render(<HorizonCanvas now={() => NOON} />);
    for (let ts = 100; ts <= 600; ts += 100) runFrame(ts);
    expect(draw.mock.lastCall![1].echo).toMatchObject({ rest: 1, restA: 0.28, look: 'ridgelevels' });
  });

  it('Work keeps the new types calm: a lower opacity than on Unwind', () => {
    useLinesStore.getState().setLines({ type: 'bars' });
    const alphaOn = (place: 'work' | 'unwind') => {
      cleanup();
      resetAudio();
      usePlaceStore.setState({ active: place });
      feedBands(0, 2000);
      render(<HorizonCanvas now={() => NOON} />);
      for (let ts = 100; ts <= 2500; ts += 100) {
        act(() => feedBands(2000 + ts, 2000 + ts + 99));
        runFrame(ts);
      }
      hitNow(1.2);
      rec.log.length = 0;
      runFrame(2600);
      const alphas = rec.log.filter((l) => l.startsWith('globalAlpha=')).map((l) => Number(l.slice(12)));
      return Math.max(...alphas);
    };
    const work = alphaOn('work');
    const unwind = alphaOn('unwind');
    expect(work).toBeGreaterThan(0);
    expect(work).toBeLessThan(unwind * 0.5);
  });

  it('Reflection off draws no reflection', () => {
    useLinesStore.getState().setLines({ reflection: false });
    const ts = playUnwind();
    rec.log.length = 0;
    runFrame(ts);
    expect(rec.log.some((l) => l.startsWith('drawImage('))).toBe(false);
    cleanup();
    useLinesStore.getState().setLines({ ...DEFAULT_LINES });
    const ts2 = playUnwind();
    rec.log.length = 0;
    runFrame(ts2);
    expect(rec.log.some((l) => l.startsWith('drawImage('))).toBe(true);
  });
});
