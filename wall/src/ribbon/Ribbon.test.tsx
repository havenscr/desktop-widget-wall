import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { useFocusStore } from '../focus/store';
import { HoverTipLayer, resetTip, TIP_DELAY_MS } from '../ui/HoverTip';
import { RX } from './model';
import { Ribbon } from './Ribbon';
import { useFixedClock, usePacificTime } from './testZone';
import { summary } from '../agents/fixtures';
import { resetAgents } from '../agents/useAgents';

usePacificTime();

const t = (hm: string) => Date.parse(`2026-11-11T${hm}:00-08:00`);
useFixedClock(t('10:24'));
const iso = (hm: string) => new Date(t(hm)).toISOString().replace('.000Z', 'Z');

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

afterEach(() => {
  resetTip();
  resetAgents();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  vi.useRealTimers();
  mocks.clear();
  useFocusStore.setState({ sessions: [] });
});

const day = {
  accounts: [{ id: 'work', label: 'Work', state: 'ok' }],
  events: [
    { key: 'd-0', accountId: 'work', title: 'AE sync', start: iso('09:00'), end: iso('09:45'), canJoin: true, isLive: false },
    { key: 'd-1', accountId: 'work', title: 'Design review', start: iso('10:00'), end: iso('11:00'), canJoin: true, isLive: false },
    { key: 'd-2', accountId: 'work', title: 'Livestream: Fabric Apps', start: iso('18:30'), end: iso('20:30'), canJoin: false, isLive: true },
  ],
};

it('draws today\'s calendar with past, now and live chips, and the needle with the time', async () => {
  mocks.set('wall2_meet_day', () => day);
  const r = render(<Ribbon kind="work" />);
  await flush();
  const chips = [...r.container.querySelectorAll('.ev')];
  expect(chips.map((c) => [c.textContent, c.className])).toEqual([
    ['AE sync', 'ev past'],
    ['Design review', 'ev now'],
    ['Livestream: Fabric Apps', 'ev next live'],
  ]);
  expect((chips[0] as HTMLElement).style.left).toBe(`${RX(9)}px`);
  const ndl = r.container.querySelector('.ndl') as HTMLElement;
  expect(ndl.textContent).toBe('10:24');
  expect(ndl.style.left).toBe(`${RX(10.4)}px`);
  expect(r.container.querySelectorAll('.tk')).toHaveLength(19);
  expect([...r.container.querySelectorAll('.hl.sun')].map((e) => e.textContent)).toEqual(['sunrise 7:09', 'sunset 4:37']);
});

it('moves the needle on the minute', async () => {
  mocks.set('wall2_meet_day', () => day);
  const r = render(<Ribbon kind="work" />);
  await flush(61_000);
  expect(r.container.querySelector('.ndl')!.textContent).toBe('10:25');
});

it('leaves row 1 empty with no error text when Meet is not set up', async () => {
  mocks.set('wall2_meet_day', () => {
    throw new Error('not-configured');
  });
  const r = render(<Ribbon kind="work" />);
  await flush();
  expect(r.container.querySelectorAll('.ev')).toHaveLength(0);
  expect(r.container.textContent).not.toMatch(/set up|error|unavailable/i);
});

it('keeps the last good calendar when a later read fails', async () => {
  let fail = false;
  mocks.set('wall2_meet_day', () => {
    if (fail) throw new Error('failed');
    return day;
  });
  const r = render(<Ribbon kind="work" />);
  await flush();
  fail = true;
  await flush(5 * 60_000);
  expect(r.container.querySelectorAll('.ev')).toHaveLength(3);
});

it('draws the focus bar from today\'s sessions up to now', async () => {
  mocks.set('wall2_meet_day', () => ({ accounts: [], events: [] }));
  useFocusStore.setState({ sessions: [{ start: t('10:00'), end: t('10:45') }] });
  const r = render(<Ribbon kind="work" />);
  await flush();
  const fo = r.container.querySelector('.fo') as HTMLElement;
  expect(fo.style.left).toBe(`${RX(10)}px`);
  expect(parseFloat(fo.style.width)).toBeCloseTo(RX(10.4) - RX(10));
});

it('uses the home icon for row 2 on Home, with no focus bar', async () => {
  mocks.set('wall2_meet_day', () => ({ accounts: [], events: [] }));
  useFocusStore.setState({ sessions: [{ start: t('10:00'), end: t('10:45') }] });
  const r = render(<Ribbon kind="home" />);
  await flush();
  expect(r.container.querySelector('.rib')!.getAttribute('data-kind')).toBe('home');
  expect(r.container.querySelector('.tabler-icon-home')).not.toBeNull();
  expect(r.container.querySelector('.tabler-icon-bolt')).toBeNull();
  expect(r.container.querySelector('.fo')).toBeNull();
});

