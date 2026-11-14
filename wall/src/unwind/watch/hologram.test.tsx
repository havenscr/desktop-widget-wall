// @ts-ignore node's own file call; the stylesheet rules are read as text.
import { readFileSync } from 'node:fs';
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { useSkyStore } from '../../horizon/sky';
import { resetNowPlaying } from '../../music/store';
import { UnwindView } from './testView';
import { useSignalStore } from '../../signals/store';
import { usePlaceStore } from '../../state/places';
import { resetLastPlayed } from '../lastPlayed';
import { DEFAULT_LOOKS, HOLO_PANE, LOOKS, LOOKS_KEY, LOOK_BOXES, behindTheLand, isLook, layeredNow, loadLooks, ownsTheMoonSky, parseLooks, pickLook } from './looks';
import { BEAM_CLEAR, EMITTER, HOLO_TILT, HologramEmitter, beamClip, paneQuad } from './HologramStage';
import { SAVED_KEY } from './saved';
import { resetWatch, useWatchStore } from './store';

// The Hologram, the fifth look: stored and parsed like the others, offered in the Look switch
// (five segments, one lit, arrow keys), drawn as a plate and an emitter under a tilted stage, in front
// of the land with no front layer, and the moon keeps out of its box.
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
    render(<UnwindView />);
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
  it('draws the plate and the emitter before the stage, with the picture whole and nothing over it', async () => {
    setup('holo');
    const { container } = render(<UnwindView />);
    await flush();
    const stage = container.querySelector('.w-stage')!;
    expect(stage.getAttribute('data-look')).toBe('holo');
    const plate = container.querySelector('.w-holo-plate')!;
    const emit = container.querySelector('.w-holo-emit')!;
    expect(plate.compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(emit.compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Nothing of the look follows the stage: the picture is painted above every part of the Hologram.
    for (let n = stage.nextElementSibling; n; n = n.nextElementSibling) expect(String(n.className)).not.toMatch(/holo/);
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
      const again = render(<UnwindView />);
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
    render(<UnwindView />);
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
    render(<UnwindView />);
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
    render(<UnwindView />);
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

describe('the Hologram beam stays off the picture', () => {
  /** The height of the line through the pane's lower corners at x, plus the clear gap. */
  const lowerEdge = (x: number) => {
    const q = paneQuad();
    const [bl, br] = [q[3]!, q[2]!];
    return bl[1] + ((br[1] - bl[1]) / (br[0] - bl[0])) * (x - bl[0]);
  };

  it('uses the tilt of the stylesheet, and the tilted pane is where the browser puts it', () => {
    expect(css).toContain(`perspective(${HOLO_TILT.perspective}px) rotateY(${HOLO_TILT.rotateY}deg) rotateX(${HOLO_TILT.rotateX}deg)`);
    const q = paneQuad();
    // Corners as the browser draws them (measured in the fit check): the lower edge runs from about y 453 at the left to 459 at the right.
    expect(q[3]![0]).toBeCloseTo(1218.5, 0);
    expect(q[3]![1]).toBeCloseTo(453.2, 0);
    expect(q[2]![0]).toBeCloseTo(1950.3, 0);
    expect(q[2]![1]).toBeCloseTo(459.4, 0);
  });

  it('cuts the beam off under the lower edge: the clip is clear of every pane corner and of the whole edge', () => {
    const clip = beamClip();
    expect(BEAM_CLEAR).toBeGreaterThanOrEqual(2);
    // The top side of the clip is the lower edge's line, BEAM_CLEAR lower, over the whole width of the scene.
    expect(clip[0]![1]).toBeCloseTo(lowerEdge(clip[0]![0]) + BEAM_CLEAR, 5);
    expect(clip[1]![1]).toBeCloseTo(lowerEdge(clip[1]![0]) + BEAM_CLEAR, 5);
    expect(clip[0]![0]).toBeLessThanOrEqual(0);
    expect(clip[1]![0]).toBeGreaterThanOrEqual(2560);
    for (const [x, y] of paneQuad()) {
      const edge = clip[0]![1] + ((clip[1]![1] - clip[0]![1]) / (clip[1]![0] - clip[0]![0])) * (x - clip[0]![0]);
      expect(y).toBeLessThan(edge);
    }
  });

  it('clips the beam (its blur included) and the rays with that polygon', () => {
    const { container } = render(<svg><HologramEmitter /></svg>);
    const clipPath = container.querySelector('clipPath#whc')!;
    expect(clipPath).toBeTruthy();
    const pts = clipPath.querySelector('polygon')!.getAttribute('points')!.split(' ').map((p) => p.split(',').map(Number));
    expect(pts.length).toBe(4);
    beamClip().forEach((c, i) => {
      expect(pts[i]![0]).toBeCloseTo(c[0], 1);
      expect(pts[i]![1]).toBeCloseTo(c[1], 1);
    });
    // The clip applies after the filter, so it also cuts the blur's spread.
    const beam = container.querySelector('.w-holo-beam')!;
    expect(beam.getAttribute('filter')).toBe('url(#whbl)');
    expect(beam.getAttribute('clip-path')).toBe('url(#whc)');
    const rays = [...container.querySelectorAll('path')].filter((p) => p.getAttribute('stroke') === '#9af9fc');
    expect(rays.length).toBe(1);
    expect(rays[0]!.getAttribute('clip-path')).toBe('url(#whc)');
    // Nothing else of the emitter is drawn above the clip line but the lens, which is on the floor.
    for (const el of container.querySelectorAll('ellipse')) expect(Number(el.getAttribute('cy'))).toBeGreaterThan(EMITTER.y - 5);
  });
});
