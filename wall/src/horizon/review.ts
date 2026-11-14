import type { CameraPlace } from '../state/places';

/** A frozen review frame requested through the URL. */
export interface ReviewFrame {
  place: CameraPlace;
  /** Epoch milliseconds the clock is frozen at. */
  ms: number;
}

const PLACE_IDS: readonly string[] = ['work', 'home', 'onair', 'unwind'];

/**
 * Parse `?hz=<place>&at=<ISO time>`. Returns null unless both are present and valid.
 * Give the time an offset (for example `2026-11-11T16:00:00-08:00`); without one it is read in local time.
 */
export function parseReview(search: string): ReviewFrame | null {
  const q = new URLSearchParams(search);
  const place = q.get('hz');
  const at = q.get('at');
  if (!place || !at || !PLACE_IDS.includes(place)) return null;
  // URLSearchParams turns a literal `+` (as in +01:00) into a space; a space is never valid in an ISO time.
  const ms = Date.parse(at.replace(/ /g, '+'));
  return Number.isNaN(ms) ? null : { place: place as CameraPlace, ms };
}

/** Review knobs for the sky layers (`sky.ts`), development builds only: the fit check's self-test breaks and the cost measurement. */
export interface SkyReview {
  /**
   * `?sky=front`: mount the front canvas on every place, asked for or not. `?sky=flat`: never mount
   * it (one canvas, as before). `?sky=empty`: claim the layer with an empty host in the main area,
   * where a screen's host goes, with nothing between the two canvases (the pixel proof: the
   * picture must be exactly the one-canvas picture).
   */
  front?: 'always' | 'never' | 'empty';
  /** `?skymoon=x,y,r`: draw the moon here in place of `MOON`. */
  moon?: [number, number, number];
}

/** Parse the sky layers' review knobs; null when there are none. */
export function parseSkyReview(search: string): SkyReview | null {
  const q = new URLSearchParams(search);
  const out: SkyReview = {};
  const sky = q.get('sky');
  if (sky === 'front') out.front = 'always';
  else if (sky === 'flat') out.front = 'never';
  else if (sky === 'empty') out.front = 'empty';
  const m = (q.get('skymoon') ?? '').split(',').map(Number);
  if (m.length === 3 && m.every((v) => Number.isFinite(v)) && m[2] > 0) out.moon = [m[0], m[1], m[2]];
  return out.front || out.moon ? out : null;
}
