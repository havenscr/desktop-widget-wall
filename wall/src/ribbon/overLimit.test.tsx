import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { lane, summary } from '../agents/fixtures';
import { resetAgents } from '../agents/useAgents';
import { mocks } from '../bridge/tauri';
import { useFocusStore } from '../focus/store';
import { HoverTipLayer, TIP_DELAY_MS } from '../ui/HoverTip';
import { resetDays, type DayRecord } from './days';
import { RX } from './model';
import { openList, overLine, overStretches, overSince } from './overLimit';
import { Ribbon } from './Ribbon';
import { useFixedClock, usePacificTime } from './testZone';

usePacificTime();

const t = (hm: string) => Date.parse(`2026-11-11T${hm}:00-08:00`);
useFixedClock(t('16:30'));
const iso = (hm: string) => new Date(t(hm)).toISOString();
const MIN = 60_000;

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

/** Sessions opened this many minutes ago; the ones named in `idle` sit idle (in review), the rest work. */
const ids = (n: number) => Array.from({ length: n }, (_, i) => `a1b2c3d4-${String(i + 1).padStart(4, '0')}`);
const opened = [410, 260, 120, 75, 42, 29, 8];
const mk = (n: number, idle: number[] = [], extra: Record<number, object> = {}) =>
  ids(n).map((id, i) =>
    lane({ id, title: `Session ${i + 1}`, elapsedS: opened[i] * 60, ...(idle.includes(i) ? { state: 'review', live: 'idle', idleS: opened[i] * 40 } : {}), ...extra[i] }),
  );
const run = (n: number) => ids(n).map((id) => ({ lane: id, start: iso('15:50'), end: null, kind: 'run' as const }));

let answer: () => unknown;
beforeEach(() => {
  resetAgents();
  resetDays();
  mocks.set('wall2_meet_day', () => ({ accounts: [], events: [] }));
  mocks.set('wall2_omni_summary', () => answer());
});
afterEach(() => {
  resetAgents();
  resetDays();
  mocks.clear();
  useFocusStore.setState({ sessions: [] });
});

const withTip = (_n: number) => (
  <>
    <Ribbon kind="work" />
    <HoverTipLayer />
  </>
);

it('over the limit: the line starts with a red "7 of 4 open" marker and the strip carries a red line from when the limit was passed', async () => {
  answer = () => summary({ slots: { used: 7, limit: 4 }, sessionsList: mk(7, [0, 1, 2, 3]), day: run(7) });
  const r = render(withTip(7));
  await flush();
  const line = r.container.querySelector('.ag-line') as HTMLElement;
  expect(line.querySelector('.x-over')!.textContent).toBe('7 of 4 open');
  expect(line.textContent).toBe('7 of 4 open3 working, 4 idle');
  // The fifth session opened 42 minutes ago: the red line runs from 15:48 to the needle.
  const rail = r.container.querySelector('.agent-row .x-rail') as HTMLElement;
  expect(parseFloat(rail.style.left)).toBeCloseTo(RX(15.8), 3);
  expect(parseFloat(rail.style.left) + parseFloat(rail.style.width)).toBeCloseTo(RX(16.5), 3);
  // The cells keep their meaning: none is a count of open sessions.
  expect(r.container.querySelectorAll('.agent-row .ac').length).toBeGreaterThan(0);
});

it('at the limit and under it: no marker, no red line', async () => {
  answer = () => summary({ slots: { used: 4, limit: 4 }, sessionsList: mk(4, [1]), day: run(4) });
  const r = render(withTip(4));
  await flush();
  expect(r.container.querySelector('.ag-line .x-over')).toBeNull();
  expect(r.container.querySelector('.agent-row .x-rail')).toBeNull();
  expect(r.container.querySelector('.ag-line')!.textContent).toBe('4 sessions: 3 working, 1 idle');
});

it('no known limit: no marker and no red line however many are open', async () => {
  answer = () => summary({ slots: { used: 7, limit: 0 }, sessionsList: mk(7), day: run(7) });
  const r = render(withTip(7));
  await flush();
  expect(r.container.querySelector('.ag-line .x-over')).toBeNull();
  expect(r.container.querySelector('.agent-row .x-rail')).toBeNull();
});

