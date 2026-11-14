// @ts-ignore node's own file call; the stylesheet rules are read as text.
import { readFileSync } from 'node:fs';
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { useSkyStore } from '../../horizon/sky';
import { resetNowPlaying } from '../../music/store';
import { Unwind } from '../../screens/Unwind';
import { useSignalStore } from '../../signals/store';
import { usePlaceStore } from '../../state/places';
import { resetLastPlayed } from '../lastPlayed';
import { DEFAULT_LOOKS, HOLO_PANE, LOOKS, LOOKS_KEY, LOOK_BOXES, behindTheLand, isLook, layeredNow, loadLooks, ownsTheMoonSky, parseLooks, pickLook } from './looks';
import { SAVED_KEY } from './saved';
import { resetWatch, useWatchStore } from './store';

// The Hologram, the fifth look: stored and parsed like the others, offered in the Look switch
// (five segments, one lit, arrow keys), drawn as a plate under a tilted stage and an emitter after
// it, in front of the land with no front layer, and the moon keeps out of its box.
const V = 'Ab3dEfGh1jK';
const THREE = [
  { kind: 'video', id: V, label: 'Night drive mix' },
  { kind: 'live', id: 'Lofi_Live01', label: 'Lofi radio' },
  { kind: 'twitch', id: 'pixel_harbor', label: 'pixel_harbor' },
];
const css = (readFileSync('src/styles/unwind.css', 'utf8') as string).replace(/\/\*[\s\S]*?\*\//g, '');
/** The text of every block whose selector is exactly `selector` (alone or last of a list). */
const rule = (selector: string) => {
  let out = '';
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1]!.split(',').map((x) => x.trim()).includes(selector)) out += m[2];
  return out;
};

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

function setup(look: string, play = true) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(THREE));
  localStorage.setItem(LOOKS_KEY, JSON.stringify({ mode: 'one', all: look }));
  resetWatch();
  useWatchStore.getState().setTab('watch');
  if (play) useWatchStore.getState().play({ kind: 'video', id: V });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetWatch();
  useSkyStore.setState({ claims: {} });
  usePlaceStore.setState({ active: 'unwind', from: 'work' });
  useSignalStore.setState({ call: null });
  mocks.set('get_now_playing', () => ({ playback_status: 'stopped' }));
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  resetNowPlaying();
  resetLastPlayed();
  localStorage.clear();
});

describe('the Hologram as a stored look', () => {
  it('is the fifth look, has a name and a one-line hint, and is a valid id', () => {
    expect(LOOKS.map((l) => l.id)).toEqual(['feather', 'sky', 'sun', 'drivein', 'holo']);
    const holo = LOOKS.find((l) => l.id === 'holo')!;
    expect(holo.name).toBe('Hologram');
    expect(holo.hint).toMatch(/^[A-Z].+\.$/);
    expect(isLook('holo')).toBe(true);
  });

  it('parses, stores, loads, and still falls back on an unknown id', () => {
    const kind = JSON.stringify({ mode: 'kind', all: 'holo', video: 'holo', live: 'sky', twitch: 'drivein' });
    expect(parseLooks(kind)).toEqual({ mode: 'kind', all: 'holo', video: 'holo', live: 'sky', twitch: 'drivein' });
    expect(parseLooks(JSON.stringify({ mode: 'one', all: 'hologram' })).all).toBe(DEFAULT_LOOKS.all);
    expect(parseLooks(JSON.stringify({ mode: 'one', all: 'holo', video: 'nope' }))).toMatchObject({ all: 'holo', video: DEFAULT_LOOKS.video });
    useWatchStore.getState().setLooks(pickLook(DEFAULT_LOOKS, 'video', 'holo'));
    expect(parseLooks(localStorage.getItem(LOOKS_KEY)).all).toBe('holo');
    expect(loadLooks().all).toBe('holo');
  });

  it('old stored settings (the four earlier looks, or none) still load as they were', () => {
    for (const id of ['feather', 'sky', 'sun', 'drivein']) {
      localStorage.setItem(LOOKS_KEY, JSON.stringify({ mode: 'one', all: id, video: 'feather', live: 'sky', twitch: 'drivein' }));
      expect(loadLooks()).toEqual({ mode: 'one', all: id, video: 'feather', live: 'sky', twitch: 'drivein' });
    }
    localStorage.removeItem(LOOKS_KEY);
    expect(loadLooks()).toEqual(DEFAULT_LOOKS);
  });
});

