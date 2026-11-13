import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { useFocusStore } from '../focus/store';
import type { WeatherState } from '../weather/useWeather';
import { CentreSlot } from './CentreSlot';
import { lane, summary } from './fixtures';
import { HOLD_HINT_MS, HOLD_MOVE_PX, HOLD_MS, POLL_MS } from './model';
import { resetAgents } from './useAgents';

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const weather: WeatherState = { reading: null, failed: false, now: 0 };
let answer: () => unknown;
let opened: string[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 11, 10, 24));
  useFocusStore.getState().dispose();
  localStorage.clear();
  opened = [];
  answer = () => summary();
  mocks.set('wall2_omni_summary', () => answer());
  mocks.set('wall2_focus_omnigent', (args) => {
    opened.push(String(args?.id));
  });
  mocks.set('get_do_not_disturb', () => false);
  resetAgents();
});
afterEach(() => {
  resetAgents();
  useFocusStore.getState().dispose();
  vi.useRealTimers();
  mocks.clear();
});

const ready = (id: string) => lane({ id, title: 'Admin pill polish', stage: 'pr', state: 'review', line: 'Checks passed. Ready when you are.', pr: { number: 561, ci: 'passing', ready: true } });

it('shows the header, three lanes and the shelf when the helper answers', async () => {
  answer = () => summary({ lanes: [lane(), lane({ id: 'a1b2c3d4-0002', title: 'Friday social card' }), ready('a1b2c3d4-0003')] });
  const r = render(<CentreSlot weather={weather} />);
  await flush();
  const centre = r.container.querySelector('.centre.lanes')!;
  expect(centre.querySelector('.lanes-hd')!.textContent).toBe('Agents3 running, 3 slotsNothing needs you');
  expect(centre.querySelector('.calm')!.className).toContain('t-cyan');
  const lanes = [...centre.querySelectorAll('.lane:not(.slim)')];
  expect(lanes).toHaveLength(3);
  expect(lanes[0].querySelector('.t2')!.textContent).toBe('Voice: iPhone mic fix');
  expect(lanes[0].querySelector('.lt .s')!.textContent).toBe('Running web tests, 56 of 89');
  expect(lanes[0].querySelector('.lm')!.textContent).toBe('42 min');
  expect(lanes[0].querySelector('.jn.c em')!.textContent).toBe('Build');
  expect(lanes[2].querySelector('.lm')!.textContent).toBe('Hold to merge');
  expect(lanes[2].querySelector('.jn.c')!.className).toBe('jn c');
  expect(centre.querySelectorAll('.lane.slim')).toHaveLength(0);
  expect(centre.querySelector('.shelf')!.textContent).toBe('4 parked, restingClaude 5 h 18%Claude this week62%');
  // Never a third line for the PR when all three lanes show.
  expect(lanes[2].querySelectorAll('.lt > *')).toHaveLength(2);
  // No fill while the lanes show.
  expect(centre.querySelector('[aria-label="Focus timer"]')).toBeNull();
});

it('turns a waiting lane amber and says One thing for you', async () => {
  answer = () => summary({ lanes: [lane(), lane({ id: 'a1b2c3d4-0002', state: 'blocked', waiting: true })], yourMove: { total: 2, first: null } });
  const r = render(<CentreSlot weather={weather} />);
  await flush();
  const calm = r.container.querySelector('.calm')!;
  expect(calm.textContent).toBe('One thing for you:Voice: iPhone mic fixthen 1 more');
  expect(calm.className).toContain('t-amber');
  const lanes = r.container.querySelectorAll('.lane:not(.slim)');
  expect(lanes[0].className).toBe('lane g');
  expect(lanes[1].className).toBe('lane g wait');
  expect(lanes[1].querySelector('.lane-ring')!.className).toContain('t-amber');
  expect(lanes[1].querySelector('.jn.c')!.className).toBe('jn c wait');
});

