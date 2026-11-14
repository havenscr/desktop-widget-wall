import { act, cleanup, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HorizonCanvas } from './HorizonCanvas';
import { drawHorizon } from './index';
import { recordingContext } from './canvasStub';
import { useSkyClaim, useSkyStore, type SkyClaim } from './sky';
import { usePlaceStore } from '../state/places';
import { BAND_COUNT, HISTORY_ROWS, danceHistory, ingestLevels, resetAudio, tickAudio } from '../audio/store';
import { resetLinesStore, useLinesStore, type LineType } from './linesSettings';

// The frame loop is stepped by hand; a timer-stepping file keeps a generous limit.
vi.setConfig({ testTimeout: 20_000 });

vi.mock('../ui/useIdle', () => ({ useIdle: vi.fn(() => false) }));
vi.mock('./index', async (original) => ({
  ...(await original<typeof import('./index')>()),
  drawHorizon: vi.fn(),
}));

const NOON = new Date(2026, 10, 11, 12, 0).getTime();
const LOUD = { bass: 0.9, mid: 0.5, high: 0.3, bands: [1], waveform: [0.1] };
const BYTES = Array.from({ length: 32 }, (_, i) => (i < 4 ? 240 : 120));
const NEW_TYPES: LineType[] = ['bars', 'ribbon', 'sparks', 'skyline'];
/** A picture box in the middle of the stage, as a look claims it (design pixels). */
const BOX = [1106, 16, 889, 500] as const;

let frames: Map<number, FrameRequestCallback>;
let nextId: number;
/** Each canvas's own recording context, so the main and front canvases' draws are told apart. */
let recs: Map<HTMLCanvasElement, ReturnType<typeof recordingContext>>;

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

function hitNow(level: number) {
  const h = danceHistory() as { data: Float32Array; head: number; rows: number };
  h.data.fill(0);
  h.rows = HISTORY_ROWS;
  for (let b = 0; b < BAND_COUNT; b++) h.data[h.head * BAND_COUNT + b] = level;
}

/** A stand-in for Watch: a claim of the picture's box, with a front host (a look behind the land) or without (a look in front of it). */
function Asker({ behind }: { behind: boolean }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const claim: SkyClaim = { boxes: [BOX], front: behind ? host : null };
  useSkyClaim('test', claim);
  return <div className="asker-host" ref={setHost} />;
}

/** Play on Unwind with a picture claimed, one frame at a hit; returns the main canvas, the front canvas (if any) and their logs for that frame. */
function playWith(type: LineType, behind: boolean) {
  useLinesStore.getState().setLines({ type });
  usePlaceStore.setState({ active: 'unwind' });
  feedBands(0, 2000);
  const { container } = render(
    <>
      <HorizonCanvas now={() => NOON} />
      <Asker behind={behind} />
    </>,
  );
  let ts = 100;
  for (; ts <= 2500; ts += 100) {
    act(() => feedBands(2000 + ts, 2000 + ts + 99));
    runFrame(ts);
  }
  hitNow(1.2);
  for (const r of recs.values()) r.log.length = 0;
  runFrame(ts);
  const main = container.querySelector('canvas.horizon-canvas:not(.horizon-front)') as HTMLCanvasElement;
  const front = document.querySelector('canvas.horizon-front') as HTMLCanvasElement | null;
  return { main: recs.get(main)!.log, front: front ? recs.get(front)!.log : null };
}

const drewType = (log: string[]) => log.includes('clip()') && log.some((l) => l.startsWith('fill') || l.startsWith('stroke('));

beforeEach(() => {
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  localStorage.clear();
  resetLinesStore();
  useSkyStore.setState({ claims: {} });
  resetAudio();
  frames = new Map();
  nextId = 1;
  recs = new Map();
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    const id = nextId++;
    frames.set(id, cb);
    return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => void frames.delete(id));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    if (!recs.has(this)) recs.set(this, recordingContext());
    return recs.get(this)!.ctx as never;
  } as never);
  window.history.replaceState(null, '', '/');
  vi.mocked(drawHorizon).mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useSkyStore.setState({ claims: {} });
});

describe('a new line type plays the full width in every look', () => {
  for (const type of NEW_TYPES) {
    it(`${type}, picture behind the land: drawn on the front canvas, in front of the picture, no box cut out`, () => {
      const { main, front } = playWith(type, true);
      expect(front).not.toBeNull();
      expect(drewType(front!)).toBe(true);
      expect(drewType(main)).toBe(false);
      // No even-odd clip, and no rectangle of the picture's box anywhere in the type's path.
      expect(front!).not.toContain('clip(evenodd)');
      expect(front!.some((l) => l.startsWith(`rect(${BOX[0] - 2},`))).toBe(false);
    });

    it(`${type}, picture in front of the land: drawn on the main canvas with no clip of the box`, () => {
      const { main, front } = playWith(type, false);
      expect(front).toBeNull();
      expect(drewType(main)).toBe(true);
      expect(main).not.toContain('clip(evenodd)');
      expect(main.some((l) => l.startsWith(`rect(${BOX[0] - 2},`))).toBe(false);
    });

    it(`${type}, no picture (Listen and every other place): drawn on the main canvas as before`, () => {
      useLinesStore.getState().setLines({ type });
      usePlaceStore.setState({ active: 'unwind' });
      feedBands(0, 2000);
      const { container } = render(<HorizonCanvas now={() => NOON} />);
      let ts = 100;
      for (; ts <= 2500; ts += 100) {
        act(() => feedBands(2000 + ts, 2000 + ts + 99));
        runFrame(ts);
      }
      hitNow(1.2);
      const rec = recs.get(container.querySelector('canvas') as HTMLCanvasElement)!;
      rec.log.length = 0;
      runFrame(ts);
      expect(document.querySelector('canvas.horizon-front')).toBeNull();
      expect(drewType(rec.log)).toBe(true);
      expect(rec.log).not.toContain('clip(evenodd)');
    });
  }
});