it('draws overlapping events in two stacked lanes and a narrow chip with its title beside it', async () => {
  mocks.set('wall2_meet_day', () => ({
    accounts: [],
    events: [
      { key: 'a', accountId: 'work', title: 'Workshop', start: iso('11:00'), end: iso('13:00'), canJoin: false, isLive: false },
      { key: 'b', accountId: 'work', title: 'Standup', start: iso('12:00'), end: iso('12:15'), canJoin: false, isLive: false },
    ],
  }));
  const r = render(<Ribbon kind="work" />);
  await flush();
  const [a, b] = [...r.container.querySelectorAll('.ev')] as HTMLElement[];
  expect(a.className).toBe('ev next s2');
  expect(a.textContent).toBe('Workshop');
  expect(b.className).toBe('ev next s2');
  expect(b.textContent).toBe('');
  expect(b.getAttribute('aria-label')).toBe('Standup, 12:00 to 12:15 PM');
  // Two lanes that never share a pixel row.
  expect(parseFloat(a.style.top) + parseFloat(a.style.height)).toBeLessThanOrEqual(parseFloat(b.style.top));
  expect(r.container.querySelector('.ev-side')!.textContent).toBe('Standup');
});

it('a chip shows title, time and account on hover, and opens its event in Outlook on a click when Rust has a link', async () => {
  const opened: string[] = [];
  mocks.set('wall2_open_event', (args) => {
    opened.push(String(args?.key));
  });
  mocks.set('wall2_meet_day', () => ({
    accounts: [{ id: 'work', label: 'Work', state: 'ok' }],
    events: [
      { key: 'd-0', accountId: 'work', title: 'Design review', start: iso('10:00'), end: iso('11:00'), canJoin: true, canOpen: true, isLive: false },
      { key: 'd-1', accountId: 'work', title: 'Lunch', start: iso('12:00'), end: iso('13:00'), canJoin: false, canOpen: false, isLive: false },
    ],
  }));
  const r = render(
    <>
      <Ribbon kind="work" />
      <HoverTipLayer />
    </>,
  );
  await flush();
  const [a, b] = [...r.container.querySelectorAll('.ev')] as HTMLElement[];
  expect(a.className).toContain('open');
  expect(a.getAttribute('role')).toBe('button');
  expect(b.getAttribute('role')).toBeNull();
  fireEvent.mouseEnter(a);
  await flush(TIP_DELAY_MS);
  expect(document.querySelector('.hover-tip')!.textContent).toBe('Design review10:00 to 11:00 AM, WorkClick to open it in Outlook');
  fireEvent.mouseLeave(a);
  fireEvent.click(a);
  fireEvent.keyDown(a, { key: 'Enter' });
  fireEvent.click(b);
  await flush();
  expect(opened).toEqual(['d-0', 'd-0']);
});

it('the needle\'s hover counts down to the next meeting', async () => {
  mocks.set('wall2_meet_day', () => day);
  const r = render(
    <>
      <Ribbon kind="work" />
      <HoverTipLayer />
    </>,
  );
  await flush();
  fireEvent.mouseEnter(r.container.querySelector('.ndl b')!);
  await flush(TIP_DELAY_MS);
  expect(document.querySelector('.hover-tip')!.textContent).toBe('10:24. Next meeting in 8 h 6 m: Livestream: Fabric Apps');
});

it('stops reading the calendar and moving the needle while hidden, and catches up on return', async () => {
  let reads = 0;
  mocks.set('wall2_meet_day', () => {
    reads++;
    return day;
  });
  const r = render(<Ribbon kind="work" />);
  await flush();
  expect(reads).toBe(1);
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await flush(11 * 60_000);
  expect(reads).toBe(1);
  expect(r.container.querySelector('.ndl')!.textContent).toBe('10:24');
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await flush();
  expect(reads).toBe(2);
  expect(r.container.querySelector('.ndl')!.textContent).toBe('10:35');
  await flush(61_000);
  expect(r.container.querySelector('.ndl')!.textContent).toBe('10:36');
});

it('clears its timers and stops reading on unmount', async () => {
  let reads = 0;
  mocks.set('wall2_meet_day', () => {
    reads++;
    return day;
  });
  const r = render(<Ribbon kind="work" />);
  await flush();
  r.unmount();
  expect(vi.getTimerCount()).toBe(0);
  await flush(30 * 60_000);
  expect(reads).toBe(1);
});

const emptyDay = { accounts: [], next: [], remaining: 0, dueTomorrow: { count: 0, estMinutes: 0 } };
const labels = (c: HTMLElement) => [...c.querySelectorAll('.li-empty')].map((l) => l.textContent);

