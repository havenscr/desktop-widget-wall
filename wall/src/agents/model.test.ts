import { describe, expect, it } from 'vitest';
import {
  ageText,
  agentSegments,
  allFreeText,
  elapsedText,
  freeSlots,
  headerAsk,
  laneLine,
  laneTone,
  mergeReady,
  needsYouCount,
  prText,
  ringFraction,
  slotMeter,
  slotsText,
  slotsTip,
  statusLine,
  waitingIds,
  MAX_PIPS,
  cardLine,
  cardMeta,
  cards,
  countText,
  usageMeters,
  usageTip,
  normalizeSummary,
  agentLayout,
  AGENT_ROWS,
  sessionSpans,
  spanWords,
  dayTotals,
} from './model';
import { lane, summary } from './fixtures';

describe('lanes', () => {
  it('amber when blocked or waiting, mint when ready to merge or live, cyan otherwise', () => {
    expect(laneTone(lane())).toBe('cyan');
    expect(laneTone(lane({ state: 'blocked' }))).toBe('amber');
    expect(laneTone(lane({ waiting: true }))).toBe('amber');
    expect(laneTone(lane({ stage: 'pr', pr: { number: 5, ci: 'passing', ready: true } }))).toBe('mint');
    expect(laneTone(lane({ stage: 'live' }))).toBe('mint');
  });

  it('is ready to merge only with a ready PR and nothing failing or running', () => {
    const pr = (ci: 'passing' | 'failing' | 'pending' | 'none', ready = true) => lane({ stage: 'pr', pr: { number: 5, ci, ready } });
    expect(mergeReady(pr('passing'))).toBe(true);
    expect(mergeReady(pr('none'))).toBe(true);
    expect(mergeReady(pr('failing'))).toBe(false);
    expect(mergeReady(pr('pending'))).toBe(false);
    expect(mergeReady(pr('passing', false))).toBe(false);
    expect(mergeReady(lane({ stage: 'review', pr: { number: 5, ci: 'passing', ready: true } }))).toBe(false);
  });

  it('writes elapsed time as the concept does', () => {
    expect(elapsedText(2520)).toBe('42 min');
    expect(elapsedText(10)).toBe('1 min');
    expect(elapsedText(7200)).toBe('2 h');
    expect(elapsedText(7500)).toBe('2 h 5 m');
  });

  it('fills the ring by stage', () => {
    expect(ringFraction(lane({ stage: 'plan' }))).toBeLessThan(ringFraction(lane({ stage: 'build' })));
    expect(ringFraction(lane({ stage: 'live' }))).toBe(1);
  });

  it('uses a plain word when the helper sent no line', () => {
    expect(laneLine(lane({ line: '' }))).toBe('Working');
    expect(laneLine(lane({ line: '', waiting: true }))).toBe('Waiting for you');
    expect(laneLine(lane({ line: '', state: 'review' }))).toBe('In review');
  });

  it('describes the PR for a roomy lane', () => {
    expect(prText(lane())).toBe('');
    expect(prText(lane({ pr: { number: 553, ci: 'pending', ready: false } }))).toBe('PR 553, checks running, draft');
    expect(prText(lane({ pr: { number: 561, ci: 'passing', ready: true } }))).toBe('PR 561, checks passing');
  });
});

