import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';

// Test helper only. Node is not in this project's types; this is the one part of it the tests use.
declare const process: { env: Record<string, string | undefined> };

/**
 * Run this test file on Pacific clocks, whatever the machine's zone, so the ribbon's local
 * hours and the horizon's sun (near Seattle) line up as on the wall. Each test file runs in
 * its own worker, so this never leaks into another file.
 */
export function usePacificTime(): void {
  // Set at once as well as before the tests, so anything read while the file loads is on
  // Pacific clocks too.
  const saved = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  beforeAll(() => {
    process.env.TZ = 'America/Los_Angeles';
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  });
}

/**
 * A fixed clock for a whole test file: fake timers set to `at` before each test, real
 * ones after. Ribbon and due-mark tests use this so no result depends on when they run.
 */
export function useFixedClock(at: number): void {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(at);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}
