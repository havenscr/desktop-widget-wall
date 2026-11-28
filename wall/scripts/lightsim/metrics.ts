/** Numbers read off one run: beat accuracy, how each light moves, colour pace, drops, panels against Plays. */
import type { RunResult, Tick } from './sim';
import { lum } from './engine';
import type { Rgb } from '../../src/studio/lightsync/preview';

/** A detected onset matches a true kick when it lands this far before or after it (ms). */
export const MATCH_BEFORE_MS = 60;
export const MATCH_AFTER_MS = 150;

export interface Metrics {
  song: string;
  preset: string;
  kicks: number;
  detected: number;
  hitRate: number;
  /** Median of onset minus kick, and of the light's reaction (the confirming tick) minus kick (ms). */
  onsetMs: number;
  reactMs: number;
  falsePerMin: number;
  gridCover: number;
  /** Pulses per minute: Far Left, Left, Right, Far Right, centre panel, edge panel. */
  ppm: number[];
  /** Brightness scalar range of the inner Play (Left) and outer Play (Far Left) while music plays. */
  innerMin: number;
  innerMax: number;
  outerMin: number;
  outerMax: number;
  /** Lowest luminance any Play showed while music played (colour times brightness). */
  minLum: number;
  /** Share of music time the inner Play sits within 0.02 of its cap. */
  atPeak: number;
  colourPerMin: number;
  drops: string;
  /** Peak of the edge panel's beat lift against the centre panel's (1 = same). */
  edgeLift: number;
  /** Correlation of the beat motion of the inner Play and the centre panel, and the lag (ms, panel after Play). */
  corr: number;
  lagMs: number;
  guardHolds: number;
  /** Detected beats the pulse ignored (closer than `minPulseGapMs` to the last pulse). */
  skipped: number;
  /** Luminance of the inner Play during silence (does it hold a floor or go dark). */
  silenceLum: number;
}

const median = (v: number[]) => {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Peaks that rise at least `d` above the trough before them and fall `d` after. */
export function countPulses(y: number[], d = 0.04): number {
  let n = 0;
  let lo = y[0] ?? 0;
  let hi = -Infinity;
  let rising = true;
  for (const v of y) {
    if (rising) {
      if (v > hi) hi = v;
      if (hi - lo >= d && hi - v >= d) {
        n++;
        rising = false;
        lo = v;
      }
      if (v < lo && hi - lo < d) {
        lo = v;
        hi = v;
      }
    } else {
      if (v < lo) lo = v;
      if (v - lo >= d) {
        rising = true;
        hi = v;
      }
    }
  }
  return n;
}

function playing(r: RunResult): (t: number) => boolean {
  const silent = r.song.sections.filter((s) => s.name === 'silence');
  return (t) => t < r.song.seconds * 1000 - 600 && !silent.some((s) => t >= s.from * 1000 + 300 && t < s.to * 1000);
}

/** High pass: the series minus its mean over the last `w` samples. */
function detrend(y: number[], w: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < y.length; i++) {
    sum += y[i];
    if (i >= w) sum -= y[i - w];
    out.push(y[i] - sum / Math.min(i + 1, w));
  }
  return out;
}

function corrAt(a: number[], b: number[], lag: number): number {
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = Math.max(0, -lag); i < a.length && i + lag < b.length; i++) {
    sab += a[i] * b[i + lag];
    saa += a[i] * a[i];
    sbb += b[i + lag] * b[i + lag];
  }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
}

