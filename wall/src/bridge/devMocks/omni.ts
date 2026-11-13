import { reviewNow } from '../../ui/reviewClock';
import { knob, longOr } from './long';
import { mocks } from '../tauri';

/**
 * Dev only: `?agents=` picks a helper state for review stills and the fit check:
 * `3` (default), `2`, `1`, `0`, `7` or `12` sessions from a helper 1.1.0 answer, `ask` (one
 * waiting, with a question), `ask2` (two waiting, one of them not on a card), `7ask` (seven sessions, the fifth waiting), `12ask` (twelve sessions, two waiting) and `12staleask` (the same, stale), `staleask` (one waiting, then the answer goes stale), `failed` (one failed), `old`
 * (three lanes as the older helper sends them), `stale`, `off` (not set up) and `down` (set
 * up, not answering).
 */
const agentsKnob = (): string => (typeof window !== 'undefined' ? (new URLSearchParams(window.location.search).get('agents') ?? '3') : '3');

/** Twelve invented sessions: title, long title, stage, state, line, next, minutes open. */
const POOL: [string, string, string, string, string, string | null, number][] = [
  ['Voice: iPhone mic fix', 'Voice mode: iPhone microphone permission fix and the dead mic fallback on older phones', 'build', 'working', 'Running web tests, 56 of 89', null, 42],
  ['Friday social card', 'Friday social card with the livestream recap and the new thumbnail set for every channel', 'build', 'working', 'Drawing four thumbnail options', null, 29],
  ['Admin pill polish', 'Admin Center pill polish, the amber ring and the singular labels on every card and list', 'pr', 'review', 'Checks passed. Ready when you are.', null, 120],
  ['Release notes draft', 'Release notes draft for the next public cut with screenshots and the upgrade section', 'plan', 'working', 'running', 'Outline the three headline changes', 8],
  ['Usage meter rework', 'Usage meter rework with one bar per subscription and the reset time in the hover card', 'review', 'review', 'idle', 'Answer the two review comments', 260],
  ['Calendar sync check', 'Calendar sync check across both accounts with the declined meeting filter kept intact', 'build', 'working', 'Comparing two calendar answers', null, 75],
  ['Docs tidy pass', 'Docs tidy pass over the setup guide, the command list and the troubleshooting table', 'live', 'review', 'Merged an hour ago', null, 410],
  ['Theme contrast audit', 'Theme contrast audit on every sky with the small text and the stage colours measured', 'build', 'working', 'idle', 'Measure the night sky values', 190],
  ['Backup script fix', 'Backup script fix for the weekly copy that skipped the newest folder after a rename', 'pr', 'review', 'Waiting on checks', null, 55],
  ['Weekly report', 'Weekly report with the hours, the open items and the three things that slipped', 'plan', 'working', 'running', 'Gather the numbers from the tracker', 14],
  ['Photo export batch', 'Photo export batch for the gallery page with smaller files and the right colour profile', 'build', 'working', 'Exporting 140 of 300', null, 33],
  ['Search index rebuild', 'Search index rebuild after the move, with the old links redirected and checked', 'review', 'review', 'idle', null, 600],
];

/**
 * The helper summary and the machine numbers, shaped exactly like the Rust commands'
 * answers (`wall2_omni_summary`, `wall2_open_session`, `wall2_machines`). Fictional data.
 * As the helper's answers: `question` is empty and picture options never arrive.
 */
