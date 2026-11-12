import type { Lane, OmniSummary } from './model';

/** Test helper only: a lane and a summary as the helper sends them, with overrides. */
export const lane = (over: Partial<Lane> = {}): Lane => ({
  id: 'a1b2c3d4-0001',
  title: 'Voice: iPhone mic fix',
  stage: 'build',
  state: 'working',
  line: 'Running web tests, 56 of 89',
  elapsedS: 2520,
  waiting: false,
  pr: null,
  ...over,
});

export const summary = (over: Partial<OmniSummary> = {}): OmniSummary => ({
  // The time of the answer: now, on whatever clock the test has set.
  now: new Date().toISOString(),
  tz: 'America/Los_Angeles',
  stale: false,
  slots: { used: 3, limit: 3 },
  lanes: [lane(), lane({ id: 'a1b2c3d4-0002', title: 'Friday social card' }), lane({ id: 'a1b2c3d4-0003', title: 'Admin pill polish' })],
  parked: 4,
  yourMove: { total: 0, first: null },
  usage: { claudeWeekPct: 62, claude5hPct: 18, weekResetsAt: null },
  day: [],
  linksAvailable: true,
  ...over,
});