export function measure(r: RunResult): Metrics {
  const { ticks, song } = r;
  const tickMs = ticks[1].t - ticks[0].t;
  const on = playing(r);
  const music = ticks.filter((k) => on(k.t));
  const minutes = music.length * tickMs / 60000;

  // Beats.
  const beats = ticks.filter((k) => k.beat);
  const kicks = song.kicks.map((s) => s * 1000);
  const used = new Set<number>();
  const onsetOff: number[] = [];
  const reactOff: number[] = [];
  let falses = 0;
  for (const b of beats) {
    let best = -1;
    let bestD = Infinity;
    kicks.forEach((k, i) => {
      const d = b.onset - k;
      if (d >= -MATCH_BEFORE_MS && d <= MATCH_AFTER_MS && Math.abs(d) < bestD && !used.has(i)) {
        best = i;
        bestD = Math.abs(d);
      }
    });
    if (best < 0) falses++;
    else {
      used.add(best);
      onsetOff.push(b.onset - kicks[best]);
      reactOff.push(b.t - kicks[best]);
    }
  }
  const gridHit = song.grid.filter((g) => beats.some((b) => b.onset - g * 1000 >= -MATCH_BEFORE_MS && b.onset - g * 1000 <= MATCH_AFTER_MS)).length;

  // Lights.
  const L = (k: Tick, i: number) => lum(k.plays[i]);
  const centre = Math.floor(r.ticks[0].panels.length / 2);
  const edge = 0;
  const series = [0, 1, 2, 3].map((i) => music.map((k) => L(k, i)));
  series.push(music.map((k) => lum(k.panels[centre])), music.map((k) => lum(k.panels[edge])));
  const ppm = series.map((y) => countPulses(y) / Math.max(minutes, 1e-9));
  const innerB = music.map((k) => k.playB[1]);
  const outerB = music.map((k) => k.playB[0]);
  const minLum = Math.min(...music.flatMap((k) => k.plays.map((c: Rgb) => lum(c))));
  const atPeak = innerB.filter((b) => b >= r.brightness - 0.02).length / Math.max(1, innerB.length);

  // Colour: the palette colour nearest the inner Play's hue changes.
  let changes = 0;
  let prev = -1;
  for (const k of music) {
    const c = k.plays[1];
    const m = Math.max(...c);
    if (m < 1e-6) continue;
    const n = c.map((v) => v / m);
    const pal = [[1, 0.24, 0.6], [0.21, 0.9, 0.92], [0.6, 0.48, 1]];
    let bi = 0;
    let bd = Infinity;
    pal.forEach((p, i) => {
      const d = p.reduce((t, v, j) => t + (v - n[j]) ** 2, 0);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    if (prev >= 0 && bi !== prev) changes++;
    prev = bi;
  }

  // Drops: each true drop matched within 1.5 s.
  const dropTxt = song.drops.length || r.drops.length
    ? `${r.drops.length} fired (${r.drops.map((d) => (d.t / 1000).toFixed(1) + 's').join(', ') || 'none'}); true ${song.drops.map((d) => d.toFixed(1) + 's').join(', ') || 'none'}`
    : '0 (none expected)';

  // Panels against Plays: the beat motion (detrended luminance) of the inner Play and the centre panel.
  const a = detrend(series[1], 25);
  const b = detrend(series[4], 25);
  let lag = 0;
  let best = -Infinity;
  const span = Math.round(400 / tickMs);
  for (let l = -span; l <= span; l++) {
    const c = corrAt(a, b, l);
    if (c > best) {
      best = c;
      lag = l;
    }
  }
  const lift = (y: number[]) => {
    const d = detrend(y, 25);
    return Math.max(...d) - Math.min(...d);
  };
  const silenceTicks = ticks.filter((k) => !on(k.t) && k.t < song.seconds * 1000 - 600);
  return {
    song: song.id,
    preset: r.preset,
    kicks: kicks.length,
    detected: beats.length,
    hitRate: used.size / Math.max(1, kicks.length),
    onsetMs: median(onsetOff),
    reactMs: median(reactOff),
    falsePerMin: falses / Math.max(minutes, 1e-9),
    gridCover: gridHit / Math.max(1, song.grid.length),
    ppm,
    innerMin: Math.min(...innerB),
    innerMax: Math.max(...innerB),
    outerMin: Math.min(...outerB),
    outerMax: Math.max(...outerB),
    minLum,
    atPeak,
    colourPerMin: changes / Math.max(minutes, 1e-9),
    drops: dropTxt,
    edgeLift: lift(series[5]) / Math.max(1e-9, lift(series[4])),
    corr: corrAt(a, b, 0),
    lagMs: lag * tickMs,
    skipped: beats.filter((k) => !k.pulseStart).length,
    guardHolds: r.heldPlays.reduce((t, v) => t + v, 0) + r.heldPanels.reduce((t, v) => t + v, 0),
    silenceLum: silenceTicks.length ? Math.max(...silenceTicks.map((k) => lum(k.plays[1]))) : NaN,
  };
}

const p = (v: number, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');
const pct = (v: number) => (Number.isFinite(v) ? Math.round(v * 100) + '%' : 'n/a');

export function markdown(rows: Metrics[]): string {
  const head = '| song | preset | kicks | hit | onset ms | react ms | false/min | grid | pulses/min FL L R FR Pc Pe | inner b | outer b | min lum | at peak | colour/min | drops | edge/centre lift | Play vs panel corr, lag | beats skipped by pulse gap | guard holds | silence lum |';
  const sep = '|' + head.split('|').slice(1, -1).map(() => '-').join('|') + '|';
  const lines = rows.map((m) =>
    `| ${m.song} | ${m.preset} | ${m.kicks} | ${pct(m.hitRate)} | ${p(m.onsetMs)} | ${p(m.reactMs)} | ${p(m.falsePerMin, 1)} | ${pct(m.gridCover)} | ${m.ppm.map((v) => p(v)).join(' ')} | ${p(m.innerMin, 2)}..${p(m.innerMax, 2)} | ${p(m.outerMin, 2)}..${p(m.outerMax, 2)} | ${p(m.minLum, 3)} | ${pct(m.atPeak)} | ${p(m.colourPerMin, 1)} | ${m.drops} | ${p(m.edgeLift, 2)} | ${p(m.corr, 2)}, ${p(m.lagMs)} ms | ${m.skipped} of ${m.detected} | ${m.guardHolds} | ${p(m.silenceLum, 3)} |`,
  );
  return [head, sep, ...lines].join('\n');
}
