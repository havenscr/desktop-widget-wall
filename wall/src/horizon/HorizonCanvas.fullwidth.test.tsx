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
import { LOOK_BOXES, layeredNow, type LookId } from '../unwind/watch/looks';

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
/**
 * The real looks the Watch tab has, as the stage claims them: the look, whether the player is
 * waiting for a click (the sun then comes forward), and whether the horizon then mounts a front
 * canvas (`layeredNow`, the real function, asserted below against this table).
 */
const LOOKS: { name: string; look: LookId; needsClick: boolean; layered: boolean }[] = [
  { name: 'Feathered', look: 'feather', needsClick: false, layered: false },
  { name: 'Whole sky', look: 'sky', needsClick: false, layered: true },
  { name: 'The sun, playing', look: 'sun', needsClick: false, layered: true },
  { name: 'The sun, waiting for a click', look: 'sun', needsClick: true, layered: false },
  { name: 'Drive-in', look: 'drivein', needsClick: false, layered: false },
  { name: 'Hologram', look: 'holo', needsClick: false, layered: false },
];

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

/** A stand-in for the stage: it claims the look's real box, with a front host only when the look is layered now. */
function Asker({ look, needsClick }: { look: LookId; needsClick: boolean }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const b = LOOK_BOXES[look];
  const claim: SkyClaim = { boxes: [[b.x, b.y, b.w, b.h]], front: layeredNow(look, needsClick) ? host : null };
  useSkyClaim('test', claim);
  return <div className="asker-host" ref={setHost} />;
}

/** Play on Unwind with a picture claimed, one frame at a hit; returns the main canvas, the front canvas (if any) and their logs for that frame. */
function playWith(type: LineType, look: LookId, needsClick: boolean) {
  useLinesStore.getState().setLines({ type });
  usePlaceStore.setState({ active: 'unwind' });
  feedBands(0, 2000);
  const { container } = render(
    <>
      <HorizonCanvas now={() => NOON} />
      <Asker look={look} needsClick={needsClick} />
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

/** The x of every point a recorded draw touches between the type's clip and its restore. */
function xs(log: string[]): number[] {
  const out: number[] = [];
  const from = log.indexOf('clip()');
  const to = log.indexOf('restore()', from);
  for (const l of log.slice(from, to)) {
    const m = /^(\w+)\((.*)\)$/.exec(l);
    if (!m) continue;
    const n = m[2].split(',').map(Number);
    if (n.some((v) => Number.isNaN(v))) continue;
    if (m[1] === 'fillRect' || m[1] === 'roundRect') out.push(n[0], n[0] + n[2]);
    else if (m[1] === 'arc' || m[1] === 'moveTo' || m[1] === 'lineTo') out.push(n[0]);
    else if (m[1] === 'quadraticCurveTo') out.push(n[2]);
    else if (m[1] === 'bezierCurveTo') out.push(n[4]);
  }
  return out;
}

describe('the real looks decide where the lines are mounted', () => {
  for (const l of LOOKS) {
    it(`${l.name}: layeredNow says ${l.layered}`, () => {
      expect(layeredNow(l.look, l.needsClick)).toBe(l.layered);
    });
  }
});

describe('a new line type plays the full width in every look', () => {
  for (const type of NEW_TYPES) {
    for (const l of LOOKS) {
      it(`${type}, ${l.name}: drawn on the ${l.layered ? 'front' : 'main'} canvas, no box cut out, across the picture's x range`, () => {
        const box = LOOK_BOXES[l.look];
        const { main, front } = playWith(type, l.look, l.needsClick);
        const drawn = l.layered ? front : main;
        expect(front !== null).toBe(l.layered);
        expect(drawn).not.toBeNull();
        expect(drewType(drawn!)).toBe(true);
        // Nothing is drawn on the other canvas.
        if (l.layered) expect(drewType(main)).toBe(false);
        // No even-odd clip, and no rectangle of the picture's box anywhere in the type's path.
        expect(drawn!).not.toContain('clip(evenodd)');
        expect(drawn!.some((x) => x.startsWith(`rect(${box.x - 2},`))).toBe(false);
        // The draw calls reach left of the box, inside it and right of it.
        const x = xs(drawn!);
        expect(x.length).toBeGreaterThan(0);
        expect(Math.min(...x)).toBeLessThan(box.x);
        expect(Math.max(...x)).toBeGreaterThan(box.x + box.w);
        expect(x.some((v) => v > box.x + 40 && v < box.x + box.w - 40)).toBe(true);
      });
    }

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
