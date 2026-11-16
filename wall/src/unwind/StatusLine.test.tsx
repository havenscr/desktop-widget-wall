// @ts-ignore node's own file calls; this test reads the stylesheet as text.
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { lane, summary } from '../agents/fixtures';
import { resetSnooze, snooze } from '../agents/snooze';
import { resetAgents } from '../agents/useAgents';
import { mocks } from '../bridge/tauri';
import { useFocusStore } from '../focus/store';
import { AlarmChip } from '../home/AlarmChip';
import { useOpenAlarms, useSecurityFeed } from '../home/useSecurity';
import { usePacificTime } from '../ribbon/testZone';
import { usePlaceStore } from '../state/places';
import { HoverTipLayer, resetTip, TIP_DELAY_MS, TIP_REFRESH_MS } from '../ui/HoverTip';
import { StatusLine, STATUS_POLL_MS } from './StatusLine';
import { needsCard, statusCard, statusMarks, STATUS_MAX_DOTS, type FocusSeen, type StatusSummary } from './model';
import { drawnLine, statusLine, statusParts } from './statusTestUtil';

usePacificTime();

const A = 'a1b2c3d4-0001';
const B = 'a1b2c3d4-0002';
const NOW = new Date(2026, 10, 11, 10, 24).toISOString();
const running = (n: number) => Array.from({ length: n }, (_, i) => lane({ id: `r${String(i).padStart(3, '0')}`, state: 'working', live: 'working' }));
const waits = (id: string) => lane({ id, state: 'blocked', waiting: true, waitingSinceS: 120 });
const sum = (over: Partial<StatusSummary> = {}): StatusSummary => ({ lanes: [], yourMove: { total: 0 }, linksAvailable: true, ...over });

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const security = (alerts: number, over: Record<string, unknown> = {}) => ({ reachable: true, stale: false, lastScan: NOW, alerts, firewalla: { api: 'up', boxOnline: true, checkedAt: null, alarms24h: alerts }, portalUrl: null, ...over });
const unsetSecurity = () => useSecurityFeed.setState({ status: 'loading', summary: null, now: Date.now(), attempts: 0, readAt: null });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 11, 10, 24));
  localStorage.clear();
  resetSnooze();
  resetAgents();
  resetTip();
  unsetSecurity();
  useFocusStore.setState({ loaded: true });
  usePlaceStore.setState({ active: 'unwind' });
});
afterEach(() => {
  cleanup();
  resetSnooze();
  resetAgents();
  resetTip();
  unsetSecurity();
  mocks.clear();
  vi.useRealTimers();
});

/** Draw the line over the answers given; the tip layer is mounted so a card can be read. */
async function show(s: unknown, alerts = 0) {
  mocks.set('wall2_omni_summary', typeof s === 'function' ? (s as () => unknown) : () => s);
  mocks.set('wall2_home_security', () => security(alerts));
  const r = render(
    <>
      <StatusLine />
      <HoverTipLayer />
    </>,
  );
  await flush();
  return r;
}
/** The text of the card a button shows on keyboard focus. */
async function cardOf(button: Element): Promise<string> {
  fireEvent.focus(button);
  await flush(1);
  const text = document.querySelector('.hover-tip')?.textContent ?? '';
  fireEvent.blur(button);
  await flush(1);
  return text;
}
const work = () => document.querySelector('.u-cap-work') as HTMLButtonElement;
const pill = () => document.querySelector('.u-need') as HTMLButtonElement;

it('calm: the mark alone when nothing runs; one soft dot per running agent', async () => {
  await show(sum());
  expect(drawnLine()).toEqual({ mark: 'put-away', dots: 0, more: null, ring: false, net: null, pill: null });
  cleanup();
  await show(sum({ lanes: running(1) }));
  expect(drawnLine()).toMatchObject({ dots: 1, more: null, pill: null });
  cleanup();
  await show(sum({ lanes: running(2) }));
  expect(drawnLine()).toMatchObject({ dots: 2 });
});

