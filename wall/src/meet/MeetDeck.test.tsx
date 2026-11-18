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
import { resetMeetStore } from './meetStore';
import type { Meeting, MeetingDetails, MeetData } from './model';

vi.setConfig({ testTimeout: 20_000 });

// The call key deck: the same eight positions before and in a call, the later keys, and the person card.
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
  calledBy: 'Priya Calder',
  people: [
    { name: 'Priya Calder', reply: 'organizer', key: 'p1-0' },
    { name: 'Marcus Veld', reply: 'yes', key: 'p1-1' },
    { name: 'Dana Osei', reply: 'maybe', key: null },
    { name: 'Robin Okafor', reply: 'none', key: 'p1-3' },
  ],
  peopleMore: 0,
  invite: 'Walk through the sizing options.',
};
// The invite may carry an address for a person; the wall must never draw it. Invented, and not on the typed shape.
const EMAILS: Record<string, string> = { 'Priya Calder': 'priya.calder@contoso.example', 'Marcus Veld': 'marcus.veld@contoso.example' };
for (const p of details.people) if (EMAILS[p.name]) (p as unknown as Record<string, unknown>).email = EMAILS[p.name];
const m = (key: string, title: string, from: number, to: number, over: Partial<Meeting> = {}): Meeting => ({ key, accountId: 'work', title, start: at(from), end: at(to), canJoin: false, ...over });
const accounts = [{ id: 'work', label: 'Work', state: 'ok' as const }];
let sent: { command: string; args?: unknown }[] = [];