it('the hover card names the idle sessions with how long each has been idle, then the working ones, then since when', async () => {
  answer = () => summary({ slots: { used: 7, limit: 4 }, sessionsList: mk(7, [0, 1, 2, 3]), day: run(7) });
  const r = render(withTip(7));
  await flush();
  fireEvent.mouseEnter(r.container.querySelector('.ag-line') as HTMLElement);
  await flush(TIP_DELAY_MS + 10);
  const card = r.container.querySelector('.hover-tip')!;
  const text = card.textContent!;
  expect(text).toContain('7 sessions open, 3 over your limit of 4');
  expect(text).toContain('IDLE (4)');
  expect(text).toContain('WORKING (3)');
  expect(text).toContain('Over the limit since 3:48 PM');
  // Longest idle first, with the time.
  const idle = [...card.querySelectorAll('.tip-row')].slice(0, 4).map((x) => x.textContent);
  expect(idle).toEqual(['Session 1idle 4 h 33 m', 'Session 2idle 2 h 53 m', 'Session 3idle 1 h 20 m', 'Session 4idle 50 m']);
  expect(text.indexOf('IDLE')).toBeLessThan(text.indexOf('WORKING'));
  expect(text.indexOf('WORKING')).toBeLessThan(text.indexOf('Over the limit since'));
});

it('under the limit the card still names the idle sessions, with no limit words', async () => {
  answer = () => summary({ slots: { used: 3, limit: 4 }, sessionsList: mk(3, [0]), day: run(3) });
  const r = render(withTip(3));
  await flush();
  fireEvent.mouseEnter(r.container.querySelector('.ag-line') as HTMLElement);
  await flush(TIP_DELAY_MS + 10);
  const text = r.container.querySelector('.hover-tip')!.textContent!;
  expect(text).toContain('3 sessions open');
  expect(text).toContain('IDLE (1)');
  expect(text).toContain('Session 1');
  expect(text).not.toContain('over your limit');
  expect(text).not.toContain('Over the limit since');
});

it('a child or a side chat is never listed, counted or marked: only the cards are', async () => {
  const kids = { total: 2, working: 2, running: 2, ids: ['child-must-not-render'] } as never;
  answer = () =>
    summary({
      slots: { used: 9, limit: 4 },
      sessionsList: mk(5, [], { 0: { kids } }),
      sessions: { 'child-must-not-render': { title: 'Child must not render', stage: 'build', state: 'working' }, 'side-chat-must-not-render': { title: 'Side chat must not render', stage: null, state: null } },
      day: [...run(5), { lane: 'child-must-not-render', start: iso('15:00'), end: null, kind: 'run' }, { lane: 'side-chat-must-not-render', start: iso('15:00'), end: null, kind: 'run' }],
    });
  const r = render(withTip(5));
  await flush();
  // 5 cards over a limit of 4: the marker says 5, not 7.
  expect(r.container.querySelector('.x-over')!.textContent).toBe('5 of 4 open');
  fireEvent.mouseEnter(r.container.querySelector('.ag-line') as HTMLElement);
  await flush(TIP_DELAY_MS + 10);
  const html = r.container.innerHTML;
  expect(html).not.toContain('must not render');
  expect(r.container.querySelector('.hover-tip')!.textContent).toContain('5 sessions open, 1 over your limit of 4');
});

it('the card names eight sessions at most and counts the rest, in the order it shows: idle, working, then waiting', async () => {
  const many = ids(12).map((id, i) => lane({ id, title: `Session ${i + 1}`, elapsedS: (100 + i) * 60, ...(i === 11 ? { waiting: true, state: 'blocked' as const } : {}) }));
  answer = () => summary({ slots: { used: 12, limit: 4 }, sessionsList: many, day: run(12) });
  const r = render(withTip(12));
  await flush();
  fireEvent.mouseEnter(r.container.querySelector('.ag-line') as HTMLElement);
  await flush(TIP_DELAY_MS + 10);
  const card = r.container.querySelector('.hover-tip')!;
  expect(card.querySelectorAll('.tip-row')).toHaveLength(8);
  // Eight places go to the working ones first; the waiting one has no name and no heading.
  expect(card.textContent).not.toContain('NEEDS YOU');
  expect(card.textContent).toContain('and 4 more');
});

it('eight waiting plus four idle: all four idle names come first, and no heading shows with no name under it', async () => {
  const sess = ids(12).map((id, i) =>
    i < 4 ? lane({ id, title: `Idle ${i + 1}`, state: 'review', live: 'idle', idleS: (i + 1) * 600 }) : lane({ id, title: `Waiting ${i - 3}`, waiting: true, state: 'blocked', waitingSinceS: 300 + i }),
  );
  answer = () => summary({ slots: { used: 12, limit: 4 }, sessionsList: sess, day: run(12) });
  const r = render(withTip(12));
  await flush();
  fireEvent.mouseEnter(r.container.querySelector('.ag-line') as HTMLElement);
  await flush(TIP_DELAY_MS + 10);
  const card = r.container.querySelector('.hover-tip')!;
  const names = [...card.querySelectorAll('.tip-row .x-t')].map((n) => n.textContent);
  expect(names.slice(0, 4)).toEqual(['Idle 4', 'Idle 3', 'Idle 2', 'Idle 1']);
  expect(names).toHaveLength(8);
  expect(names.slice(4).every((n) => n!.startsWith('Waiting'))).toBe(true);
  expect(card.textContent).toContain('and 4 more');
});

