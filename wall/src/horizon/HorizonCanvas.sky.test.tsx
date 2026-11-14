import { act, cleanup, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HorizonCanvas } from './HorizonCanvas';
import { MOON, MOON_PLACES, type HorizonOptions } from './index';
import { recordingContext, stubContext } from './canvasStub';
import { MAIN_LEFT } from '../screens/frameLayout';
import { claimSky, releaseSky, useSkyClaim, useSkyStore, type SkyClaim } from './sky';
import { usePlaceStore } from '../state/places';
import { resetAudio } from '../audio/store';

// The still frame under reduced motion is redrawn once a minute; one test steps that timer.
vi.setConfig({ testTimeout: 20_000 });

vi.mock('../ui/useIdle', () => ({ useIdle: vi.fn(() => false) }));
// The canvas reuses one options object for both parts of a frame (setting `part` between the two
// draws), so the mock keeps a copy of what each call was given, and the objects themselves in `given`.
const { draw, given } = vi.hoisted(() => ({ draw: vi.fn(), given: [] as object[] }));
vi.mock('./index', async (original) => ({
  ...(await original<typeof import('./index')>()),
  drawHorizon: (ctx: CanvasRenderingContext2D, o: HorizonOptions) => {
    given.push(o);
    draw(ctx, { ...o });
  },
}));

const NIGHT = new Date(2026, 10, 11, 22, 30).getTime();

let frames: Map<number, FrameRequestCallback>;
let nextId: number;
/** Each canvas's own context, so the main and front canvases' draws are told apart. */
let ctxOf: Map<HTMLCanvasElement, CanvasRenderingContext2D>;

function runFrame(ts: number) {
  const id = Math.max(...frames.keys());
  const cb = frames.get(id)!;
  frames.delete(id);
  act(() => cb(ts));
}

function setReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
}

beforeEach(() => {
  usePlaceStore.setState({ active: 'unwind' });
  useSkyStore.setState({ claims: {} });
  resetAudio();
  frames = new Map();
  nextId = 1;
  ctxOf = new Map();
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    const id = nextId++;
    frames.set(id, cb);
    return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => void frames.delete(id));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    if (!ctxOf.has(this)) ctxOf.set(this, stubContext());
    return ctxOf.get(this) as never;
  } as never);
  window.history.replaceState(null, '', '/');
  draw.mockClear();
  given.length = 0;
  setHidden(false);
  setReducedMotion(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  setHidden(false);
  useSkyStore.setState({ claims: {} });
});

/** A stand-in for Watch: a host element in the layout, and a claim naming it. */
function Asker({ claim, withHost = true }: { claim: Omit<SkyClaim, 'front'> | null; withHost?: boolean }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useSkyClaim('test', claim === null ? null : { ...claim, front: withHost ? host : null });
  return <div className="asker-host" ref={setHost} />;
}

const mainCanvas = (c: HTMLElement) => c.querySelector('canvas.horizon-canvas:not(.horizon-front)') as HTMLCanvasElement;
const frontCanvas = () => document.querySelector('canvas.horizon-front') as HTMLCanvasElement | null;

