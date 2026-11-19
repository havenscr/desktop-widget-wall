import { act, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LIBRARY_DATA } from '../bridge/devMocks/libraryData';
import { mocks } from '../bridge/tauri';
import { usePlaceStore } from '../state/places';
import { useSignalStore } from '../signals/store';
import type { CallSignal } from '../signals/model';
import { resetTools } from '../tools/store';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import { resetLibIndex } from '../work/keyLibrary';
import { startAutoSwitch } from './autoSwitch';
import { Meet } from './Meet';
import { resetMeetStore, useMeetStore } from './meetStore';
import { occurrenceId, type Meeting, type MeetingDetails } from './model';

// Fake timers step through several minutes here, and the limit is generous for a slow runner.
vi.setConfig({ testTimeout: 30_000 });

// A local time, so "today" and "tomorrow" are right in any time zone.
const NOW = new Date(2026, 10, 12, 10, 0).getTime();
const at = (mins: number) => new Date(NOW + mins * 60_000).toISOString().replace('.000Z', 'Z');
const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const call = (over: Partial<CallSignal> = {}): CallSignal => ({ kind: 'teams', since: NOW - 5000, camera: false, ...over });
const setCall = (c: CallSignal | null) => act(() => useSignalStore.setState({ known: true, call: c }));

const details: MeetingDetails = {
  calledBy: 'Casey Rowe',
  people: [
    { name: 'Casey Rowe', reply: 'organizer' },
    { name: 'Dana Whitfield', reply: 'yes' },
  ],
  peopleMore: 0,
  invite: 'Walk through the sizing options.',
};
const m = (key: string, title: string, from: number, to: number, over: Partial<Meeting> = {}): Meeting => ({ key, accountId: 'work', title, start: at(from), end: at(to), canJoin: false, ...over });
const accountsOk = [{ id: 'work', label: 'Work', state: 'ok' as const }];

let sent: { command: string; args?: unknown }[] = [];
let reads = { next: 0, day: 0, checklist: 0 };
let hidden = false;
const setHidden = (h: boolean) => {
  hidden = h;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

interface Serve {
  meetings: () => Meeting[];
  day?: () => unknown[];
  checklist?: string[];
  accounts?: () => unknown[];
  fail?: () => boolean;
}
/** Serves like the native side: every read renews every action key and drops what has ended. */
const serve = (o: Serve) => {
  let gen = 0;
  mocks.set('wall2_meet_next', () => {
    reads.next += 1;
    if (o.fail?.()) return { accounts: [{ id: 'work', label: 'Work', state: 'unavailable', reason: 'graph-503-UnknownError' }], meetings: [] };
    gen += 1;
    return { accounts: o.accounts?.() ?? accountsOk, meetings: o.meetings().filter((x) => Date.parse(x.end) > Date.now()).map((x, n) => ({ ...x, key: `${gen}-${n}` })) };
  });
  mocks.set('wall2_meet_day', () => {
    reads.day += 1;
    return { accounts: accountsOk, events: o.day?.() ?? [] };
  });
  mocks.set('wall2_meet_checklist', () => {
    reads.checklist += 1;
    return { state: o.checklist ? 'ok' : 'missing', items: o.checklist ?? [], reason: null };
  });
  mocks.set('wall2_keys_library', () => LIBRARY_DATA);
  for (const c of ['wall2_keys_send_library', 'wall2_meet_join', 'wall2_open_event', 'wall2_meet_checklist_open']) {
    mocks.set(c, (args) => (sent.push({ command: c, args }), null));
  }
};
const renderMeet = async () => {
  const r = render(
    <>
      <Meet />
      <HoverTipLayer />
    </>,
  );
  await flush(10);
  return r;
};
const hero = (c: HTMLElement) => c.querySelector('.meet-hero') as HTMLElement;
const nextCard = (c: HTMLElement) => c.querySelector('.meet-later') as HTMLElement;
const island = (c: HTMLElement) => c.querySelector('.meet-island') as HTMLElement;
const heading = (c: HTMLElement) => island(c).querySelector('.meet-isl-hd .k')?.textContent;
/** The eight keys of the deck in a Teams call, in their places. */
const CALL_DECK = ['Mute', 'Camera off', 'Share', 'Leave', 'Raise hand', 'Reactions', 'Chat panel', 'Open in Teams'];
const callKeyLabels = (c: HTMLElement) => [...(hero(c).querySelector('.meet-keys')?.querySelectorAll('button') ?? [])].map((b) => b.getAttribute('aria-label'));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  sent = [];
  reads = { next: 0, day: 0, checklist: 0 };
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  resetTools();
  resetLibIndex();
  usePlaceStore.setState({ active: 'meet' });
  useSignalStore.setState({ known: true, call: null, recording: false, leave: null });
  resetMeetStore();
});
afterEach(() => {
  resetTip();
  vi.useRealTimers();
  mocks.clear();
  Reflect.deleteProperty(document, 'hidden');
  usePlaceStore.setState({ active: 'work' });
  useSignalStore.setState({ known: false, call: null, recording: false, leave: null });
});