describe('header and slots', () => {
  it('shows the real slot numbers, even past the limit', () => {
    expect(slotsText(summary())).toBe('3 running, 3 slots');
    expect(slotsText(summary({ slots: { used: 9, limit: 4 } }))).toBe('9 running, 4 slots');
    expect(slotsText(summary({ slots: { used: 1, limit: 1 } }))).toBe('1 running, 1 slot');
    expect(slotsText(summary({ slots: { used: 8, limit: 4, sessions: 6, working: 4, helpers: 7 } }))).toBe('4 working, 6 open, 4 slots');
  });

  it('says Nothing needs you, or One thing for you with the title and how many more', () => {
    expect(headerAsk(summary())).toMatchObject({ text: 'Nothing needs you', title: null, id: null, more: null, tone: 'cyan' });
    // An older helper: the first entry names it.
    const one = summary({ yourMove: { total: 1, first: { sessionId: 'a1b2c3d4-0009', title: 'Invoice check', kind: 'gate', since: null, question: '' } } });
    expect(headerAsk(one)).toMatchObject({ text: 'One thing for you', title: 'Invoice check', id: 'a1b2c3d4-0009', more: null, canStep: false, tone: 'amber' });
    // Nothing to name or step through: a plain line, never an empty title.
    expect(headerAsk(summary({ yourMove: { total: 3, first: null } }))).toMatchObject({ text: 'Something needs you', title: null, id: null, more: '3 things in all', canStep: false });
    // More waiting than the five ids it can step through: "and more".
    const six = summary({ yourMove: { total: 8, first: null, ids: ['a1b2c3d4-00a1', 'a1b2c3d4-00a2', 'a1b2c3d4-00a3', 'a1b2c3d4-00a4', 'a1b2c3d4-00a5'] } });
    expect(headerAsk(six).more).toBe('then 4 more, and more');
    expect(headerAsk(six, 4).more).toBe('back to the first');
    // A waiting lane counts even when the your-move list has not caught up.
    const s = summary({ lanes: [lane({ waiting: true }), lane({ id: 'a1b2c3d4-0002', title: 'Second', state: 'blocked' })] });
    expect(needsYouCount(s)).toBe(2);
    expect(headerAsk(s)).toMatchObject({ text: 'One thing for you', title: 'Voice: iPhone mic fix', more: 'then 1 more', canStep: true, tone: 'amber' });
  });

  it('steps through the waiting ids, naming sessions with no card from the names map, and wraps', () => {
    const s = summary({
      yourMove: { total: 2, first: null, ids: ['a1b2c3d4-0002', 'a1b2c3d4-00ff'] },
      sessions: { 'a1b2c3d4-00ff': { title: 'Not on a card', stage: 'plan', state: 'blocked' } },
    });
    expect(waitingIds(s)).toEqual(['a1b2c3d4-0002', 'a1b2c3d4-00ff']);
    expect(headerAsk(s, 0)).toMatchObject({ text: 'One thing for you', title: 'Friday social card', id: 'a1b2c3d4-0002', more: 'then 1 more' });
    expect(headerAsk(s, 1)).toMatchObject({ text: 'Also for you', title: 'Not on a card', id: 'a1b2c3d4-00ff', more: 'back to the first' });
    expect(headerAsk(s, 2)).toMatchObject({ id: 'a1b2c3d4-0002' });
    // An id nothing names is still a session.
    expect(headerAsk(summary({ yourMove: { total: 1, first: null, ids: ['a1b2c3d4-0abc'] } })).title).toBe('a session');
  });

  it('draws the slot meter with a pip per slot and the overflow past the last', () => {
    expect(slotMeter(summary({ slots: { used: 8, limit: 4, sessions: 6, working: 2, helpers: 3 } }))).toEqual({ pips: [true, true, false, false], over: 0 });
    expect(slotMeter(summary({ slots: { used: 8, limit: 4, sessions: 9, working: 7, helpers: 3 } }))).toEqual({ pips: [true, true, true, true], over: 3 });
    // An older helper fills by used slots.
    expect(slotMeter(summary({ slots: { used: 9, limit: 4 } })).over).toBe(5);
    expect(slotMeter(summary({ slots: { used: 1, limit: 20 } })).pips).toHaveLength(MAX_PIPS);
    expect(slotsTip(summary({ slots: { used: 8, limit: 4, sessions: 6, working: 4, helpers: 7 } }))).toBe(
      '4 working, 6 open, 7 helpers, 4 slots on the server (more may run than there are slots). Click to bring OmniGent forward.',
    );
  });

  it('counts free rows up to three, inside the limit', () => {
    expect(freeSlots(summary())).toBe(0);
    expect(freeSlots(summary({ lanes: [lane()] }))).toBe(2);
    expect(freeSlots(summary({ lanes: [] }))).toBe(3);
    expect(freeSlots(summary({ lanes: [lane()], slots: { used: 1, limit: 2 } }))).toBe(1);
    expect(freeSlots(summary({ slots: { used: 5, limit: 4 } }))).toBe(0);
    expect(allFreeText(summary({ lanes: [] }))).toBe('All three slots free');
    expect(allFreeText(summary({ lanes: [], slots: { used: 0, limit: 4 } }))).toBe('All slots free');
  });

  it('dates a stale answer by the last fresh one', () => {
    const t = Date.parse('2026-11-11T18:24:00Z');
    expect(ageText(t - 4 * 60_000, t)).toBe('updated 4 min ago');
    expect(ageText(t - 10_000, t)).toBe('updated 1 min ago');
    expect(ageText(null, t)).toBe('may be out of date');
  });
});

describe('status line', () => {
  it('says how many are working and whether anything needs you', () => {
    expect(statusLine(summary())).toBe('Three agents still working, nothing needs you');
    expect(statusLine(summary({ lanes: [lane(), lane({ waiting: true })] }))).toBe('One agent still working, one thing for you');
    expect(statusLine(summary({ lanes: [], yourMove: { total: 2, first: null } }))).toBe('No agents working, two things for you');
    expect(statusLine(summary({ lanes: [lane({ state: 'review' })] }))).toBe('No agents working, nothing needs you');
  });
});

