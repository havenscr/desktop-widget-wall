import { longOr } from './long';
import { mocks } from '../tauri';

/**
 * The helper summary and the machine numbers, shaped exactly like the Rust commands'
 * answers (`wall2_omni_summary`, `wall2_open_session`, `wall2_machines`). Fictional data.
 */
export function registerOmniMocks(): void {
  mocks.set('wall2_omni_summary', () => {
    const now = Date.now();
    const iso = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();
    return {
      now: new Date(now).toISOString(),
      tz: 'America/Los_Angeles',
      stale: false,
      slots: { used: 3, limit: 3 },
      lanes: [
        {
          id: 'a1b2c3d4-0001',
          title: 'Voice: mic fix',
          stage: 'build',
          state: 'working',
          line: 'Running web tests, 56 of 89',
          elapsedS: 2520,
          waiting: false,
          pr: { number: 553, ci: 'pending', ready: false },
        },
        {
          id: 'a1b2c3d4-0002',
          title: 'Friday social card',
          stage: 'plan',
          state: 'blocked',
          line: 'Waiting on a thumbnail choice',
          elapsedS: 900,
          waiting: true,
          pr: null,
        },
        {
          id: 'a1b2c3d4-0003',
          title: 'Admin phone pass',
          stage: 'pr',
          state: 'review',
          line: 'Ready for review',
          elapsedS: 7200,
          waiting: false,
          pr: { number: 561, ci: 'passing', ready: true },
        },
      ],
      parked: 4,
      yourMove: {
        total: 1,
        first: {
          sessionId: 'a1b2c3d4-0002',
          title: 'Friday social card',
          kind: 'gate',
          since: iso(3),
          question: 'Which thumbnail for Friday?',
        },
      },
      usage: { claudeWeekPct: 62, claude5hPct: 18, weekResetsAt: iso(-3000) },
      day: [
        { lane: 'a1b2c3d4-0001', start: iso(240), end: null, kind: 'run' },
        { lane: 'a1b2c3d4-0002', start: iso(60), end: null, kind: 'wait' },
        { lane: 'a1b2c3d4-0003', start: iso(300), end: iso(120), kind: 'done' },
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
