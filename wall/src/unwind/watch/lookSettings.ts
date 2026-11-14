import { DRIVE_IN_GROUND, DRIVE_IN_SCREEN, HOLO_PANE, LOOK_BOXES, skySoftEdge, type LookId, type WallRect } from './looks';

/**
 * The settings of each video look (the sheet's Looks side): a few sliders and switches per look,
 * kept per LOOK (never per kind of video) in local storage. Every default is today's exact number,
 * so with nothing moved the wall draws what it always drew: `tuneVars` writes a custom property only
 * for a value that differs from its default, and every rule in `unwind.css` that reads one carries
 * today's number as its fallback.
 *
 * Where a setting moves or sizes a picture, `lookBox` is the one source of the picture's box: the
 * stage's own place, the sky claim (the moon keeps clear of it), the edge band, the drive-in
 * audience for the buddy and fit-check all read it. Each range is limited so the look can never
 * reach the clock column (wall x 594), the left block (x 1084), the cards (x 2000) or the top of
 * the strip; the limits and their reasons are on each control below and in the README.
 */

export const TUNE_KEY = 'wall2-watch-look-tune';

export interface SkyTune {
  /** Percent of the usual box, about the foot centre. */
  size: number;
  /** Soft edge in px (top, left and right). */
  soft: number;
  /** Brightness percent of the picture. */
  bright: number;
  /** The floor wash under the picture. */
  floor: boolean;
}
export interface SunTune {
  /** The disc's diameter in px. */
  size: number;
  /** How far the disc's foot stands over the horizon line, px (negative: sunk). */
  up: number;
  /** Glow percent (halo and rim). */
  glow: number;
  /** The warm streak on the floor. */
  streak: boolean;
}
export interface FeatherTune {
  size: number;
  /** Side fade as percent of the width (the top and foot fades keep their usual proportion to it). */
  soft: number;
  glow: number;
}
export interface DriveTune {
  size: number;
  /** The screen's light on the floor, percent opacity (42 today). */
  floor: number;
  /** The marquee board under the screen and its words. */
  sign: boolean;
  /** The neon line round the frame and its glow. */
  neon: boolean;
  /** A soft light that travels round the neon line while the video plays (needs the neon line). */
  light: boolean;
}
export interface HoloTune {
  /** The pane's turn in degrees. */
  tilt: number;
  /** The dark plate's alpha in percent. */
  plate: number;
  /** The emitter's fan and rays. */
  beam: boolean;
}
export interface LookTune {
  sky: SkyTune;
  sun: SunTune;
  feather: FeatherTune;
  drivein: DriveTune;
  holo: HoloTune;
}

export const DEFAULT_TUNE: Readonly<LookTune> = Object.freeze({
  sky: Object.freeze({ size: 100, soft: 120, bright: 90, floor: true }),
  sun: Object.freeze({ size: 461, up: 29, glow: 50, streak: true }),
  feather: Object.freeze({ size: 100, soft: 20, glow: 50 }),
  drivein: Object.freeze({ size: 100, floor: 42, sign: true, neon: true, light: true }),
  holo: Object.freeze({ tilt: 7, plate: 74, beam: true }),
});

/** A fresh, mutable copy of every look's defaults. */
export function defaultTune(): LookTune {
  return { sky: { ...DEFAULT_TUNE.sky }, sun: { ...DEFAULT_TUNE.sun }, feather: { ...DEFAULT_TUNE.feather }, drivein: { ...DEFAULT_TUNE.drivein }, holo: { ...DEFAULT_TUNE.holo } };
}

/** The wall's fixed numbers the boxes are measured from (wall pixels). */
export const SKY_FOOT = Object.freeze({ x: 1550.5, y: 516 });
export const SUN_CENTRE_X = 1331.5;
export const FEATHER_FOOT = Object.freeze({ x: 1555, y: 505 });
export const DRIVE_FOOT = Object.freeze({ x: 1580, y: DRIVE_IN_GROUND });
/** Unwind's offset: stage CSS pixels are wall pixels less this. */
const OFF = Object.freeze({ x: 124, y: 20 });
/** The sun's halo box is this much bigger than its disc (563 over 461), and the disc sits 51 px in at the usual size. */
const SUN_USUAL = 461;
const HALO = 563;
const INSET = 51;
/** The strip's top keeps this much clear above the sun's disc. */
export const SUN_TOP_CLEAR = 8;