describe('ribbon segments', () => {
  const now = Date.parse('2026-11-11T18:24:00Z');
  const at = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();
  // One pixel a minute from now - 600, so x is easy to read.
  const hourAt = (ms: number) => (ms - (now - 600 * 60_000)) / 60_000;

  it('draws run, wait, past and done spans on rows by lane, up to now', () => {
    const s = summary({
      lanes: [lane({ id: 'a1b2c3d4-0001' }), lane({ id: 'a1b2c3d4-0002' })],
      day: [
        { lane: 'a1b2c3d4-0002', start: at(100), end: at(40), kind: 'done' },
        { lane: 'a1b2c3d4-0001', start: at(30), end: null, kind: 'run' },
        { lane: 'a1b2c3d4-0002', start: at(20), end: null, kind: 'wait' },
        { lane: 'a1b2c3d4-0009', start: at(300), end: at(200), kind: 'run' },
        { lane: 'a1b2c3d4-0001', start: at(-10), end: null, kind: 'run' },
      ],
    });
    const segs = agentSegments(s, now, hourAt);
    expect(segs.map((g) => [g.row, g.kind, g.x, g.width])).toEqual([
      [2, 'past', 300, 100],
      [1, 'done', 500, 60],
      [0, 'run', 570, 30],
      [1, 'wait', 580, 20],
    ]);
  });

  it('skips spans the ribbon cannot place and keeps a tiny span visible', () => {
    const s = summary({ lanes: [], day: [{ lane: 'a1b2c3d4-0001', start: at(1), end: at(0.5), kind: 'run' }, { lane: 'a1b2c3d4-0001', start: 'nope', end: null, kind: 'run' }] });
    expect(agentSegments(s, now, hourAt).map((g) => g.width)).toEqual([5]);
    expect(agentSegments(s, now, () => null)).toEqual([]);
  });
});