// ---------- 2: the island and the ticks survive a read ----------

it('a refresh with a new action key and the same event keeps the ticks and the chosen kind; a different event does not', async () => {
  let list = [m('x', 'Design review', -10, 50, { details })];
  serve({ meetings: () => list, checklist: ['Who decides', 'Next step'] });
  const { container } = await renderMeet();
  const isl = () => within(island(container));
  fireEvent.click(isl().getByRole('tab', { name: 'Your first-meeting list' }));
  fireEvent.click(isl().getByRole('checkbox', { name: /Who decides/ }));
  expect(heading(container)).toBe('Your first-meeting list');
  const key0 = useMeetStore.getState().ticks;
  // Five minutes on: a new read, every action key renewed.
  await flush(5 * 60_000 + 10);
  expect(reads.next).toBeGreaterThan(3);
  expect(heading(container)).toBe('Your first-meeting list');
  expect(isl().getByRole('checkbox', { name: /Who decides/ }).getAttribute('aria-checked')).toBe('true');
  expect(useMeetStore.getState().ticks).toEqual(key0);
  // A different occurrence (another title at the same time) starts clean.
  list = [m('y', 'Budget review', -10, 50, { details })];
  await flush(5 * 60_000 + 10);
  expect(heading(container)).toBe('The invite');
  fireEvent.click(isl().getByRole('tab', { name: 'Your first-meeting list' }));
  expect(isl().getByRole('checkbox', { name: /Who decides/ }).getAttribute('aria-checked')).toBe('false');
});

it('the occurrence identity is the same for the same event under another key and differs for another time, account or title', () => {
  const a = m('1-0', 'Review', 0, 30);
  expect(occurrenceId({ ...a, ...{ key: '9-9' } } as Meeting)).toBe(occurrenceId(a));
  expect(occurrenceId({ ...a, title: 'Other' })).not.toBe(occurrenceId(a));
  expect(occurrenceId({ ...a, accountId: 'second' })).not.toBe(occurrenceId(a));
  expect(occurrenceId({ ...a, end: at(31) })).not.toBe(occurrenceId(a));
  expect(occurrenceId(a)).not.toContain('Review');
});

// ---------- 3: a call keeps its controls ----------

it('a call that outlasts its meeting keeps the meeting and the keys, and shows the minutes over', async () => {
  serve({ meetings: () => [m('a', 'Design review', -50, 5, { details }), m('b', 'Lunch with Sam', 90, 150)] });
  await setCall(call({ since: NOW - 50 * 60_000 }));
  const { container } = await renderMeet();
  expect(hero(container).querySelector('.meet-hero-title')?.textContent).toBe('Design review');
  expect(callKeyLabels(container)).toEqual(CALL_DECK);
  // Twelve minutes past the end, the list has dropped the ended meeting.
  await flush(17 * 60_000);
  expect(hero(container).querySelector('.meet-hero-title')?.textContent).toBe('Design review');
  expect(callKeyLabels(container)).toEqual(CALL_DECK);
  expect(hero(container).textContent).not.toContain('Nothing scheduled');
  expect(hero(container).querySelector('.meet-ring-n')?.textContent).toBe('12');
  expect(hero(container).querySelector('.meet-ring-u')?.textContent).toBe('min over');
  expect(hero(container).querySelector('.meet-ring-dial')?.getAttribute('data-tone')).toBe('amber');
  expect(hero(container).textContent).toMatch(/ended \d+(:\d\d)? [AP]M/);
  expect(hero(container).textContent).not.toMatch(/min left/);
  // The Next card shows the meeting after the call's meeting as usual.
  expect(nextCard(container).textContent).toContain('Lunch with Sam');
});