const r2 = (n: number) => Math.round(n * 100) / 100;
const px = (n: number) => `${r2(n)}px`;

/** One control: its bounds, its default and the words that read it back. */
interface Base {
  key: string;
  label: string;
  /** The hover tip (also the hint where it is set). */
  note: string;
}
export interface RangeControl extends Base {
  kind: 'range';
  min: number;
  /** The largest value this look's other settings allow. */
  max: (t: LookTune) => number;
  /** The largest value ever (the stored value is bounded by it on read). */
  hardMax: number;
  step: number;
  usual: number;
  /** The value in plain words, without "your usual" or the comparison. */
  show: (v: number) => string;
  more: string;
  less: string;
}
export interface SwitchControl extends Base {
  kind: 'switch';
  usual: boolean;
  /** Another switch of the look this one needs: while that one is off this one is disabled and says why. */
  needs?: { key: string; reason: string };
}
export type Control = RangeControl | SwitchControl;

const SKY_SIZE_MIN = 60;
/** Whole sky: the soft edge may not pass 40 percent of the picture's smaller side (the two ramps would cross), 200 px at the usual size. */
function skyBox(size: number): WallRect {
  const s = size / 100;
  return { x: r2(SKY_FOOT.x - (LOOK_BOXES.sky.w / 2) * s), y: r2(SKY_FOOT.y - LOOK_BOXES.sky.h * s), w: r2(LOOK_BOXES.sky.w * s), h: r2(LOOK_BOXES.sky.h * s) };
}
function skySoftMax(t: LookTune): number {
  const b = skyBox(t.sky.size);
  return Math.floor(Math.min(b.w, b.h) * 0.4 / 5) * 5;
}
/** The sun's disc may not rise past 8 px under the strip's top, and may not stand more than 60 px over the horizon. */
function sunUpMax(size: number): number {
  return Math.min(60, DRIVE_IN_GROUND - SUN_TOP_CLEAR - size);
}

const pct = (v: number) => `${v}%`;