it('the start does not move after a failed poll: the same summary at two wall times gives the same start', async () => {
  const good = summary({ slots: { used: 7, limit: 4 }, sessionsList: mk(7, [0, 1, 2, 3]), day: run(7) });
  let fail = false;
  answer = () => {
    if (fail) throw new Error('no answer');
    return good;
  };
  const r = render(withTip(7));
  await flush();
  const rail = () => r.container.querySelector('.agent-row .x-rail') as HTMLElement;
  const left0 = parseFloat(rail().style.left);
  fail = true;
  // Two minutes of wall time with no answer: the render clock moves, the start of the red line does not.
  await flush(120_000);
  expect(rail()).not.toBeNull();
  expect(parseFloat(rail().style.left)).toBeCloseTo(left0, 6);
  fireEvent.mouseEnter(r.container.querySelector('.ag-line') as HTMLElement);
  await flush(TIP_DELAY_MS + 10);
  expect(r.container.querySelector('.hover-tip')!.textContent).toContain('Over the limit since 3:48 PM');
});

it('overLine and openList read their start from the answer time given, not a render clock', () => {
  const at = t('16:30');
  const s = summary({ slots: { used: 7, limit: 4 }, sessionsList: mk(7) });
  expect(overLine(s, null, 4, at, at + 5 * MIN)[0].from).toBe(at - 42 * MIN);
  expect(overLine(s, null, 4, at, at + 9 * MIN)[0].from).toBe(at - 42 * MIN);
  expect(openList(s, 4, at, new Map(), null, at + 9 * MIN).since).toBe(at - 42 * MIN);
});

it('churn while the count stays over the limit does not reset the start', () => {
  // Limit 4: A to E open (5) at 10:00, F opens at 10:30, A closes at 11:00; the count never fell to 4.
  const now = t('12:00');
  const open = (id: string, title: string, from: string) => lane({ id, title, elapsedS: (now - t(from)) / 1000 });
  const s = summary({
    slots: { used: 5, limit: 4 },
    sessionsList: [open('b', 'B', '10:00'), open('c', 'C', '10:00'), open('d', 'D', '10:00'), open('e', 'E', '10:00'), open('f', 'F', '10:30')],
  });
  const rec: DayRecord = {
    date: '2026-11-11',
    tz: 'America/Los_Angeles',
    sessions: [{ id: 'a', title: 'A', spans: [{ stage: 'build', start: iso('10:00'), end: iso('11:00') }], pr: null }],
  };
  expect(overLine(s, rec, 4, now, now)).toEqual([{ from: t('10:00'), to: now }]);
  expect(openList(s, 4, now, new Map(), rec, now).since).toBe(t('10:00'));
  // With no record of A the fifth-oldest open card is all that is known.
  expect(overLine(s, null, 4, now, now)).toEqual([{ from: t('10:30'), to: now }]);
});

it('a past stretch that ended before the ribbon first hour draws no tick', async () => {
  const closed = ['b1', 'b2', 'b3', 'b4', 'b5'].map((id, k) => ({
    id: `closed-${id}`,
    title: `Closed ${k}`,
    spans: [{ stage: 'build' as const, start: iso('04:00'), end: new Date(t('05:00') + k * 5 * MIN).toISOString() }],
    pr: null,
  }));
  mocks.set('wall2_omni_day', () => ({ date: '2026-11-11', tz: 'America/Los_Angeles', sessions: closed }));
  mocks.set('wall2_omni_days', () => [{ date: '2026-11-11', sessions: 8 }]);
  answer = () => summary({ slots: { used: 3, limit: 4 }, sessionsList: mk(3), day: run(3) });
  const r = render(withTip(3));
  await flush();
  await flush(50);
  expect(r.container.querySelectorAll('.agent-row .x-rail')).toHaveLength(0);
});

it('a long title is cut inside the card, not widening it', async () => {
  const longTitle = 'Docs tidy pass over the setup guide, the command list and the troubleshooting table of every page';
  answer = () => summary({ slots: { used: 5, limit: 4 }, sessionsList: mk(5, [0], { 0: { title: longTitle } }), day: run(5) });
  const r = render(withTip(5));
  await flush();
  fireEvent.mouseEnter(r.container.querySelector('.ag-line') as HTMLElement);
  await flush(TIP_DELAY_MS + 10);
  expect(r.container.querySelector('.hover-tip .ag-card .x-t')!.textContent).toBe(longTitle);
});