it('six dots at most, then +N: six is six, seven is six and +1, twelve is six and +6', async () => {
  for (const [n, dots, more] of [[6, 6, null], [7, 6, '+1'], [12, 6, '+6']] as const) {
    await show(sum({ lanes: running(n), sessionsList: running(n) }));
    expect(drawnLine(), `${n} running`).toMatchObject({ dots, more });
    cleanup();
  }
  expect(STATUS_MAX_DOTS).toBe(6);
});

it('the capsule card carries the sentences the line used to say, and what a click does', async () => {
  await show(sum({ lanes: running(1) }));
  expect(await cardOf(work())).toBe('Work is put away1 agent still running. No agent needs you.Click to see the agents on Work');
  cleanup();
  await show(sum({ lanes: running(2) }));
  expect(await cardOf(work())).toContain('2 agents still running. No agent needs you.');
  cleanup();
  await show(sum());
  // Nothing running: the sentence for the agents is only "No agent needs you."
  expect(await cardOf(work())).toBe('Work is put awayNo agent needs you.Click to see the agents on Work');
});

it('a focus session on or paused changes the mark to focus-2 and the card title', async () => {
  for (const status of ['running', 'paused'] as const) {
    useFocusStore.setState({ loaded: true, state: { status, minutes: 25 } as never });
    await show(sum({ lanes: running(1) }));
    expect(drawnLine()).toMatchObject({ mark: 'focus', dots: 1 });
    expect((await cardOf(work())).startsWith('Focus is still on1 agent still running.')).toBe(true);
    cleanup();
  }
  useFocusStore.setState({ loaded: true, state: { status: 'idle' } as never });
  await show(sum());
  expect(drawnLine()?.mark).toBe('put-away');
});

it('before the focus store has loaded: nothing to say draws nothing, something to say draws it without claiming the work is put away', async () => {
  useFocusStore.setState({ loaded: false });
  await show(sum());
  expect(drawnLine()).toBeNull();
  expect(document.querySelector('.u-line')).toBeNull();
  cleanup();
  await show(sum({ lanes: running(1) }));
  expect(drawnLine()).toMatchObject({ dots: 1 });
  expect((await cardOf(work())).startsWith('Work1 agent still running.')).toBe(true);
  expect(document.body.textContent).not.toContain('put away');
});

it('a helper that is stale or failing draws one grey ring in place of the dots, never an all-clear', async () => {
  const stale = sum({ stale: true, lanes: running(3) });
  await show(stale);
  expect(drawnLine()).toMatchObject({ mark: 'put-away', dots: 0, ring: true, pill: null });
  const card = await cardOf(work());
  expect(card).toContain('Agents: no fresh answer');
  expect(card).not.toContain('No agent needs you');
  expect(card).not.toContain('still running');
  cleanup();
  await show(() => Promise.reject(new Error('Could not reach the service')));
  expect(drawnLine()).toMatchObject({ dots: 0, ring: true, pill: null });
  expect(await cardOf(work())).toContain('Agents: no fresh answer');
});

it('a helper that is not set up draws the mark alone: no ring, no dots, no claim about agents', async () => {
  await show(() => Promise.reject(new Error('not-configured')));
  expect(drawnLine()).toEqual({ mark: 'put-away', dots: 0, more: null, ring: false, net: null, pill: null });
  expect(await cardOf(work())).toBe('Work is put awayClick to see the agents on Work');
});

it('a read that fails after a good one turns the dots into the ring', async () => {
  let fail = false;
  await show(() => (fail ? Promise.reject(new Error('down')) : sum({ lanes: running(2) })));
  expect(drawnLine()).toMatchObject({ dots: 2, ring: false });
  fail = true;
  await flush(60_000);
  expect(drawnLine()).toMatchObject({ dots: 0, ring: true });
});

it('one thing waits: the amber pill in words; its click opens that chat through the bridge', async () => {
  const opened: unknown[] = [];
  mocks.set('wall2_open_session', (a) => void opened.push(a));
  await show(sum({ lanes: [...running(1), waits(A)], yourMove: { total: 1, first: { sessionId: A } } }));
  expect(drawnLine()).toMatchObject({ dots: 1, pill: 'One thing needs you' });
  expect(await cardOf(pill())).toBe('One chat is waiting for youClick to open it');
  fireEvent.click(pill());
  await flush();
  expect(opened).toEqual([{ id: A }]);
});

