import { SKY_PLACES } from '../backdrop/settings';
import type { CameraPlace, PlaceId } from '../state/places';

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
   * picture must be exactly the one-canvas picture). `?sky=place`: split the picture the way the animated sky does (the sky on
   * the main canvas, the ground on a second one under the veil) with the sky layer itself empty: the pixel proof, which must
   * match `?sky=flat`.
   */
  front?: 'always' | 'never' | 'empty' | 'place';
  /** `?skyon=work,home`: the animated sky shows on these pages in place of the setting. `?skystyle=aurora|wash`: its style. `?skyt=40`: the moment (seconds) a review still draws. */
  on?: PlaceId[];
  style?: 'wash' | 'aurora';
  t?: number;
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
  else if (sky === 'place') out.front = 'place';
  const on = q.get('skyon');
  if (on !== null) out.on = on.split(',').filter((id): id is PlaceId => SKY_PLACES.some((p) => p.id === id));
  const style = q.get('skystyle');
  if (style === 'wash' || style === 'aurora') out.style = style;
  const t = Number(q.get('skyt'));
  if (q.has('skyt') && Number.isFinite(t) && t >= 0) out.t = t;
  const m = (q.get('skymoon') ?? '').split(',').map(Number);
  if (m.length === 3 && m.every((v) => Number.isFinite(v)) && m[2] > 0) out.moon = [m[0], m[1], m[2]];
  return out.front || out.moon || out.on || out.style || out.t !== undefined ? out : null;
}
