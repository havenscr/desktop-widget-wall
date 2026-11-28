/**
 * The native frame function (`src-tauri/src/wall2_lightsync/engine.rs`, `Engine::step`) in
 * TypeScript, built on the shared pieces of `src/studio/lightsync/preview.ts`. It differs from the
 * page preview in one way only: panels take their ripple distance from real x, y positions (the
 * Nanoleaf layout), as the native side does, so a layout file can be swapped in. On a row of five
 * evenly spaced panels it gives the preview's frames exactly (the parity test checks that).
 *
 * Nothing here talks to a device; it is maths on numbers.
 */
import { AUTO_TARGET, GUARD_MAX_TRANSITIONS, MAX_BACKDATE_MS, RIPPLE_FALLOFF, Swing, autoGain, bassMotion, bandLevel, kickShape, paletteColour, type Rgb } from '../../src/studio/lightsync/preview';
import { DEFAULT_LIGHT_SYNC, INTENSITIES, DEFAULT_LIGHTS_UI, driftOf, type Follow, type IntensityId, type LightSyncSettings, type LightsUi } from '../../src/studio/lightsync/model';

const FRAME_MS = 33;
const NUDGE_MS = 200;
const LEVEL_LO = 0.2;
const LEVEL_SPAN = 0.7;

export interface EngineTuning {
  s: LightSyncSettings & { driftMs: number };
  ui: LightsUi;
  colors: Rgb[];
  kick: Rgb;
}

const hexRgb = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;

/** The settings an intensity sends, as the page builds them (`engineSettings`). */
export function tuningFor(id: IntensityId, palette: { colors: readonly string[]; kick: string }, follow: Follow[] = DEFAULT_LIGHTS_UI.follow): EngineTuning {
  const col = INTENSITIES[id];
  const ui: LightsUi = { colourBars: col.colourBars, follow: follow.slice(), ripple: DEFAULT_LIGHTS_UI.ripple, preset: id, saved: {}, autoLevel: process.env.LIGHTSIM_AUTOLEVEL !== '0' };
  return { s: { ...DEFAULT_LIGHT_SYNC, ...col.settings, driftMs: driftOf(ui.colourBars) }, ui, colors: palette.colors.map(hexRgb), kick: hexRgb(palette.kick) };
}

/** `levels_from_bands`: the bass is the mean of bytes 0 to 5, the highs the mean of 20 to 31. */
export function levelsFromBands(bands: readonly number[]): [number, number] {
  const mean = (a: number, b: number) => {
    const part = bands.slice(a, b);
    return part.length ? part.reduce((t, v) => t + v / 255, 0) / (b - a) : 0;
  };
  return [mean(0, 6), mean(20, 32)];
}

export interface LightState {
  b: number;
  swing: Swing;
  /** Frames the flash guard changed (instrumentation only). */
  held: number;
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const mix = (a: Rgb, b: Rgb, t: number): Rgb => {
  const k = clamp01(t);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
};
export const lum = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

export class Engine {
  bassEnv = 0;
  highEnv = 0;
  kickAgeMs = Infinity;
  pos = 0;
  clockMs = 0;
  nudgeLeft = 0;
  autoLevel = AUTO_TARGET;
  slowBass = 0;
  recent: [number, number, number][] = [];
  plays: LightState[] = [];
  panels: LightState[] = [];
  /** The pulse and the ripple front of the newest step (instrumentation). */
  pulse = 0;
  constructor(readonly floor0: number) {}

  private follow(env: number, target: number, dt: number, a: number, r: number) {
    return env + (target - env) * (1 - Math.exp(-dt / (target > env ? a : r)));
  }
  private shaped(level: number, gain: number) {
    return clamp01(clamp01((level - LEVEL_LO) / LEVEL_SPAN) * gain);
  }
  private windowed(dt: number, bass: number, high: number, window: number): [number, number] {
    this.recent.push([Math.max(1, dt), bass, high]);
    const span = window * FRAME_MS;
    let total = this.recent.reduce((t, r) => t + r[0], 0);
    while (this.recent.length > 1 && total - this.recent[0][0] >= span) total -= this.recent.shift()![0];
    const b = this.recent.reduce((t, r) => t + r[0] * r[1], 0);
    const h = this.recent.reduce((t, r) => t + r[0] * r[2], 0);
    return [b / total, h / total];
  }