it('several wait: the count in words, the first waiting chat opens; with no link it goes to Work', async () => {
  const opened: unknown[] = [];
  mocks.set('wall2_open_session', (a) => void opened.push(a));
  const two = { lanes: [waits(A), waits(B)], yourMove: { total: 2, first: { sessionId: A }, ids: [A, B] } };
  await show(sum(two));
  expect(drawnLine()).toMatchObject({ pill: '2 things need you' });
  expect(await cardOf(pill())).toBe('2 chats are waiting for youClick to open the first one');
  fireEvent.click(pill());
  expect(opened).toEqual([{ id: A }]);
  cleanup();
  await show(sum({ ...two, linksAvailable: false }));
  expect(await cardOf(pill())).toBe('2 chats are waiting for youClick to see them on Work');
  fireEvent.click(pill());
  expect(usePlaceStore.getState().active).toBe('work');
  expect(opened).toEqual([{ id: A }]);
});

it('a waiting lane the helper total misses still shows the pill', async () => {
  await show(sum({ lanes: [lane({ id: A, state: 'working', waiting: true })], yourMove: { total: 0 } }));
  expect(drawnLine()).toMatchObject({ dots: 0, pill: 'One thing needs you' });
});

// jsdom does not turn Enter or Space on a button into a click (the browser does, for a real `button`), and
// `@testing-library/user-event` is not installed. So this checks what makes the keys work (a real button, in the tab
// order, no key handler of its own, named for a screen reader); the keys themselves are checked in a real browser
// (see the pull request) and the destination of each control below.
it('every control is a real button in the tab order, so Enter and Space act as a click', async () => {
  await show(sum({ lanes: [...running(1), waits(A)], yourMove: { total: 1, first: { sessionId: A } } }), 4);
  const buttons = [...document.querySelectorAll('.u-line button')] as HTMLButtonElement[];
  expect(buttons.map((b) => b.className.split(' ')[0])).toEqual(['u-cap-work', 'u-cap-net', 'u-need']);
  for (const b of buttons) {
    expect(b.tagName).toBe('BUTTON');
    expect(b.type).toBe('button');
    expect(b.tabIndex).toBeGreaterThanOrEqual(0);
    expect(b.disabled).toBe(false);
    expect(b.getAttribute('aria-label') ?? b.textContent).toBeTruthy();
    expect(b.getAttribute('title')).toBeNull();
    expect(b.getAttribute('onkeydown')).toBeNull();
  }
});

it.each([
  ['the capsule', '.u-cap-work', 'work', null, true],
  ['the alerts button', '.u-cap-net', 'home', null, true],
  ['the amber pill with a link', '.u-need', 'unwind', A, true],
  ['the amber pill without a link', '.u-need', 'work', null, false],
] as const)('%s goes to its destination on a click', async (_name, selector, place, opened, links) => {
  const calls: unknown[] = [];
  mocks.set('wall2_open_session', (a) => void calls.push(a));
  await show(sum({ lanes: [...running(1), waits(A)], yourMove: { total: 1, first: { sessionId: A } }, linksAvailable: links }), 4);
  fireEvent.click(document.querySelector(selector)!);
  await flush();
  expect(usePlaceStore.getState().active).toBe(place);
  expect(calls).toEqual(opened ? [{ id: opened }] : []);
});

it('snoozed chats stay quiet: no pill, the card leaves the needs sentence out; one unsnoozed chat still shows', async () => {
  const one = summary({ now: NOW, lanes: [...running(1), waits(A)], yourMove: { total: 1, first: { sessionId: A, title: 'A', kind: 'gate', since: null, question: '' }, ids: [A] } });
  snooze(A, one);
  await show(one);
  expect(drawnLine()).toMatchObject({ dots: 1, pill: null });
  const card = await cardOf(work());
  expect(card).toContain('1 agent still running.');
  expect(card).not.toContain('needs you');
  expect(card).not.toContain('need you');
  cleanup();
  const both = summary({ now: NOW, lanes: [waits(A), waits(B)], yourMove: { total: 2, first: { sessionId: A, title: 'A', kind: 'gate', since: null, question: '' }, ids: [A, B] } });
  snooze(A, both);
  const opened: unknown[] = [];
  mocks.set('wall2_open_session', (a) => void opened.push(a));
  await show(both);
  expect(drawnLine()?.pill).toBe('One thing needs you');
  fireEvent.click(pill());
  expect(opened).toEqual([{ id: B }]);
});