it('opens the chat on a tap anywhere on the lane', async () => {
  answer = () => summary({ lanes: [lane()] });
  const r = render(<CentreSlot weather={weather} />);
  await flush();
  fireEvent.click(r.container.querySelector('.lane .t2')!);
  await flush();
  expect(opened).toEqual(['a1b2c3d4-0001']);
  fireEvent.keyDown(r.container.querySelector('.lane[role="button"]')!, { key: 'Enter' });
  await flush();
  expect(opened).toEqual(['a1b2c3d4-0001', 'a1b2c3d4-0001']);
});

it('does not offer the tap when the helper says links are not available', async () => {
  answer = () => summary({ lanes: [ready('a1b2c3d4-0003')], linksAvailable: false });
  const r = render(<CentreSlot weather={weather} />);
  await flush();
  const l = r.container.querySelector('.lane:not(.slim)')!;
  expect(l.getAttribute('role')).toBeNull();
  fireEvent.click(l);
  await flush();
  expect(opened).toEqual([]);
  expect(l.querySelector('.hold')).toBeNull();
});

it('Hold to merge: a short tap only says Hold, a 600 ms hold opens the chat', async () => {
  answer = () => summary({ lanes: [ready('a1b2c3d4-0003')] });
  const r = render(<CentreSlot weather={weather} />);
  await flush();
  const btn = r.container.querySelector('.hold')!;
  fireEvent.pointerDown(btn);
  await flush(HOLD_MS - 200);
  fireEvent.pointerUp(btn);
  fireEvent.click(btn);
  await flush();
  expect(opened).toEqual([]);
  expect(btn.textContent).toBe('Hold');
  await flush(HOLD_HINT_MS);
  expect(btn.textContent).toBe('Hold to merge');
  fireEvent.pointerDown(btn);
  await flush(HOLD_MS);
  expect(opened).toEqual(['a1b2c3d4-0003']);
  fireEvent.pointerUp(btn);
  fireEvent.click(btn);
  await flush();
  expect(opened).toEqual(['a1b2c3d4-0003']);
  expect(btn.textContent).toBe('Hold to merge');
});

it('a hold that leaves the button early does nothing', async () => {
  answer = () => summary({ lanes: [ready('a1b2c3d4-0003')] });
  const r = render(<CentreSlot weather={weather} />);
  await flush();
  const btn = r.container.querySelector('.hold')!;
  fireEvent.pointerDown(btn);
  await flush(200);
  fireEvent.pointerCancel(btn);
  await flush(HOLD_MS);
  expect(opened).toEqual([]);
});

it('with fewer than three lanes, the free rows are slim and the lanes get a PR line', async () => {
  answer = () => summary({ slots: { used: 1, limit: 3 }, lanes: [lane({ pr: { number: 553, ci: 'pending', ready: false } })] });
  const r = render(<CentreSlot weather={weather} />);
  await flush();
  const free = [...r.container.querySelectorAll('.lane.slim')];
  expect(free.map((f) => f.textContent)).toEqual(['Free slot', 'Free slot']);
  expect(r.container.querySelector('.lane:not(.slim) .xs')!.textContent).toBe('PR 553, checks running, draft');
  expect(r.container.querySelector('.lanes')!.getAttribute('data-lanes')).toBe('1');
});

it('with no lane, one slim row and the focus timer fill the centre', async () => {
  answer = () => summary({ slots: { used: 0, limit: 3 }, lanes: [] });
  const r = render(<CentreSlot weather={weather} />);
  await flush();
  const free = [...r.container.querySelectorAll('.lane.slim')];
  expect(free.map((f) => f.textContent)).toEqual(['All three slots free']);
  expect(r.container.querySelector('.lanes-idle [aria-label="Focus timer"]')).not.toBeNull();
  expect(r.container.querySelector('.lanes-hd')).not.toBeNull();
  expect(r.container.querySelector('.shelf')).not.toBeNull();
});