it('names each row on its icon and says a row is empty only after good reads', async () => {
  mocks.set('wall2_meet_day', () => ({ accounts: [{ id: 'work', label: 'Work', state: 'ok' }], events: [] }));
  mocks.set('wall2_tasks_summary', () => emptyDay);
  mocks.set('wall2_omni_summary', () => summary({ lanes: [], day: [] }));
  const work = render(<Ribbon kind="work" />);
  await flush();
  const icons = [...work.container.querySelectorAll('.li')].map((i) => i.getAttribute('title'));
  expect(icons).toEqual(["Today's calendar", 'Agent activity and tasks due today']);
  expect(labels(work.container)).toEqual(['No meetings today', 'No agent activity yet']);
  work.unmount();
  const home = render(<Ribbon kind="home" />);
  await flush();
  expect(home.container.querySelectorAll('.li')[1].getAttribute('title')).toBe('Home tasks due today');
  expect(labels(home.container)).toEqual(['No meetings today', 'Nothing scheduled at home']);
});

it('says nothing about a row it does not know: before a read, after a failed read, or not set up', async () => {
  mocks.set('wall2_meet_day', () => {
    throw new Error('failed');
  });
  mocks.set('wall2_tasks_summary', () => {
    throw new Error('failed');
  });
  mocks.set('wall2_omni_summary', () => {
    throw new Error('not-configured');
  });
  const work = render(<Ribbon kind="work" />);
  // Before the first answers land.
  expect(labels(work.container)).toEqual([]);
  await flush();
  expect(labels(work.container)).toEqual([]);
  work.unmount();
  mocks.set('wall2_meet_day', () => {
    throw new Error('not-configured');
  });
  const home = render(<Ribbon kind="home" />);
  await flush();
  expect(labels(home.container)).toEqual([]);
});

it('says the calendar is not available when no account can be read', async () => {
  mocks.set('wall2_meet_day', () => ({ accounts: [{ id: 'work', label: 'Work', state: 'signed-out' }], events: [] }));
  mocks.set('wall2_tasks_summary', () => emptyDay);
  const r = render(<Ribbon kind="home" />);
  await flush();
  expect(labels(r.container)).toEqual(['Calendar not available', 'Nothing scheduled at home']);
});

it('says nothing about agent activity while the helper has not answered or the tasks are unknown', async () => {
  mocks.set('wall2_meet_day', () => day);
  mocks.set('wall2_omni_summary', () => summary({ lanes: [], day: [] }));
  mocks.set('wall2_tasks_summary', () => {
    throw new Error('failed');
  });
  const r = render(<Ribbon kind="work" />);
  await flush();
  expect(labels(r.container)).toEqual([]);
});

it('drops the empty label once the row has something on it', async () => {
  mocks.set('wall2_meet_day', () => day);
  mocks.set('wall2_tasks_summary', () => emptyDay);
  const r = render(<Ribbon kind="home" />);
  await flush();
  expect(labels(r.container)).toEqual(['Nothing scheduled at home']);
});

it('drops an older day answer that arrives after a newer one, and the empty-row label still follows the newer one', async () => {
  let calls = 0;
  let releaseOld: (v: unknown) => void = () => undefined;
  mocks.set('wall2_tasks_summary', () => emptyDay);
  mocks.set('wall2_meet_day', () => {
    calls += 1;
    if (calls === 1) return new Promise((r) => (releaseOld = r));
    return { ...day, seq: 7 };
  });
  const r = render(<Ribbon kind="work" />);
  await flush();
  await flush(5 * 60_000);
  expect(r.container.querySelectorAll('.ev')).toHaveLength(3);
  releaseOld({ accounts: [{ id: 'work', label: 'Work', state: 'signed-out' }], events: [], seq: 3 });
  await flush();
  expect(r.container.querySelectorAll('.ev')).toHaveLength(3);
  expect(labels(r.container)).not.toContain('Calendar not available');
});

it('an older answer cannot turn an empty good day into "not available" either', async () => {
  let calls = 0;
  let releaseOld: (v: unknown) => void = () => undefined;
  mocks.set('wall2_tasks_summary', () => emptyDay);
  mocks.set('wall2_meet_day', () => {
    calls += 1;
    if (calls === 1) return new Promise((r) => (releaseOld = r));
    return { accounts: [{ id: 'work', label: 'Work', state: 'ok' }], events: [], seq: 9 };
  });
  const r = render(<Ribbon kind="home" />);
  await flush();
  await flush(5 * 60_000);
  expect(labels(r.container)).toContain('No meetings today');
  releaseOld({ accounts: [{ id: 'work', label: 'Work', state: 'signed-out' }], events: [], seq: 2 });
  await flush();
  expect(labels(r.container)).toContain('No meetings today');
  expect(labels(r.container)).not.toContain('Calendar not available');
});

