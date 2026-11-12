import { afterAll, beforeAll } from 'vitest';

// Test helper only. Node is not in this project's types; this is the one part of it the tests use.
declare const process: { env: Record<string, string | undefined> };

/**
 * Run this test file on Pacific clocks, whatever the machine's zone, so the ribbon's local
 * hours and the horizon's sun (near Seattle) line up as on the wall. Each test file runs in
 * its own worker, so this never leaks into another file.
 */
export function usePacificTime(): void {
  let saved: string | undefined;
  beforeAll(() => {
    saved = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  });
}