const serve = (meetings: Meeting[], day: unknown[] = []) => {
  const data: MeetData = { accounts, meetings };
  mocks.set('wall2_meet_next', () => data);
  mocks.set('wall2_meet_day', () => ({ accounts, events: day }));
  mocks.set('wall2_meet_checklist', () => ({ state: 'missing', items: [], reason: null }));
  mocks.set('wall2_keys_library', () => LIBRARY_DATA);
  for (const c of ['wall2_keys_send_library', 'wall2_meet_join', 'wall2_open_event', 'wall2_onair_mark', 'wall2_onair_open', 'wall2_meet_checklist_open', 'wall2_meet_person_action']) {
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
const heroOf = (c: HTMLElement) => c.querySelector('.meet-hero') as HTMLElement;
const deck = (c: HTMLElement) => [...(heroOf(c).querySelector('.meet-keys')?.children ?? [])] as HTMLElement[];
const label = (e: HTMLElement) => e.getAttribute('aria-label');
const person = (c: HTMLElement, name: RegExp) => within(heroOf(c)).getByRole('button', { name });
const personCalls = () => sent.filter((s) => s.command === 'wall2_meet_person_action');

const BEFORE = ['Join: Design review', 'Open invite', 'Copy join info', 'Open chat', 'Running late', 'Do Not Disturb', 'Lights', 'Open in Teams'];
const IN_CALL = ['Mute', 'Camera off', 'Share', 'Leave', 'Raise hand', 'Reactions', 'Chat panel', 'Open in Teams'];

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

const before = (): [Meeting, unknown[]] => {
  const hero = m('1-0', 'Design review', 12, 42, { canJoin: true, details });
  return [hero, [{ key: 'd-hero', accountId: 'work', title: 'Design review', start: hero.start, end: hero.end, canOpen: true }]];
};

it('before a call the deck has eight keys in fixed places; Join and Open invite work, the six others are unavailable', async () => {
  const [hero, day] = before();
  serve([hero], day);
  const { container } = await renderMeet();
  const keys = deck(container);
  expect(keys.map(label)).toEqual(BEFORE);
  fireEvent.click(keys[0]);
  fireEvent.click(keys[1]);
  expect(sent).toEqual([
    { command: 'wall2_meet_join', args: { key: '1-0' } },
    { command: 'wall2_open_event', args: { key: 'd-hero' } },
  ]);
  sent = [];
  for (const k of keys.slice(2)) {
    expect(k.getAttribute('aria-disabled')).toBe('true');
    expect(k.getAttribute('data-later')).toBe('true');
    fireEvent.click(k);
  }
  await flush(600);
  expect(sent).toEqual([]);
});

it('a key that does not apply keeps its place empty, so the others do not move', async () => {
  serve([m('1-0', 'Design review', 12, 42, { canJoin: true, details })]);
  const { container } = await renderMeet();
  const keys = deck(container);
  expect(keys).toHaveLength(8);
  expect(keys[1].getAttribute('aria-hidden')).toBe('true');
  expect(keys.slice(2).map(label)).toEqual(BEFORE.slice(2));
});

it('in a Teams call the same eight places hold Mute, Camera, Share, Leave and four unavailable keys', async () => {
  serve([m('1-0', 'Design review', -10, 20, { canJoin: true, details })]);
  await setCall(call());
  const { container } = await renderMeet();
  const keys = deck(container);
  expect(keys.map(label)).toEqual(IN_CALL);
  expect(keys[3].className).toContain('red');
  sent = [];
  fireEvent.click(keys[3]);
  await flush(600);
  expect(sent).toEqual([{ command: 'wall2_keys_send_library', args: { id: 'teams-leave' } }]);
  sent = [];
  for (const k of keys.slice(4)) {
    expect(k.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(k);
  }
  await flush(600);
  expect(sent).toEqual([]);
});

for (const kind of ['teams', 'zoom'] as const) {
  it(`in a ${kind} call Mute, Camera, Share and Leave each send their own key id`, async () => {
    serve([m('1-0', 'Design review', -10, 20, { canJoin: true, details })]);
    await setCall(call({ kind }));
    const { container } = await renderMeet();
    const keys = deck(container);
    for (const [i, role] of ['mute', 'camera', 'share', 'leave'].entries()) {
      sent = [];
      fireEvent.click(keys[i]);
      await flush(600);
      expect(sent).toEqual([{ command: 'wall2_keys_send_library', args: { id: `${kind}-${role}` } }]);
    }
  });
}

it('the later keys and a browser call keys are out of the tab order and do nothing on click, Enter or Space', async () => {
  const inert = async (inCall: CallSignal | null) => {
    serve([m('1-0', 'Design review', inCall ? -10 : 12, inCall ? 20 : 42, { canJoin: true, details })]);
    await setCall(inCall);
    const { container, unmount } = await renderMeet();
    const keys = deck(container);
    // The tab stops of the hero: every button that is not tabIndex -1. None may be a later or unavailable key.
    const stops = [...heroOf(container).querySelectorAll<HTMLElement>('button')].filter((b) => b.tabIndex >= 0);
    for (const b of stops) {
      expect(b.getAttribute('aria-disabled')).toBeNull();
      expect(b.getAttribute('data-later')).toBeNull();
    }
    const unavailable = keys.filter((k) => k.getAttribute('aria-disabled') === 'true');
    expect(unavailable.length).toBeGreaterThan(0);
    sent = [];
    for (const k of unavailable) {
      expect(k.tabIndex).toBe(-1);
      expect(k.hasAttribute('disabled')).toBe(false);
      for (const key of ['Enter', ' ']) {
        const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        act(() => void k.dispatchEvent(ev));
        expect(ev.defaultPrevented).toBe(true);
      }
      fireEvent.click(k);
    }
    await flush(600);
    expect(sent).toEqual([]);
    unmount();
    mocks.clear();
    resetTip();
  };
  await inert(null);
  await inert(call());
  await inert(call({ kind: 'browser' }));
});

it('a key the library cannot run is not a tab stop and does nothing', async () => {
  serve([m('1-0', 'Design review', -10, 20, { canJoin: true, details })]);
  mocks.set('wall2_keys_library', () => ({ ...LIBRARY_DATA, groups: [] }));
  await setCall(call());
  const { container } = await renderMeet();
  const first = deck(container)[0];
  expect(first.className).toContain('off');
  expect(first.tabIndex).toBe(-1);
  expect(first.getAttribute('aria-disabled')).toBe('true');
  sent = [];
  fireEvent.click(first);
  const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  act(() => void first.dispatchEvent(ev));
  await flush(600);
  expect(ev.defaultPrevented).toBe(true);
  expect(sent).toEqual([]);
});

it('a later key says "Not available yet" and draws dashed', async () => {
  serve([m('1-0', 'Design review', -10, 20, { details })]);
  await setCall(call());
  const { container } = await renderMeet();
  const k = deck(container)[4];
  fireEvent.mouseEnter(k);
  await flush(TIP_DELAY_MS);
  expect(screen.getByRole('tooltip').textContent).toBe('Not available yet');
  expect(k.className).toContain('later');
});

it('the ring is 120 px', async () => {
  serve([m('1-0', 'Design review', -10, 20, { details })]);
  await setCall(call());
  const { container } = await renderMeet();
  const svg = container.querySelector('.meet-ring-dial svg');
  expect(svg?.getAttribute('width')).toBe('120');
  expect(svg?.getAttribute('height')).toBe('120');
});

it('a click on initials opens the card with the name and reply; its three actions call the bridge with the person key', async () => {
  serve([m('1-0', 'Design review', -10, 20, { details })]);
  await setCall(call());
  const { container } = await renderMeet();
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(person(container, /^Marcus Veld/));
  const card = within(screen.getByRole('dialog'));
  expect(card.getByText('Marcus Veld')).toBeTruthy();
  expect(card.getByText('Accepted')).toBeTruthy();
  expect(card.getAllByRole('button').map((b) => b.textContent)).toEqual(['Copy email', 'Email', 'Message on Teams']);
  fireEvent.click(card.getByRole('button', { name: 'Copy email' }));
  await flush(10);
  fireEvent.click(card.getByRole('button', { name: 'Email' }));
  await flush(10);
  expect(personCalls()).toEqual([
    { command: 'wall2_meet_person_action', args: { key: 'p1-1', action: 'copy' } },
    { command: 'wall2_meet_person_action', args: { key: 'p1-1', action: 'email' } },
  ]);
  // Email closes the card; Teams is a fresh open.
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(person(container, /^Marcus Veld/));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Message on Teams' }));
  await flush(10);
  expect(personCalls().at(-1)).toEqual({ command: 'wall2_meet_person_action', args: { key: 'p1-1', action: 'teams' } });
});

it('a person with no key gets a card with no actions', async () => {
  serve([m('1-0', 'Design review', -10, 20, { details })]);
  await setCall(call());
  const { container } = await renderMeet();
  fireEvent.click(person(container, /^Dana Osei/));
  const card = within(screen.getByRole('dialog'));
  expect(card.getByText('Maybe')).toBeTruthy();
  expect(card.queryAllByRole('button')).toEqual([]);
});

it('Escape, a click outside and a click on the same initials close the card', async () => {
  serve([m('1-0', 'Design review', -10, 20, { details })]);
  await setCall(call());
  const { container } = await renderMeet();
  const open = () => fireEvent.click(person(container, /^Marcus Veld/));
  open();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  open();
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole('dialog')).toBeNull();
  open();
  fireEvent.mouseDown(screen.getByRole('dialog'));
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.click(person(container, /^Marcus Veld/));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('the card closes when the meeting changes', async () => {
  let list = [m('1-0', 'Design review', 12, 42, { details })];
  serve(list);
  mocks.set('wall2_meet_next', () => ({ accounts, meetings: list }));
  const { container } = await renderMeet();
  fireEvent.click(person(container, /^Marcus Veld/));
  expect(screen.getByRole('dialog')).toBeTruthy();
  list = [m('2-0', 'Budget check-in', 12, 42, { details })];
  await flush(5 * 60_000 + 10);
  expect(heroOf(container).textContent).toContain('Budget check-in');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('a failed action shows one quiet line and keeps the card', async () => {
  serve([m('1-0', 'Design review', -10, 20, { details })]);
  mocks.set('wall2_meet_person_action', () => Promise.reject('failed'));
  await setCall(call());
  const { container } = await renderMeet();
  fireEvent.click(person(container, /^Marcus Veld/));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Copy email' }));
  await flush(10);
  expect(within(screen.getByRole('dialog')).getByRole('status').textContent).toBe('Could not copy');
});

it('no address and no contact card appear in the hero or the card', async () => {
  serve([m('1-0', 'Design review', -10, 20, { details })]);
  await setCall(call());
  const { container } = await renderMeet();
  fireEvent.click(person(container, /^Marcus Veld/));
  const text = heroOf(container).textContent ?? '';
  expect(text).not.toMatch(/@|mailto|Contact card|Open contact/i);
  for (const addr of Object.values(EMAILS)) {
    expect(container.textContent).not.toContain(addr);
    expect(container.innerHTML).not.toContain(addr);
  }
});

it('Escape returns the focus to the initial that opened the card', async () => {
  serve([m('1-0', 'Design review', -10, 20, { details })]);
  await setCall(call());
  const { container } = await renderMeet();
  const ini = person(container, /^Marcus Veld/);
  ini.focus();
  fireEvent.click(ini);
  within(screen.getByRole('dialog')).getByRole('button', { name: 'Email' }).focus();
  expect(document.activeElement).not.toBe(ini);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(ini);
});

it('the Copied line clears when the card closes, also when the answer arrives after it closed', async () => {
  serve([m('1-0', 'Design review', -10, 20, { details })]);
  await setCall(call());
  const { container } = await renderMeet();
  fireEvent.click(person(container, /^Marcus Veld/));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Copy email' }));
  await flush(10);
  expect(within(screen.getByRole('dialog')).getByRole('status').textContent).toBe('Copied');
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(person(container, /^Marcus Veld/));
  expect(within(screen.getByRole('dialog')).queryByRole('status')).toBeNull();
  // A copy still running when the card closes does not leave a line on the next open.
  let done: () => void = () => undefined;
  mocks.set('wall2_meet_person_action', () => new Promise((r) => (done = () => r(null))));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Copy email' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(person(container, /^Marcus Veld/));
  await act(async () => done());
  await flush(10);
  expect(within(screen.getByRole('dialog')).queryByRole('status')).toBeNull();
});

it('the Escape listener exists only while the card is open and leaves other Escape handlers alone', async () => {
  serve([m('1-0', 'Design review', -10, 20, { details })]);
  await setCall(call());
  const { container } = await renderMeet();
  const add = vi.spyOn(document, 'addEventListener');
  const remove = vi.spyOn(document, 'removeEventListener');
  const keydowns = (spy: typeof add) => spy.mock.calls.filter((c) => c[0] === 'keydown').length;
  const other = vi.fn();
  document.addEventListener('keydown', other);
  // Closed: Escape does nothing to the card and nothing is stolen.
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(other).toHaveBeenCalledTimes(1);
  const addedBefore = keydowns(add);
  const removedBefore = keydowns(remove);
  fireEvent.click(person(container, /^Marcus Veld/));
  expect(keydowns(add) - addedBefore).toBe(1);
  const stop = vi.spyOn(Event.prototype, 'stopImmediatePropagation');
  const stopProp = vi.spyOn(Event.prototype, 'stopPropagation');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(other).toHaveBeenCalledTimes(2);
  expect(stop).not.toHaveBeenCalled();
  expect(stopProp).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(keydowns(remove) - removedBefore).toBe(1);
  document.removeEventListener('keydown', other);
  vi.restoreAllMocks();
});