describe('cards from a newer helper', () => {
  it('shows the full session list when the helper sends one, else the lanes', () => {
    const list = [lane({ id: 'a1b2c3d4-0011' }), lane({ id: 'a1b2c3d4-0012' }), lane({ id: 'a1b2c3d4-0013' }), lane({ id: 'a1b2c3d4-0014' })];
    expect(cards(summary({ sessionsList: list })).map((l) => l.id)).toEqual(list.map((l) => l.id));
    expect(cards(summary()).map((l) => l.id)).toEqual(summary().lanes.map((l) => l.id));
    expect(countText(7)).toBe('3 of 7');
    expect(countText(3)).toBeNull();
  });

  it('says the most useful thing first on the second line', () => {
    expect(cardLine(lane({ waiting: true, waitingSinceS: 720, line: 'Waiting on a thumbnail choice' }))).toEqual({ text: 'Waiting on you for 12 min: a thumbnail choice', tone: 'amber' });
    expect(cardLine(lane({ state: 'blocked', line: 'idle' }))).toEqual({ text: 'Waiting on you', tone: 'amber' });
    expect(cardLine(lane({ waiting: true, waitingSinceS: 300, line: 'Waiting on you' })).text).toBe('Waiting on you for 5 min');
    expect(cardLine(lane({ waiting: true, line: 'waiting for you to pick a thumbnail' })).text).toBe('Waiting on you');
    expect(cardLine(lane({ failed: true, line: 'running' }))).toEqual({ text: 'Failed, needs a look', tone: 'red' });
    expect(cardLine(lane({ live: 'working', line: 'Running web tests' })).text).toBe('Running web tests');
    expect(cardLine(lane({ live: 'idle', line: 'idle', next: 'Answer two comments' })).text).toBe('Next: Answer two comments');
    expect(cardLine(lane({ live: 'working', line: 'running' })).text).toBe('Working now');
    expect(cardLine(lane({ live: 'idle', line: 'idle', idleS: 300 })).text).toBe('Idle for 5 min');
    expect(cardLine(lane({ live: 'idle', line: 'idle' })).text).toBe('Idle');
    // An older helper: the line as today.
    expect(cardLine(lane({ line: '' })).text).toBe('Working');
  });

  it('lists helpers, the assistant and the PR quietly', () => {
    expect(cardMeta(lane({ kids: { total: 3, working: 2 }, harness: 'codex', pr: { number: 7, ci: 'passing', ready: true } }))).toEqual([
      '3 helpers, 2 working',
      'Codex',
      'PR 7, checks passing',
    ]);
    expect(cardMeta(lane({ kids: { total: 1, working: 0 } }))).toEqual(['1 helper, none working']);
    expect(cardMeta(lane())).toEqual([]);
  });

  it('checks the new fields and keeps an old answer as it was', () => {
    const raw = {
      ...summary(),
      slots: { used: 8, limit: 4, sessions: 'x', working: 2, helpers: -1 },
      sessionsList: [{ ...lane({ id: 'a1b2c3d4-0021' }), kids: { total: 2, working: 5 }, harness: 'gpt', live: 'busy', failed: 'yes', next: '  ' }, { id: 5 }],
      sessions: { 'a1b2c3d4-0022': { title: 'Named', stage: 'nope', state: 'blocked' }, bad: { stage: 'plan' } },
      yourMove: { total: 1, first: null, ids: ['a1b2c3d4-0022', 7] },
      usage: { claudeWeekPct: null, claude5hPct: null, weekResetsAt: null, accounts: [{ provider: 'claude', label: 'Claude 1', weekPct: 140, fiveHourPct: null, weekResetsAt: null }, { provider: 'x', label: 'Bad' }] },
    };
    const s = normalizeSummary(raw)!;
    expect(s.slots).toEqual({ used: 8, limit: 4, sessions: null, working: 2, helpers: null });
    expect(s.sessionsList).toHaveLength(1);
    expect(s.sessionsList![0]).toMatchObject({ kids: { total: 2, working: 2 }, harness: null, live: null, failed: false, next: null });
    expect(s.sessions).toEqual({ 'a1b2c3d4-0022': { title: 'Named', stage: null, state: 'blocked' } });
    expect(s.yourMove.ids).toEqual(['a1b2c3d4-0022']);
    expect(s.usage!.accounts).toEqual([{ provider: 'claude', label: 'Claude 1', weekPct: 100, fiveHourPct: null, weekResetsAt: null }]);
    const old = normalizeSummary(summary())!;
    expect(old.sessionsList).toBeNull();
    expect(old.sessions).toEqual({});
    expect(old.usage).toMatchObject({ claudeWeekPct: 62, claude5hPct: 18, accounts: [] });
  });

  it('gives one meter per subscription, the fullest above 90 in amber, or the old single meter', () => {
    const m = usageMeters({
      claudeWeekPct: 94,
      claude5hPct: null,
      weekResetsAt: null,
      accounts: [
        { provider: 'claude', label: 'Claude 1', weekPct: 41, fiveHourPct: 12, weekResetsAt: null },
        { provider: 'claude', label: 'Claude 2', weekPct: 94, fiveHourPct: null, weekResetsAt: null },
        { provider: 'codex', label: 'Codex', weekPct: null, fiveHourPct: null, weekResetsAt: null },
      ],
    });
    expect(m.map((x) => [x.label, x.pct, x.warn])).toEqual([
      ['Claude 1', 41, false],
      ['Claude 2', 94, true],
      ['Codex', null, false],
    ]);
    expect(usageTip(m[2])).toBe('Codex: no recent weekly reading');
    expect(usageTip(m[0])).toBe('Claude 1: 41% of this week used, 12% of the five hour window');
    expect(usageMeters({ claudeWeekPct: 62, claude5hPct: 18, weekResetsAt: null })).toEqual([{ label: 'Claude this week', pct: 62, fiveHour: 18, resets: null, warn: false, hotHidden: false }]);
    // Three meters hide the five hour figure: a hot one there is a small mark, never amber on a calm week figure.
    const hot = usageMeters({
      claudeWeekPct: 30,
      claude5hPct: null,
      weekResetsAt: null,
      accounts: [
        { provider: 'claude', label: 'Claude 1', weekPct: 30, fiveHourPct: 97, weekResetsAt: null },
        { provider: 'claude', label: 'Claude 2', weekPct: 20, fiveHourPct: null, weekResetsAt: null },
        { provider: 'codex', label: 'Codex', weekPct: 10, fiveHourPct: null, weekResetsAt: null },
      ],
    });
    expect(hot.map((x) => [x.warn, x.hotHidden])).toEqual([[false, true], [false, false], [false, false]]);
    // With two meters the five hour figure shows, so it may be the amber one.
    const two = usageMeters({ claudeWeekPct: 30, claude5hPct: null, weekResetsAt: null, accounts: [{ provider: 'claude', label: 'Claude 1', weekPct: 30, fiveHourPct: 97, weekResetsAt: null }] });
    expect(two.map((x) => [x.warn, x.hotHidden])).toEqual([[true, false]]);
    expect(usageMeters({ claudeWeekPct: 80, claude5hPct: null, weekResetsAt: null, accounts: [{ provider: 'codex', label: 'Codex', weekPct: 80, fiveHourPct: null, weekResetsAt: null }] })[0].warn).toBe(false);
    expect(usageMeters(null)).toEqual([]);
  });
});

