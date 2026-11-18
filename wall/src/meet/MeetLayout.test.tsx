import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LIBRARY_DATA } from '../bridge/devMocks/libraryData';
import { mocks } from '../bridge/tauri';
import { usePlaceStore } from '../state/places';
import { useSignalStore } from '../signals/store';
import type { CallSignal } from '../signals/model';
import { resetTools } from '../tools/store';
import { HoverTipLayer, resetTip, TIP_DELAY_MS } from '../ui/HoverTip';
import { resetLibIndex } from '../work/keyLibrary';
import { Meet } from './Meet';
import { resetMeetStore, useMeetStore } from './meetStore';
import { occurrenceId, type Meeting, type MeetingDetails, type MeetData } from './model';

// Fake timers step through several minutes here, and the limit is generous for a slow runner.
vi.setConfig({ testTimeout: 20_000 });

const NOW = Date.parse('2026-11-12T17:00:00Z');
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
    { name: 'Eli Navarro', reply: 'yes' },
    { name: 'Robin Okafor', reply: 'maybe' },
    { name: 'Tariq Lindgren', reply: 'no' },
    { name: 'Noor Haddad', reply: 'none' },
  ],
  peopleMore: 0,
  invite: 'Walk through the sizing options, then agree who owns each next step.',
};
const m = (key: string, title: string, from: number, to: number, over: Partial<Meeting> = {}): Meeting => ({ key, accountId: 'work', title, start: at(from), end: at(to), canJoin: false, ...over });
const accounts = [{ id: 'work', label: 'Work', state: 'ok' as const }];
let sent: { command: string; args?: unknown }[] = [];

const serve = (meetings: Meeting[], extra: { checklist?: string[]; day?: unknown[] } = {}) => {
  const data: MeetData = { accounts, meetings };
  mocks.set('wall2_meet_next', () => data);
  mocks.set('wall2_meet_day', () => ({ accounts, events: extra.day ?? [] }));
  mocks.set('wall2_meet_checklist', () => ({ state: extra.checklist ? 'ok' : 'missing', items: extra.checklist ?? [], reason: null }));
  mocks.set('wall2_keys_library', () => LIBRARY_DATA);
  for (const c of ['wall2_keys_send_library', 'wall2_meet_join', 'wall2_open_event', 'wall2_onair_mark', 'wall2_onair_open', 'wall2_meet_checklist_open']) {
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
const tipWords = async (el: Element) => {
  fireEvent.mouseEnter(el);
  await flush(TIP_DELAY_MS);
  const words = screen.getByRole('tooltip').textContent ?? '';
  fireEvent.mouseLeave(el);
  await flush(10);
  return words;
};
const heroOf = (c: HTMLElement) => c.querySelector('.meet-hero') as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  sent = [];
  resetTools();
  resetLibIndex();
  resetMeetStore();
  usePlaceStore.setState({ active: 'meet' });
  useSignalStore.setState({ known: true, call: null, recording: false, leave: null });
});
afterEach(() => {
  resetTip();
  vi.useRealTimers();
  mocks.clear();
  usePlaceStore.setState({ active: 'work' });
  useSignalStore.setState({ known: false, call: null, recording: false, leave: null });
});

it('during a Teams call the keys are Mute, Camera, Share and Leave, and each press sends its library key', async () => {
  serve([m('1-0', 'Design review', -10, 20, { canJoin: true, details }), m('1-1', 'Lunch', 50, 110)]);
  await setCall(call());
  await renderMeet();
  const keys = within(screen.getByLabelText('Call keys'));
  expect(keys.getAllByRole('button').slice(0, 4).map((b) => b.getAttribute('aria-label'))).toEqual(['Mute', 'Camera off', 'Share', 'Leave']);
  for (const [label, id] of [['Mute', 'teams-mute'], ['Camera off', 'teams-camera'], ['Share', 'teams-share'], ['Leave', 'teams-leave']]) {
    sent = [];
    fireEvent.click(keys.getByRole('button', { name: label }));
    await flush(600);
    expect(sent.filter((s) => s.command === 'wall2_keys_send_library')).toEqual([{ command: 'wall2_keys_send_library', args: { id } }]);
  }
  // Join and Open invite are for before or between calls.
  expect(screen.queryByRole('button', { name: /^Join/ })).toBeNull();
  expect(screen.getByText('In call, Teams')).toBeTruthy();
  expect(screen.getByLabelText('Leave').className).toContain('red');
});

