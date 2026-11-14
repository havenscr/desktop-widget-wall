// @ts-ignore node's own file call; the stylesheet rules are read as text.
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { useSkyStore } from '../../horizon/sky';
import { resetNowPlaying } from '../../music/store';
import { useSignalStore } from '../../signals/store';
import { usePlaceStore } from '../../state/places';
import { resetLastPlayed } from '../lastPlayed';
import { FRAME_CX, GROUND_Y, NEON_BOUNDS, NEON_PATH, TOWER_SVG } from './towerFrame';
import { DRIVE_IN_SCREEN, LOOKS, LOOKS_KEY, LOOK_BOXES, skySoftEdge, type LookId } from './looks';
import {
  CONTROLS,
  DEFAULT_TUNE,
  DRIVE_FOOT,
  TUNE_KEY,
  controlWords,
  defaultTune,
  isUsual,
  loadTune,
  lookBox,
  parseTune,
  resolveTune,
  tuneVars,
  withPatch,
  type LookTune,
  type RangeControl,
} from './lookSettings';
import { SAVED_KEY } from './saved';
import { TUNE_WRITE_MS, driveInAudience, resetWatch, useWatchStore } from './store';
import { UnwindView } from './testView';

// The settings of each look: the store (bounds, fallbacks, older shapes), the proof that nothing
// changes while every setting is at its default, each control reaching its property and its box,
// the limits at both ends of every range, and the sheet's section (words, reset, keyboard).
const V = 'Ab3dEfGh1jK';
const THREE = [
  { kind: 'video', id: V, label: 'Night drive mix' },
  { kind: 'live', id: 'Lofi_Live01', label: 'Lofi radio' },
  { kind: 'twitch', id: 'pixel_harbor', label: 'pixel_harbor' },
];
const raw = readFileSync('src/styles/unwind.css', 'utf8') as string;
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
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
const IDS = LOOKS.map((l) => l.id) as LookId[];

function setup(look: LookId, play = true, tune?: Partial<Record<LookId, Record<string, number | boolean>>>) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(THREE));
  localStorage.setItem(LOOKS_KEY, JSON.stringify({ mode: 'one', all: look }));
  if (tune) localStorage.setItem(TUNE_KEY, JSON.stringify(tune));
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

describe('the stored settings', () => {
  it('start at today\'s exact numbers', () => {
    expect(DEFAULT_TUNE.sky).toEqual({ size: 100, soft: 120, bright: 90, floor: true });
    expect(DEFAULT_TUNE.sun).toEqual({ size: 461, up: 29, glow: 50, streak: true });
    expect(DEFAULT_TUNE.feather).toEqual({ size: 100, soft: 20, glow: 50 });
    expect(DEFAULT_TUNE.drivein).toEqual({ size: 100, floor: 42, sign: true, neon: true, light: false });
    expect(DEFAULT_TUNE.holo).toEqual({ tilt: 7, see: 26, beam: true });
    expect(loadTune()).toEqual(DEFAULT_TUNE);
  });

  it('on load a number out of its range, of the wrong type or not finite is discarded: that field takes its usual value, the rest of the look is kept', () => {
    const t = parseTune(JSON.stringify({ sky: { size: 5, soft: 9999, bright: 'bright', floor: 'yes' }, sun: { size: 1e9, up: -9999, glow: NaN, streak: false }, holo: { tilt: -4, see: 200.4, beam: false } }));
    expect(t.sky).toEqual(DEFAULT_TUNE.sky);
    expect(t.sun).toEqual({ ...DEFAULT_TUNE.sun, streak: false });
    expect(t.holo).toEqual({ tilt: 7, see: 26, beam: false });
    expect(t.feather).toEqual(DEFAULT_TUNE.feather);
    expect(t.drivein).toEqual(DEFAULT_TUNE.drivein);
    // Below the minimum and above the maximum, one field at a time; the others stay.
    expect(parseTune(JSON.stringify({ sky: { size: 59, soft: 80 } })).sky).toEqual({ ...DEFAULT_TUNE.sky, soft: 80 });
    expect(parseTune(JSON.stringify({ sky: { size: 101, soft: 80 } })).sky).toEqual({ ...DEFAULT_TUNE.sky, soft: 80 });
    expect(parseTune(JSON.stringify({ sky: { size: 60, soft: 201, bright: 70 } })).sky).toEqual({ ...DEFAULT_TUNE.sky, size: 60, bright: 70 });
    expect(parseTune(JSON.stringify({ sun: { up: -101, size: 279, glow: 101 } })).sun).toEqual(DEFAULT_TUNE.sun);
    expect(parseTune(JSON.stringify({ feather: { size: 109 }, drivein: { size: 106, floor: -1 } }))).toEqual(DEFAULT_TUNE);
    // A value at an end of its range is kept.
    expect(parseTune(JSON.stringify({ sky: { size: 60, soft: 200 }, sun: { up: -100, size: 280 }, feather: { size: 108 }, drivein: { size: 80 }, holo: { tilt: 12, see: 60 } }))).toMatchObject({ sky: { size: 60, soft: 200 }, sun: { up: -100, size: 280 }, feather: { size: 108 }, drivein: { size: 80 }, holo: { tilt: 12, see: 60 } });
  });

  it('older, broken or missing stored shapes fall back to the defaults', () => {
    for (const bad of [null, '', '{', '[]', '7', 'null', '"x"', JSON.stringify({ sky: 5 }), JSON.stringify({ sky: [1] }), JSON.stringify({ unknown: { a: 1 } }), 'x'.repeat(5000)]) {
      expect(parseTune(bad)).toEqual(DEFAULT_TUNE);
    }
    // A record from before a look had settings: only the looks it names change.
    expect(parseTune(JSON.stringify({ sky: { soft: 80 } })).sky).toEqual({ size: 100, soft: 80, bright: 90, floor: true });
    // The look choice's own key is separate and untouched.
    localStorage.setItem(LOOKS_KEY, JSON.stringify({ mode: 'one', all: 'sky' }));
    expect(loadTune()).toEqual(DEFAULT_TUNE);
  });

  it('a broken local storage gives the defaults and never throws', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadTune()).toEqual(DEFAULT_TUNE);
    get.mockRestore();
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(() => useWatchStore.getState().setTune('sky', { soft: 60 })).not.toThrow();
    expect(useWatchStore.getState().tune.sky.soft).toBe(60);
    set.mockRestore();
  });

  it('setTune keeps the change, saves it per look and reloads it; resetTune puts one look back', () => {
    const st = useWatchStore.getState();
    st.setTune('sky', { soft: 60, bright: 70 });
    st.setTune('sun', { glow: 80 });
    expect(JSON.parse(localStorage.getItem(TUNE_KEY)!).sky).toMatchObject({ soft: 60, bright: 70 });
    expect(loadTune().sun.glow).toBe(80);
    useWatchStore.getState().resetTune('sky');
    expect(useWatchStore.getState().tune.sky).toEqual(DEFAULT_TUNE.sky);
    expect(useWatchStore.getState().tune.sun.glow).toBe(80);
    expect(loadTune().sky).toEqual(DEFAULT_TUNE.sky);
  });

  it('a patch is bounded by the control, the dependent limits included', () => {
    expect(withPatch(defaultTune(), 'feather', { size: 500 }).feather.size).toBe(108);
    // A live change is clamped to the control's own range; a limit that depends on another setting is applied where the value is drawn.
    expect(withPatch(defaultTune(), 'sky', { soft: 9999 }).sky.soft).toBe(200);
    expect(withPatch(defaultTune(), 'sky', { size: 60, soft: 200 }).sky.soft).toBe(200);
    expect(resolveTune(withPatch(defaultTune(), 'sky', { size: 60, soft: 200 })).sky.soft).toBe(120);
    expect(withPatch(defaultTune(), 'sun', { up: 60 }).sun.up).toBe(60);
    expect(resolveTune(withPatch(defaultTune(), 'sun', { up: 60 })).sun.up).toBe(36);
    expect(resolveTune(withPatch(defaultTune(), 'sun', { size: 280, up: 60 })).sun.up).toBe(60);
  });

  it('dragging Size down and up again keeps the stored soft edge: the wish stays, only the drawing is limited', () => {
    let t = withPatch(defaultTune(), 'sky', { soft: 200 });
    t = withPatch(t, 'sky', { size: 60 });
    expect(t.sky.soft).toBe(200);
    expect(resolveTune(t).sky.soft).toBe(120);
    t = withPatch(t, 'sky', { size: 100 });
    expect(resolveTune(t).sky.soft).toBe(200);
  });

  it('the resolved soft edge goes through the existing clamp and the sun keeps 8 px under the top', () => {
    const t = { ...defaultTune(), sky: { size: 60, soft: 200, bright: 90, floor: true } };
    expect(resolveTune(t).sky.soft).toBe(skySoftEdge(200, lookBox('sky', t)));
    expect(resolveTune(t).sky.soft).toBe(120);
    const s = { ...defaultTune(), sun: { size: 461, up: 60, glow: 50, streak: true } };
    expect(lookBox('sun', s).y).toBeGreaterThanOrEqual(8);
  });
});

