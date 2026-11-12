import type { PlaceId } from '../state/places';

/** A frozen review frame requested through the URL. */
export interface ReviewFrame {
  place: PlaceId;
  /** Epoch milliseconds the clock is frozen at. */
  ms: number;
}

const PLACE_IDS: readonly string[] = ['work', 'home', 'unwind'];

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
  return Number.isNaN(ms) ? null : { place: place as PlaceId, ms };
}
