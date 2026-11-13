import { BAND_COUNT, HISTORY_HZ, HISTORY_ROWS, bandHistory, danceHistory, type BandHistory } from './store';
import { BAND_FLOOR, SPECTRUM_SCALE } from './bandScale';

export { BAND_FLOOR, SPECTRUM_SCALE };

/**
 * The real spectrum for the echo, in place of the renderer's made-up `spec(u, tau)`.
 *
 * `u` runs 0 at the echo's centre to 1 at its edge, and maps to band `u * 31`, so the bass sits
 * in the centre as `spec()` puts its kick there and the treble at the edges; values between two
 * bands are interpolated. `age` is seconds before the newest history row (the line's place in
 * the 7 seconds the echo spreads across its lines), interpolated between rows; past the oldest
 * row it reads the oldest. The band level is lifted off `BAND_FLOOR` and scaled to `spec()`'s
 * range, 0 to `SPECTRUM_SCALE`. Nothing is allocated.
 */
export function sampleBands(u: number, age: number, h: BandHistory = bandHistory()): number {
  if (h.rows === 0 || h.head < 0) return 0;
  const x = (u > 0 ? (u < 1 ? u : 1) : 0) * (BAND_COUNT - 1);
  const b0 = Math.floor(x);
  const b1 = b0 < BAND_COUNT - 1 ? b0 + 1 : b0;
  const fb = x - b0;
  const r = (age > 0 ? age : 0) * HISTORY_HZ;
  const last = h.rows - 1;
  const r0 = Math.min(Math.floor(r), last);
  const r1 = Math.min(r0 + 1, last);
  const fr = r0 < last ? r - Math.floor(r) : 0;
  const row0 = ((h.head - r0 + HISTORY_ROWS) % HISTORY_ROWS) * BAND_COUNT;
  const row1 = ((h.head - r1 + HISTORY_ROWS) % HISTORY_ROWS) * BAND_COUNT;
  const d = h.data;
  const v0 = d[row0 + b0] + (d[row0 + b1] - d[row0 + b0]) * fb;
  const v1 = d[row1 + b0] + (d[row1 + b1] - d[row1 + b0]) * fb;
  const v = v0 + (v1 - v0) * fr;
  return v > BAND_FLOOR ? ((v - BAND_FLOOR) / (1 - BAND_FLOOR)) * SPECTRUM_SCALE : 0;
}

/**
 * The line heights the echo draws (`stepDance`, one history row at a time), in place of the made-up
 * `spec(u, tau)`: the same place (`u`, bass at the centre) and moment (`age`) mapping and row
 * interpolation as `sampleBands`, but a smoothstep between neighbouring bands, so a hit in one band
 * rises as a rounded hill rather than a tent. Heights are 0 to `DANCE_LIMIT` already (no floor to
 * lift off). Nothing is allocated.
 */
export function sampleDance(u: number, age: number, h: BandHistory = danceHistory()): number {
  if (h.rows === 0 || h.head < 0) return 0;
  const x = (u > 0 ? (u < 1 ? u : 1) : 0) * (BAND_COUNT - 1);
  const b0 = Math.floor(x);
  const b1 = b0 < BAND_COUNT - 1 ? b0 + 1 : b0;
  const t = x - b0;
  const fb = t * t * (3 - 2 * t);
  const r = (age > 0 ? age : 0) * HISTORY_HZ;
  const last = h.rows - 1;
  const r0 = Math.min(Math.floor(r), last);
  const r1 = Math.min(r0 + 1, last);
  const fr = r0 < last ? r - Math.floor(r) : 0;
  const row0 = ((h.head - r0 + HISTORY_ROWS) % HISTORY_ROWS) * BAND_COUNT;
  const row1 = ((h.head - r1 + HISTORY_ROWS) % HISTORY_ROWS) * BAND_COUNT;
  const d = h.data;
  const v0 = d[row0 + b0] + (d[row0 + b1] - d[row0 + b0]) * fb;
  const v1 = d[row1 + b0] + (d[row1 + b1] - d[row1 + b0]) * fb;
  return v0 + (v1 - v0) * fr;
}