describe('with every setting at its default the wall draws what it drew before', () => {
  it('the boxes are the same objects as today\'s', () => {
    for (const look of IDS) expect(lookBox(look, defaultTune())).toBe(LOOK_BOXES[look]);
    expect(lookBox('drivein', defaultTune())).toBe(DRIVE_IN_SCREEN);
  });

  it('no custom property is written (the whole sky\'s soft edge always was)', () => {
    for (const look of IDS) expect(tuneVars(look, defaultTune())).toEqual(look === 'sky' ? { '--w-sky-soft': '120px' } : {});
  });

  it('the stylesheet carries today\'s numbers as the fallbacks of every property it reads', () => {
    const flat = (s: string) => s.replace(/\s+/g, '');
    const r = (sel: string) => flat(rule(sel));
    const fbOf = (sel: string, prop: string) => flat(rule(sel)).match(new RegExp(`(?:^|;)${prop}:var\\(--[a-z-]+,([^)]+)\\)`))?.[1];
    // Each stage's box: wall box less Unwind's offset (124, 20); the sun's stage is its halo box (563 at 926, -56).
    const boxes: [string, [number, number, number, number]][] = [
      ['.w-sky', [LOOK_BOXES.sky.x - 124, LOOK_BOXES.sky.y - 20, LOOK_BOXES.sky.w, LOOK_BOXES.sky.h]],
      ['.w-feather', [LOOK_BOXES.feather.x - 124, LOOK_BOXES.feather.y - 20, LOOK_BOXES.feather.w, LOOK_BOXES.feather.h]],
      ['.w-drivein', [DRIVE_IN_SCREEN.x - 124, DRIVE_IN_SCREEN.y - 20, DRIVE_IN_SCREEN.w, DRIVE_IN_SCREEN.h]],
      ['.w-sun', [926, -56, 563, 563]],
    ];
    for (const [sel, [l, t, w, h]] of boxes) {
      expect(fbOf(sel, 'left')).toBe(`${l}px`);
      expect(fbOf(sel, 'top')).toBe(`${t}px`);
      expect(fbOf(sel, 'width')).toBe(`${w}px`);
      expect(fbOf(sel, 'height')).toBe(`${h}px`);
    }
    expect(fbOf('.w-sky .w-screen', 'filter')).toBeUndefined();
    expect(r('.w-sky .w-screen')).toContain('filter:brightness(var(--w-bright,0.9))saturate(1.1)');
    expect(fbOf('.w-glow', 'opacity')).toBe('0.5');
    expect(r('.w-feather .w-screen')).toContain('#000var(--w-fe-x,20%),#000calc(100%-var(--w-fe-x,20%)),transparent),linear-gradient(180deg,transparent,#000var(--w-fe-t,17%),#000var(--w-fe-b,74%)');
    expect(fbOf('.w-spill', 'opacity')).toBe('0.42');
    expect(fbOf('.w-spill', 'top')).toBe('451px');
    expect(fbOf('.w-tower', 'left')).toBe('-1244px');
    expect(fbOf('.w-tower', 'top')).toBe('-54px');
    expect(r('.w-tower')).toContain('transform:var(--w-tf,none)');
    expect(r('.w-halo')).toContain('rgba(255,150,96,var(--w-halo-a1,0.5))');
    expect(r('.w-halo')).toContain('rgba(255,95,168,var(--w-halo-a2,0.22))');
    expect(r('.w-sun .w-screen')).toContain('inset:var(--w-inset,51px)');
    expect(r('.w-sun .w-screen')).toContain('rgba(255,150,96,var(--w-disc-glow,0.45))');
    expect(fbOf('.w-streak', 'top')).toBe('541px');
    expect(r('.w-holo')).toContain('rotateY(var(--w-rot,-7deg))');
    expect(r('.w-holo-glass')).toContain('rgba(7,5,22,var(--w-plate-a,0.74))');
    expect(r('.w-holo-glass')).toContain('rgba(7,5,22,var(--w-plate-b,0.6))');
    expect(r('.w-sign')).toContain('display:var(--w-sign,inline)');
  });

  it('every look setting property the stylesheet reads has a fallback (the soft edge is set on every whole sky stage)', () => {
    const names = new Set<string>();
    for (const m of css.matchAll(/var\((--w-[a-z0-9-]+)\s*([,)])/g)) if (m[2] === ')') names.add(m[1]!);
    expect([...names].filter((n) => n !== '--w-sky-soft')).toEqual([]);
  });

  it('the stage on screen carries nothing of the settings at the defaults, whichever look', async () => {
    for (const look of IDS) {
      setup(look);
      const r = render(<UnwindView />);
      await flush();
      const stage = document.querySelector('.w-stage') as HTMLElement;
      const props = Array.from({ length: stage.style.length }, (_, i) => stage.style.item(i));
      expect(props).toEqual(look === 'sky' ? ['--w-sky-soft'] : []);
      expect(stage.getAttribute('data-sky-box')).toBe(`${LOOK_BOXES[look].x},${LOOK_BOXES[look].y},${LOOK_BOXES[look].w},${LOOK_BOXES[look].h}`);
      expect(document.querySelector('.w-skyspill') !== null).toBe(look === 'sky');
      expect(document.querySelector('.w-streak') !== null).toBe(look === 'sun');
      r.unmount();
    }
  });
});