describe('the Look switch with five segments', () => {
  it('shows five radios, exactly one selected, and the arrow keys walk all five and wrap', async () => {
    setup('feather');
    render(<Unwind />);
    await flush();
    const group = () => screen.getByRole('radiogroup', { name: 'Look' });
    const radios = () => [...group().querySelectorAll<HTMLElement>('[role=radio]')];
    expect(radios().map((r) => r.textContent)).toEqual(['Feathered', 'Whole sky', 'The sun', 'Drive-in', 'Hologram']);
    const lit = () => radios().filter((r) => r.getAttribute('aria-checked') === 'true').map((r) => r.textContent);
    expect(lit()).toEqual(['Feathered']);
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        group().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      });
      expect(lit().length).toBe(1);
      seen.push(lit()[0]!);
    }
    expect(seen).toEqual(['Whole sky', 'The sun', 'Drive-in', 'Hologram', 'Feathered']);
    await act(async () => {
      group().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(lit()).toEqual(['Hologram']);
    expect(document.querySelector('.w-stage')?.getAttribute('data-look')).toBe('holo');
  });

  it('keeps one box in every look and with nothing playing (its rule is fixed in the stylesheet)', () => {
    const r = rule('.w-lookbar');
    expect(r).toMatch(/left: 460px/);
    expect(r).toMatch(/width: 500px/);
    expect(r).toMatch(/height: 46px/);
    // Nothing look-specific restyles the switch's box.
    expect(css).not.toMatch(/\.w-holo[^{]*\.w-lookbar\s*\{/);
  });
});

describe('the Hologram on the wall', () => {
  it('draws the plate before the stage and the emitter after it, with the picture whole and nothing over it', async () => {
    setup('holo');
    const { container } = render(<Unwind />);
    await flush();
    const stage = container.querySelector('.w-stage')!;
    expect(stage.getAttribute('data-look')).toBe('holo');
    const plate = container.querySelector('.w-holo-plate')!;
    const emit = container.querySelector('.w-holo-emit')!;
    expect(plate.compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stage.compareDocumentPosition(emit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The plate is the pane's own box (before the tilt), less Unwind's offset.
    expect((plate as HTMLElement).style.width).toBe(`${HOLO_PANE.w}px`);
    expect((plate as HTMLElement).style.height).toBe(`${HOLO_PANE.h}px`);
    expect(HOLO_PANE.w / HOLO_PANE.h).toBeCloseTo(16 / 9, 2);
    expect(plate.querySelectorAll('.w-holo-hr').length).toBe(2);
    expect(plate.querySelectorAll('.w-holo-tk').length).toBe(4);
    // Nothing lies on the picture: the stage holds the screen and nothing else.
    expect([...stage.children].map((c) => c.className)).toEqual(['w-screen']);
    expect(emit.getAttribute('style')).toMatch(/pointer-events: none/);
    // The emitter is drawn by the Hologram only.
    for (const other of ['feather', 'sky', 'sun', 'drivein']) {
      setup(other);
      const again = render(<Unwind />);
      await flush();
      expect(again.container.querySelector('.w-holo-plate, .w-holo-emit')).toBeNull();
      again.unmount();
    }
  });

  it('sits in front of the land with no front layer, owns no moon sky, and asks the moon to keep out of its box', async () => {
    expect(behindTheLand('holo')).toBe(false);
    expect(layeredNow('holo', false)).toBe(false);
    expect(ownsTheMoonSky('holo')).toBe(false);
    setup('holo');
    render(<Unwind />);
    await flush();
    const c = useSkyStore.getState().claims.watch;
    expect(c.front ?? null).toBeNull();
    expect(c.noMoon).toBeFalsy();
    const b = LOOK_BOXES.holo;
    expect(c.boxes).toEqual([[b.x, b.y, b.w, b.h]]);
    // The box covers the whole tilted pane.
    expect(b.x).toBeLessThanOrEqual(1219);
    expect(b.x + b.w).toBeGreaterThanOrEqual(1950);
    expect(b.y).toBeLessThanOrEqual(38);
    expect(b.y + b.h).toBeGreaterThanOrEqual(459);
    expect(document.querySelector('.w-stage.w-layered')).toBeNull();
    expect(document.querySelector('.w-front')).toBeNull();
  });

  it('keeps the pointer off the player, with the click-to-start exception, and drops the blend where the layering cannot blend', () => {
    // The base rule: the frame takes no pointer; only a refused autoplay's .w-take frame does.
    expect(rule('.w-frame')).toMatch(/pointer-events: none/);
    expect(rule('.w-frame.w-take')).toMatch(/pointer-events: auto/);
    expect(css).not.toMatch(/\.w-holo[^{]*\{[^}]*pointer-events: auto/);
    expect(rule('.w-holo-plate')).toMatch(/pointer-events: none/);
    // The look: tilted, blended with screen, in the owner's numbers.
    const tilt = 'perspective(2400px) rotateY(-7deg) rotateX(1.2deg)';
    expect(css).toContain(tilt);
    expect(rule('.w-holo')).toMatch(/mix-blend-mode: screen/);
    // Fallbacks: no blend where the browser has none or the main area is its own layer group; the tilt and plate stay.
    expect(css).toMatch(/@supports not \(mix-blend-mode: screen\)\s*\{\s*\.w-holo\s*\{\s*mix-blend-mode: normal/);
    expect(css).toMatch(/\.main:has\(\.w-layered\) \.w-holo\s*\{\s*mix-blend-mode: normal/);
  });

  it('a refused autoplay still shows the click line and the frame can be clicked', async () => {
    setup('holo');
    render(<Unwind />);
    await flush();
    await act(async () => useWatchStore.getState().setNeedsClick(true));
    expect(screen.getByText('Click the video to start')).toBeTruthy();
    const stage = document.querySelector('.w-stage')!;
    expect(within(stage as HTMLElement).queryByTitle('Night drive mix') ?? stage.querySelector('.w-frame')).toBeTruthy();
  });
});

describe('the settings sheet tile for the Hologram', () => {
  it('offers a Hologram tile with a drawing and its one-line description, and picking it plays that look', async () => {
    setup('drivein');
    render(<Unwind />);
    await flush();
    await act(async () => screen.getByRole('button', { name: 'How video is shown' }).click());
    const tiles = screen.getByRole('radiogroup', { name: 'Look for everything' });
    const tile = within(tiles).getByRole('radio', { name: /Hologram/ });
    expect(tile.querySelector('.w-pic.holo')).toBeTruthy();
    await act(async () => tile.click());
    expect(parseLooks(localStorage.getItem(LOOKS_KEY)).all).toBe('holo');
    expect(screen.getByText(/The whole picture floats on a tilted pane of light/)).toBeTruthy();
  });
});