describe('agent row sub-rows', () => {
  const rowsFor = (n: number) => {
    const t = (h: number, m: number) => new Date(2026, 10, 11, h, m).toISOString();
    const ids = Array.from({ length: n }, (_, i) => `a1b2c3d4-00${String(i).padStart(2, '0')}`);
    const s = summary({
      lanes: ids.slice(0, 3).map((id) => lane({ id })),
      sessionsList: ids.map((id) => lane({ id })),
      day: ids.map((id, i) => ({ lane: id, start: t(7 + Math.floor(i / 2), (i % 2) * 30), end: t(8 + i, 0), kind: 'run' as const })),
    });
    return { ids, l: agentLayout(s, new Date(2026, 10, 11, 23).getTime(), (ms) => ms / 1e9) };
  };

  it('three sessions: each its own 8 px row, nothing folded', () => {
    const { ids, l } = rowsFor(3);
    expect(AGENT_ROWS).toBe(3);
    expect(l.rows).toBe(3);
    expect(l.moreRow).toBeNull();
    expect(l.hidden).toEqual([]);
    expect(ids.map((id) => l.segs.find((g) => g.lane === id)!.row)).toEqual([0, 1, 2]);
  });

  it('eight and twelve sessions: two rows in card order, the rest folded into "+N more", never sharing a row', () => {
    for (const n of [8, 12]) {
      const { ids, l } = rowsFor(n);
      expect(l.rows).toBe(3);
      expect(l.moreRow).toBe(2);
      expect(l.hidden).toEqual(ids.slice(2));
      expect(new Set(l.segs.map((g) => g.lane))).toEqual(new Set(ids.slice(0, 2)));
      const byRow = new Map<number, Set<string>>();
      for (const g of l.segs) byRow.set(g.row, (byRow.get(g.row) ?? new Set<string>()).add(g.lane));
      for (const lanes of byRow.values()) expect(lanes.size).toBe(1);
      expect(Math.max(...l.segs.map((g) => g.row))).toBeLessThan(2);
    }
  });

  it('a card with no span today takes no row', () => {
    const t = (h: number) => new Date(2026, 10, 11, h).toISOString();
    const s = summary({
      sessionsList: [lane({ id: 'a1b2c3d4-0001' }), lane({ id: 'a1b2c3d4-0002' })],
      day: [{ lane: 'a1b2c3d4-0002', start: t(8), end: t(9), kind: 'run' }],
    });
    expect(agentLayout(s, new Date(2026, 10, 11, 20).getTime(), (ms) => ms / 1e9).segs.map((g) => g.row)).toEqual([0]);
  });

  it('writes spans in plain words', () => {
    const at = (h: number, m = 0) => new Date(2026, 10, 11, h, m).getTime();
    expect(spanWords({ kind: 'run', start: at(14, 10), end: at(15, 40), open: false })).toBe('working 2:10 to 3:40');
    expect(spanWords({ kind: 'wait', start: at(15, 40), end: at(16), open: true })).toBe('waiting on you since 3:40');
    expect(spanWords({ kind: 'done', start: at(9), end: at(10), open: false })).toBe('in review 9:00 to 10:00');
    const g = (k: number) => ({ key: String(k), lane: 'x', row: 0, x: 0, width: 5, kind: 'run' as const, start: at(8 + k), end: at(8 + k, 30), open: false });
    expect(sessionSpans([g(0), g(1), g(2), g(3), g(4)], 'x')).toBe('1 earlier, then working 9:00 to 9:30, working 10:00 to 10:30, working 11:00 to 11:30, working 12:00 to 12:30');
  });
});

it('sums the day for the agent row icon', () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 11, h, m).getTime();
  const g = (lane: string, kind: 'run' | 'wait' | 'past' | 'done', a: number, b: number) => ({ key: lane + a, lane, row: 0, x: 0, width: 5, kind, start: a, end: b, open: false });
  expect(dayTotals([g('a', 'past', at(9), at(10, 30)), g('b', 'run', at(10), at(11)), g('a', 'wait', at(10, 30), at(10, 50)), g('c', 'done', at(8), at(9))])).toBe(
    'Today: 2 h 30 m of agent work across 3 sessions, 20 min waiting on you',
  );
  expect(dayTotals([g('a', 'done', at(8), at(9))])).toBe('Today: no time of agent work across 1 session, no waiting on you');
});