// The pure rules.
it('overSince: the moment the open count passed the limit, from when each open session opened', () => {
  const now = t('16:30');
  const s = summary({ slots: { used: 7, limit: 4 }, sessionsList: mk(7) });
  expect(overSince(s, 4, now)).toBe(now - 42 * MIN);
  expect(overSince(s, 7, now)).toBeNull();
  expect(overSince(s, null, now)).toBeNull();
});

it('overStretches: where more than the limit were open, ending when the count drops back', () => {
  const sp = [
    { start: 0, end: 100 * MIN },
    { start: 10 * MIN, end: 40 * MIN },
    { start: 20 * MIN, end: 50 * MIN },
    { start: 30 * MIN, end: null },
  ];
  // Limit 2: three open from minute 20, four from 30, three after 40, back to two at 50.
  expect(overStretches(sp, 2, 200 * MIN)).toEqual([{ from: 20 * MIN, to: 50 * MIN }]);
  // Limit 1: over from minute 10 until only the open one is left at 100.
  expect(overStretches(sp, 1, 200 * MIN)).toEqual([{ from: 10 * MIN, to: 100 * MIN }]);
  // A stretch under two minutes is not drawn.
  expect(overStretches([{ start: 0, end: 10 * MIN }, { start: 0, end: 10 * MIN }, { start: 9 * MIN + 30_000, end: 10 * MIN }], 2, 20 * MIN)).toEqual([]);
});

it('back under after being over: the earlier stretch is drawn and there is no marker', async () => {
  const closed = ['b1', 'b2', 'b3', 'b4', 'b5'].map((id, k) => ({
    id: `closed-${id}`,
    title: `Closed ${k}`,
    spans: [{ stage: 'build' as const, start: iso('14:40'), end: new Date(t('15:20') + k * 5 * MIN).toISOString() }],
    pr: null,
  }));
  mocks.set('wall2_omni_day', () => ({ date: '2026-11-11', tz: 'America/Los_Angeles', sessions: closed }));
  mocks.set('wall2_omni_days', () => [{ date: '2026-11-11', sessions: 8 }]);
  answer = () => summary({ slots: { used: 3, limit: 4 }, sessionsList: mk(3), day: run(3) });
  const r = render(withTip(3));
  await flush();
  await flush(50);
  expect(r.container.querySelector('.ag-line .x-over')).toBeNull();
  const rails = [...r.container.querySelectorAll('.agent-row .x-rail')] as HTMLElement[];
  expect(rails).toHaveLength(1);
  // Over from 14:40 (the fifth open at once, with the cards) until the count dropped back at 15:40.
  expect(parseFloat(rails[0].style.left)).toBeLessThan(RX(15));
  expect(parseFloat(rails[0].style.left) + parseFloat(rails[0].style.width)).toBeLessThan(RX(16.5));
});

it('overLine: nothing at or under the limit with no history; the current stretch ends at now', () => {
  const now = t('16:30');
  const under = summary({ sessionsList: mk(3) });
  expect(overLine(under, null, 4, now, now)).toEqual([]);
  const over = summary({ sessionsList: mk(5) });
  expect(overLine(over, null, 4, now, now)).toEqual([{ from: now - 42 * MIN, to: now }]);
});

it('openList: waiting, working and idle sessions apart; longest idle first; seen-working time stands in for idle seconds', () => {
  const now = t('16:30');
  const s = summary({
    sessionsList: [
      lane({ id: 'a1', title: 'A', state: 'review', live: 'idle', idleS: 600 }),
      lane({ id: 'a2', title: 'B', state: 'review', live: 'idle' }),
      lane({ id: 'a3', title: 'C', elapsedS: 3000 }),
      lane({ id: 'a4', title: 'D', waiting: true, state: 'blocked', waitingSinceS: 900 }),
    ],
  });
  const l = openList(s, 4, now, new Map([['a2', now - 3 * 3_600_000]]));
  expect(l.idle.map((x) => [x.title, x.when])).toEqual([['B', 'idle 3 h 00 m'], ['A', 'idle 10 m']]);
  expect(l.working.map((x) => [x.title, x.when])).toEqual([['C', '50 m']]);
  expect(l.needs.map((x) => [x.title, x.when])).toEqual([['D', '15 m']]);
  expect(l.over).toBe(0);
});