it('three meetings at once stack in three thin lanes with no title drawn', async () => {
  mocks.set('wall2_meet_day', () => ({
    accounts: [],
    events: ['a', 'b', 'c'].map((k) => ({ key: `d-${k}`, accountId: 'work', title: `Meeting ${k}`, start: iso('13:00'), end: iso('14:00'), canJoin: false, isLive: false })),
  }));
  const r = render(<Ribbon kind="work" />);
  await flush();
  const evs = [...r.container.querySelectorAll('.ev')] as HTMLElement[];
  expect(evs.map((e) => [e.className, e.textContent])).toEqual([
    ['ev next s3', ''],
    ['ev next s3', ''],
    ['ev next s3', ''],
  ]);
  expect(new Set(evs.map((e) => e.style.top)).size).toBe(3);
  expect(r.container.querySelector('.ev.more')).toBeNull();
});

it('four meetings at once: two real chips and a "+2" chip; a click on it lists the other two to open in Outlook', async () => {
  const opened: string[] = [];
  mocks.set('wall2_open_event', (args) => {
    opened.push(String(args?.key));
  });
  mocks.set('wall2_meet_day', () => ({
    accounts: [{ id: 'work', label: 'Work', state: 'ok' }],
    events: ['a', 'b', 'c', 'd'].map((k) => ({ key: `d-${k}`, accountId: 'work', title: `Meeting ${k}`, start: iso('13:00'), end: iso('14:00'), canJoin: false, canOpen: true, isLive: false })),
  }));
  const r = render(
    <>
      <Ribbon kind="work" />
      <HoverTipLayer />
    </>,
  );
  await flush();
  expect([...r.container.querySelectorAll('.ev:not(.more)')].map((c) => c.textContent)).toEqual(['Meeting a', 'Meeting b']);
  const more = r.container.querySelector('.ev.more') as HTMLElement;
  expect(more.textContent).toBe('+2');
  fireEvent.mouseEnter(more);
  await flush(TIP_DELAY_MS);
  expect(document.querySelector('.hover-tip')!.textContent).toContain('2 more at this time');
  fireEvent.mouseLeave(more);
  fireEvent.click(more);
  const picks = [...document.querySelectorAll('.hover-tip.pinned .tip-pick')] as HTMLElement[];
  expect(picks.map((p) => p.textContent)).toEqual(['c', 'd'].map((k) => `Meeting ${k}, 1:00 to 2:00 PM, Work`));
  fireEvent.click(picks[0]);
  await flush();
  expect(opened).toEqual(['d-c']);
  expect(document.querySelector('.hover-tip')).toBeNull();
});

it('folds all-day events into one "1 all day" chip at the row start that lists them on hover', async () => {
  mocks.set('wall2_meet_day', () => ({
    accounts: [{ id: 'work', label: 'Work', state: 'ok' }],
    events: [
      { key: 'all', accountId: 'work', title: 'Company offsite', start: '2026-11-11T08:00:00Z', end: '2026-11-12T08:00:00Z', canJoin: false, isLive: false },
      { key: 'd-1', accountId: 'work', title: 'Design review', start: iso('10:00'), end: iso('11:00'), canJoin: true, isLive: false },
    ],
  }));
  const r = render(
    <>
      <Ribbon kind="work" />
      <HoverTipLayer />
    </>,
  );
  await flush();
  const chip = r.container.querySelector('.ev.allday') as HTMLElement;
  expect(chip.textContent).toBe('1 all day');
  expect(chip.style.left).toBe(`${RX(6)}px`);
  // The timed event keeps the full lane.
  const review = [...r.container.querySelectorAll('.ev:not(.allday)')] as HTMLElement[];
  expect(review.map((e) => [e.textContent, e.className])).toEqual([['Design review', 'ev now']]);
  fireEvent.mouseEnter(chip);
  await flush(TIP_DELAY_MS);
  expect(document.querySelector('.hover-tip')!.textContent).toContain('Company offsite, Work');
});

it('marks the ribbon late after 9 PM, so the agent bars and focus line dim', async () => {
  mocks.set('wall2_meet_day', () => day);
  const early = render(<Ribbon kind="work" now={() => t('20:30')} />);
  await flush();
  expect(early.container.querySelector('.rib')!.className).toBe('rib');
  early.unmount();
  const late = render(<Ribbon kind="work" now={() => t('21:15')} />);
  await flush();
  expect(late.container.querySelector('.rib')!.className).toBe('rib late');
});