it('a call with no meeting is a plain call: status, time, the four keys, no ring, "Call in progress"', async () => {
  serve({ meetings: () => [] });
  await setCall(call());
  const { container } = await renderMeet();
  const h = hero(container);
  expect(within(h).getByText('In call, Teams')).toBeTruthy();
  expect(h.querySelector('.meet-hero-title')?.textContent).toBe('Call in progress');
  expect(h.querySelector('.meet-time')).not.toBeNull();
  expect(h.querySelector('.meet-ring')).toBeNull();
  expect(callKeyLabels(container)).toEqual(CALL_DECK);
  expect(h.textContent).not.toContain('Nothing scheduled');
  // The keys still work.
  fireEvent.click(within(h).getByRole('button', { name: 'Leave' }));
  await flush(600);
  expect(sent).toContainEqual({ command: 'wall2_keys_send_library', args: { id: 'teams-leave' } });
});

it('a call with only a later, unrelated meeting is a plain call; the later meeting is in the Next card, never the hero', async () => {
  serve({ meetings: () => [m('a', 'Budget review', 60, 90, { canJoin: true })] });
  await setCall(call());
  const { container } = await renderMeet();
  expect(hero(container).querySelector('.meet-hero-title')?.textContent).toBe('Call in progress');
  expect(hero(container).textContent).not.toContain('Budget review');
  expect(hero(container).querySelector('.meet-ring')).toBeNull();
  const card = within(nextCard(container));
  expect(card.getByText('Next')).toBeTruthy();
  expect(card.getByText('Budget review')).toBeTruthy();
});

it('a meeting that starts within 10 minutes after the call began is the call\'s; one that starts later is not', async () => {
  serve({ meetings: () => [m('a', 'Early join', 8, 40, { details })] });
  await setCall(call({ since: NOW }));
  const first = await renderMeet();
  expect(hero(first.container).querySelector('.meet-hero-title')?.textContent).toBe('Early join');
  // Joined before the start: the ring is violet, counting to the start.
  expect(hero(first.container).querySelector('.meet-ring-dial')?.getAttribute('data-tone')).toBe('violet');
  expect(hero(first.container).querySelector('.meet-ring-u')?.textContent).toBe('min to go');
  first.unmount();
  await setCall(null);
  serve({ meetings: () => [m('a', 'Too late', 11, 40, { details })] });
  await setCall(call({ since: NOW }));
  const second = await renderMeet();
  expect(hero(second.container).querySelector('.meet-hero-title')?.textContent).toBe('Call in progress');
});

it('a calendar error during a call keeps the call\'s meeting; with nothing known it is a plain call', async () => {
  let failing = false;
  serve({ meetings: () => [m('a', 'Design review', -10, 50, { details })], fail: () => failing });
  await setCall(call());
  const first = await renderMeet();
  expect(hero(first.container).querySelector('.meet-hero-title')?.textContent).toBe('Design review');
  failing = true;
  await flush(5 * 60_000 + 10);
  expect(hero(first.container).querySelector('.meet-hero-title')?.textContent).toBe('Design review');
  expect(callKeyLabels(first.container)).toEqual(CALL_DECK);
  first.unmount();
  await setCall(null);
  mocks.set('wall2_meet_next', () => Promise.reject(new Error('failed')));
  await setCall(call());
  const second = await renderMeet();
  expect(hero(second.container).querySelector('.meet-hero-title')?.textContent).toBe('Call in progress');
  expect(callKeyLabels(second.container)).toEqual(CALL_DECK);
});

it('the recording chip shows in every kind of hero while a recorder runs', async () => {
  act(() => useSignalStore.setState({ recording: true }));
  // Ordinary.
  serve({ meetings: () => [m('a', 'Design review', 10, 40)] });
  let r = await renderMeet();
  expect(hero(r.container).querySelector('.rec-chip')).not.toBeNull();
  r.unmount();
  // Nothing scheduled.
  serve({ meetings: () => [] });
  r = await renderMeet();
  expect(hero(r.container).textContent).toContain('Nothing scheduled');
  expect(hero(r.container).querySelector('.rec-chip')).not.toBeNull();
  r.unmount();
  // Not set up.
  mocks.set('wall2_meet_next', () => Promise.reject(new Error('not-configured')));
  r = await renderMeet();
  expect(hero(r.container).querySelector('.rec-chip')).not.toBeNull();
  r.unmount();
  // No account readable and nothing known.
  mocks.set('wall2_meet_next', () => ({ accounts: [{ id: 'work', label: 'Work', state: 'signed-out' }], meetings: [] }));
  r = await renderMeet();
  expect(hero(r.container).textContent).toContain('Calendar not available');
  expect(hero(r.container).querySelector('.rec-chip')).not.toBeNull();
  r.unmount();
  // A plain call.
  serve({ meetings: () => [] });
  await setCall(call());
  r = await renderMeet();
  expect(hero(r.container).querySelector('.rec-chip')).not.toBeNull();
  r.unmount();
  // The dimmed last known meeting.
  await setCall(null);
  let fail = false;
  serve({ meetings: () => [m('a', 'Design review', 300, 330)], fail: () => fail });
  r = await renderMeet();
  fail = true;
  await flush(5 * 60_000 + 10);
  expect(hero(r.container).classList.contains('dimmed')).toBe(true);
  expect(hero(r.container).querySelector('.rec-chip')).not.toBeNull();
  // And not while no recorder runs.
  act(() => useSignalStore.setState({ recording: false }));
  expect(hero(r.container).querySelector('.rec-chip')).toBeNull();
});