it('a Zoom call sends the Zoom keys', async () => {
  serve([m('1-0', 'Design review', -10, 20, { details })]);
  await setCall(call({ kind: 'zoom' }));
  await renderMeet();
  fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
  await flush(600);
  fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
  await flush(600);
  expect(sent.filter((s) => s.command === 'wall2_keys_send_library').map((s) => (s.args as { id: string }).id)).toEqual(['zoom-mute', 'zoom-leave']);
  expect(screen.getByText('In call, Zoom')).toBeTruthy();
});

it('the Camera key reads on or off from the camera signal, and Mute never claims a state', async () => {
  serve([m('1-0', 'Design review', -10, 20, { details })]);
  await setCall(call({ camera: true }));
  const { container } = await renderMeet();
  expect(screen.getByRole('button', { name: 'Camera on' }).className).toContain('cy');
  expect(screen.getByRole('button', { name: 'Mute' }).className).not.toContain('cy');
  expect(screen.queryByText(/Mic on|Muted|Unmuted/)).toBeNull();
  await setCall(call({ camera: false }));
  expect(screen.getByRole('button', { name: 'Camera off' }).className).not.toContain('cy');
  expect(heroOf(container).textContent).not.toMatch(/Mic on/);
});

it('hovering Mute says what it sends and that the wall cannot see mute', async () => {
  serve([m('1-0', 'Design review', -10, 20, { details })]);
  await setCall(call());
  await renderMeet();
  expect(await tipWords(screen.getByRole('button', { name: 'Mute' }))).toBe('Sends Ctrl+Shift+M to Teams. The wall cannot see whether you are muted.');
  expect(await tipWords(screen.getByRole('button', { name: 'Leave' }))).toContain('Ctrl+Shift+H');
});

it('a call in the browser draws the four keys dashed and disabled, and a press sends nothing', async () => {
  serve([m('1-0', 'Design review', -10, 20, { details })]);
  await setCall(call({ kind: 'browser' }));
  await renderMeet();
  const keys = screen.getByLabelText('Call keys');
  const buttons = within(keys).getAllByRole('button');
  expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Mute', 'Camera', 'Share', 'Leave', 'Raise hand', 'Reactions', 'Chat panel', 'Open in browser']);
  for (const b of buttons) {
    expect(b.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(b);
  }
  for (const b of buttons.slice(0, 4)) expect(b.className).toContain('dashed');
  await flush(600);
  expect(sent.filter((s) => s.command === 'wall2_keys_send_library')).toEqual([]);
  expect(await tipWords(buttons[0])).toBe('A call in the browser takes no shortcuts from the wall');
  expect(screen.getByText('In call, browser')).toBeTruthy();
});

it('before a call: Join (filled within 15 minutes) and Open invite, from the matching day event', async () => {
  const hero = m('1-0', 'Design review', 10, 40, { canJoin: true, details });
  serve([hero, m('1-1', 'Lunch', 70, 130)], {
    day: [
      { key: 'd-other', accountId: 'work', title: 'Design review', start: at(11), end: at(40), canOpen: true },
      { key: 'd-hero', accountId: 'work', title: 'Design review', start: hero.start, end: hero.end, canOpen: true },
    ],
  });
  await renderMeet();
  const join = screen.getByRole('button', { name: 'Join: Design review' });
  expect(join.className).toContain('urgent');
  fireEvent.click(join);
  expect(sent).toContainEqual({ command: 'wall2_meet_join', args: { key: '1-0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Open invite' }));
  expect(sent).toContainEqual({ command: 'wall2_open_event', args: { key: 'd-hero' } });
  expect(screen.getByText('The wall switches to the call by itself when it starts.')).toBeTruthy();
  expect(screen.getByText('Next, in 10 min')).toBeTruthy();
});

it('Join is filled even when the meeting is far off (no glow), and Open invite is absent when no day event matches', async () => {
  serve([m('1-0', 'Design review', 90, 120, { canJoin: true })], { day: [{ key: 'd1', accountId: 'work', title: 'Another', start: at(90), end: at(120), canOpen: true }] });
  await renderMeet();
  const far = screen.getByRole('button', { name: 'Join: Design review' });
  expect(far.className).toBe('meet-key join');
  expect(far.className).not.toContain('quiet');
  expect(screen.queryByRole('button', { name: 'Open invite' })).toBeNull();
});

it('a meeting with no join link and nothing to open says so instead of leaving a gap', async () => {
  serve([m('1-0', 'Lunch with Sam', 30, 90)]);
  const { container } = await renderMeet();
  expect(within(heroOf(container)).getByText('No join link')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Join/ })).toBeNull();
});