export const CONTROLS: Readonly<Record<LookId, readonly Control[]>> = Object.freeze({
  sky: [
    { kind: 'range', key: 'size', label: 'Size', note: 'How big the picture stands behind the mountains. 100 is as tall as the sky allows; smaller shrinks it toward the horizon', min: SKY_SIZE_MIN, max: () => 100, hardMax: 100, step: 1, usual: 100, show: (v) => `${v}%`, more: 'larger', less: 'smaller' },
    { kind: 'range', key: 'soft', label: 'Soft edge', note: 'How far the top, left and right edges fade into the sky. 0 is a plain edge; the most is 40 percent of the smaller side', min: 0, max: skySoftMax, hardMax: 200, step: 5, usual: 120, show: (v) => `${v} px`, more: 'wider', less: 'narrower' },
    { kind: 'range', key: 'bright', label: 'Brightness', note: 'How bright the picture is over the sky', min: 50, max: () => 100, hardMax: 100, step: 1, usual: 90, show: (v) => `${v}%`, more: 'brighter', less: 'dimmer' },
    { kind: 'switch', key: 'floor', label: 'Floor light', note: 'The faint wash of the picture’s colours on the floor', usual: true },
  ],
  sun: [
    { kind: 'range', key: 'size', label: 'Size', note: 'How wide the sun is. The most is what fits the sky at the usual height', min: 280, max: () => SUN_USUAL, hardMax: SUN_USUAL, step: 1, usual: SUN_USUAL, show: (v) => `${v} px`, more: 'larger', less: 'smaller' },
    {
      kind: 'range',
      key: 'up',
      label: 'Height',
      note: 'How high the sun stands over the horizon. Below zero it sinks behind the land; the top always stays under the strip',
      min: -100,
      max: (t) => sunUpMax(t.sun.size),
      hardMax: 60,
      step: 1,
      usual: 29,
      show: (v) => (v > 0 ? `${v} px up` : v < 0 ? `${-v} px sunk` : 'on the horizon'),
      more: 'higher',
      less: 'lower',
    },
    { kind: 'range', key: 'glow', label: 'Glow', note: 'How strong the halo and the warm rim are', min: 0, max: () => 100, hardMax: 100, step: 5, usual: 50, show: (v) => `${v}`, more: 'stronger', less: 'fainter' },
    { kind: 'switch', key: 'streak', label: 'Floor streak', note: 'The warm streak of the sun on the floor', usual: true },
  ],
  feather: [
    { kind: 'range', key: 'size', label: 'Size', note: 'How big the melting picture is. The most keeps it clear of the cards', min: 60, max: () => 108, hardMax: 108, step: 1, usual: 100, show: pct, more: 'larger', less: 'smaller' },
    { kind: 'range', key: 'soft', label: 'Soft edge', note: 'How far the sides melt into the sky, as a share of the width. The top and the foot melt in proportion', min: 10, max: () => 30, hardMax: 30, step: 1, usual: 20, show: pct, more: 'wider', less: 'narrower' },
    { kind: 'range', key: 'glow', label: 'Glow', note: 'How strong the coloured glow round the picture is', min: 0, max: () => 100, hardMax: 100, step: 5, usual: 50, show: (v) => `${v}`, more: 'stronger', less: 'fainter' },
  ],
  drivein: [
    { kind: 'range', key: 'size', label: 'Size', note: 'The screen and its tower together. The most keeps the tower inside the strip and clear of the cards', min: 80, max: () => 105, hardMax: 105, step: 1, usual: 100, show: pct, more: 'larger', less: 'smaller' },
    { kind: 'range', key: 'floor', label: 'Floor light', note: 'How strongly the screen’s light falls on the floor. 0 is none', min: 0, max: () => 100, hardMax: 100, step: 1, usual: 42, show: (v) => `${v}`, more: 'brighter', less: 'fainter' },
    { kind: 'switch', key: 'sign', label: 'Sign under the video', note: 'The marquee board under the screen and its words (Watt\u2019s Drive-in, now showing, intermission)', usual: true },
    { kind: 'switch', key: 'neon', label: 'Neon line', note: 'The neon line round the frame and its glow. Off leaves the steel surround as it is', usual: true },
    { kind: 'switch', key: 'light', label: 'Travelling light', note: 'A soft light that travels slowly round the neon line while the video plays. It stops when paused and under reduced motion', usual: true, needs: { key: 'neon', reason: 'Needs the neon line on' } },
  ],
  holo: [
    { kind: 'range', key: 'tilt', label: 'Tilt', note: 'How far the pane turns. 0 faces you', min: 0, max: () => 12, hardMax: 12, step: 1, usual: 7, show: (v) => `${v}\u00b0`, more: 'steeper', less: 'flatter' },
    { kind: 'range', key: 'plate', label: 'Plate darkness', note: 'How dark the glass plate behind the picture is. Lower lets more of the sky through', min: 40, max: () => 90, hardMax: 90, step: 1, usual: 74, show: (v) => `${v}`, more: 'darker', less: 'lighter' },
    { kind: 'switch', key: 'beam', label: 'Beam', note: 'The fan of light from the emitter to the pane', usual: true },
  ],
});