it('the unavailable state with no history keeps the amber line and Open Tools in the hero, under the title', async () => {
  mocks.set('wall2_meet_next', () => ({ accounts: [{ id: 'work', label: 'Work', state: 'signed-out' }], meetings: [] }));
  const { container } = await renderMeet();
  expect(within(hero(container)).getByRole('button', { name: 'Open Tools' })).toBeTruthy();
  expect(hero(container).querySelector('.meet-trouble')?.textContent).toContain('Work');
});

// ---------- 4: the call's identity ----------

it('the call keeps its identity and the elapsed time when only the call\'s kind changes', async () => {
  serve({ meetings: () => [m('a', 'Design review', -10, 50)] });
  await setCall(call({ since: NOW - 120_000 }));
  const { container } = await renderMeet();
  // Teams to Zoom: the signal's `since` is new, the call is the same.
  await setCall({ kind: 'zoom', since: NOW + 30_000, camera: false });
  expect(useMeetStore.getState().callId).toBe(NOW - 120_000);
  expect(hero(container).textContent).toContain('In call, Zoom');
});

// ---------- 5: nothing runs while hidden ----------

it('the day feed and the checklist are not read while the page is hidden or another place is showing, and unmount stops them', async () => {
  serve({ meetings: () => [m('a', 'Design review', 10, 40)] });
  const { unmount } = await renderMeet();
  const day0 = reads.day;
  const list0 = reads.checklist;
  expect(day0).toBe(1);
  expect(list0).toBe(1);
  setHidden(true);
  await flush(20 * 60_000);
  expect(reads.day).toBe(day0);
  expect(reads.checklist).toBe(list0);
  setHidden(false);
  await flush(10);
  expect(reads.day).toBe(day0 + 1);
  expect(reads.checklist).toBe(list0 + 1);
  await flush(5 * 60_000 + 10);
  expect(reads.day).toBe(day0 + 2);
  // Another place is showing while Meet is still mounted: no day read.
  act(() => usePlaceStore.setState({ active: 'work' }));
  const afterLeave = reads.day;
  await flush(11 * 60_000);
  expect(reads.day).toBe(afterLeave);
  unmount();
  const done = { day: reads.day, list: reads.checklist };
  await flush(20 * 60_000);
  expect(reads.day).toBe(done.day);
  expect(reads.checklist).toBe(done.list);
});

it('the read after Open file is one timer the screen owns: it never runs hidden or after the screen has gone', async () => {
  serve({ meetings: () => [m('a', 'Catch-up', -10, 50)] });
  const first = await renderMeet();
  const click = () => fireEvent.click(within(island(first.container)).getByRole('button', { name: 'Open file' }));
  const base = reads.checklist;
  click();
  await flush(10);
  await flush(3000);
  expect(reads.checklist).toBe(base + 1);
  // Hidden before the timer fires: it does not read, and showing again reads once.
  click();
  await flush(10);
  setHidden(true);
  await flush(10_000);
  expect(reads.checklist).toBe(base + 1);
  setHidden(false);
  await flush(10);
  expect(reads.checklist).toBe(base + 2);
  // Unmounted before the timer fires: nothing is read, nothing is set.
  click();
  await flush(10);
  const before = reads.checklist;
  first.unmount();
  await flush(10_000);
  expect(reads.checklist).toBe(before);
});