describe('the front layer', () => {
  it('off by default: one canvas, and every draw is the whole picture (no part)', () => {
    const { container } = render(
      <>
        <HorizonCanvas now={() => NIGHT} />
        <Asker claim={null} />
      </>,
    );
    for (let k = 1; k <= 4; k++) runFrame(k * 100);
    expect(document.querySelectorAll('canvas')).toHaveLength(1);
    expect(frontCanvas()).toBeNull();
    expect(draw.mock.calls.length).toBe(5);
    for (const [ctx, o] of draw.mock.calls) {
      expect(ctx).toBe(ctxOf.get(mainCanvas(container)));
      expect(o).not.toHaveProperty('part');
    }
    // A claim that only moves the moon mounts no second canvas either.
    act(() => useSkyStore.setState({ claims: { m: { noMoon: true } } }));
    runFrame(600);
    expect(frontCanvas()).toBeNull();
    expect(draw.mock.lastCall![1]).not.toHaveProperty('part');
  });

  it('on: a second canvas in the asker\'s element, fixed to the stage, taking no pointer; each frame draws the sky on the main canvas and the ground on it, with the same options', () => {
    const { container } = render(
      <>
        <HorizonCanvas now={() => NIGHT} />
        <Asker claim={{}} />
      </>,
    );
    const front = frontCanvas()!;
    expect(front).not.toBeNull();
    expect(front.parentElement!.className).toBe('asker-host');
    expect(front.style.position).toBe('fixed');
    expect(front.style.pointerEvents).toBe('none');
    expect(front.getAttribute('aria-hidden')).toBe('true');
    draw.mockClear();
    runFrame(100);
    runFrame(200);
    expect(draw.mock.calls).toHaveLength(4);
    const main = ctxOf.get(mainCanvas(container));
    for (let f = 0; f < 2; f++) {
      const [skyCtx, sky] = draw.mock.calls[f * 2];
      const [groundCtx, ground] = draw.mock.calls[f * 2 + 1];
      expect(skyCtx).toBe(main);
      expect(groundCtx).toBe(ctxOf.get(front));
      expect(sky.part).toBe('sky');
      expect(ground.part).toBe('ground');
      const { part: _a, ...s } = sky;
      const { part: _b, ...g } = ground;
      expect(g).toEqual(s); // same camera, time, ripple and pulse
    }
    // The same size as the main canvas, and it follows a resize with it.
    expect([front.width, front.height]).toEqual([mainCanvas(container).width, mainCanvas(container).height]);
  });

  it('the rail\'s column: the front canvas is cut at the main area\'s left edge and the main canvas takes the ground there from it; the veil goes on the front canvas', () => {
    const logs = new Map<HTMLCanvasElement, string[]>();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      if (!ctxOf.has(this)) {
        const r = recordingContext();
        logs.set(this, r.log);
        ctxOf.set(this, r.ctx);
      }
      return ctxOf.get(this) as never;
    } as never);
    const { container } = render(
      <>
        <div className="veil" style={{ ['--veil' as string]: '0.1' }} />
        <HorizonCanvas now={() => NIGHT} />
        <Asker claim={{}} />
      </>,
    );
    const front = frontCanvas()!;
    expect(front.style.clipPath).toBe(`inset(0px 0px 0px ${MAIN_LEFT}px)`);
    for (const l of logs.values()) l.length = 0; // the first paint came before the front canvas
    runFrame(100);
    const main = logs.get(mainCanvas(container))!;
    const strip = Math.ceil(MAIN_LEFT * Number(mainCanvas(container).width / 2560));
    expect(main.filter((l) => l.startsWith('drawImage('))).toEqual([`drawImage([],0,0,${strip},${front.height},0,0,${strip},${front.height})`]);
    // drawHorizon is mocked here, so the front canvas's own calls are the veil's (and nothing else).
    expect(logs.get(front)!).toContain('globalCompositeOperation=source-atop');
  });

  it('released: the second canvas goes and the main canvas draws the whole picture again on the next frame', () => {
    const { container, rerender } = render(
      <>
        <HorizonCanvas now={() => NIGHT} />
        <Asker claim={{}} />
      </>,
    );
    runFrame(100);
    rerender(
      <>
        <HorizonCanvas now={() => NIGHT} />
        <Asker claim={null} />
      </>,
    );
    expect(frontCanvas()).toBeNull();
    draw.mockClear();
    runFrame(200);
    expect(draw.mock.calls).toHaveLength(1);
    expect(draw.mock.calls[0][0]).toBe(ctxOf.get(mainCanvas(container)));
    expect(draw.mock.calls[0][1]).not.toHaveProperty('part');
  });

  it('a claim with no element mounts nothing', () => {
    render(
      <>
        <HorizonCanvas now={() => NIGHT} />
        <Asker claim={{ boxes: [[0, 0, 10, 10]] }} withHost={false} />
      </>,
    );
    expect(frontCanvas()).toBeNull();
  });

  it('a host taken out of the page while its claimant stays: the next frame is the one-canvas whole picture, and the claim drops the host so no canvas is left behind', async () => {
    const { container } = render(
      <>
        <HorizonCanvas now={() => NIGHT} />
        <Asker claim={{ boxes: [[600, 50, 300, 150]] }} />
      </>,
    );
    runFrame(100);
    expect(frontCanvas()).not.toBeNull();
    const hostEl = document.querySelector('.asker-host')!;
    const parent = hostEl.parentElement!;
    hostEl.remove(); // the claimant (Asker) is still mounted
    draw.mockClear();
    runFrame(200); // before the page's change is even reported
    expect(draw.mock.calls).toHaveLength(1);
    expect(draw.mock.calls[0][0]).toBe(ctxOf.get(mainCanvas(container)));
    expect(draw.mock.calls[0][1]).not.toHaveProperty('part');
    expect(draw.mock.calls[0][1].moon).toEqual(MOON);
    await act(async () => {
      await Promise.resolve();
    });
    expect(useSkyStore.getState().claims.test).toEqual({ boxes: [[600, 50, 300, 150]] });
    expect(document.querySelectorAll('canvas')).toHaveLength(1);
    expect(frontCanvas()).toBeNull();
    draw.mockClear();
    runFrame(300);
    expect(draw.mock.calls.map(([c, o]) => [c === ctxOf.get(mainCanvas(container)), o.part])).toEqual([[true, undefined]]);
    parent.appendChild(hostEl); // back, so the page can be taken down as React built it
  });

  it('nothing avoidable per frame: one options object for both parts, and the veil read only while it can change', () => {
    let clock = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const style = vi.spyOn(window, 'getComputedStyle');
    render(
      <>
        <div className="veil" style={{ ['--veil' as string]: '0.1' }} />
        <HorizonCanvas now={() => NIGHT} />
        <Asker claim={{}} />
      </>,
    );
    given.length = 0;
    runFrame(100);
    // The sky and the ground are drawn from the very same object (only its part changes).
    expect(given).toHaveLength(2);
    expect(given[0]).toBe(given[1]);
    // Read while the place's veil may still be moving (it has a 600 ms transition), then never.
    clock += 900;
    runFrame(200);
    style.mockClear();
    for (let k = 3; k <= 12; k++) runFrame(k * 100);
    expect(style).not.toHaveBeenCalled();
    // A place change reads it again through its transition.
    act(() => usePlaceStore.getState().setActive('work'));
    act(() => usePlaceStore.getState().setActive('unwind'));
    runFrame(1300);
    expect(style).toHaveBeenCalled();
  });

  it('rests with the main canvas: a hidden page draws neither, and both resume together', () => {
    render(
      <>
        <HorizonCanvas now={() => NIGHT} />
        <Asker claim={{}} />
      </>,
    );
    runFrame(100);
    draw.mockClear();
    setHidden(true);
    runFrame(200);
    runFrame(300);
    expect(draw).not.toHaveBeenCalled();
    setHidden(false);
    runFrame(400);
    expect(draw.mock.calls.map(([, o]) => o.part)).toEqual(['sky', 'ground']);
  });

  it('Zen stops both: no front canvas and no frames while it is open', () => {
    render(
      <>
        <HorizonCanvas now={() => NIGHT} />
        <Asker claim={{}} />
      </>,
    );
    runFrame(100);
    act(() => usePlaceStore.getState().setActive('zen'));
    expect(frontCanvas()).toBeNull();
    expect(frames.size).toBe(0);
  });

  it('a still frame (reduced motion) is drawn again on both canvases when the layer comes, and once a minute after', () => {
    vi.useFakeTimers();
    setReducedMotion(true);
    const { rerender } = render(
      <>
        <HorizonCanvas now={() => NIGHT} />
        <Asker claim={null} />
      </>,
    );
    expect(draw).toHaveBeenCalledTimes(1);
    draw.mockClear();
    rerender(
      <>
        <HorizonCanvas now={() => NIGHT} />
        <Asker claim={{}} />
      </>,
    );
    expect(draw.mock.calls.map(([, o]) => o.part)).toEqual(['sky', 'ground']);
    // Once more when the place's veil has settled (its transition is 600 ms), so the front canvas's veil is the settled one.
    draw.mockClear();
    act(() => vi.advanceTimersByTime(1000));
    expect(draw.mock.calls.map(([, o]) => o.part)).toEqual(['sky', 'ground']);
    draw.mockClear();
    act(() => vi.advanceTimersByTime(59_000));
    expect(draw.mock.calls.map(([, o]) => o.part)).toEqual(['sky', 'ground']);
  });
});