/** The one-line hint shown under the sliders for the control in use (16 px, one line in the sheet). */
export const HINTS: Readonly<Record<string, string>> = Object.freeze({
  'sky.size': 'How big the picture stands; 100 is as tall as the sky allows',
  'sky.soft': 'How far the top and sides fade into the sky; 0 is plain',
  'sky.bright': 'How bright the picture is over the sky',
  'sky.floor': 'The faint wash of the picture\u2019s colours on the floor',
  'sun.size': 'How wide the sun is; the most fits the sky',
  'sun.up': 'How high it stands; below zero it sinks behind the land',
  'sun.glow': 'How strong the halo and the warm rim are',
  'sun.streak': 'The warm streak of the sun on the floor',
  'feather.size': 'How big the picture is; the most clears the cards',
  'feather.soft': 'How far the sides melt, as a share of the width',
  'feather.glow': 'How strong the coloured glow round it is',
  'drivein.size': 'Screen and tower together; the most fits the strip',
  'drivein.floor': 'How strongly the screen\u2019s light falls on the floor',
  'drivein.sign': 'The marquee board under the screen',
  'drivein.neon': 'The neon line round the frame and its glow',
  'drivein.light': 'A soft light that travels slowly round the line',
  'holo.tilt': 'How far the pane turns; 0 faces you',
  'holo.plate': 'How dark the glass behind the picture is',
  'holo.beam': 'The fan of light from the emitter to the pane',
});

/** A value read back in plain words: "120 px, your usual", "wider than usual". */
export function controlWords(c: RangeControl, value: number): string {
  const shown = c.show(value);
  if (value === c.usual) return `${shown}, your usual`;
  return `${shown}, ${value > c.usual ? c.more : c.less} than usual`;
}

/** A tune with the limits that depend on other settings applied (what is drawn, and what the sheet shows). */
export function resolveTune(t: LookTune): LookTune {
  const sky = { ...t.sky, soft: Math.min(t.sky.soft, skySoftMax(t)) };
  const sun = { ...t.sun, up: Math.min(t.sun.up, sunUpMax(t.sun.size)) };
  return { ...t, sky: { ...sky, soft: skySoftEdge(sky.soft, skyBox(sky.size)) }, sun };
}