it('network alerts: a shield and the count inside the capsule, 1, 4 and 12; a click goes to Home; no good read, no button', async () => {
  for (const n of [1, 4, 12]) {
    await show(sum({ lanes: running(2) }), n);
    expect(drawnLine(), `${n} alerts`).toMatchObject({ dots: 2, net: String(n) });
    const net = document.querySelector('.u-cap-net') as HTMLButtonElement;
    expect(net.querySelector('svg.tabler-icon-shield-exclamation')).not.toBeNull();
    expect(net.getAttribute('aria-label')).toBe(`${n === 1 ? '1 network alert' : `${n} network alerts`}. Show them on Home`);
    expect(await cardOf(net)).toContain(`${n === 1 ? 'An alert is' : `${n} alerts are`} open on the home network`);
    usePlaceStore.setState({ active: 'unwind' });
    fireEvent.click(net);
    expect(usePlaceStore.getState().active).toBe('home');
    cleanup();
    unsetSecurity();
  }
  await show(sum({ lanes: running(2) }), 4);
  expect(drawnLine()?.net).toBe('4');
  cleanup();
  mocks.set('wall2_omni_summary', () => sum({ lanes: running(2) }));
  mocks.set('wall2_home_security', () => security(4, { reachable: false }));
  unsetSecurity();
  render(<StatusLine />);
  await flush();
  expect(drawnLine()).toMatchObject({ dots: 2, net: null });
  expect(document.querySelector('.u-cap.has-net')).toBeNull();
});

it('alerts alone, with the focus store not loaded, still draw the capsule', async () => {
  useFocusStore.setState({ loaded: false });
  await show(sum(), 3);
  expect(drawnLine()).toMatchObject({ dots: 0, net: '3' });
});

