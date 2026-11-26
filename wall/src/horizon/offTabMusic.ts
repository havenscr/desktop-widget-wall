import { CAMERAS, ease, type CameraPreset } from './cameras';
import { visualizerWeight } from './echo';

/** How strongly the music moves the ridgelines on every tab but Unwind: today's look, about 60 percent of Unwind, or Unwind's own strength. */
export type MusicLevel = 'calm' | 'medium' | 'full';

export const MUSIC_LEVELS: readonly MusicLevel[] = ['calm', 'medium', 'full'];
export const DEFAULT_MUSIC_LEVEL: MusicLevel = 'medium';

/** Seconds a change of level takes to ease in. */
export const LEVEL_EASE_S = 1;

/**
 * How far each music value of a camera moves toward Unwind's, per level: 0 is the camera's own
 * value (Calm, today's look), 1 is Unwind's. Medium is about 60 percent of the height and
 * opacity, and 6 lines in place of 3 (3 of the 8 more Unwind has, 0.375).
 */
export interface MusicFractions {
  amp: number;
  a: number;
  n: number;
  gp: number;
  /** Cover colours and instrument follow (`visualizerWeight`): 0.6 on Medium, not tied to the line count. */
  vw: number;
}
export const LEVEL_FRACTIONS: Readonly<Record<MusicLevel, Readonly<MusicFractions>>> = {
  calm: { amp: 0, a: 0, n: 0, gp: 0, vw: 0 },
  medium: { amp: 0.6, a: 0.6, n: 0.375, gp: 0.6, vw: 0.6 },
  full: { amp: 1, a: 1, n: 1, gp: 1, vw: 1 },
};

const POS: Record<MusicLevel, number> = { calm: 0, medium: 1, full: 2 };

/** The fractions at a position between levels (0 Calm, 1 Medium, 2 Full), written into `out`. */
export function fractionsAt(pos: number, out: MusicFractions): MusicFractions {
  const p = Math.min(2, Math.max(0, pos));
  const lo = p < 1 ? LEVEL_FRACTIONS.calm : LEVEL_FRACTIONS.medium;
  const hi = p < 1 ? LEVEL_FRACTIONS.medium : LEVEL_FRACTIONS.full;
  const k = p < 1 ? p : p - 1;
  out.amp = lo.amp + (hi.amp - lo.amp) * k;
  out.a = lo.a + (hi.a - lo.a) * k;
  out.n = lo.n + (hi.n - lo.n) * k;
  out.gp = lo.gp + (hi.gp - lo.gp) * k;
  out.vw = lo.vw + (hi.vw - lo.vw) * k;
  return out;
}

/** The eased position between levels: it moves from `from` to the target over `LEVEL_EASE_S`, never a jump. */
export interface LevelEase {
  pos: number;
  from: number;
  to: number;
  t: number;
}

export function createLevelEase(level: MusicLevel): LevelEase {
  return { pos: POS[level], from: POS[level], to: POS[level], t: 1 };
}

/** Advance the ease by `dt` seconds toward `level` (a new level restarts it from where it is now); `instant` lands at once. */
export function stepLevelEase(s: LevelEase, level: MusicLevel, dt: number, instant = false): void {
  const target = POS[level];
  if (target !== s.to) {
    s.from = s.pos;
    s.to = target;
    s.t = instant ? 1 : 0;
  }
  if (s.t < 1) s.t = Math.min(1, s.t + Math.max(0, dt) / LEVEL_EASE_S);
  s.pos = s.t >= 1 ? s.to : s.from + (s.to - s.from) * ease(s.t);
}

/**
 * The camera the lines are drawn with off Unwind: the music values of `camera` moved toward
 * Unwind's by `f`, scaled by `play` (1 while music drives the lines, 0 at rest, so the resting
 * look never changes) and by the camera's ripple (none on Rainier). Writes into `out` and returns it;
 * with nothing to move it returns `camera` itself. On Unwind the target is the camera itself, so
 * nothing moves.
 */
export function withMusicLevel(camera: CameraPreset, f: MusicFractions, play: number, out: CameraPreset): CameraPreset {
  const w = Math.min(1, Math.max(0, camera.ea / 0.2)) * Math.min(1, Math.max(0, play));
  if (w <= 0 || (f.amp <= 0 && f.a <= 0 && f.n <= 0 && f.gp <= 0 && f.vw <= 0)) return camera;
  const u = CAMERAS.unwind;
  Object.assign(out, camera);
  out.eamp = camera.eamp + (u.eamp - camera.eamp) * f.amp * w;
  out.ea = camera.ea + (u.ea - camera.ea) * f.a * w;
  out.en = camera.en + (u.en - camera.en) * f.n * w;
  out.gp = camera.gp + (u.gp - camera.gp) * f.gp * w;
  const base = visualizerWeight(camera);
  out.vw = base + (1 - base) * f.vw * w;
  return out;
}