function clampNum(v: unknown, min: number, max: number, dflt: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return dflt;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/** Stored settings, each field checked; anything missing, of the wrong type or out of bounds falls back or is clamped. */
export function parseTune(raw: string | null): LookTune {
  const out = defaultTune();
  if (!raw || raw.length > 4000) return out;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  const o = v as Record<string, unknown>;
  for (const look of Object.keys(CONTROLS) as (keyof LookTune)[]) {
    const rec = o[look];
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue;
    const r = rec as Record<string, unknown>;
    const target = out[look] as unknown as Record<string, number | boolean>;
    for (const c of CONTROLS[look]) {
      if (c.kind === 'switch') target[c.key] = typeof r[c.key] === 'boolean' ? (r[c.key] as boolean) : c.usual;
      else target[c.key] = clampNum(r[c.key], c.min, c.hardMax, c.usual);
    }
  }
  return out;
}

export function loadTune(): LookTune {
  try {
    return parseTune(localStorage.getItem(TUNE_KEY));
  } catch {
    return defaultTune();
  }
}

export function saveTune(t: LookTune): void {
  try {
    localStorage.setItem(TUNE_KEY, JSON.stringify(t));
  } catch {
    /* the settings are a convenience */
  }
}

/** True while every setting of this look is at its default. */
export function isUsual(look: LookId, t: LookTune): boolean {
  const rec = t[look] as unknown as Record<string, number | boolean>;
  return CONTROLS[look].every((c) => rec[c.key] === c.usual);
}

/** This look's settings with `patch` applied, each value bounded by its control (the dependent limits included). */
export function withPatch(t: LookTune, look: LookId, patch: Record<string, number | boolean>): LookTune {
  const next = { ...t, [look]: { ...t[look], ...patch } } as LookTune;
  const rec = next[look] as unknown as Record<string, number | boolean>;
  for (const c of CONTROLS[look]) {
    if (c.kind === 'switch') {
      if (typeof rec[c.key] !== 'boolean') rec[c.key] = c.usual;
    } else {
      rec[c.key] = clampNum(rec[c.key], c.min, c.max(next), c.usual);
    }
  }
  return next;
}

/** This look back to its defaults, the others untouched. */
export function resetLook(t: LookTune, look: LookId): LookTune {
  return { ...t, [look]: { ...DEFAULT_TUNE[look] } } as LookTune;
}

/**
 * The tilted pane's bounding box for a turn of `tilt` degrees, merged with the flat pane (what a
 * point of it can reach), rounded to whole pixels. At the usual 7 degrees it is today's box.
 */
function holoBoxFor(tilt: number): WallRect {
  const p = HOLO_PANE;
  const ox = p.x + p.w * 0.5;
  const oy = p.y + p.h * 0.6;
  const a = (-tilt * Math.PI) / 180;
  const b = (1.2 * Math.PI) / 180;
  const pt = (x: number, y: number): [number, number] => {
    const dx = x - ox;
    const dy = y - oy;
    const z1 = dy * Math.sin(b);
    const x2 = dx * Math.cos(a) + z1 * Math.sin(a);
    const y2 = dy * Math.cos(b);
    const z2 = -dx * Math.sin(a) + z1 * Math.cos(a);
    const w = 1 - z2 / 2400;
    return [ox + x2 / w, oy + y2 / w];
  };
  const q = [pt(p.x, p.y), pt(p.x + p.w, p.y), pt(p.x + p.w, p.y + p.h), pt(p.x, p.y + p.h)];
  const x0 = Math.min(p.x, Math.round(Math.min(...q.map((c) => c[0]))));
  const x1 = Math.max(p.x + p.w, Math.round(Math.max(...q.map((c) => c[0]))));
  const y0 = Math.min(p.y, Math.round(Math.min(...q.map((c) => c[1]))));
  const y1 = Math.max(p.y + p.h, Math.round(Math.max(...q.map((c) => c[1]))));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const boxCache = new Map<string, Readonly<WallRect>>();

/**
 * The picture's box in wall pixels for a look under its settings (the drawn picture: the disc, the
 * screen, the tilted pane's reach; never a glow). The usual settings give exactly `LOOK_BOXES`, and
 * the same object per set of settings, so a store selector sees one value from call to call.
 */
export function lookBox(look: LookId, tune: LookTune): Readonly<WallRect> {
  const t = resolveTune(tune);
  if (isUsual(look, t)) return LOOK_BOXES[look];
  let key: string;
  let make: () => WallRect;
  switch (look) {
    case 'sky':
      key = `sky:${t.sky.size}`;
      make = () => skyBox(t.sky.size);
      break;
    case 'sun':
      key = `sun:${t.sun.size}:${t.sun.up}`;
      make = () => ({ x: r2(SUN_CENTRE_X - t.sun.size / 2), y: DRIVE_IN_GROUND - t.sun.up - t.sun.size, w: t.sun.size, h: t.sun.size });
      break;
    case 'feather': {
      key = `feather:${t.feather.size}`;
      const s = t.feather.size / 100;
      make = () => ({ x: r2(FEATHER_FOOT.x - (LOOK_BOXES.feather.w / 2) * s), y: r2(FEATHER_FOOT.y - LOOK_BOXES.feather.h * s), w: r2(LOOK_BOXES.feather.w * s), h: r2(LOOK_BOXES.feather.h * s) });
      break;
    }
    case 'drivein': {
      key = `drivein:${t.drivein.size}`;
      const s = t.drivein.size / 100;
      make = () => ({ x: r2(DRIVE_FOOT.x - (DRIVE_IN_SCREEN.w / 2) * s), y: r2(DRIVE_FOOT.y - (DRIVE_FOOT.y - DRIVE_IN_SCREEN.y) * s), w: r2(DRIVE_IN_SCREEN.w * s), h: r2(DRIVE_IN_SCREEN.h * s) });
      break;
    }
    default:
      key = `holo:${t.holo.tilt}`;
      make = () => holoBoxFor(t.holo.tilt);
  }
  // A usual box under another record of settings is still the usual object.
  let b = boxCache.get(key);
  if (!b) {
    b = Object.freeze(make());
    boxCache.set(key, b);
  }
  const u = LOOK_BOXES[look];
  return b.x === u.x && b.y === u.y && b.w === u.w && b.h === u.h ? u : b;
}

/** The drive-in's scale (1 at the usual size). */
export function driveScale(t: LookTune): number {
  return t.drivein.size / 100;
}

/** The Hologram's turn as CSS needs it. */
export function holoRotateY(t: LookTune): number {
  return -t.holo.tilt;
}

type Vars = Record<string, string>;

/** Where a stage box moves: left, top, width and height in stage CSS pixels. */
function boxVars(b: WallRect): Vars {
  return { '--w-l': px(b.x - OFF.x), '--w-t': px(b.y - OFF.y), '--w-w': px(b.w), '--w-h': px(b.h) };
}

const a3 = (n: number) => String(Math.round(n * 1000) / 1000);

/**
 * The CSS custom properties a look's stage carries: only those whose setting is off its default
 * (and the whole sky's soft edge, which was always carried). With every setting at its default
 * only that one is set, so every other rule falls back to today's number.
 */
export function tuneVars(look: LookId, tune: LookTune): Vars {
  const t = resolveTune(tune);
  const v: Vars = {};
  switch (look) {
    case 'sky': {
      const d = DEFAULT_TUNE.sky;
      if (t.sky.size !== d.size) Object.assign(v, boxVars(skyBox(t.sky.size)));
      v['--w-sky-soft'] = `${t.sky.soft}px`;
      if (t.sky.bright !== d.bright) v['--w-bright'] = a3(t.sky.bright / 100);
      break;
    }
    case 'sun': {
      const d = DEFAULT_TUNE.sun;
      if (t.sun.size !== d.size || t.sun.up !== d.up) {
        const k = t.sun.size / SUN_USUAL;
        const disc = lookBox('sun', t);
        const halo = HALO * k;
        const top = disc.y - INSET * k;
        Object.assign(v, boxVars({ x: SUN_CENTRE_X - halo / 2, y: top, w: halo, h: halo }));
        v['--w-inset'] = px(INSET * k);
        v['--w-k'] = a3(k);
        v['--w-gy'] = px(DRIVE_IN_GROUND - top);
      }
      if (t.sun.glow !== d.glow) {
        const g = t.sun.glow / 50;
        v['--w-halo-a1'] = a3(0.5 * g);
        v['--w-halo-a2'] = a3(0.22 * g);
        v['--w-disc-glow'] = a3(0.45 * g);
      }
      break;
    }
    case 'feather': {
      const d = DEFAULT_TUNE.feather;
      if (t.feather.size !== d.size) {
        Object.assign(v, boxVars(lookBox('feather', t)));
        v['--w-k'] = a3(t.feather.size / 100);
      }
      if (t.feather.soft !== d.soft) {
        v['--w-fe-x'] = `${t.feather.soft}%`;
        v['--w-fe-t'] = `${r2(t.feather.soft * 0.85)}%`;
        v['--w-fe-b'] = `${r2(100 - t.feather.soft * 1.3)}%`;
      }
      if (t.feather.glow !== d.glow) v['--w-glow-a'] = a3(t.feather.glow / 100);
      break;
    }
    case 'drivein': {
      const d = DEFAULT_TUNE.drivein;
      if (t.drivein.size !== d.size) {
        const b = lookBox('drivein', t);
        Object.assign(v, boxVars(b));
        const k = driveScale(t);
        v['--w-k'] = a3(k);
        v['--w-tl'] = px(-b.x);
        v['--w-tt'] = px(-b.y);
        v['--w-tf'] = `scale(${a3(k)})`;
        v['--w-gy'] = px(DRIVE_IN_GROUND - b.y);
      }
      if (t.drivein.floor !== d.floor) v['--w-spill-a'] = a3(t.drivein.floor / 100);
      if (!t.drivein.sign) v['--w-sign'] = 'none';
      if (!t.drivein.neon) v['--w-neon'] = 'none';
      break;
    }
    case 'holo': {
      const d = DEFAULT_TUNE.holo;
      if (t.holo.tilt !== d.tilt) v['--w-rot'] = `${holoRotateY(t)}deg`;
      if (t.holo.plate !== d.plate) {
        v['--w-plate-a'] = a3(t.holo.plate / 100);
        v['--w-plate-b'] = a3(Math.max(0, t.holo.plate / 100 - 0.14));
      }
      break;
    }
  }
  return v;
}