it('the hero says who called, how many are invited and how they replied; a person who declined is not drawn', async () => {
  serve([m('1-0', 'Design review', -10, 20, { details })]);
  await setCall(call());
  const { container } = await renderMeet();
  const hero = heroOf(container);
  expect(within(hero).getByText('Called by Casey Rowe · Work')).toBeTruthy();
  expect(within(hero).getByText('6 invited')).toBeTruthy();
  expect(within(hero).getByText('3 said yes, 1 maybe')).toBeTruthy();
  const circles = [...hero.querySelectorAll('.meet-ppl-row .meet-ini')].map((e) => e.querySelector('.meet-ini-t')?.textContent);
  // Six invited, one declined: five drawn, so five circles and no "+N".
  expect(circles).toEqual(['CR', 'DW', 'EN', 'RO', 'NH']);
  expect(circles.join(' ')).not.toContain('TL');
  // The invite's words stay in the island; the hero no longer draws them.
  expect(hero.textContent).not.toContain('Walk through the sizing options');
  // The status row carries the time of day and a red dot's words.
  expect(hero.querySelector('.meet-time')?.textContent).toMatch(/^\d{1,2}:\d{2}[AP]M$/);
  // The ring is minutes left, in violet during a call.
  expect(hero.querySelector('.meet-ring-n')?.textContent).toBe('20');
  expect(hero.querySelector('.meet-ring-dial')?.getAttribute('data-tone')).toBe('violet');
  expect(hero.textContent).toContain('min left');
});

it('with no invite text the agenda line is hidden, and with no details there is no people block', async () => {
  serve([m('1-0', 'Catch-up', -10, 20, { details: null })]);
  await setCall(call());
  const { container } = await renderMeet();
  const hero = heroOf(container);
  expect(hero.querySelector('.meet-agenda')).toBeNull();
  expect(hero.querySelector('.meet-ppl')).toBeNull();
  expect(hero.textContent).not.toContain('Called by');
  expect(within(hero).getByText('Work')).toBeTruthy();
});

it('a title over 50 characters is marked long (32 px, three lines), a short one is not', async () => {
  serve([m('1-0', 'x'.repeat(51), -10, 20)]);
  const first = await renderMeet();
  expect(first.container.querySelector('.meet-hero-title')?.getAttribute('data-long')).toBe('true');
  first.unmount();
  serve([m('1-0', 'x'.repeat(50), -10, 20)]);
  const second = await renderMeet();
  expect(second.container.querySelector('.meet-hero-title')?.getAttribute('data-long')).toBeNull();
});

it('"Now" with a cyan dot when the meeting has started and no call is sensed', async () => {
  serve([m('1-0', 'Design review', -10, 20)]);
  const { container } = await renderMeet();
  expect(screen.getByText('Now')).toBeTruthy();
  expect(container.querySelector('.meet-st')?.getAttribute('data-tone')).toBe('now');
  expect(container.querySelector('.meet-ring-dial')?.getAttribute('data-tone')).toBe('cyan');
});

it('the ring turns amber with 10 minutes or less left', async () => {
  serve([m('1-0', 'Design review', -50, 10)]);
  await setCall(call());
  const { container } = await renderMeet();
  expect(container.querySelector('.meet-ring-dial')?.getAttribute('data-tone')).toBe('amber');
});

const next = (c: HTMLElement) => c.querySelector('.meet-later') as HTMLElement;

it('the Next card: "After this" before the hero starts, with the title, time, Join and two later lines', async () => {
  serve([
    m('1-0', 'Design review', 10, 40),
    m('1-1', 'Architecture session', 100, 160, { canJoin: true }),
    m('1-2', 'Budget alignment', 200, 260),
    m('1-3', 'Quarterly planning', 300, 360),
  ]);
  const { container } = await renderMeet();
  const card = within(next(container));
  expect(card.getByText('After this')).toBeTruthy();
  expect(card.getByText('3 more today')).toBeTruthy();
  expect(card.getByText('Architecture session')).toBeTruthy();
  expect(card.getByRole('button', { name: 'Join: Architecture session' })).toBeTruthy();
  expect(card.getByText('Later')).toBeTruthy();
  expect(card.getByText('Budget alignment')).toBeTruthy();
  expect(card.getByText('Quarterly planning')).toBeTruthy();
  expect(card.queryByText(/more today, the last ends/)).toBeNull();
  expect(card.queryByText('Starts as this one ends')).toBeNull();
});

