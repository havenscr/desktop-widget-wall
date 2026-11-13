import { BAND_COUNT, HISTORY_HZ, HISTORY_ROWS, bandHistory, type BandHistory } from './store';

/**
 * Band level (0 to 1) that reads as nothing on the echo: about -52 dB. Below it a band adds
 * no height, so a quiet passage leaves the lines close to the range rather than lifting the
 * whole ridge. Tune on the strip with real music.
 */
export const BAND_FLOOR = 0.3;
/** The top of the made-up `spec()` the echo was drawn to, so real bands lift the lines as high. */
export const SPECTRUM_SCALE = 1.3;

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
