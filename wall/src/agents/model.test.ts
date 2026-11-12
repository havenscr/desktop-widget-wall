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
  slotsText,
  statusLine,
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
    expect(slotsText(summary())).toBe('3 of 3 slots');
    expect(slotsText(summary({ slots: { used: 5, limit: 4 } }))).toBe('5 of 4 slots');
    expect(slotsText(summary({ slots: { used: 1, limit: 1 } }))).toBe('1 of 1 slot');
  });

  it('says Nothing needs you, or One thing for you with how many more', () => {
    expect(headerAsk(summary())).toEqual({ text: 'Nothing needs you', more: null, tone: 'cyan' });
    expect(headerAsk(summary({ yourMove: { total: 1, first: null } }))).toEqual({ text: 'One thing for you', more: null, tone: 'amber' });
    expect(headerAsk(summary({ yourMove: { total: 3, first: null } })).more).toBe('then 2 more');
    // A waiting lane counts even when the your-move list has not caught up.
    const s = summary({ lanes: [lane({ waiting: true }), lane({ state: 'blocked' })] });
    expect(needsYouCount(s)).toBe(2);
    expect(headerAsk(s)).toEqual({ text: 'One thing for you', more: 'then 1 more', tone: 'amber' });
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