/** Rule 1: the old sentence and the new marks agree, for every summary, focus and snooze set in this table. */
const FOCUS: FocusSeen[] = ['unknown', 'on', 'off'];
const TABLE: [string, StatusSummary | null, string[]][] = [
  ['no helper', null, []],
  ['stale', sum({ stale: true, lanes: running(2), yourMove: { total: 2 } }), []],
  ['calm', sum(), []],
  ['one running', sum({ lanes: running(1) }), []],
  ['two running, one in review', sum({ lanes: [...running(2), lane({ id: 'rv', state: 'review' })] }), []],
  ['seven running', sum({ lanes: running(7) }), []],
  ['twelve running in the list, three lanes', sum({ lanes: running(3), sessionsList: running(12) }), []],
  ['helper work only', sum({ lanes: [lane({ id: 'h', live: 'idle', bg: { agents: 1, shells: 0 } })] }), []],
  ['idle working lane', sum({ lanes: [lane({ id: 'i', live: 'idle' })] }), []],
  ['one waiting', sum({ lanes: [waits(A)], yourMove: { total: 1, first: { sessionId: A } } }), []],
  ['one waiting, no link', sum({ lanes: [waits(A)], yourMove: { total: 1, first: { sessionId: A } }, linksAvailable: false }), []],
  ['one running, one waiting', sum({ lanes: [...running(1), waits(A)], yourMove: { total: 1, first: { sessionId: A } } }), []],
  ['two waiting', sum({ lanes: [waits(A), waits(B)], yourMove: { total: 2, first: { sessionId: A }, ids: [A, B] } }), []],
  ['helper total lower than waiting lanes', sum({ lanes: [waits(A), waits(B)], yourMove: { total: 1 } }), []],
  ['helper total with no lane', sum({ lanes: [], yourMove: { total: 3 } }), []],
  ['total not a number', sum({ lanes: running(1), yourMove: { total: Number.NaN } }), []],
  ['total infinite', sum({ lanes: [], yourMove: { total: Infinity } }), []],
  ['total missing', sum({ lanes: running(1), yourMove: {} as { total: number } }), []],
  ['snoozed only', sum({ lanes: [waits(A)], yourMove: { total: 1, first: { sessionId: A }, ids: [A] } }), [A]],
  ['one snoozed, one not', sum({ lanes: [waits(A), waits(B)], yourMove: { total: 2, first: { sessionId: A }, ids: [A, B] } }), [A]],
  ['both snoozed', sum({ lanes: [waits(A), waits(B)], yourMove: { total: 2, first: { sessionId: A }, ids: [A, B] } }), [A, B]],
];
/** What the old sentence says as numbers: running (or null when not said), needs (or null when not said). */
function fromSentence(parts: ReturnType<typeof statusParts>): { running: number | null; needs: number | null } {
  const run = parts.find((p) => p.kind === 'running')?.text.match(/^(\d+)/)?.[1];
  const needs = parts.find((p) => p.kind === 'needs');
  const none = parts.some((p) => p.kind === 'text' && p.text === 'No agent needs you.');
  const n = needs ? (needs.text.startsWith('One') ? 1 : Number(needs.text.match(/^(\d+)/)?.[1])) : none ? 0 : null;
  return { running: run ? Number(run) : null, needs: n };
}
it('table: for every summary the old sentence and the new marks agree on running, needs and what opens', () => {
  for (const focus of FOCUS) {
    for (const [name, s, snoozed] of TABLE) {
      const set = new Set(snoozed);
      const parts = statusParts(focus, s, set);
      const said = fromSentence(parts);
      const m = statusMarks(focus, s, set);
      const where = `${name}, focus ${focus}`;
      expect(m.running, `${where}: running`).toBe(said.running ?? 0);
      expect(m.agents === 'current' ? m.needs : null, `${where}: needs`).toBe(said.needs);
      const open = parts.find((p) => p.kind === 'needs');
      expect(m.open, `${where}: open`).toBe(open && open.kind === 'needs' ? open.open : null);
      // Not current: the old line says nothing about agents, and the marks carry no count.
      if (m.agents !== 'current') expect([m.running, m.needs], where).toEqual([0, null]);
      // The card's sentences are the old sentences for the agent parts (the focus sentence is the card's title).
      const card = statusCard(m);
      const old = statusLine(focus, s, set).replace(/^(Work is put away|Focus is still on)\.\s*/, '');
      if (m.agents === 'current' && !(m.needs === 0 && m.snoozedWaiting > 0)) expect(card.detail, `${where}: card`).toBe(old);
      if (m.agents === 'current' && m.needs === 0 && m.snoozedWaiting > 0) expect(card.detail, `${where}: card without the needs sentence`).toBe(old.replace(/\s*No agent needs you\.$/, ''));
      expect(needsCard(Math.max(1, m.needs ?? 1), !!m.open).title).toMatch(/waiting for you$/);
    }
  }
});

it('table: the alerts count on the button is the count the old chip said', async () => {
  for (const n of [1, 4, 12, 99]) {
    mocks.set('wall2_home_security', () => security(n));
    const r = render(
      <>
        <AlarmChip className="old" period />
        <AlarmChip className="new" mark />
      </>,
    );
    await flush();
    const oldText = (r.container.querySelector('.old') as HTMLElement).textContent;
    expect(oldText).toBe(`${n} network alert${n === 1 ? '' : 's'}.`);
    expect((r.container.querySelector('.new') as HTMLElement).textContent).toBe(String(n));
    cleanup();
    unsetSecurity();
  }
});

/** An answer that changes between reads: the first call gets `first`, every later one `later`. */
const changing = (first: StatusSummary, later: StatusSummary) => {
  let calls = 0;
  return () => (++calls === 1 ? first : later);
};
/** Rest on (or focus) a control, let the next helper read land, and give the open card its redraw. */
async function openAcrossARead(selector: string, how: 'hover' | 'focus') {
  const el = document.querySelector(selector)!;
  if (how === 'hover') fireEvent.mouseEnter(el);
  else fireEvent.focus(el);
  await flush(TIP_DELAY_MS + 1);
  const before = document.querySelector('.hover-tip')?.textContent ?? '';
  await flush(STATUS_POLL_MS);
  await flush(TIP_REFRESH_MS);
  return { before, after: document.querySelector('.hover-tip')?.textContent ?? '' };
}