  step(t: EngineTuning, input: { bass: number; high: number; beat: boolean; dtMs: number; beatLagMs?: number }, nPlays: number, panelXy: readonly (readonly [number, number])[]): { plays: Rgb[]; panels: Rgb[] } {
    const s = t.s;
    const dt = Number.isFinite(input.dtMs) ? Math.min(500, Math.max(0, input.dtMs)) : 0;
    let bassIn = clamp01(input.bass);
    let highIn = clamp01(input.high);
    if (t.ui.autoLevel === true) {
      const g = autoGain(this, Math.max(bassIn, highIn), dt);
      bassIn = clamp01(bassIn * g);
      highIn = clamp01(highIn * g);
    }
    const [wb, wh] = this.windowed(dt, bassIn, highIn, s.levelWindow);
    this.bassEnv = this.follow(this.bassEnv, clamp01(this.shaped(wb, s.bassGain) + bassMotion(this, wb, dt)), dt, s.attackMs, s.releaseMs);
    this.highEnv = this.follow(this.highEnv, this.shaped(wh, s.highGain), dt, s.attackMs, s.releaseMs);
    this.clockMs += dt;
    if (input.beat) {
      this.nudgeLeft += s.beatNudge;
      if (!(this.kickAgeMs < s.minPulseGapMs)) this.kickAgeMs = Number.isFinite(input.beatLagMs) ? Math.min(MAX_BACKDATE_MS, Math.max(0, input.beatLagMs as number)) : 0;
    }
    const take = Math.min(this.nudgeLeft, (s.beatNudge * dt) / NUDGE_MS);
    this.nudgeLeft -= take;
    const n = t.colors.length;
    this.pos = (((this.pos + take + dt / s.driftMs) % n) + n) % n;
    const pulse = kickShape(this.kickAgeMs, s.kickRiseMs, s.kickDecayMs);
    this.pulse = pulse;
    const plays = s.plays ? this.playsStep(t, nPlays, pulse, dt) : Array.from({ length: nPlays }, () => [0, 0, 0] as Rgb);
    const panels = s.panels ? this.panelsStep(t, panelXy, pulse, dt) : [];
    if (Number.isFinite(this.kickAgeMs)) this.kickAgeMs += dt;
    return { plays, panels };
  }

  private light(dt: number, st: LightState, s: LightSyncSettings, colour: Rgb, kick: Rgb, env: number, lift: number, steps: number): Rgb {
    const target = s.floor + (s.brightness - s.floor) * clamp01(s.energyDepth * env + s.kickFlash * lift);
    const b = target < st.b ? Math.max(target, st.b - (s.slewDown * dt) / 1000) : target;
    st.b = b;
    const out = mix(colour, kick, s.kickWhite * lift).map((v) => v * b) as Rgb;
    const y = lum(out);
    const round = (c: Rgb) => c.map((v) => Math.round(v * steps) / steps) as Rgb;
    const cand = round(out.map(clamp01) as Rgb);
    const l0 = lum(cand);
    const held = st.swing.limit(this.clockMs, l0, GUARD_MAX_TRANSITIONS);
    let shown = cand;
    if (held !== l0 && y > 1e-6) {
      let h = out.map((v) => clamp01(v * (held / y))) as Rgb;
      const l = lum(h);
      if (l < held && l < 1) h = mix(h, [1, 1, 1], (held - l) / (1 - l));
      shown = round(h);
      st.held++;
    }
    st.swing.commit(this.clockMs, lum(shown));
    return shown;
  }

  private playsStep(t: EngineTuning, n: number, pulse: number, dt: number): Rgb[] {
    const s = t.s;
    while (this.plays.length < n) this.plays.push({ b: Math.max(this.floor0, s.floor), swing: new Swing(), held: 0 });
    const out: Rgb[] = [];
    for (let i = 0; i < n; i++) {
      const d = Math.abs(i - (n - 1) / 2);
      const inner = d < (n - 1) / 4 + 0.5;
      const f = t.ui.follow[i];
      const env = f ? bandLevel(f, this.bassEnv, this.highEnv) : inner ? this.bassEnv : this.highEnv;
      const colour = paletteColour(t.colors, this.pos + i * 0.25);
      out.push(this.light(dt, this.plays[i], s, colour, t.kick, env, pulse * (inner ? 1 : 0.5), 65535));
    }
    return out;
  }

  private panelsStep(t: EngineTuning, xy: readonly (readonly [number, number])[], pulse: number, dt: number): Rgb[] {
    if (!xy.length) return [];
    const s = t.s;
    const n = xy.length;
    while (this.panels.length < n) this.panels.push({ b: Math.max(this.floor0, s.floor), swing: new Swing(), held: 0 });
    const cx = xy.reduce((a, p) => a + p[0], 0) / n;
    const cy = xy.reduce((a, p) => a + p[1], 0) / n;
    const dist = xy.map((p) => Math.hypot(p[0] - cx, p[1] - cy));
    const far = Math.max(1, ...dist);
    const env = bandLevel(t.ui.follow[4] ?? 'both', this.bassEnv, this.highEnv);
    const front = this.kickAgeMs < s.rippleMs ? this.kickAgeMs / s.rippleMs : null;
    return dist.map((d, i) => {
      const colour = paletteColour(t.colors, this.pos + i / n);
      const lift = t.ui.ripple ? (front === null ? 0 : Math.exp(-(((d / far - front) / 0.2) ** 2)) * (1 - RIPPLE_FALLOFF * front)) : pulse;
      return this.light(dt, this.panels[i], s, colour, t.kick, env, lift, 255);
    });
  }
}