/** A tune with every range of every look at one end ('min' or 'max'), after the dependent limits. */
function atEnd(look: LookId, end: 'min' | 'max'): LookTune {
  let t = defaultTune();
  for (const c of CONTROLS[look]) if (c.kind === 'range') t = withPatch(t, look, { [c.key]: end === 'min' ? c.min : c.max(t) });
  // The dependent maxima may have moved: ask again.
  for (const c of CONTROLS[look]) if (c.kind === 'range') t = withPatch(t, look, { [c.key]: end === 'min' ? c.min : c.max(t) });
  return t;
}

describe('the boxes stay clear at both ends of every range', () => {
  const LEFT_BLOCK = 1084;
  const CARDS = 2000;
  it('Whole sky: inside today\'s box, its foot where it was, the foot centre kept', () => {
    for (const end of ['min', 'max'] as const) {
      const b = lookBox('sky', atEnd('sky', end));
      const u = LOOK_BOXES.sky;
      expect(b.x).toBeGreaterThanOrEqual(u.x);
      expect(b.x + b.w).toBeLessThanOrEqual(u.x + u.w + 0.01);
      expect(b.y).toBeGreaterThanOrEqual(u.y);
      expect(b.y + b.h).toBeCloseTo(u.y + u.h, 1);
      expect(b.w / b.h).toBeCloseTo(889 / 500, 2);
    }
    expect(lookBox('sky', withPatch(defaultTune(), 'sky', { size: 60 })).w).toBeCloseTo(533.4, 1);
  });

  it('The sun: a circle clear of the left block and the cards, 8 px under the strip, centre kept', () => {
    for (const end of ['min', 'max'] as const) {
      for (const up of [-100, 60]) {
        let t = atEnd('sun', end);
        t = withPatch(t, 'sun', { up });
        const b = lookBox('sun', t);
        expect(b.w).toBe(b.h);
        expect(b.x).toBeGreaterThanOrEqual(1101);
        expect(b.x + b.w).toBeLessThanOrEqual(1562);
        expect(b.y).toBeGreaterThanOrEqual(8);
        expect(b.x + b.w / 2).toBeCloseTo(1331.5, 1);
        expect(b.y + b.h).toBe(505 - resolveTune(t).sun.up);
        // The disc's box and the stage's halo box: the halo is 563/461 of it and stays centred.
        const v = tuneVars('sun', t);
        if (v['--w-w']) expect(parseFloat(v['--w-w'])).toBeCloseTo((b.w * 563) / 461, 1);
      }
    }
  });

  it('Feathered: clear of the left block and the cards, its foot where it was, inside the strip', () => {
    for (const end of ['min', 'max'] as const) {
      const b = lookBox('feather', atEnd('feather', end));
      expect(b.x).toBeGreaterThan(LEFT_BLOCK);
      expect(b.x + b.w).toBeLessThan(CARDS);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y + b.h).toBeCloseTo(505, 1);
      expect(b.w / b.h).toBeCloseTo(810 / 455, 2);
    }
  });

  it('Drive-in: the screen stays 16:9 on its footings, and the whole tower stays clear of the left block, the cards and the strip\'s top', () => {
    for (const end of ['min', 'max'] as const) {
      const t = atEnd('drivein', end);
      const b = lookBox('drivein', t);
      const k = t.drivein.size / 100;
      expect(b.w / b.h).toBeCloseTo(16 / 9, 2);
      expect(b.x + b.w / 2).toBeCloseTo(1580, 1);
      // The tower's widest points (the side stays' footings, 385 px each side of the centre) and its coping (471 px over the ground).
      expect(1580 - 385 * k).toBeGreaterThan(LEFT_BLOCK);
      expect(1580 + 385 * k).toBeLessThan(CARDS);
      expect(505 - 471 * k).toBeGreaterThanOrEqual(8);
      // The foot: the screen's foot stands where it did, scaled about the footings.
      expect(b.y + b.h).toBeCloseTo(505 - (505 - 432) * k, 1);
    }
  });

  it('Hologram: the tilted reach stays clear of the left block and the cards at 0 and 12 degrees', () => {
    for (const end of ['min', 'max'] as const) {
      const b = lookBox('holo', atEnd('holo', end));
      expect(b.x).toBeGreaterThan(LEFT_BLOCK);
      expect(b.x + b.w).toBeLessThan(CARDS);
      expect(b.y).toBeGreaterThan(0);
    }
    expect(lookBox('holo', withPatch(defaultTune(), 'holo', { tilt: 7 }))).toBe(LOOK_BOXES.holo);
  });

  it('the audience the buddy walks to follows the drive-in\'s size, and is one object per size', () => {
    const base = { playing: { kind: 'video', id: V, label: 'x' } as never, looks: { mode: 'one', all: 'drivein', video: 'feather', live: 'sky', twitch: 'drivein' } as never };
    expect(driveInAudience({ ...base, tune: defaultTune() })).toBe(DRIVE_IN_SCREEN);
    const t = withPatch(defaultTune(), 'drivein', { size: 90 });
    const a = driveInAudience({ ...base, tune: t })!;
    expect(a).toBe(driveInAudience({ ...base, tune: withPatch(defaultTune(), 'drivein', { size: 90 }) }));
    expect(a.w).toBeCloseTo(604.8, 1);
    expect(driveInAudience(base)).toBe(DRIVE_IN_SCREEN);
  });
});

