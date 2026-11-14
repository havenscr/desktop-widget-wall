// @ts-ignore node's own file call; the whole-sky tests read unwind.css as text.
import { readFileSync } from 'node:fs';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { HorizonCanvas } from '../../horizon/HorizonCanvas';
import { MOON, MOON_PLACES } from '../../horizon/cameras';
import { stubContext } from '../../horizon/canvasStub';
import { moonFor, useSkyStore } from '../../horizon/sky';
import { resetNowPlaying } from '../../music/store';
import { UnwindView } from './testView';
import { useSignalStore } from '../../signals/store';
import { usePlaceStore } from '../../state/places';
import { resetLastPlayed } from '../lastPlayed';
import { CAMERAS } from '../../horizon/cameras';
import { LOOKS_KEY, LOOK_BOXES, type LookId } from './looks';
import { SAVED_KEY } from './saved';
import { resetWatch, useWatchStore } from './store';

// sky layers: each look tells the horizon its picture's box, whether the moon may show, and
// (for a picture behind the land) where to mount the front canvas.
const V = 'Ab3dEfGh1jK';
const THREE = [
  { kind: 'video', id: V, label: 'Night drive mix' },
  { kind: 'live', id: 'Lofi_Live01', label: 'Lofi radio' },
  { kind: 'twitch', id: 'pixel_harbor', label: 'pixel_harbor' },
];
const IDS: LookId[] = ['feather', 'sky', 'sun', 'drivein', 'holo'];
// The feathered picture stands in front of the mountains (the owner's choice), as the drive-in does.
const BEHIND: Record<LookId, boolean> = { feather: false, sky: true, sun: true, drivein: false, holo: false };

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

function setup(look: LookId, play = true) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(THREE));
  localStorage.setItem(LOOKS_KEY, JSON.stringify({ mode: 'one', all: look }));
  resetWatch();
  useWatchStore.getState().setTab('watch');
  if (play) useWatchStore.getState().play({ kind: 'video', id: V });
}

