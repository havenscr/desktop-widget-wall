/**
 * Dev only: `?long=1` swaps the mock strings for the longest ones the wall should cope with
 * (and every machine number at its maximum), so `scripts/fit-check.mjs` can check that each
 * Work wing still fits.
 */
export const LONG_MOCKS = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('long');

/** `long` under `?long=1`, otherwise `normal`. */
export function longOr<T>(normal: T, long: T): T {
  return LONG_MOCKS ? long : normal;
}