describe('each control reaches what it changes', () => {
  const stageOf = async (look: LookId, tune: Partial<Record<LookId, Record<string, number | boolean>>>) => {
    setup(look, true, tune);
    const r = render(<UnwindView />);
    await flush();
    return { r, stage: document.querySelector('.w-stage') as HTMLElement };
  };
  const prop = (el: HTMLElement, name: string) => el.style.getPropertyValue(name);

  it('Whole sky: size moves the box, soft edge, brightness, floor light', async () => {
    const { r, stage } = await stageOf('sky', { sky: { size: 80, soft: 60, bright: 70, floor: false } });
    expect(prop(stage, '--w-w')).toBe('711.2px');
    expect(prop(stage, '--w-h')).toBe('400px');
    expect(prop(stage, '--w-sky-soft')).toBe('60px');
    expect(prop(stage, '--w-bright')).toBe('0.7');
    expect(document.querySelector('.w-skyspill')).toBeNull();
    const b = lookBox('sky', parseTune(localStorage.getItem(TUNE_KEY)));
    expect(stage.getAttribute('data-sky-box')).toBe(`${b.x},${b.y},${b.w},${b.h}`);
    // The sky claim (the moon keeps clear of it) is the same box.
    expect(useSkyStore.getState().claims.watch?.boxes).toEqual([[b.x, b.y, b.w, b.h]]);
    // The edge band sits on the smaller picture's lower edge.
    const band = document.querySelector('.w-edge') as HTMLElement;
    expect(parseFloat(band.style.top)).toBeCloseTo(b.y + b.h - 20 - 72, 1);
    expect(parseFloat(band.style.width)).toBeCloseTo(b.w, 1);
    r.unmount();
  });

  it('The sun: size and height move the disc and its halo together; glow; streak', async () => {
    const { r, stage } = await stageOf('sun', { sun: { size: 380, up: 10, glow: 100, streak: false } });
    const k = 380 / 461;
    expect(parseFloat(prop(stage, '--w-w'))).toBeCloseTo(563 * k, 1);
    expect(parseFloat(prop(stage, '--w-inset'))).toBeCloseTo(51 * k, 1);
    expect(prop(stage, '--w-k')).toBe(String(Math.round(k * 1000) / 1000));
    // The disc's top is the stage's top plus the inset: wall y 505 - 10 - 380.
    expect(parseFloat(prop(stage, '--w-t')) + 20 + parseFloat(prop(stage, '--w-inset'))).toBeCloseTo(505 - 10 - 380, 1);
    expect(parseFloat(prop(stage, '--w-gy')) - 0).toBeCloseTo(505 - (parseFloat(prop(stage, '--w-t')) + 20), 1);
    expect(prop(stage, '--w-halo-a1')).toBe('1');
    expect(prop(stage, '--w-halo-a2')).toBe('0.44');
    expect(prop(stage, '--w-disc-glow')).toBe('0.9');
    expect(document.querySelector('.w-streak')).toBeNull();
    expect(stage.getAttribute('data-sky-box')).toBe(`${1331.5 - 190},${505 - 10 - 380},380,380`);
    r.unmount();
  });

  it('Feathered: size, soft edge and glow', async () => {
    const { r, stage } = await stageOf('feather', { feather: { size: 80, soft: 30, glow: 0 } });
    expect(prop(stage, '--w-w')).toBe('648px');
    expect(prop(stage, '--w-fe-x')).toBe('30%');
    expect(prop(stage, '--w-fe-t')).toBe('25.5%');
    expect(prop(stage, '--w-fe-b')).toBe('61%');
    expect(prop(stage, '--w-glow-a')).toBe('0');
    expect(prop(stage, '--w-k')).toBe('0.8');
    r.unmount();
  });

  it('Drive-in: size scales the picture and the tower together; floor light; sign', async () => {
    const { r, stage } = await stageOf('drivein', { drivein: { size: 90, floor: 10, sign: false, neon: false, light: true } });
    const b = lookBox('drivein', parseTune(localStorage.getItem(TUNE_KEY)));
    expect(prop(stage, '--w-w')).toBe(`${b.w}px`);
    expect(prop(stage, '--w-tl')).toBe(`${-b.x}px`);
    expect(prop(stage, '--w-tf')).toBe('scale(0.9)');
    expect(prop(stage, '--w-spill-a')).toBe('0.1');
    expect(prop(stage, '--w-sign')).toBe('none');
    expect(prop(stage, '--w-neon')).toBe('none');
    // One svg, scaled about the footing centre; the picture and the audience are the same box.
    expect(document.querySelectorAll('.w-tower').length).toBe(1);
    expect(stage.getAttribute('data-audience')).toBe(`${b.x},${b.y},${b.w},${b.h}`);
    expect(document.querySelectorAll('.w-tower .w-sign').length).toBe(2);
    r.unmount();
  });

  it('Hologram: tilt turns the pane and its plate; see-through; beam', async () => {
    const { r, stage } = await stageOf('holo', { holo: { tilt: 2, see: 50, beam: false } });
    const plate = document.querySelector('.w-holo-plate') as HTMLElement;
    for (const el of [stage, plate]) {
      expect(prop(el, '--w-rot')).toBe('-2deg');
      expect(prop(el, '--w-plate-a')).toBe('0.5');
      expect(prop(el, '--w-plate-b')).toBe('0.36');
    }
    expect(document.querySelector('.w-holo-beam')).toBeNull();
    // The clip still stands under the pane's lower edge at the new tilt.
    expect(document.querySelector('clipPath#whc polygon')).toBeTruthy();
    r.unmount();
  });
});