it('shows the real numbers past the limit and hides a missing five hour figure', async () => {
  answer = () => summary({ slots: { used: 5, limit: 4 }, usage: { claudeWeekPct: 40, claude5hPct: null, weekResetsAt: null } });
  const r = render(<CentreSlot weather={weather} />);
  await flush();
  expect(screen.getByText('5 running, 4 slots')).toBeTruthy();
  expect(r.container.querySelector('.shelf')!.textContent).toBe('4 parked, restingClaude this week40%');
  answer = () => summary({ usage: null, parked: 0 });
  await flush(POLL_MS);
  expect(r.container.querySelector('.shelf')!.textContent).toBe('Nothing parked');
});

it('a stale answer says "updated N min ago" and dims the lanes', async () => {
  let fail = false;
  answer = () => {
    if (fail) throw new Error('failed');
    return summary();
  };
  const r = render(<CentreSlot weather={weather} />);
  await flush();
  expect(r.container.querySelector('.lanes-age')).toBeNull();
  fail = true;
  await flush(4 * 60_000);
  expect(r.container.querySelector('.lanes')!.className).toBe('centre lanes stale');
  expect(r.container.querySelector('.lanes-age')!.textContent).toBe('updated 4 min ago');
});

it('a stale answer from the helper with no fresh one says it may be out of date', async () => {
  answer = () => summary({ stale: true });
  const r = render(<CentreSlot weather={weather} />);
  await flush();
  expect(r.container.querySelector('.lanes-age')!.textContent).toBe('may be out of date');
});

it('not set up: the fill with one quiet line, never a Not set up card', async () => {
  answer = () => {
    throw new Error('not-configured');
  };
  const r = render(<CentreSlot weather={weather} />);
  await flush();
  expect(r.container.querySelector('[aria-label="Focus timer"]')).not.toBeNull();
  // A quiet header row above the cards, in the place the lanes' header takes.
  const note = r.container.querySelector('.centre-fill > .centre-note:first-child')!;
  expect(note.textContent).toBe('Agentsnot set up');
  expect(r.container.querySelector('.centre-note .t-amber')).toBeNull();
  expect(r.container.querySelector('.centre-note button')).toBeNull();
  expect(r.container.querySelector('.lanes')).toBeNull();
});

it('set up but not reachable with no earlier answer: the fill with one amber line', async () => {
  answer = () => {
    throw new Error('failed');
  };
  const r = render(<CentreSlot weather={weather} />);
  await flush();
  expect(r.container.querySelector('[aria-label="Focus timer"]')).not.toBeNull();
  expect(r.container.querySelector('.centre-fill > .centre-note:first-child .k')!.textContent).toBe('Agents');
  expect(r.container.querySelector('.centre-note .t-amber')!.textContent).toBe('not reachable');
});

it('not reachable: "Try again" forces one read at once, and the lanes come when it answers', async () => {
  let calls = 0;
  let up = false;
  answer = () => {
    calls += 1;
    if (!up) throw new Error('failed');
    return summary({ lanes: [lane()] });
  };
  const r = render(<CentreSlot weather={weather} />);
  await flush();
  const before = calls;
  up = true;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await flush();
  expect(calls).toBe(before + 1);
  expect(r.container.querySelector('.lanes')).not.toBeNull();
  expect(r.container.querySelector('.centre-note')).toBeNull();
});

it('renders titles and lines as plain text', async () => {
  answer = () => summary({ lanes: [lane({ title: '<b>bold</b>', line: '<img src=x>' })] });
  const r = render(<CentreSlot weather={weather} />);
  await flush();
  expect(r.container.querySelector('.lane .t2')!.textContent).toBe('<b>bold</b>');
  expect(r.container.querySelector('.lane b')).toBeNull();
  expect(r.container.querySelector('.lane img')).toBeNull();
});