it('a checklist read that answers late never lands over a newer one', async () => {
  serve({ meetings: () => [m('a', 'Catch-up', -10, 50)] });
  const answers: ((v: unknown) => void)[] = [];
  mocks.set('wall2_meet_checklist', () => new Promise((res) => answers.push(res)));
  const { container } = await renderMeet();
  // A second read (the window got the focus back) while the first is still out.
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await flush(10);
  expect(answers).toHaveLength(2);
  answers[1]({ state: 'ok', items: ['Newer'], reason: null });
  await flush(10);
  answers[0]({ state: 'ok', items: ['Older'], reason: null });
  await flush(10);
  expect(island(container).textContent).toContain('Newer');
  expect(island(container).textContent).not.toContain('Older');
});

// ---------- 7: today's count and the latest end ----------

const dayRow = (key: string, title: string, from: number, to: number) => ({ key, accountId: 'work', title, start: at(from), end: at(to), canOpen: true });

it('"N more today" counts today\'s meetings from the day feed (nine here, past the next read\'s eight), and "the last ends" is the latest end', async () => {
  const read = [m('a', 'Hero now', -10, 50), m('b', 'M1', 60, 90), m('c', 'M2', 100, 130), m('d', 'M3', 140, 170)];
  const dayFeed = [dayRow('d0', 'Hero now', -10, 50), ...Array.from({ length: 9 }, (_, i) => dayRow(`d${i + 1}`, `M${i + 1}`, 60 + i * 40, 90 + i * 40))];
  // An early meeting runs longest: the last row is not the latest end.
  dayFeed[2] = dayRow('d2', 'M2', 100, 600 - 1);
  serve({ meetings: () => read, day: () => dayFeed });
  await setCall(call());
  const { container } = await renderMeet();
  const card = within(nextCard(container));
  expect(card.getByText('9 more today')).toBeTruthy();
  // The card shows M1, M2 and M3; six more today remain, and the latest end is M2's, 7:59 PM (10:00 AM + 599 min).
  expect(card.getByText(/^\+6 more today, the last ends 7:59 PM$/)).toBeTruthy();
});

it('a meeting tomorrow is never called today: it reads "Tomorrow" and the count says nothing more today', async () => {
  const tomorrow = new Date(2026, 10, 13, 9, 0).getTime();
  const mins = (tomorrow - NOW) / 60_000;
  serve({ meetings: () => [m('a', 'Hero now', -10, 50), m('b', 'Planning check-in', mins, mins + 30), m('c', 'Quarterly review', mins + 300, mins + 360)] });
  const { container } = await renderMeet();
  const card = within(nextCard(container));
  expect(card.getByText('Nothing more today')).toBeTruthy();
  expect(card.getByText(/^Tomorrow 9 AM to 9:30 AM · Work$/)).toBeTruthy();
  expect(card.getByText('Tomorrow 2 PM')).toBeTruthy();
  expect(nextCard(container).textContent).not.toMatch(/\d more today, the last ends/);
});

it('a meeting that starts today and crosses midnight counts as today, with its real end', async () => {
  const late = new Date(2026, 10, 12, 23, 0).getTime();
  const mins = (late - NOW) / 60_000;
  serve({ meetings: () => [m('a', 'Hero now', -10, 50), m('b', 'Early', 90, 120), m('c', 'Night shift', mins, mins + 90), m('d', 'Quiet hour', mins - 200, mins - 150), m('e', 'Another', 150, 180)] });
  const { container } = await renderMeet();
  const card = within(nextCard(container));
  expect(card.getByText('4 more today')).toBeTruthy();
  expect(card.getByText(/^\+1 more today, the last ends 12:30 AM$/)).toBeTruthy();
});

// ---------- 8: the Next card row ----------

it('the Next card row is the leave time or Join, never both', async () => {
  serve({ meetings: () => [m('a', 'Design review', -10, 20), m('b', 'Lunch with Sam', 60, 120, { canJoin: true })] });
  await setCall(call());
  act(() => useSignalStore.setState({ leave: { key: 'travel', leaveAt: NOW + 50 * 60_000, startsAt: NOW + 60 * 60_000 } }));
  const { container } = await renderMeet();
  const card = within(nextCard(container));
  expect(card.getByText(/^Leave by .*, 30 min after this$/)).toBeTruthy();
  expect(card.queryByRole('button', { name: /^Join/ })).toBeNull();
  act(() => useSignalStore.setState({ leave: null }));
  expect(card.getByRole('button', { name: 'Join: Lunch with Sam' })).toBeTruthy();
  expect(card.queryByText(/^Leave by/)).toBeNull();
  // A leave time before the hero ends reads in amber.
  act(() => useSignalStore.setState({ leave: { key: 'travel', leaveAt: NOW + 10 * 60_000, startsAt: NOW + 60 * 60_000 } }));
  const amber = card.getByText(/^Leave by .*, before this ends$/);
  expect(amber.className).toContain('amber');
});