it.each(['hover', 'focus'] as const)("a capsule card that is open (%s) across a read that sends an agent from running to waiting does not keep the old sentence", async (how) => {
  await show(changing(sum({ lanes: running(1) }), sum({ lanes: [waits(A)], yourMove: { total: 1, first: { sessionId: A } } })));
  const { before, after } = await openAcrossARead('.u-cap-work', how);
  expect(before).toContain('1 agent still running. No agent needs you.');
  expect(after).toContain('One thing needs you.');
  expect(after).not.toContain('No agent needs you');
  expect(after).not.toContain('still running');
  expect(drawnLine()).toMatchObject({ dots: 0, pill: 'One thing needs you' });
});

it.each(['hover', 'focus'] as const)('a pill card that is open (%s) across a read that sends one waiting chat to two shows the new title and hint', async (how) => {
  await show(
    changing(
      sum({ lanes: [waits(A)], yourMove: { total: 1, first: { sessionId: A }, ids: [A] } }),
      sum({ lanes: [waits(A), waits(B)], yourMove: { total: 2, first: { sessionId: A }, ids: [A, B] } }),
    ),
  );
  const { before, after } = await openAcrossARead('.u-need', how);
  expect(before).toBe('One chat is waiting for youClick to open it');
  expect(after).toBe('2 chats are waiting for youClick to open the first one');
});

/** The timers the shared security read keeps (its poll and its clock), measured with nothing else rendered. */
function Probe() {
  useOpenAlarms();
  return null;
}
it('draws no timers of its own: exactly the helper poll on top of the shared security read, in every state', async () => {
  mocks.set('wall2_home_security', () => security(0));
  mocks.set('wall2_omni_summary', () => sum());
  const probe = render(<Probe />);
  await flush();
  const base = vi.getTimerCount();
  probe.unmount();
  cleanup();
  for (const [name, s, alarms] of [
    ['calm', sum(), 0],
    ['busy', sum({ lanes: [...running(7), waits(A)], yourMove: { total: 1, first: { sessionId: A } } }), 12],
  ] as const) {
    await show(s, alarms);
    expect(vi.getTimerCount(), name).toBe(base + 1);
    await flush(1000);
    expect(vi.getTimerCount(), `${name}, a second later`).toBe(base + 1);
    cleanup();
    unsetSecurity();
  }
});

const ALL_CSS = readFileSync('src/styles/unwind.css', 'utf8');
/** Only the status line's rules (the rest of the file animates other things). */
const CSS = ALL_CSS.slice(ALL_CSS.indexOf('/* The status line along the bottom'), ALL_CSS.indexOf('/* Centre: tabs, then now playing. */'));
const rule = (selector: string) => CSS.match(new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`))?.[2] ?? '';
it('nothing blinks: the dots, ring and pill fade in once over 400 ms (opacity only), and just appear under reduced motion', () => {
  for (const sel of ['.u-dot', '.u-ring', '.u-need']) expect(rule(sel), sel).toMatch(/animation: u-mark-in 400ms ease-out;/);
  expect(CSS).not.toMatch(/animation:[^;]*infinite/);
  const frames = CSS.match(/@keyframes u-mark-in \{([^@]*?)\n\}/)?.[1] ?? '';
  expect(frames.replace(/\s+/g, ' ').trim()).toBe('from { opacity: 0; }');
  const reduced = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce) {\n  .u-dot'));
  expect(reduced.slice(0, reduced.indexOf('\n}\n') + 3)).toMatch(/\.u-dot,\s*\.u-ring,\s*\.u-need \{\s*animation: none;/);
});

it('every text is 16 px or more', () => {
  expect(rule('.u-line')).toMatch(/font-size: 19px;/);
  expect(rule('.u-more')).toMatch(/font: 600 16px/);
  expect(rule('.u-cap .u-cap-net')).toMatch(/font: 600 17px/);
});