it('Hold to merge: a move of 11 px still opens after 600 ms', async () => {
  answer = () => summary({ lanes: [ready('a1b2c3d4-0003')] });
  const r = render(<CentreSlot weather={weather} />);
  await flush();
  const btn = r.container.querySelector('.hold')!;
  fireEvent.pointerDown(btn, { pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(btn, { pointerId: 1, clientX: 100 + HOLD_MOVE_PX - 1, clientY: 100 });
  await flush(HOLD_MS);
  expect(opened).toEqual(['a1b2c3d4-0003']);
});

it('Hold to merge: a move of 13 px cancels the hold with no hint', async () => {
  answer = () => summary({ lanes: [ready('a1b2c3d4-0003')] });
  const r = render(<CentreSlot weather={weather} />);
  await flush();
  const btn = r.container.querySelector('.hold')!;
  fireEvent.pointerDown(btn, { pointerId: 1, clientX: 100, clientY: 100 });
  await flush(100);
  fireEvent.pointerMove(btn, { pointerId: 1, clientX: 100 + 12, clientY: 100 + 5 });
  await flush(HOLD_MS);
  expect(opened).toEqual([]);
  expect(btn.textContent).toBe('Hold to merge');
  expect(btn.className).not.toContain('holding');
  fireEvent.pointerUp(btn, { pointerId: 1 });
  await flush();
  expect(btn.textContent).toBe('Hold to merge');
});

it('Hold to merge: a pointer cancel stops the hold with no hint', async () => {
  answer = () => summary({ lanes: [ready('a1b2c3d4-0003')] });
  const r = render(<CentreSlot weather={weather} />);
  await flush();
  const btn = r.container.querySelector('.hold')!;
  fireEvent.pointerDown(btn, { pointerId: 1, clientX: 100, clientY: 100 });
  await flush(300);
  fireEvent.pointerCancel(btn, { pointerId: 1 });
  await flush(HOLD_MS);
  expect(opened).toEqual([]);
  expect(btn.textContent).toBe('Hold to merge');
});

it('Hold to merge: Enter or Space on the button opens the chat, and only once', async () => {
  answer = () => summary({ lanes: [ready('a1b2c3d4-0003')] });
  const r = render(<CentreSlot weather={weather} />);
  await flush();
  const btn = r.container.querySelector('.hold')!;
  fireEvent.keyDown(btn, { key: 'Enter' });
  await flush();
  expect(opened).toEqual(['a1b2c3d4-0003']);
  fireEvent.keyDown(btn, { key: ' ' });
  await flush();
  expect(opened).toEqual(['a1b2c3d4-0003', 'a1b2c3d4-0003']);
});

it('back from hidden: the kept lanes show dimmed with "updated N min ago" until the first new read returns', async () => {
  const r = render(<CentreSlot weather={weather} />);
  await flush();
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
  await flush(6 * 60_000);
  let release: (() => void) | null = null;
  mocks.set('wall2_omni_summary', () => new Promise((resolve) => (release = () => resolve(summary()))));
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
  await flush();
  expect(r.container.querySelector('.lanes')!.className).toBe('centre lanes stale');
  expect(r.container.querySelector('.lanes-age')!.textContent).toBe('updated 6 min ago');
  await act(async () => release!());
  await flush();
  expect(r.container.querySelector('.lanes')!.className).toBe('centre lanes');
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

const many = (n: number) => Array.from({ length: n }, (_, i) => lane({ id: `a1b2c3d4-00${String(i).padStart(2, '0')}`, title: `Session ${i + 1}` }));

it('a newer helper: every parent or standalone session gets a card, numbered, with a quiet "3 of 7" count', async () => {
  answer = () => summary({ sessionsList: many(7), slots: { used: 9, limit: 4, sessions: 7, working: 6, helpers: 5 } });
  const r = render(<CentreSlot weather={weather} />);
  await flush();
  const list = r.container.querySelector('.lanes-list')!;
  expect(list.className).toContain('scrolls');
  const cards = [...list.querySelectorAll('.lane:not(.slim)')];
  expect(cards).toHaveLength(7);
  expect(cards.map((c) => c.querySelector('.lane-num')!.textContent)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  expect(r.container.querySelector('.lanes-count')!.textContent).toBe('3 of 7');
  expect(r.container.querySelector('.slot-meter')!.textContent).toBe('+26 working, 7 open, 4 slots');
  expect(r.container.querySelectorAll('.slot-meter .pips i.on')).toHaveLength(4);
  expect(r.container.querySelectorAll('.lane.slim')).toHaveLength(0);
});

it('three or fewer sessions: no count and no scrolling', async () => {
  answer = () => summary({ sessionsList: many(2) });
  const r = render(<CentreSlot weather={weather} />);
  await flush();
  expect(r.container.querySelector('.lanes-count')).toBeNull();
  expect(r.container.querySelector('.lanes-list')!.className).toBe('lanes-list');
  expect(r.container.querySelectorAll('.lane.slim')).toHaveLength(1);
});

it('"One thing for you: <title>" opens the waiting session and brings OmniGent forward; "then 1 more" steps to the next', async () => {
  answer = () =>
    summary({
      sessionsList: many(3).map((l, i) => (i === 1 ? { ...l, waiting: true, state: 'blocked' as const, waitingSinceS: 600 } : l)),
      yourMove: { total: 2, first: null, ids: ['a1b2c3d4-0001', 'a1b2c3d4-00ff'] },
      sessions: { 'a1b2c3d4-00ff': { title: 'Off the cards', stage: 'plan', state: 'blocked' } },
    });
  const r = render(<CentreSlot weather={weather} />);
  await flush();
  const ask = r.container.querySelector('.ask-btn')!;
  expect(ask.textContent).toBe('One thing for you:Session 2');
  fireEvent.click(ask);
  await flush();
  expect(opened).toEqual(['a1b2c3d4-0001']);
  // The waiting card is amber and says so.
  const waiting = r.container.querySelectorAll('.lane:not(.slim)')[1];
  expect(waiting.className).toContain('wait');
  expect(waiting.querySelector('.lt2 .s')!.textContent).toBe('Waiting on you for 10 min: Running web tests, 56 of 89');
  fireEvent.click(r.container.querySelector('.ask-more')!);
  await flush();
  expect(opened).toEqual(['a1b2c3d4-0001', 'a1b2c3d4-00ff']);
  expect(r.container.querySelector('.ask-btn')!.textContent).toBe('Also for you:Off the cards');
  expect(r.container.querySelector('.ask-more')!.textContent).toBe('back to the first');
});

it('the slot meter and the parked count bring OmniGent forward without a session', async () => {
  answer = () => summary();
  const r = render(<CentreSlot weather={weather} />);
  await flush();
  fireEvent.click(r.container.querySelector('.slot-meter')!);
  fireEvent.click(r.container.querySelector('.shelf-parked')!);
  await flush();
  expect(opened).toEqual(['null', 'null']);
});

it('shows one usage meter per subscription, the fullest above 90 in amber', async () => {
  answer = () =>
    summary({
      usage: {
        claudeWeekPct: 94,
        claude5hPct: null,
        weekResetsAt: null,
        accounts: [
          { provider: 'claude', label: 'Claude 1', weekPct: 41, fiveHourPct: 12, weekResetsAt: null },
          { provider: 'claude', label: 'Claude 2', weekPct: 94, fiveHourPct: null, weekResetsAt: null },
          { provider: 'codex', label: 'Codex', weekPct: null, fiveHourPct: null, weekResetsAt: null },
        ],
      },
    });
  const r = render(<CentreSlot weather={weather} />);
  await flush();
  const meters = [...r.container.querySelectorAll('.shelf-week')];
  expect(meters.map((m) => m.textContent)).toEqual(['Claude 141%', 'Claude 294%', 'Codexn/a']);
  expect(meters.map((m) => m.className.includes('t-amber'))).toEqual([false, true, false]);
});

it('a failed session says so in red', async () => {
  answer = () => summary({ sessionsList: [lane({ failed: true, line: 'Two tests failed' })] });
  const r = render(<CentreSlot weather={weather} />);
  await flush();
  const card = r.container.querySelector('.lane:not(.slim)')!;
  expect(card.className).toContain('failed');
  expect(card.querySelector('.lt2 .s')!.className).toContain('t-red');
  expect(card.querySelector('.lt2 .s')!.textContent).toBe('Failed: Two tests failed');
});