it('the Next card in a call is "Next", and past two later lines it counts the rest and names when the last ends', async () => {
  serve([
    m('1-0', 'Design review', -10, 20),
    m('1-1', 'A', 60, 90),
    m('1-2', 'B', 100, 130),
    m('1-3', 'C', 140, 170),
    m('1-4', 'D', 180, 210),
    m('1-5', 'E', 220, 250),
  ]);
  await setCall(call());
  const { container } = await renderMeet();
  const card = within(next(container));
  expect(card.getByText('Next')).toBeTruthy();
  expect(card.getByText('5 more today')).toBeTruthy();
  expect(card.getByText(/^\+2 more today, the last ends \d+(:\d\d)? [AP]M$/)).toBeTruthy();
  expect(card.queryByText('D')).toBeNull();
  expect(card.getByText('C')).toBeTruthy();
});

it('back to back: amber "Next, back to back", Join, and "Starts as this one ends"', async () => {
  serve([m('1-0', 'Escalation review', -50, 10), m('1-1', 'Architecture session', 11, 70, { canJoin: true })]);
  await setCall(call());
  const { container } = await renderMeet();
  const card = within(next(container));
  expect(card.getByText('Next, back to back').getAttribute('data-amber')).toBe('true');
  expect(card.getByText('Starts as this one ends')).toBeTruthy();
  expect(card.getByRole('button', { name: 'Join: Architecture session' })).toBeTruthy();
});

it('"Leave by" shows in cyan when the leave signal is for the meeting after the hero', async () => {
  serve([m('1-0', 'Design review', -10, 20), m('1-1', 'Lunch with Sam', 60, 120)]);
  await setCall(call());
  act(() => useSignalStore.setState({ leave: { key: 'travel', leaveAt: NOW + 40 * 60_000, startsAt: NOW + 60 * 60_000 } }));
  const { container } = await renderMeet();
  const line = within(next(container)).getByText(/^Leave by \d+(:\d\d)? [AP]M, \d+ min after this$/);
  expect(line.className).toContain('cyan');
  // A leave signal for some other meeting shows nothing here.
  act(() => useSignalStore.setState({ leave: { key: 'travel', leaveAt: NOW + 40 * 60_000, startsAt: NOW + 200 * 60_000 } }));
  expect(within(next(container)).queryByText(/^Leave by/)).toBeNull();
});

it('nothing after the hero: the card keeps its place and says "Nothing else today"', async () => {
  serve([m('1-0', 'Design review', -10, 20)]);
  const { container } = await renderMeet();
  expect(next(container).textContent).toContain('Nothing else today');
  expect(next(container).textContent).toContain('After this');
});

it('a long title in the Next card has its full text on hover', async () => {
  const title = 'Architecture working session on the shared data platform migration and rollout order';
  serve([m('1-0', 'Design review', -10, 20), m('1-1', title, 60, 120)]);
  await renderMeet();
  expect(screen.getByText(title).getAttribute('data-long')).toBe('true');
  expect(await tipWords(screen.getByText(title))).toBe(title);
});

const island = (c: HTMLElement) => c.querySelector('.meet-island') as HTMLElement;
const heading = (c: HTMLElement) => island(c).querySelector('.meet-isl-hd .k')?.textContent;

it('the island opens on the invite; an arrow, an Also on file row and the dots change the large kind; nothing turns by itself', async () => {
  serve([m('1-0', 'Design review', -10, 20, { details })], { checklist: ['Who decides', 'Next step'] });
  const { container } = await renderMeet();
  expect(heading(container)).toBe('The invite');
  const isl = within(island(container));
  expect(isl.getByText('Also on file')).toBeTruthy();
  expect(isl.getByText('From the calendar invite')).toBeTruthy();
  expect(island(container).querySelector('.meet-isl-invite')?.textContent).toBe(details.invite);
  // Nothing turns by itself.
  await flush(5 * 60_000);
  expect(heading(container)).toBe('The invite');
  fireEvent.click(isl.getByRole('button', { name: 'Next' }));
  expect(heading(container)).toBe('Who is coming');
  expect(isl.getByText('From the invite')).toBeTruthy();
  expect(isl.getByText('Dana Whitfield')).toBeTruthy();
  expect(isl.getByText('Declined')).toBeTruthy();
  fireEvent.click(isl.getByRole('button', { name: 'Next' }));
  expect(heading(container)).toBe('Your first-meeting list');
  expect(isl.getByText('From meet-checklist.txt')).toBeTruthy();
  fireEvent.click(isl.getByRole('button', { name: 'Next' }));
  expect(heading(container)).toBe('The invite');
  fireEvent.click(isl.getByRole('button', { name: 'Previous' }));
  expect(heading(container)).toBe('Your first-meeting list');
  // A click on an index row shows that kind large; the dots do the same.
  fireEvent.click(isl.getByRole('button', { name: /^The invite/ }));
  expect(heading(container)).toBe('The invite');
  fireEvent.click(isl.getByRole('tab', { name: 'Who is coming' }));
  expect(heading(container)).toBe('Who is coming');
  expect(isl.getByRole('tab', { name: 'Who is coming' }).getAttribute('aria-selected')).toBe('true');
  // The footer carries only the arrows and dots; no line repeats the kinds.
  expect(isl.queryByText(/^Order:/)).toBeNull();
});