export function registerOmniMocks(): void {
  mocks.set('wall2_omni_summary', () => {
    const AGENTS = agentsKnob();
    if (AGENTS === 'off') throw new Error('not-configured');
    if (AGENTS === 'down') throw new Error('failed');
    // Minutes from now (the review's moment in a review still, `?hz=&at=`).
    const now = reviewNow ? reviewNow() : Date.now();
    const iso = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();
    const id = (i: number) => `a1b2c3d4-${String(i + 1).padStart(4, '0')}`;
    const old = AGENTS === 'old';
    const count = { '0': 0, '1': 1, '2': 2, '7': 7, '7ask': 7, '12': 12, '12ask': 12, '12staleask': 12 }[AGENTS] ?? 3;
    const stale = AGENTS === 'stale' || AGENTS === 'staleask' || AGENTS === '12staleask';
    const waitOn = AGENTS === 'ask' || AGENTS === 'ask2' || AGENTS === 'staleask' || old ? [1] : AGENTS === '7ask' ? [4] : AGENTS === '12ask' || AGENTS === '12staleask' ? [1, 4] : [];
    const all = POOL.map(([title, long, stage, state, line, next, mins], i) => {
      const waiting = waitOn.includes(i);
      const failed = AGENTS === 'failed' && i === 0;
      const base = {
        id: id(i),
        // Rust caps titles and lines at 80 characters.
        title: longOr(title, long).slice(0, 80),
        stage,
        state: waiting ? 'blocked' : state,
        line: (waiting ? 'Waiting on a thumbnail choice' : failed ? 'Two web tests failed' : line).slice(0, 80),
        elapsedS: mins * 60,
        waiting,
        pr: i === 0 ? { number: 553, ci: failed ? 'failing' : 'pending', ready: false } : i === 2 ? { number: 561, ci: 'passing', ready: true } : i === 8 ? { number: 570, ci: 'pending', ready: true } : null,
      };
      if (old) return base;
      const idle = line === 'idle' || waiting;
      return {
        ...base,
        live: idle ? 'idle' : 'working',
        idleS: waiting ? 720 : null,
        kids: i === 0 ? { total: 3, working: 2 } : i === 5 ? { total: 1, working: 0 } : null,
        waitingSinceS: waiting ? 720 : null,
        next,
        harness: i % 4 === 3 ? 'codex' : 'claude',
        failed,
      };
    });
    const list = count === 1 ? [all[2]] : all.slice(0, count);
    const shown = old ? all.slice(0, 3) : list;
    // An earlier session that ended today, and (for `ask2`) a waiting one with no card.
    const ended = 'a1b2c3d4-0e0d';
    const extraWait = 'a1b2c3d4-0e0f';
    const waitIds = AGENTS === 'ask2' ? [id(1), extraWait] : waitOn.map(id);
    const firstWait = waitIds[0] ?? null;
    const day = [
      { lane: ended, start: iso(330), end: iso(280), kind: 'done' },
      { lane: id(0), start: iso(264), end: iso(194), kind: 'done' },
      { lane: id(1), start: iso(245), end: iso(140), kind: 'done' },
      { lane: id(2), start: iso(105), end: iso(9), kind: 'done' },
      { lane: id(0), start: iso(42), end: null, kind: 'run' },
      { lane: id(1), start: iso(29), end: iso(12), kind: 'run' },
      { lane: id(1), start: iso(12), end: null, kind: waitOn.includes(1) ? 'wait' : 'run' },
      { lane: id(2), start: iso(8), end: iso(2), kind: 'run' },
      ...shown.slice(3).map((l, k) => ({ lane: l.id, start: iso(150 - k * 12), end: l.waiting ? null : k % 2 ? iso(60 - k * 4) : null, kind: l.waiting ? 'wait' : 'run' })),
    ].filter((d) => d.lane === ended || shown.some((l) => l.id === d.lane) || old);
    const names: Record<string, { title: string; stage: string; state: string }> = {};
    for (const l of shown) names[l.id] = { title: l.title, stage: l.stage, state: l.state };
    names[ended] = { title: 'Morning inbox triage', stage: 'live', state: 'review' };
    if (AGENTS === 'ask2') names[extraWait] = { title: 'Invoice wording check', stage: 'plan', state: 'blocked' };
    const titleOf = (x: string | null) => (x ? (names[x]?.title ?? '') : '');
    const working = shown.filter((l) => l.state === 'working').length;
    const usage = old
      ? { claudeWeekPct: 62, claude5hPct: 18, weekResetsAt: iso(-3000) }
      : {
          claudeWeekPct: 94,
          claude5hPct: null,
          weekResetsAt: iso(-3000),
          accounts: [
            { provider: 'claude', label: 'Claude 1', weekPct: 41, fiveHourPct: 12, weekResetsAt: iso(-3000) },
            { provider: 'claude', label: 'Claude 2', weekPct: 94, fiveHourPct: null, weekResetsAt: iso(-1500) },
            { provider: 'codex', label: 'Codex', weekPct: stale ? null : 6, fiveHourPct: null, weekResetsAt: iso(-4000) },
          ],
        };
    const summary: Record<string, unknown> = {
      // The answer's own time is this page's clock (the wall treats a helper clock that has not
      // moved for 30 minutes as not reachable). `?clock=review` moves Date.now but not a bare
      // `new Date()`, so it is read from Date.now: then a review still's day spans line up.
      now: new Date(Date.now()).toISOString(),
      tz: 'America/Los_Angeles',
      stale,
      slots: old ? { used: 9, limit: 4 } : { used: shown.length + 4, limit: 4, sessions: shown.length, working, helpers: 4 },
      lanes: shown.slice(0, 3),
      parked: 4,
      yourMove: {
        total: waitIds.length,
        first: firstWait ? { sessionId: firstWait, title: titleOf(firstWait), kind: 'gate', since: iso(12), question: AGENTS === 'ask' ? 'Which of the four thumbnails goes on the Friday post?' : '' } : null,
        ...(old ? {} : { ids: waitIds }),
      },
      usage,
      // The concept's day, relative to now: done runs, a short wait, and the live runs.
      day,
      linksAvailable: true,
      system: { cpuPct: 61, ramPct: 48, gpuPct: null, tempC: 52, load1: 1.4, uptimeS: 864_000 },
    };
    if (!old) {
      summary.sessionsList = shown;
      summary.sessions = names;
    }
    return summary;
  });
  mocks.set('wall2_open_session', async (args) => {
    const id = String(args?.id ?? '');
    if (!/^[a-f0-9-]{8,64}$/.test(id)) throw new Error('Unknown session');
  });
  mocks.set('wall2_focus_omnigent', async (args) => {
    const id = args?.id;
    if (id != null && !/^[a-f0-9-]{8,64}$/.test(String(id))) throw new Error('Unknown session');
  });
  mocks.set('wall2_machines', () =>
    longOr(
      { pc: { cpuPct: 34, gpuPct: 71, ramPct: 58 }, box: knob('box') === 'none' ? null : { cpuPct: 61, gpuPct: null, ramPct: 48, tempC: 52 }, boxStale: false },
      { pc: { cpuPct: 100, gpuPct: 100, ramPct: 100 }, box: { cpuPct: 100, gpuPct: 100, ramPct: 100, tempC: 104 }, boxStale: false },
    ),
  );
}