describe('the moon under the sky claims', () => {
  it('is drawn at its place on Unwind with no claim, withheld while a claim says no moon or covers it, and back once released', () => {
    const { rerender } = render(
      <>
        <HorizonCanvas now={() => NIGHT} />
        <Asker claim={null} />
      </>,
    );
    runFrame(100);
    expect(draw.mock.lastCall![1].moon).toEqual(MOON);
    expect(MOON).toEqual([1890, 260, 44]);
    expect(MOON_PLACES[0]).toBe(MOON);
    const show = (claim: Omit<SkyClaim, 'front'> | null) => {
      rerender(
        <>
          <HorizonCanvas now={() => NIGHT} />
          <Asker claim={claim} />
        </>,
      );
      runFrame(nextId * 100);
      return draw.mock.lastCall![1];
    };
    expect(show({ noMoon: true })).not.toHaveProperty('moon');
    // A picture over its place moves it to the next clear place; so does a card's keep-clear box.
    expect(show({ boxes: [[1150, 50, 810, 455]] }).moon).toEqual(MOON_PLACES[1]);
    expect(show({ clear: [[1740, 24, 800, 462]] }).moon).toEqual(MOON_PLACES[1]);
    expect(show({ boxes: [[600, 50, 300, 150]] }).moon).toEqual(MOON); // a picture well clear of it
    // Boxes over every place: no moon.
    expect(show({ clear: MOON_PLACES.map(([x, y]) => [x - 1, y - 1, 2, 2] as const) })).not.toHaveProperty('moon');
    expect(show(null).moon).toEqual(MOON);
  });

  it('a resting canvas draws exactly one new frame when a claim comes, changes or goes, with no other trigger, and none when a claim is made again with the same boxes', () => {
    vi.useFakeTimers();
    setReducedMotion(true);
    render(<HorizonCanvas now={() => NIGHT} />);
    // At rest: one still frame, no animation loop, the moon at its first place.
    expect(frames.size).toBe(0);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(draw.mock.lastCall![1].moon).toEqual(MOON);
    draw.mockClear();
    // A card claims a box over the moon: the next frame comes at once, the moon moved.
    act(() => claimSky('card', { clear: [[1740, 24, 800, 462]] }));
    expect(draw).toHaveBeenCalledTimes(1);
    expect(draw.mock.lastCall![1].moon).toEqual(MOON_PLACES[1]);
    expect(mainCanvas(document.body).dataset.moon).toBe(MOON_PLACES[1].join(','));
    // The same box made again (new arrays, same values): no frame, so no loop of claims and frames.
    draw.mockClear();
    act(() => claimSky('card', { clear: [[1740, 24, 800, 462]] }));
    expect(draw).not.toHaveBeenCalled();
    // The box changes to cover the second place too: one frame, the moon moves on.
    act(() => claimSky('card', { clear: [[1740, 24, 800, 462], [700, 280, 120, 40]] }));
    expect(draw).toHaveBeenCalledTimes(1);
    expect(draw.mock.lastCall![1].moon).toEqual(MOON_PLACES[2]);
    // Released: one frame, the moon back at its first place.
    draw.mockClear();
    act(() => releaseSky('card'));
    expect(draw).toHaveBeenCalledTimes(1);
    expect(draw.mock.lastCall![1].moon).toEqual(MOON);
    expect(mainCanvas(document.body).dataset.moon).toBe(MOON.join(','));
  });
});