it('an overlap reads "Next, overlaps" with "Starts before this one ends"; back to back keeps its own words', async () => {
  serve({ meetings: () => [m('a', 'Design review', -50, 20), m('b', 'Overlapping call', 10, 70, { canJoin: true })] });
  await setCall(call());
  const first = await renderMeet();
  expect(within(nextCard(first.container)).getByText('Next, overlaps').getAttribute('data-amber')).toBe('true');
  expect(within(nextCard(first.container)).getByText('Starts before this one ends')).toBeTruthy();
  first.unmount();
  await setCall(null);
  serve({ meetings: () => [m('a', 'Design review', -50, 20), m('b', 'Next one', 21, 70, { canJoin: true })] });
  await setCall(call());
  const second = await renderMeet();
  expect(within(nextCard(second.container)).getByText('Next, back to back')).toBeTruthy();
  expect(within(nextCard(second.container)).getByText('Starts as this one ends')).toBeTruthy();
});

// ---------- 8: switching by itself while hidden ----------

it('a call that starts while the page is hidden opens Meet once when the page becomes visible during that call', async () => {
  let visible = false;
  useSignalStore.setState({ call: null });
  usePlaceStore.setState({ active: 'work' });
  const stop = startAutoSwitch(() => visible);
  try {
    useSignalStore.setState({ call: call({ since: 1 }) });
    expect(usePlaceStore.getState().active).toBe('work');
    visible = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(usePlaceStore.getState().active).toBe('meet');
    // Once: leaving Meet and another visibility change does nothing.
    usePlaceStore.setState({ active: 'home' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(usePlaceStore.getState().active).toBe('home');
    // A call that ended while hidden is never opened for.
    useSignalStore.setState({ call: null });
    visible = false;
    useSignalStore.setState({ call: call({ since: 2 }) });
    useSignalStore.setState({ call: null });
    visible = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(usePlaceStore.getState().active).toBe('home');
    // Still hidden when the call starts, On Air when it becomes visible: stays on air, and is not tried again.
    visible = false;
    useSignalStore.setState({ call: call({ since: 3 }) });
    usePlaceStore.setState({ active: 'onair' });
    visible = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(usePlaceStore.getState().active).toBe('onair');
    usePlaceStore.setState({ active: 'work' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(usePlaceStore.getState().active).toBe('work');
  } finally {
    stop();
    useSignalStore.setState({ call: null });
  }
});

it('a meeting that starts at the same minute as the hero is the Next card and reads "Next, overlaps"', async () => {
  serve({ meetings: () => [m('a', 'Design review', -10, 50, { details }), m('b', 'Same minute', -10, 20, { canJoin: true })] });
  await setCall(call());
  const { container } = await renderMeet();
  const card = within(nextCard(container));
  expect(card.getByText('Next, overlaps')).toBeTruthy();
  expect(card.getByText('Same minute')).toBeTruthy();
  expect(card.getByText('Starts before this one ends')).toBeTruthy();
});

it('the recording chip stays in the hero while a key press line shows, and the line sits under the lights', async () => {
  serve({ meetings: () => [m('a', 'Design review', -10, 50)] });
  mocks.set('wall2_keys_send_library', () => Promise.reject(new Error('no-target')));
  act(() => useSignalStore.setState({ recording: true }));
  await setCall(call());
  const { container } = await renderMeet();
  expect(hero(container).querySelector('.meet-hero-st .rec-chip')).not.toBeNull();
  fireEvent.click(within(hero(container)).getByRole('button', { name: 'Mute' }));
  await flush(10);
  expect(hero(container).querySelector('.meet-hero-line .meet-brief')).not.toBeNull();
  expect(hero(container).querySelector('.meet-hero-st .rec-chip')).not.toBeNull();
  // The line goes after a few seconds; the chip never did.
  await flush(10_000);
  expect(hero(container).querySelector('.meet-hero-line .meet-brief')).toBeNull();
  expect(hero(container).querySelector('.meet-hero-st .rec-chip')).not.toBeNull();
});
