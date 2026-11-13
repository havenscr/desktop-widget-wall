/**
 * Dev only: `?long=1` swaps the mock strings for the longest ones the wall should cope with
 * (and every machine number at its maximum), so `scripts/fit-check.mjs` can check that each
 * Work wing still fits. Read when a mock answers, never at import time.
 */
export const longMocks = (): boolean => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('long');

/** `long` under `?long=1`, otherwise `normal`. */
export function longOr<T>(normal: T, long: T): T {
  return longMocks() ? long : normal;
}

/**
 * Dev only: a review knob from the address, for stills of states the default mocks never
 * show: `?meet=none` (no meetings today), `?box=none` (the box has no numbers),
 * `?net=alarms` (the home app sends only the alarm count, as it does today).
 */
export function knob(name: string): string | null {
  return typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get(name) : null;
}
