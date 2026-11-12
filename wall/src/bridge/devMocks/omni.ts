import { reviewNow } from '../../ui/reviewClock';
import { longOr } from './long';
import { mocks } from '../tauri';

/**
 * Dev only: `?agents=` picks a helper state for review stills and the fit check:
 * `3` (default), `2`, `1`, `0` lanes, `ask` (one lane waiting), `stale`, `off` (not set
 * up) and `down` (set up, not answering).
 */
const AGENTS = typeof window !== 'undefined' ? (new URLSearchParams(window.location.search).get('agents') ?? '3') : '3';

/**
 * The helper summary and the machine numbers, shaped exactly like the Rust commands'
 * answers (`wall2_omni_summary`, `wall2_open_session`, `wall2_machines`). Fictional data.
 * As the helper's v1 answers: `question` is empty and picture options never arrive.
 */
export function registerOmniMocks(): void {
  mocks.set('wall2_omni_summary', () => {
    if (AGENTS === 'off') throw new Error('not-configured');
    if (AGENTS === 'down') throw new Error('failed');
    // Minutes from now (the review's moment in a review still, `?hz=&at=`).
    const now = reviewNow ? reviewNow() : Date.now();
    const iso = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();
    const lanes = [
      {
        id: 'a1b2c3d4-0001',
        title: longOr('Voice: iPhone mic fix', 'Voice mode: iPhone microphone permission fix and the dead mic fallback on older phones'),
        stage: 'build',
        state: 'working',
        line: longOr('Running web tests, 56 of 89', 'Running the full web test suite in parallel shards, 56 of 89 finished, 2 retried'),
        elapsedS: 2520,
        waiting: false,
        pr: { number: 553, ci: 'pending', ready: false },
      },
      {
        id: 'a1b2c3d4-0002',
        title: longOr('Friday social card', 'Friday social card with the livestream recap and the new thumbnail set'),
        stage: 'build',
        state: AGENTS === 'ask' ? 'blocked' : 'working',
        line: AGENTS === 'ask' ? 'Waiting on a thumbnail choice' : longOr('Drawing four thumbnail options', 'Drawing four thumbnail options in the comic look for the Friday post'),
        elapsedS: 1740,
        waiting: AGENTS === 'ask',
        pr: null,
      },
      {
        id: 'a1b2c3d4-0003',
        title: longOr('Admin pill polish', 'Admin Center pill polish, the amber ring and the singular labels on every card'),
        stage: 'pr',
        state: 'review',
        line: longOr('Checks passed. Ready when you are.', 'Checks passed on every platform. Ready when you are, merge goes through the gate.'),
        elapsedS: 7200,
        waiting: false,
        pr: { number: 561, ci: 'passing', ready: true },
      },
    ];
    const count = AGENTS === '0' ? 0 : AGENTS === '1' ? 1 : AGENTS === '2' ? 2 : 3;
    // Rust caps titles and lines at 80 characters.
    const shown = (count === 1 ? [lanes[2]] : lanes.slice(0, count)).map((l) => ({ ...l, title: l.title.slice(0, 80), line: l.line.slice(0, 80) }));
    const asks = AGENTS === 'ask' ? 2 : 0;
    return {
      // The answer's own time is the real clock (the wall treats an answer over 30 minutes
      // old as not reachable); the lanes' day follows the review's moment.
      now: new Date().toISOString(),
      tz: 'America/Los_Angeles',
      stale: AGENTS === 'stale',
      slots: { used: shown.length, limit: 3 },
      lanes: shown,
      parked: 4,
      yourMove: {
        total: asks,
        first: asks ? { sessionId: 'a1b2c3d4-0002', title: 'Friday social card', kind: 'gate', since: iso(3), question: '' } : null,
      },
      usage: { claudeWeekPct: 62, claude5hPct: AGENTS === 'stale' ? null : 18, weekResetsAt: iso(-3000) },
      // The concept's day, relative to now: done runs, a short wait, and the three live runs.
      day: [
        { lane: 'a1b2c3d4-0001', start: iso(264), end: iso(194), kind: 'done' },
        { lane: 'a1b2c3d4-0002', start: iso(245), end: iso(140), kind: 'done' },
        { lane: 'a1b2c3d4-0003', start: iso(105), end: iso(9), kind: 'done' },
        { lane: 'a1b2c3d4-0001', start: iso(42), end: null, kind: 'run' },
        { lane: 'a1b2c3d4-0002', start: iso(29), end: iso(0.5), kind: 'run' },
        { lane: 'a1b2c3d4-0002', start: iso(0.5), end: null, kind: AGENTS === 'ask' ? 'wait' : 'run' },
        { lane: 'a1b2c3d4-0003', start: iso(8), end: iso(2), kind: 'run' },
      ],
      linksAvailable: true,
      system: { cpuPct: 61, ramPct: 48, gpuPct: null, tempC: 52, load1: 1.4, uptimeS: 864_000 },
    };
  });
  mocks.set('wall2_open_session', async (args) => {
    const id = String(args?.id ?? '');
    if (!/^[a-f0-9-]{8,64}$/.test(id)) throw new Error('Unknown session');
  });
  mocks.set('wall2_machines', () =>
    longOr(
      { pc: { cpuPct: 34, gpuPct: 71, ramPct: 58 }, box: { cpuPct: 61, gpuPct: null, ramPct: 48, tempC: 52 }, boxStale: false },
      { pc: { cpuPct: 100, gpuPct: 100, ramPct: 100 }, box: { cpuPct: 100, gpuPct: 100, ramPct: 100, tempC: 104 }, boxStale: false },
    ),
  );
}
