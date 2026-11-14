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
import { NEON_PATH } from './towerFrame';
import { DRIVE_IN_SCREEN, LOOKS, LOOKS_KEY, LOOK_BOXES, skySoftEdge, type LookId } from './looks';
import {
  CONTROLS,
  DEFAULT_TUNE,
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
import { driveInAudience, resetWatch, useWatchStore } from './store';
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
    expect(DEFAULT_TUNE.drivein).toEqual({ size: 100, floor: 42, sign: true, neon: true, light: true });
    expect(DEFAULT_TUNE.holo).toEqual({ tilt: 7, plate: 74, beam: true });
    expect(loadTune()).toEqual(DEFAULT_TUNE);
  });

  it('each field is bounded on read; nothing usable falls back to the default', () => {
    const t = parseTune(JSON.stringify({ sky: { size: 5, soft: 9999, bright: 'bright', floor: 'yes' }, sun: { size: 1e9, up: -9999, glow: NaN, streak: false }, holo: { tilt: -4, plate: 200.4, beam: false } }));
    expect(t.sky).toEqual({ size: 60, soft: 200, bright: 90, floor: true });
    expect(t.sun).toEqual({ size: 461, up: -100, glow: 50, streak: false });
    expect(t.holo).toEqual({ tilt: 0, plate: 90, beam: false });
    expect(t.feather).toEqual(DEFAULT_TUNE.feather);
    expect(t.drivein).toEqual(DEFAULT_TUNE.drivein);
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
    expect(withPatch(defaultTune(), 'sky', { size: 60, soft: 200 }).sky.soft).toBe(120);
    expect(withPatch(defaultTune(), 'sun', { up: 60 }).sun.up).toBe(36);
    expect(withPatch(defaultTune(), 'sun', { size: 280, up: 60 }).sun.up).toBe(60);
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

  it('Hologram: tilt turns the pane and its plate; plate darkness; beam', async () => {
    const { r, stage } = await stageOf('holo', { holo: { tilt: 2, plate: 50, beam: false } });
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

  it('every slider is a native range input a keyboard moves with the arrow keys, none disabled, none swallowing a key', async () => {
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
        const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
        el.focus();
        el.dispatchEvent(ev);
        expect(ev.defaultPrevented).toBe(false);
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

  it('the three are switches of the Drive-in look, on by default, the light needing the neon line', () => {
    const c = CONTROLS.drivein.filter((x) => x.kind === 'switch');
    expect(c.map((x) => [x.key, x.label, x.usual])).toEqual([
      ['sign', 'Sign under the video', true],
      ['neon', 'Neon line', true],
      ['light', 'Travelling light', true],
    ]);
    expect((c[2] as { needs?: { key: string } }).needs?.key).toBe('neon');
  });

  it('the light is drawn only while the video plays: not paused, not waiting for a click', async () => {
    let r = await play({});
    expect(light()).not.toBeNull();
    expect(document.querySelectorAll('.w-light path').length).toBe(3);
    r.unmount();
    r = await play({}, 'paused');
    expect(light()).toBeNull();
    r.unmount();
    r = await play({}, 'refused');
    expect(light()).toBeNull();
    r.unmount();
  });

  it('the light follows the neon line\'s own path, stays outside the picture\'s box and is its own layer', async () => {
    const r = await play({});
    const d = document.querySelector('.w-light path')!.getAttribute('d');
    expect(d).toBe(NEON_PATH);
    expect(document.querySelector('.w-tower')!.innerHTML).toContain(`d="${NEON_PATH}"`);
    // The svg is cropped to the box plus 20 px, so the line (9.5 px out) lies inside it and never on the picture.
    expect(document.querySelector('.w-light')!.getAttribute('viewBox')).toBe(`${DRIVE_IN_SCREEN.x - 20} ${DRIVE_IN_SCREEN.y - 20} ${DRIVE_IN_SCREEN.w + 40} ${DRIVE_IN_SCREEN.h + 40}`);
    expect(rule('.w-light')).toMatch(/will-change: transform/);
    expect(rule('.w-light')).toMatch(/pointer-events: none/);
    // One lap in 12 seconds, a dash offset on the existing path, nothing that lays out; none under reduced motion.
    expect(rule('.w-light path')).toMatch(/animation: w-snake 12s linear infinite/);
    expect(css).toMatch(/@keyframes w-snake\s*\{\s*from\s*\{\s*stroke-dashoffset/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.w-light\s*\{\s*display: none/);
    r.unmount();
  });

  it('no light with the switch off or the neon line off; the neon off hides the two neon strokes by one property', async () => {
    let r = await play({ light: false });
    expect(light()).toBeNull();
    r.unmount();
    r = await play({ neon: false });
    expect(light()).toBeNull();
    expect((document.querySelector('.w-stage') as HTMLElement).style.getPropertyValue('--w-neon')).toBe('none');
    expect(document.querySelectorAll('.w-tower path[stroke="url(#wtneon)"]').length).toBe(2);
    expect(rule(".w-tower path[stroke='url(#wtneon)']")).toMatch(/display: var\(--w-neon, inline\)/);
    r.unmount();
  });

  it('the sign off hides the board and its words only: one handle, nothing else moves', async () => {
    const r = await play({ sign: false });
    expect((document.querySelector('.w-stage') as HTMLElement).style.getPropertyValue('--w-sign')).toBe('none');
    const signs = document.querySelectorAll('.w-tower .w-sign');
    expect(signs.length).toBe(2);
    expect(Object.keys(tuneVars('drivein', { ...defaultTune(), drivein: { ...DEFAULT_TUNE.drivein, sign: false } }))).toEqual(['--w-sign']);
    r.unmount();
  });

  it('the sheet disables the light with a one line reason while the neon line is off', async () => {
    setup('drivein');
    render(<UnwindView />);
    await flush();
    await act(async () => screen.getByRole('button', { name: 'How video is shown' }).click());
    const sheet = screen.getByRole('dialog', { name: 'How video is shown' });
    const sw = within(sheet).getByRole('switch', { name: 'Travelling light' });
    expect(sw.getAttribute('aria-disabled')).toBe('false');
    await act(async () => within(sheet).getByRole('switch', { name: 'Neon line' }).click());
    expect(sw.getAttribute('aria-disabled')).toBe('true');
    expect(within(sheet).getByText('Needs the neon line on')).toBeTruthy();
    await act(async () => sw.click());
    expect(useWatchStore.getState().tune.drivein.light).toBe(true);
  });
});
