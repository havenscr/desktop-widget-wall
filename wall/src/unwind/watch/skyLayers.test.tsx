// @ts-ignore node's own file call; the whole-sky tests read unwind.css as text.
import { readFileSync } from 'node:fs';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { HorizonCanvas } from '../../horizon/HorizonCanvas';
import { MOON } from '../../horizon/cameras';
import { stubContext } from '../../horizon/canvasStub';
import { moonFor, useSkyStore } from '../../horizon/sky';
import { resetNowPlaying } from '../../music/store';
import { Unwind } from '../../screens/Unwind';
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
const IDS: LookId[] = ['feather', 'sky', 'sun', 'drivein'];
const BEHIND: Record<LookId, boolean> = { feather: true, sky: true, sun: true, drivein: false };

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
        <Unwind />
      </>,
    );
    await flush();
    const c = claims().watch;
    expect(c.boxes).toEqual(box(look));
    expect(c.noMoon === true).toBe(look === 'sun' || look === 'drivein');
    expect(moonFor(MOON, claims())).toBeNull(); // no look leaves the moon showing behind or beside its picture
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

  it('follows the look as it changes, and is released when Watch is left, when nothing is on and when Unwind is left', async () => {
    setup('sky');
    render(
      <>
        <HorizonCanvas />
        <Unwind />
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
    // Listen: the claim goes with the Watch panel.
    act(() => useWatchStore.getState().setTab('listen'));
    await flush();
    expect(claims()).toEqual({});
    expect(front()).toBeNull();
    expect(moonFor(MOON, claims())).toBe(MOON);
    // Leaving Watch stopped the video; back on Watch and playing, it comes back. Stopping the video releases it (the whole sky has no empty screen).
    act(() => useWatchStore.getState().setTab('watch'));
    await flush();
    expect(claims()).toEqual({});
    act(() => useWatchStore.getState().play({ kind: 'video', id: V }));
    await flush();
    expect(front()).not.toBeNull();
    act(() => useWatchStore.getState().stop());
    await flush();
    expect(claims()).toEqual({});
    expect(front()).toBeNull();
    // Playing again, then leaving Unwind for another place: nothing is left behind.
    act(() => useWatchStore.getState().play({ kind: 'video', id: V }));
    await flush();
    expect(front()).not.toBeNull();
    act(() => usePlaceStore.getState().setActive('work'));
    await flush();
    expect(claims()).toEqual({});
    expect(front()).toBeNull();
  });

  it('with nothing on, the moon shows in every look but the drive-in, whose empty screen owns that sky', async () => {
    for (const look of IDS) {
      setup(look, false);
      const { unmount } = render(<Unwind />);
      await flush();
      expect(moonFor(MOON, claims())).toBe(look === 'drivein' ? null : MOON);
      if (look === 'drivein') expect(claims().watch).toEqual({ boxes: box('drivein'), noMoon: true });
      unmount();
      expect(claims()).toEqual({});
    }
  });

  it('while the player waits for a click to start, the picture is not put behind the land (the click reaches it), and its box still keeps the moon out', async () => {
    setup('feather');
    render(
      <>
        <HorizonCanvas />
        <Unwind />
      </>,
    );
    await flush();
    expect(front()).not.toBeNull();
    act(() => useWatchStore.setState({ needsClick: true }));
    await flush();
    expect(front()).toBeNull();
    expect(document.querySelector('.w-stage')!.classList.contains('w-layered')).toBe(false);
    expect(claims().watch.boxes).toEqual(box('feather'));
    expect(moonFor(MOON, claims())).toBeNull();
    act(() => useWatchStore.setState({ needsClick: false }));
    await flush();
    expect(front()).not.toBeNull();
  });

  it('the whole sky stays behind the land while it waits for a click (the wall lets the pointer through to it, and the front canvas takes none)', async () => {
    setup('sky');
    render(
      <>
        <HorizonCanvas />
        <Unwind />
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

  it('the sun is a clean circle: no bands across the video', () => {
    const sun = rule('.w-sun .w-screen')!;
    expect(sun).toContain('border-radius:50%');
    expect(sun).not.toContain('mask');
  });
});