const claims = () => useSkyStore.getState().claims;
const front = () => document.querySelector('canvas.horizon-front');
const box = (look: LookId) => {
  const b = LOOK_BOXES[look];
  return [[b.x, b.y, b.w, b.h]];
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetWatch();
  useSkyStore.setState({ claims: {} });
  usePlaceStore.setState({ active: 'unwind', from: 'work' });
  useSignalStore.setState({ call: null });
  mocks.set('get_now_playing', () => ({ playback_status: 'stopped' }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => stubContext() as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  mocks.clear();
  resetNowPlaying();
  resetLastPlayed();
  localStorage.clear();
  useSkyStore.setState({ claims: {} });
});

describe('the sky layers under each look', () => {
  it.each(IDS)('%s: states its box, keeps the moon out of it, and asks for the front layer only behind the land', async (look) => {
    setup(look);
    render(
      <>
        <HorizonCanvas />
        <UnwindView />
      </>,
    );
    await flush();
    const c = claims().watch;
    expect(c.boxes).toEqual(box(look));
    expect(c.noMoon === true).toBe(look === 'sun' || look === 'drivein');
    // No look leaves the moon behind or beside its picture: it is gone, or at another place 40 px clear of the box.
    const m = moonFor(MOON_PLACES, claims());
    if (look === 'sun' || look === 'drivein') expect(m).toBeNull();
    else {
      expect(m).not.toBe(MOON);
      if (m) {
        const [bx, by, bw, bh] = box(look)[0];
        const gap = Math.hypot(Math.max(bx - m[0], 0, m[0] - bx - bw), Math.max(by - m[1], 0, m[1] - by - bh)) - m[2];
        expect(gap).toBeGreaterThanOrEqual(40);
      }
    }
    expect(!!c.front).toBe(BEHIND[look]);
    const stage = document.querySelector('.w-stage')!;
    expect(stage.getAttribute('data-sky-box')).toBe(box(look)[0].join(','));
    expect(stage.classList.contains('w-layered')).toBe(BEHIND[look]);
    if (BEHIND[look]) {
      // The front canvas is in the stage, after the picture: the land stands in front of it, the controls after it in front of the land.
      const f = front()!;
      expect(f.closest('.w-front')).toBe(c.front);
      expect(f.closest('.w-stage')).toBe(stage);
      const screen = stage.querySelector('.w-screen')!;
      expect(screen.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      if (look === 'sun') {
        // The warm streak lies on the land: after the front canvas.
        expect(f.compareDocumentPosition(stage.querySelector('.w-streak')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
      if (look === 'sky') {
        expect(f.compareDocumentPosition(document.querySelector('.w-skyspill')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
    } else {
      expect(front()).toBeNull();
    }
    expect(document.querySelectorAll('canvas.horizon-front').length).toBe(BEHIND[look] ? 1 : 0);
    expect(document.querySelector('.w-moonveil')).toBeNull();
  });

  it('follows the look as it changes, and is released while Watch or Unwind is left (the video plays on) and when nothing is on', async () => {
    setup('sky');
    render(
      <>
        <HorizonCanvas />
        <UnwindView />
      </>,
    );
    await flush();
    expect(front()).not.toBeNull();
    for (const look of ['drivein', 'feather', 'sun', 'sky'] as LookId[]) {
      act(() => useWatchStore.getState().pickLook(look));
      await flush();
      expect(claims().watch.boxes).toEqual(box(look));
      expect(document.querySelectorAll('canvas.horizon-front').length).toBe(BEHIND[look] ? 1 : 0);
    }
    // Listen: the video plays on out of sight and claims nothing from the sky.
    act(() => useWatchStore.getState().setTab('listen'));
    await flush();
    expect(useWatchStore.getState().playing).not.toBeNull();
    expect(claims()).toEqual({});
    expect(front()).toBeNull();
    expect(moonFor(MOON_PLACES, claims())).toBe(MOON);
    // Back on Watch it is still playing, in its look, behind the land again.
    act(() => useWatchStore.getState().setTab('watch'));
    await flush();
    expect(claims().watch.boxes).toEqual(box('sky'));
    expect(front()).not.toBeNull();
    // Stopping the video releases it (the whole sky has no empty screen).
    act(() => useWatchStore.getState().stop());
    await flush();
    expect(claims()).toEqual({});
    expect(front()).toBeNull();
    // Playing again, then leaving Unwind for another place: it plays on and claims nothing.
    act(() => useWatchStore.getState().play({ kind: 'video', id: V }));
    await flush();
    expect(front()).not.toBeNull();
    act(() => usePlaceStore.getState().setActive('work'));
    await flush();
    expect(useWatchStore.getState().playing).not.toBeNull();
    expect(claims()).toEqual({});
    expect(front()).toBeNull();
    expect(moonFor(MOON_PLACES, claims())).toBe(MOON);
    // And back on Unwind, in its look again.
    act(() => usePlaceStore.getState().setActive('unwind'));
    await flush();
    expect(claims().watch.boxes).toEqual(box('sky'));
    expect(front()).not.toBeNull();
  });

  it('with nothing on, the moon shows in every look but the drive-in, whose empty screen owns that sky', async () => {
    for (const look of IDS) {
      setup(look, false);
      const { unmount } = render(<UnwindView />);
      await flush();
      expect(moonFor(MOON_PLACES, claims())).toBe(look === 'drivein' ? null : MOON);
      if (look === 'drivein') expect(claims().watch).toEqual({ boxes: box('drivein'), noMoon: true });
      unmount();
      expect(claims()).toEqual({});
    }
  });

  it('while the player waits for a click to start, the sun is not put behind the land (the click reaches it), and it still keeps the moon out', async () => {
    setup('sun');
    render(
      <>
        <HorizonCanvas />
        <UnwindView />
      </>,
    );
    await flush();
    expect(front()).not.toBeNull();
    act(() => useWatchStore.setState({ needsClick: true }));
    await flush();
    expect(front()).toBeNull();
    expect(document.querySelector('.w-stage')!.classList.contains('w-layered')).toBe(false);
    expect(claims().watch.boxes).toEqual(box('sun'));
    expect(moonFor(MOON_PLACES, claims())).toBeNull();
    act(() => useWatchStore.setState({ needsClick: false }));
    await flush();
    expect(front()).not.toBeNull();
  });

  it('the whole sky stays behind the land while it waits for a click (the wall lets the pointer through to it, and the front canvas takes none)', async () => {
    setup('sky');
    render(
      <>
        <HorizonCanvas />
        <UnwindView />
      </>,
    );
    await flush();
    act(() => useWatchStore.setState({ needsClick: true }));
    await flush();
    const f = front() as HTMLCanvasElement | null;
    expect(f).not.toBeNull();
    expect(f!.style.pointerEvents).toBe('none');
    expect(document.querySelector('.w-stage')!.classList.contains('w-layered')).toBe(true);
  });
});

describe('the cards Unwind stands in the sky keep the moon clear of them', () => {
  const rect = (x: number, y: number, w: number, h: number) => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON() {} }) as DOMRect;
  /** Each card drawn where the layout puts it (jsdom lays nothing out). */
  const lay = (boxes: Record<string, [number, number, number, number]>) =>
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      for (const sel in boxes) if (this.matches(sel)) return rect(...boxes[sel]);
      return rect(0, 0, 0, 0);
    });

  it('Listen: the wide card claims its own drawn box, so the moon moves to the next clear place, and back when Listen goes', async () => {
    lay({ '.sp-card': [1740, 24, 800, 462] });
    useWatchStore.getState().setTab('listen');
    const { unmount } = render(<UnwindView />);
    await flush();
    expect(claims()['listen-card']).toEqual({ clear: [[1740, 24, 800, 462]] });
    expect(moonFor(MOON_PLACES, claims())).toBe(MOON_PLACES[1]);
    unmount();
    expect(claims()).toEqual({});
    expect(moonFor(MOON_PLACES, claims())).toBe(MOON);
  });

  it('Listen: the player claims its own drawn box too, so a player grown down toward the second place takes the moon away rather than under it', async () => {
    // The player at its widest (long names) leaves the second place 45 px clear.
    const spy = lay({ '.sp-card': [1740, 24, 800, 462], '.u-player': [624, 26, 1086, 225] });
    useWatchStore.getState().setTab('listen');
    const { unmount } = render(<UnwindView />);
    await flush();
    expect(claims()['listen-player']).toEqual({ clear: [[624, 26, 1086, 225]] });
    expect(moonFor(MOON_PLACES, claims())).toBe(MOON_PLACES[1]);
    unmount();
    expect(claims()).toEqual({});
    // A player 30 px taller: the second place is too near it and the third lies on it, so no moon.
    spy.mockRestore();
    lay({ '.sp-card': [1740, 24, 800, 462], '.u-player': [624, 26, 1086, 255] });
    render(<UnwindView />);
    await flush();
    expect(claims()['listen-player']).toEqual({ clear: [[624, 26, 1086, 255]] });
    expect(moonFor(MOON_PLACES, claims())).toBeNull();
  });

  it('Watch with nothing on: the list card, the left block and the Look switch claim their boxes; the moon stays at its first place, clear of them', async () => {
    lay({ '.w-card': [2030, 20, 510, 330], '.w-now': [620, 120, 520, 260], '.w-lookbar': [620, 400, 458, 44] });
    setup('feather', false);
    render(<UnwindView />);
    await flush();
    expect(claims()['watch-card']).toEqual({ clear: [[2030, 20, 510, 330]] });
    expect(claims()['watch-now']).toEqual({ clear: [[620, 120, 520, 260]] });
    expect(claims()['watch-look']).toEqual({ clear: [[620, 400, 458, 44]] });
    expect(moonFor(MOON_PLACES, claims())).toBe(MOON);
  });
});

describe('the feathered look stands in front of the mountains', () => {
  it('never asks for the front layer, playing or waiting for a click: its glow and picture are drawn over the one horizon canvas, and no moon veil is needed', async () => {
    setup('feather');
    render(
      <>
        <HorizonCanvas />
        <UnwindView />
      </>,
    );
    await flush();
    for (const needsClick of [false, true, false]) {
      act(() => useWatchStore.setState({ needsClick }));
      await flush();
      const stage = document.querySelector('.w-stage.w-feather')!;
      expect(stage.classList.contains('w-layered')).toBe(false);
      expect(stage.querySelector('.w-front')).toBeNull();
      expect(stage.querySelector('.w-glow')).not.toBeNull();
      expect(front()).toBeNull();
      expect(claims().watch.front).toBeUndefined();
      expect(document.querySelectorAll('canvas').length).toBe(1);
    }
    // Its box still keeps the moon off it: the first place is within 40 px of the picture.
    expect(moonFor(MOON_PLACES, claims())).not.toBe(MOON);
    expect(document.querySelector('.w-moonveil')).toBeNull();
  });
});

describe('the whole sky is fitted whole', () => {
  // The embedded player does not report its video's shape, so the frame is fitted as 16:9 (the
  // fit check measures the drawn box in a real browser: inside the stage at the top and sides).
  const b = LOOK_BOXES.sky;
  // Read as text from disk (the test setup does not load unwind.css as a style).
  const css: string = readFileSync('src/styles/unwind.css', 'utf8');
  /** The declarations of the rule whose selector is exactly `sel` (whitespace taken out), or null. */
  const rule = (sel: string) => {
    const lines: string[] = css.replace(/\r/g, '').split('\n');
    const at = lines.findIndex((l) => l.trim() === `${sel} {`);
    if (at < 0) return null;
    const end = lines.findIndex((l, i) => i > at && l.trim() === '}');
    return lines.slice(at + 1, end).join('').replace(/\s+/g, '');
  };

  it('is the whole 16:9 picture, inside the strip at the top and the sides, its top 12 to 20 px down, its foot under the horizon', () => {
    expect(Math.abs(b.w / b.h - 16 / 9)).toBeLessThan(0.002);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.w).toBeLessThanOrEqual(2560);
    expect(b.y).toBeGreaterThanOrEqual(12);
    expect(b.y).toBeLessThanOrEqual(20);
    expect(b.y + b.h).toBeGreaterThan(CAMERAS.unwind.hy); // only the land hides its lower edge
  });

  it('the stage is the box (less Unwind\'s offset, 124 by 20) and the frame fills it: no cover crop', () => {
    const sky = rule('.w-sky')!;
    expect(sky).toContain(`left:${b.x - 124}px;`);
    expect(sky).toContain(`top:${b.y - 20}px;`);
    expect(sky).toContain(`width:${b.w}px;`);
    expect(sky).toContain(`height:${b.h}px;`);
    expect(sky).not.toContain('overflow:hidden');
    // No rule sizes or moves the whole sky's frame: it keeps .w-frame's inset 0 and 100 percent.
    expect(rule('.w-sky .w-frame')).toBeNull();
    // Plain edges: no mask fades or crops any of it (the owner asked for no feather on this look).
    const screen = rule('.w-sky .w-screen')!;
    expect(screen).not.toContain('mask');
  });

  it('the left block has no dark plate beside the whole sky (no picture lies under it; its text reads on the sky)', () => {
    expect(rule('.unwind:has(.w-sky) .w-now')).toBeNull();
    expect(css).not.toMatch(/:has\(\.w-sky\)[^{]*\.w-now\s*\{/);
  });

  it('the sun is a clean circle: no bands across the video', () => {
    const sun = rule('.w-sun .w-screen')!;
    expect(sun).toContain('border-radius:50%');
    expect(sun).not.toContain('mask');
  });
});