describe('the sheet\'s section for the look', () => {
  const open = async (look: LookId, play = true) => {
    setup(look, play);
    render(<UnwindView />);
    await flush();
    await act(async () => screen.getByRole('button', { name: 'How video is shown' }).click());
    return screen.getByRole('dialog', { name: 'How video is shown' });
  };

  it('names the look, shows its controls with the value in plain words, and ends with the foot line', async () => {
    const sheet = await open('sky');
    const group = within(sheet).getByRole('group', { name: 'Whole sky settings' });
    expect(within(group).getByText('Size')).toBeTruthy();
    const soft = within(group).getByRole('slider', { name: 'Soft edge' }) as HTMLInputElement;
    expect(soft.getAttribute('aria-valuetext')).toBe('120 px, your usual');
    expect(within(group).getByText('120 px, your usual')).toBeTruthy();
    expect(within(group).getByRole('switch', { name: 'Floor light' }).getAttribute('aria-checked')).toBe('true');
    expect(within(group).getByText('Each look keeps its own settings. Changes show at once.')).toBeTruthy();
  });

  it('a slider changes the stage at once, reads back "wider than usual", and Reset puts the look back', async () => {
    const sheet = await open('sky');
    const soft = within(sheet).getByRole('slider', { name: 'Soft edge' }) as HTMLInputElement;
    fireEvent.change(soft, { target: { value: '160' } });
    expect((document.querySelector('.w-stage') as HTMLElement).style.getPropertyValue('--w-sky-soft')).toBe('160px');
    expect(within(sheet).getByText('160 px, wider than usual')).toBeTruthy();
    fireEvent.change(soft, { target: { value: '40' } });
    expect(within(sheet).getByText('40 px, narrower than usual')).toBeTruthy();
    const reset = within(sheet).getByRole('button', { name: /Reset to my usual/ });
    expect(reset.getAttribute('aria-disabled')).toBe('false');
    await act(async () => reset.click());
    expect((document.querySelector('.w-stage') as HTMLElement).style.getPropertyValue('--w-sky-soft')).toBe('120px');
    expect(within(sheet).getByText('120 px, your usual')).toBeTruthy();
    expect(reset.getAttribute('aria-disabled')).toBe('true');
    expect(JSON.parse(localStorage.getItem(TUNE_KEY)!).sky.soft).toBe(120);
  });

  it('Reset touches this look only', async () => {
    useWatchStore.getState().setTune('sun', { glow: 80 });
    const sheet = await open('sky');
    useWatchStore.getState().setTune('sky', { bright: 60 });
    await flush();
    await act(async () => within(sheet).getByRole('button', { name: /Reset to my usual/ }).click());
    expect(useWatchStore.getState().tune.sky).toEqual(DEFAULT_TUNE.sky);
    expect(useWatchStore.getState().tune.sun.glow).toBe(80);
  });

  it('the soft edge slider\'s top follows the size (the most is 40 percent of the smaller side)', async () => {
    const sheet = await open('sky');
    const soft = () => within(sheet).getByRole('slider', { name: 'Soft edge' }) as HTMLInputElement;
    expect(soft().max).toBe('200');
    fireEvent.change(within(sheet).getByRole('slider', { name: 'Size' }), { target: { value: '60' } });
    expect(soft().max).toBe('120');
    expect(soft().value).toBe('120');
  });

  it('every slider is reachable and its keys act: ArrowRight, ArrowLeft, Home and End change the input, the store, the words and the stage', async () => {
    for (const look of IDS) {
      cleanup();
      const sheet = await open(look);
      for (const c of CONTROLS[look]) {
        if (c.kind !== 'range') continue;
        const el = within(sheet).getByRole('slider', { name: c.label }) as HTMLInputElement;
        expect(el.type).toBe('range');
        expect(el.disabled).toBe(false);
        expect(el.tabIndex).toBeGreaterThanOrEqual(0);
        expect(Number(el.min)).toBe(c.min);
        expect(Number(el.step)).toBe(c.step);
        const stored = () => (useWatchStore.getState().tune[look] as unknown as Record<string, number>)[c.key]!;
        const key = (k: string) => fireEvent.keyDown(el, { key: k });
        const max = c.max(useWatchStore.getState().tune);
        const words = (v: number) => controlWords(c as RangeControl, v);
        // Home, then one step up with ArrowRight, one step back with ArrowLeft, then End.
        key('Home');
        expect([el.value, stored()]).toEqual([String(c.min), c.min]);
        expect(el.getAttribute('aria-valuetext')).toBe(words(c.min));
        expect(within(sheet).getAllByText(words(c.min)).length).toBeGreaterThan(0);
        key('ArrowRight');
        expect([el.value, stored()]).toEqual([String(c.min + c.step), c.min + c.step]);
        key('ArrowRight');
        key('ArrowLeft');
        expect(stored()).toBe(c.min + c.step);
        expect(el.getAttribute('aria-valuetext')).toBe(words(c.min + c.step));
        key('ArrowLeft');
        key('ArrowLeft');
        expect(stored()).toBe(c.min);
        key('End');
        const top = c.max(useWatchStore.getState().tune);
        expect([el.value, stored()]).toEqual([String(top), top]);
        expect(top).toBeLessThanOrEqual(max);
        expect(el.getAttribute('aria-valuetext')).toBe(words(top));
        // The key was taken: it does not also move the native control.
        const ev = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
        el.dispatchEvent(ev);
        expect(ev.defaultPrevented).toBe(true);
        // Put the control back to its usual for the next one (End may have moved a limit).
        useWatchStore.getState().resetTune(look);
        await flush();
      }
      // The stage moved with the keys: the whole sky's soft edge as the one property to read.
      if (look === 'sky') {
        const el = within(sheet).getByRole('slider', { name: 'Soft edge' }) as HTMLInputElement;
        fireEvent.keyDown(el, { key: 'ArrowRight' });
        expect((document.querySelector('.w-stage') as HTMLElement).style.getPropertyValue('--w-sky-soft')).toBe('121px');
        fireEvent.keyDown(el, { key: 'End' });
        expect((document.querySelector('.w-stage') as HTMLElement).style.getPropertyValue('--w-sky-soft')).toBe('200px');
        fireEvent.keyDown(el, { key: 'Home' });
        expect((document.querySelector('.w-stage') as HTMLElement).style.getPropertyValue('--w-sky-soft')).toBe('0px');
      }
      for (const c of CONTROLS[look]) {
        if (c.kind !== 'switch') continue;
        const sw = within(sheet).getByRole('switch', { name: c.label });
        await act(async () => sw.click());
        expect(sw.getAttribute('aria-checked')).toBe('false');
      }
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
    }
  });

  it('the sheet shows a wish above the ceiling at the ceiling and says so; it returns when the ceiling does', async () => {
    useWatchStore.getState().setTune('sky', { soft: 200 });
    const sheet = await open('sky');
    fireEvent.change(within(sheet).getByRole('slider', { name: 'Size' }), { target: { value: '60' } });
    expect(within(sheet).getByText('120 px, the most this size allows')).toBeTruthy();
    expect(useWatchStore.getState().tune.sky.soft).toBe(200);
    fireEvent.change(within(sheet).getByRole('slider', { name: 'Size' }), { target: { value: '100' } });
    expect(within(sheet).getByText('200 px, wider than usual')).toBeTruthy();
    expect(useWatchStore.getState().tune.sky.soft).toBe(200);
  });

  it('a drag writes storage a handful of times at most and the last value is the stored one', async () => {
    const sheet = await open('sky');
    const soft = within(sheet).getByRole('slider', { name: 'Soft edge' });
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const before = writes.mock.calls.filter((c) => c[0] === TUNE_KEY).length;
    const stage = () => (document.querySelector('.w-stage') as HTMLElement).style.getPropertyValue('--w-sky-soft');
    for (let i = 1; i <= 100; i++) {
      fireEvent.change(soft, { target: { value: String(i) } });
      expect(stage()).toBe(`${i}px`);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2);
      });
    }
    const during = writes.mock.calls.filter((c) => c[0] === TUNE_KEY).length - before;
    expect(during).toBeLessThanOrEqual(3);
    // Release writes the last value at once.
    fireEvent.pointerUp(soft);
    expect(JSON.parse(localStorage.getItem(TUNE_KEY)!).sky.soft).toBe(100);
    // Blur, a key let go, and a hidden page write too; and the timer writes a change nobody released.
    fireEvent.change(soft, { target: { value: '90' } });
    fireEvent.blur(soft);
    expect(JSON.parse(localStorage.getItem(TUNE_KEY)!).sky.soft).toBe(90);
    fireEvent.keyDown(soft, { key: 'ArrowLeft' });
    fireEvent.keyUp(soft, { key: 'ArrowLeft' });
    expect(JSON.parse(localStorage.getItem(TUNE_KEY)!).sky.soft).toBe(89);
    fireEvent.change(soft, { target: { value: '70' } });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(JSON.parse(localStorage.getItem(TUNE_KEY)!).sky.soft).toBe(70);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    fireEvent.change(soft, { target: { value: '60' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TUNE_WRITE_MS + 5);
    });
    expect(JSON.parse(localStorage.getItem(TUNE_KEY)!).sky.soft).toBe(60);
    writes.mockRestore();
  });

  it('every control has a tooltip note and a one-line hint, and a range\'s usual lies inside its bounds', () => {
    for (const look of IDS) {
      for (const c of CONTROLS[look]) {
        expect(c.note.length).toBeGreaterThan(10);
        if (c.kind === 'range') {
          const t = defaultTune();
          expect(c.usual).toBeGreaterThanOrEqual(c.min);
          expect(c.usual).toBeLessThanOrEqual(c.max(t));
          expect(controlWords(c as RangeControl, c.usual)).toMatch(/, your usual$/);
          expect(controlWords(c as RangeControl, c.min === c.usual ? c.usual : c.min)).toMatch(c.min === c.usual ? /your usual/ : /than usual$/);
        }
        expect(isUsual(look, defaultTune())).toBe(true);
      }
    }
  });

  it('with a look per kind, a chooser says which look is adjusted and each look keeps its own settings', async () => {
    const sheet = await open('sky');
    await act(async () => screen.getByRole('radio', { name: 'A look for each kind' }).click());
    const pick = within(sheet).getByRole('radiogroup', { name: 'Look to adjust' });
    expect(within(sheet).getByText('A look keeps its own settings, whatever kind of video plays in it. Changes show at once.')).toBeTruthy();
    await act(async () => within(pick).getByRole('radio', { name: 'The sun' }).click());
    expect(within(sheet).getByRole('group', { name: 'The sun settings' })).toBeTruthy();
    fireEvent.change(within(sheet).getByRole('slider', { name: 'Glow' }), { target: { value: '80' } });
    await act(async () => within(pick).getByRole('radio', { name: 'Whole sky' }).click());
    expect(within(sheet).getByRole('group', { name: 'Whole sky settings' })).toBeTruthy();
    await act(async () => within(pick).getByRole('radio', { name: 'The sun' }).click());
    expect((within(sheet).getByRole('slider', { name: 'Glow' }) as HTMLInputElement).value).toBe('80');
  });
});