it('with one kind there is no index, no arrows and no dots', async () => {
  serve([m('1-0', 'Design review', -10, 20, { details: { ...details, people: [], peopleMore: 0 } })]);
  const { container } = await renderMeet();
  expect(heading(container)).toBe('The invite');
  expect(screen.queryByText('Also on file')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  expect(screen.queryByRole('tablist')).toBeNull();
});

it('with no kind at all the island explains the checklist file and its Open file button opens it', async () => {
  serve([m('1-0', 'Catch-up', -10, 20, { details: null })]);
  const { container } = await renderMeet();
  const isl = within(island(container));
  expect(heading(container)).toBe('Your first-meeting list');
  expect(isl.getByText(/meet-checklist\.txt, one item a line/)).toBeTruthy();
  expect(island(container).querySelectorAll('.meet-isl-how')).toHaveLength(3);
  fireEvent.click(isl.getByRole('button', { name: 'Open file' }));
  await flush(10);
  expect(sent).toContainEqual({ command: 'wall2_meet_checklist_open', args: undefined });
});

it('a refused checklist file says why in the how-to', async () => {
  serve([m('1-0', 'Catch-up', -10, 20, { details: null })]);
  mocks.set('wall2_meet_checklist', () => ({ state: 'refused', items: [], reason: 'meet-checklist.txt is over 4 KB' }));
  const { container } = await renderMeet();
  expect(island(container).textContent).toContain('meet-checklist.txt is over 4 KB');
});

it('the checklist ticks an item for this meeting only', async () => {
  const meetings = [m('1-0', 'Design review', -10, 20), m('1-1', 'Lunch', 60, 90)];
  serve(meetings, { checklist: ['Who decides', 'Next step'] });
  const { container } = await renderMeet();
  const isl = within(island(container));
  const item = isl.getByRole('checkbox', { name: /Who decides/ });
  expect(item.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(item);
  expect(isl.getByRole('checkbox', { name: /Who decides/ }).getAttribute('aria-checked')).toBe('true');
  expect(isl.getByRole('checkbox', { name: /Next step/ }).getAttribute('aria-checked')).toBe('false');
  expect(useMeetStore.getState().ticks).toEqual({ [occurrenceId(meetings[0])]: [0] });
  // The next meeting starts with a clean list.
  serve([m('1-5', 'Other', -10, 20)], { checklist: ['Who decides', 'Next step'] });
  await flush(5 * 60_000 + 10);
  expect(within(island(container)).getByRole('checkbox', { name: /Who decides/ }).getAttribute('aria-checked')).toBe('false');
  // Ticking again takes the tick back.
  fireEvent.click(within(island(container)).getByRole('checkbox', { name: /Who decides/ }));
  fireEvent.click(within(island(container)).getByRole('checkbox', { name: /Who decides/ }));
  expect(useMeetStore.getState().ticks[occurrenceId(m('1-5', 'Other', -10, 20))]).toEqual([]);
});

const capture = (c: HTMLElement) => c.querySelector('.meet-capture') as HTMLElement;
const markTile = (c: HTMLElement) => within(capture(c)).getByRole('button', { name: /Mark a moment/ });

it('Capture before a call is dashed and dim, says why on hover, and a click does nothing', async () => {
  serve([m('1-0', 'Design review', 10, 40, { details })]);
  const { container } = await renderMeet();
  const tile = markTile(container);
  expect(tile.getAttribute('aria-disabled')).toBe('true');
  expect(tile.parentElement?.className).toContain('off');
  fireEvent.click(tile);
  await flush(10);
  expect(sent.filter((s) => s.command === 'wall2_onair_mark')).toEqual([]);
  expect(await tipWords(tile)).toBe('Wakes when the call starts');
  expect(capture(container).classList.contains('panel')).toBe(false);
});

it('Mark a moment writes the time in the call and the meeting title cut to 60 characters, once for a double click', async () => {
  const title = `${'Quarterly planning and roadmap review '.repeat(3)}`.trim();
  serve([m('1-0', title, -10, 20, { details })]);
  await setCall(call({ since: NOW - 192_000 }));
  const { container } = await renderMeet();
  const tile = markTile(container);
  expect(tile.getAttribute('aria-disabled')).toBeNull();
  expect(capture(container).textContent).toContain('Marks the time in the call to marks.txt');
  fireEvent.click(tile, { detail: 1 });
  await flush(10);
  fireEvent.click(tile, { detail: 2 });
  await flush(10);
  const marks = sent.filter((s) => s.command === 'wall2_onair_mark');
  expect(marks).toHaveLength(1);
  const args = marks[0].args as { showMs: number; part: string };
  expect(args.showMs).toBeGreaterThanOrEqual(192_000);
  expect(args.showMs).toBeLessThan(192_100);
  expect(args.part.length).toBeLessThanOrEqual(60);
  expect(title.startsWith(args.part)).toBe(true);
  expect(capture(container).textContent).toContain('1 marked: 03:12');
  // A second mark inside a second counts once; later ones add.
  fireEvent.click(tile, { detail: 1 });
  await flush(10);
  expect(sent.filter((s) => s.command === 'wall2_onair_mark')).toHaveLength(1);
  await flush(2000);
  fireEvent.click(tile, { detail: 1 });
  await flush(10);
  expect(sent.filter((s) => s.command === 'wall2_onair_mark')).toHaveLength(2);
  expect(capture(container).textContent).toMatch(/2 marked: 03:12, 03:14/);
});

it('this call\'s marks appear in the island as Live notes and are cleared when the call ends', async () => {
  serve([m('1-0', 'Design review', -10, 20, { details })], { checklist: ['One'] });
  await setCall(call({ since: NOW - 60_000 }));
  const { container } = await renderMeet();
  fireEvent.click(markTile(container), { detail: 1 });
  await flush(10);
  const isl = within(island(container));
  fireEvent.click(isl.getByRole('tab', { name: 'Live notes' }));
  expect(heading(container)).toBe('Live notes');
  expect(isl.getByText('From Capture')).toBeTruthy();
  expect(island(container).querySelectorAll('.meet-isl-note')).toHaveLength(1);
  expect(useMeetStore.getState().marks).toHaveLength(1);
  await setCall(null);
  expect(useMeetStore.getState().marks).toEqual([]);
  expect(isl.queryByRole('tab', { name: 'Live notes' })).toBeNull();
  expect(capture(container).textContent).toContain('Nothing running');
});

it('a failed mark says so in one fixed line, and Open file opens marks.txt', async () => {
  serve([m('1-0', 'Design review', -10, 20)]);
  mocks.set('wall2_onair_mark', () => Promise.reject(new Error('refused')));
  await setCall(call());
  const { container } = await renderMeet();
  fireEvent.click(markTile(container), { detail: 1 });
  await flush(10);
  expect(capture(container).textContent).toContain('marks.txt is full or the mark was refused');
  expect(useMeetStore.getState().marks).toEqual([]);
  fireEvent.click(within(capture(container)).getByRole('button', { name: /Open file/ }));
  await flush(10);
  expect(sent).toContainEqual({ command: 'wall2_onair_open', args: { which: 'marks' } });
});

it('the recording chip sits in the status row while a recorder runs', async () => {
  serve([m('1-0', 'Design review', -10, 20)]);
  await setCall(call());
  act(() => useSignalStore.setState({ recording: true }));
  const { container } = await renderMeet();
  expect(container.querySelector('.meet-hero-st .rec-chip')).not.toBeNull();
});

it('a failed key press says why in the hero\'s last row', async () => {
  serve([m('1-0', 'Design review', -10, 20)]);
  mocks.set('wall2_keys_send_library', () => Promise.reject(new Error('no-target')));
  await setCall(call());
  const { container } = await renderMeet();
  fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
  await flush(10);
  expect(container.querySelector('.meet-hero-line .meet-brief')).not.toBeNull();
});