describe('the drive-in\'s sign, neon line and travelling light', () => {
  const play = async (tune: Record<string, number | boolean>, state: 'playing' | 'paused' | 'refused' = 'playing') => {
    setup('drivein', true, { drivein: tune });
    const r = render(<UnwindView />);
    await flush();
    const st = useWatchStore.getState();
    if (state === 'refused') st.setNeedsClick(true);
    else {
      st.setReport({ started: true, time: 5, duration: 100, count: 0, index: 0 });
      if (state === 'paused') st.setPaused(true);
    }
    await flush();
    return r;
  };
  const light = () => document.querySelector('.w-light');

  it('the three are switches of the Drive-in look: the sign and the neon line on, the travelling light off unless asked for and needing the neon line', () => {
    const c = CONTROLS.drivein.filter((x) => x.kind === 'switch');
    expect(c.map((x) => [x.key, x.label, x.usual])).toEqual([
      ['sign', 'Sign under the video', true],
      ['neon', 'Neon line', true],
      ['light', 'Travelling light', false],
    ]);
    expect((c[2] as { needs?: { key: string } }).needs?.key).toBe('neon');
    expect(c[2]!.note).toMatch(/only while a drive-in video plays/);
  });

  it('with nothing stored there is no light even while a video plays', async () => {
    const r = await play({ light: false });
    expect(light()).toBeNull();
    r.unmount();
    setup('drivein');
    const r2 = render(<UnwindView />);
    await flush();
    useWatchStore.getState().setReport({ started: true, time: 5, duration: 100, count: 0, index: 0 });
    await flush();
    expect(light()).toBeNull();
    r2.unmount();
  });

  it('switched on, the light is drawn only while the video plays: not paused, not waiting for a click', async () => {
    let r = await play({ light: true });
    expect(light()).not.toBeNull();
    expect(document.querySelectorAll('.w-light path').length).toBe(3);
    r.unmount();
    r = await play({ light: true }, 'paused');
    expect(light()).toBeNull();
    r.unmount();
    r = await play({ light: true }, 'refused');
    expect(light()).toBeNull();
    r.unmount();
  });

  it('the light follows the neon outline of the frame\'s own geometry, from the frame\'s exports, and stays outside the picture\'s box', async () => {
    const r = await play({ light: true });
    const lightSvg = document.querySelector('.w-light') as unknown as SVGElement;
    expect(document.querySelector('.w-light path')!.getAttribute('d')).toBe(NEON_PATH);
    // The static neon, its glow and the light are one path, and the static strokes sit in the one group the Neon switch hides.
    const strokes = [...document.querySelectorAll('.w-tower .w-neon path')];
    expect(strokes.length).toBe(2);
    for (const e of strokes) expect(e.getAttribute('d')).toBe(NEON_PATH);
    expect(TOWER_SVG.match(/class="w-neon"/g)!.length).toBe(1);
    expect(document.querySelectorAll('.w-tower .w-sign').length).toBe(2);
    // Its own svg is the frame's NEON_BOUNDS (the box grown by 20 px), placed and scaled from the same numbers as the tower.
    const B = NEON_BOUNDS;
    expect(lightSvg.getAttribute('viewBox')).toBe(`${B.x} ${B.y} ${B.w} ${B.h}`);
    expect(B).toEqual({ x: DRIVE_IN_SCREEN.x - 20, y: DRIVE_IN_SCREEN.y - 20, w: DRIVE_IN_SCREEN.w + 40, h: DRIVE_IN_SCREEN.h + 40 });
    const st = lightSvg.style;
    expect(st.left).toBe(`calc(var(--w-tl, ${-DRIVE_IN_SCREEN.x}px) + ${B.x}px)`);
    expect(st.top).toBe(`calc(var(--w-tt, ${-DRIVE_IN_SCREEN.y}px) + ${B.y}px)`);
    expect(st.transformOrigin).toBe(`${FRAME_CX - B.x}px ${GROUND_Y - B.y}px`);
    // The tower's own css numbers are the same constants: its place (wall 0, 0 less the box) and its origin, the footing centre.
    expect(rule('.w-tower')).toMatch(new RegExp(`left: var\\(--w-tl, ${-DRIVE_IN_SCREEN.x}px\\)`));
    expect(rule('.w-tower')).toMatch(new RegExp(`top: var\\(--w-tt, ${-DRIVE_IN_SCREEN.y}px\\)`));
    expect(rule('.w-tower')).toMatch(new RegExp(`transform-origin: ${FRAME_CX}px ${GROUND_Y}px`));
    expect(DRIVE_FOOT).toEqual({ x: FRAME_CX, y: GROUND_Y });
    // At both ends of the Size slider the light's svg and the tower's svg carry the same scale and the same offsets.
    for (const size of [80, 105]) {
      r.unmount();
      const r2 = await play({ light: true, size });
      const stage = document.querySelector('.w-stage') as HTMLElement;
      const b = lookBox('drivein', parseTune(localStorage.getItem(TUNE_KEY)));
      expect(stage.style.getPropertyValue('--w-tf')).toBe(`scale(${size / 100})`);
      expect(stage.style.getPropertyValue('--w-tl')).toBe(`${-b.x}px`);
      expect(stage.style.getPropertyValue('--w-tt')).toBe(`${-b.y}px`);
      expect(rule('.w-light')).toMatch(/transform: var\(--w-tf, none\)/);
      expect(rule('.w-tower')).toMatch(/transform: var\(--w-tf, none\)/);
      r2.unmount();
    }
    expect(rule('.w-light')).toMatch(/will-change: transform/);
    expect(rule('.w-light')).toMatch(/pointer-events: none/);
    // One lap in 12 seconds, a dash offset on the existing path, nothing that lays out; none under reduced motion.
    expect(rule('.w-light path')).toMatch(/animation: w-snake 12s linear infinite/);
    expect(css).toMatch(/@keyframes w-snake\s*\{\s*from\s*\{\s*stroke-dashoffset/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.w-light\s*\{\s*display: none/);
  });

  it('no light with the neon line off; the neon off hides the group of the two neon strokes by one property', async () => {
    const r = await play({ neon: false, light: true });
    expect(light()).toBeNull();
    expect((document.querySelector('.w-stage') as HTMLElement).style.getPropertyValue('--w-neon')).toBe('none');
    expect(rule('.w-tower .w-neon')).toMatch(/display: var\(--w-neon, inline\)/);
    r.unmount();
  });

  it('the sign off hides the board and its words only: one handle, nothing else moves', async () => {
    const r = await play({ sign: false });
    expect((document.querySelector('.w-stage') as HTMLElement).style.getPropertyValue('--w-sign')).toBe('none');
    expect(document.querySelectorAll('.w-tower .w-sign').length).toBe(2);
    expect(Object.keys(tuneVars('drivein', { ...defaultTune(), drivein: { ...DEFAULT_TUNE.drivein, sign: false } }))).toEqual(['--w-sign']);
    r.unmount();
  });

  it('the sheet disables the light with a one line reason while the neon line is off, and says what it does when on', async () => {
    setup('drivein');
    render(<UnwindView />);
    await flush();
    await act(async () => screen.getByRole('button', { name: 'How video is shown' }).click());
    const sheet = screen.getByRole('dialog', { name: 'How video is shown' });
    const sw = within(sheet).getByRole('switch', { name: 'Travelling light' });
    expect(sw.getAttribute('aria-disabled')).toBe('false');
    expect(within(sheet).getByText('Off, your usual')).toBeTruthy();
    await act(async () => sw.click());
    expect(useWatchStore.getState().tune.drivein.light).toBe(true);
    expect(within(sheet).getByText('On, only while it plays')).toBeTruthy();
    await act(async () => within(sheet).getByRole('switch', { name: 'Neon line' }).click());
    expect(sw.getAttribute('aria-disabled')).toBe('true');
    expect(within(sheet).getByText('Needs the neon line on')).toBeTruthy();
    await act(async () => sw.click());
    expect(useWatchStore.getState().tune.drivein.light).toBe(true);
    // Reset puts the light back to off.
    await act(async () => within(sheet).getByRole('button', { name: /Reset to my usual/ }).click());
    expect(useWatchStore.getState().tune.drivein).toEqual(DEFAULT_TUNE.drivein);
  });
});

/**
 * Main's own numbers, written out as literals (never imported from the code under test): every look's
 * rules in the stylesheet fall back to them, and a stage with nothing stored has exactly main's elements.
 */
describe('with nothing stored every look is main\'s, by main\'s own numbers', () => {
  const flat = (t: string) => t.replace(/\s+/g, '');
  const props = (sel: string, ...names: string[]) => names.map((n) => flat(rule(sel)).match(new RegExp(`(?:^|;)${n}:([^;]+)`))?.[1]);
  it('the stage boxes (stage pixels, wall less 124 and 20)', () => {
    expect(props('.w-sky', 'left', 'top', 'width', 'height')).toEqual(['var(--w-l,982px)', 'var(--w-t,-4px)', 'var(--w-w,889px)', 'var(--w-h,500px)']);
    expect(props('.w-feather', 'left', 'top', 'width', 'height')).toEqual(['var(--w-l,1026px)', 'var(--w-t,30px)', 'var(--w-w,810px)', 'var(--w-h,455px)']);
    expect(props('.w-drivein', 'left', 'top', 'width', 'height')).toEqual(['var(--w-l,1120px)', 'var(--w-t,34px)', 'var(--w-w,672px)', 'var(--w-h,378px)']);
    expect(props('.w-sun', 'left', 'top', 'width', 'height')).toEqual(['var(--w-l,926px)', 'var(--w-t,-56px)', 'var(--w-w,563px)', 'var(--w-h,563px)']);
  });
  it('the sky: brightness 0.9, saturation 1.1, floor wash 0.3, soft edge 120 px', () => {
    expect(flat(rule('.w-sky .w-screen'))).toContain('filter:brightness(var(--w-bright,0.9))saturate(1.1)');
    expect(props('.w-skyspill', 'opacity', 'left', 'top', 'width', 'height')).toEqual(['0.3', '388px', '485px', '1843px', '195px']);
    expect(DEFAULT_TUNE.sky.soft).toBe(120);
    expect(tuneVars('sky', defaultTune())).toEqual({ '--w-sky-soft': '120px' });
  });
  it('the sun: halo 0.5 and 0.22, rim 0.45 at 77 px, disc inset 51, streak 153, 541, 256 by 170 blurred 36, opacity 0.55', () => {
    expect(flat(rule('.w-halo'))).toContain('rgba(255,150,96,var(--w-halo-a1,0.5)),rgba(255,95,168,var(--w-halo-a2,0.22))62%');
    expect(flat(rule('.w-sun .w-screen'))).toContain('inset:var(--w-inset,51px)');
    expect(flat(rule('.w-sun .w-screen'))).toContain('box-shadow:00calc(77px*var(--w-k,1))rgba(255,150,96,var(--w-disc-glow,0.45))');
    expect(props('.w-streak', 'left', 'top', 'width', 'height', 'filter', 'opacity')).toEqual(['calc(153px*var(--w-k,1))', 'var(--w-gy,541px)', 'calc(256px*var(--w-k,1))', 'calc(170px*var(--w-k,1))', 'blur(calc(36px*var(--w-k,1)))', '0.55']);
  });
  it('feathered: masks 20, 17 and 74 percent, glow 0.5 offset 116 and 66 blurred 40', () => {
    expect(flat(rule('.w-feather .w-screen'))).toContain('#000var(--w-fe-x,20%),#000calc(100%-var(--w-fe-x,20%)),transparent),linear-gradient(180deg,transparent,#000var(--w-fe-t,17%),#000var(--w-fe-b,74%),transparent)');
    expect(props('.w-glow', 'left', 'right', 'top', 'bottom', 'opacity', 'filter')).toEqual(['calc(-116px*var(--w-k,1))', 'calc(-116px*var(--w-k,1))', 'calc(-66px*var(--w-k,1))', 'calc(-66px*var(--w-k,1))', 'var(--w-glow-a,0.5)', 'blur(40px)']);
  });
  it('the drive-in: floor light 0.42 at 845 by 218, tower at -1244, -54 about 1580, 505', () => {
    expect(props('.w-spill', 'left', 'width', 'top', 'height', 'opacity')).toEqual(['calc(-86.5px*var(--w-k,1))', 'calc(845px*var(--w-k,1))', 'var(--w-gy,451px)', 'calc(218px*var(--w-k,1))', 'var(--w-spill-a,0.42)']);
    expect(props('.w-tower', 'left', 'top', 'transform', 'transform-origin')).toEqual(['var(--w-tl,-1244px)', 'var(--w-tt,-54px)', 'var(--w-tf,none)', '1580px505px']);
    expect(flat(rule('.w-sign'))).toBe('display:var(--w-sign,inline);');
    expect(flat(rule('.w-tower .w-neon'))).toBe('display:var(--w-neon,inline);');
  });
  it('the hologram: pane turned 7 degrees, plate 0.74 over 0.6', () => {
    expect(flat(rule('.w-holo'))).toContain('transform:perspective(2400px)rotateY(var(--w-rot,-7deg))rotateX(1.2deg)');
    expect(flat(rule('.w-holo-glass'))).toContain('rgba(7,5,22,var(--w-plate-a,0.74)),rgba(7,5,22,var(--w-plate-b,0.6))');
    expect(tuneVars('holo', defaultTune())).toEqual({});
  });

  /** Main's elements per look, as the playing stage draws them (a video that has started), in document order; the frame's svg shapes and the player are left out. */
  const MAIN: Record<LookId, string[]> = {
    feather: ['w-stage w-feather', 'w-glow', 'w-screen', 'w-edge'],
    sky: ['w-stage w-sky w-layered', 'w-screen', 'w-front', 'w-skyspill', 'w-edge'],
    sun: ['w-stage w-sun w-layered', 'w-halo', 'w-screen', 'w-front', 'w-streak', 'w-edge'],
    drivein: ['w-stage w-drivein', 'w-spill', 'w-screen', 'w-edge'],
    holo: ['w-holo-plate', 'w-holo-glass', 'w-holo-hr t', 'w-holo-hr b', 'w-holo-tk tl', 'w-holo-tk tr', 'w-holo-tk bl', 'w-holo-tk br', 'w-stage w-holo', 'w-screen', 'w-edge'],
  };
  it('a playing stage with nothing stored draws exactly main\'s elements: no light, the sign shown, the neon lit', async () => {
    for (const look of IDS) {
      setup(look);
      const r = render(<UnwindView />);
      await flush();
      useWatchStore.getState().setReport({ started: true, time: 5, duration: 100, count: 0, index: 0 });
      await flush();
      const layer = document.querySelector('.w-layer')!;
      const names = [...layer.querySelectorAll('*')].filter((e) => !e.closest('.w-tower, .w-holo-emit, iframe')).map((e) => e.getAttribute('class') ?? e.tagName);
      expect(names).toEqual(MAIN[look]);
      expect(layer.querySelector('.w-light')).toBeNull();
      const stage = layer.querySelector('.w-stage') as HTMLElement;
      for (const name of ['--w-sign', '--w-neon', '--w-tf', '--w-l']) expect(stage.style.getPropertyValue(name)).toBe('');
      if (look === 'drivein') {
        const tower = layer.querySelector('.w-tower')!;
        // Main's tower: the frame's group and the marquee's three lines of words (which the sign handle wraps), the neon's two strokes inside the frame.
        expect([...tower.children].map((e) => e.tagName)).toEqual(['g', 'g']);
        expect(tower.querySelectorAll('text').length).toBe(3);
        expect(tower.querySelectorAll('.w-neon path').length).toBe(2);
        expect(tower.querySelectorAll('.w-sign').length).toBe(2);
        expect(tower.querySelector('animate, animateTransform, style')).toBeNull();
      }
      r.unmount();
    }
  });
});
