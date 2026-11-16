import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import { OFF_READ_DELAY_MS, resetHome, TEXT, useHome } from './homeStore';
import { OfficeMoods } from './OfficeMoods';
import { NOTE_MS } from './store';

vi.setConfig({ testTimeout: 20_000 });

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

interface M {
  id: string;
  label: string;
  line: string | null;
  active: boolean;
}
let list: M[];
let off: { active: boolean } | null;
let stale: boolean;
let canWrite: boolean;
let block: string | null;
let readWord: string | null;
let calls: { command: string; args?: Record<string, unknown> }[];
let writeWord: string | null;
let hold: boolean;

const answer = () => ({ stale, moods: list.map((m) => ({ ...m })), off, canWrite, writeBlock: block });
const count = (c: string) => calls.filter((x) => x.command === c).length;
const LONG = 'Bright desk for the long afternoon sessions today';
const LINE = 'Room 70%, neon 20%, desk lamp on, panels off, the window side kept low so the screen has no glare on it at all today';

beforeEach(() => {
  vi.useFakeTimers();
  resetHome();
  resetTip();
  list = [
    { id: 'brightDesk', label: 'Bright desk', line: 'Room 70%, neon 20%', active: false },
    { id: 'eveningLamp', label: 'Evening lamp', line: null, active: false },
    { id: 'gaming', label: 'Gaming', line: 'Room 25%', active: false },
  ];
  off = null;
  stale = false;
  canWrite = true;
  block = null;
  readWord = null;
  calls = [];
  writeWord = null;
  hold = false;
  mocks.set('wall2_office_moods', () => {
    calls.push({ command: 'wall2_office_moods' });
    if (readWord) throw readWord;
    return answer();
  });
  mocks.set('wall2_office_mood', async (args) => {
    calls.push({ command: 'wall2_office_mood', args });
    if (hold) await new Promise<never>(() => undefined);
    if (writeWord) throw writeWord;
    list = list.map((m) => ({ ...m, active: m.id === args?.id }));
    if (off) off = { active: false };
    return answer();
  });
  mocks.set('wall2_office_off', async () => {
    calls.push({ command: 'wall2_office_off' });
    if (writeWord) throw writeWord;
    list = list.map((m) => ({ ...m, active: false }));
    off = { active: true };
    return answer();
  });
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  resetHome();
  resetTip();
});

const show = async () => {
  const view = render(
    <>
      <OfficeMoods />
      <HoverTipLayer />
    </>,
  );
  await flush();
  return view;
};
const slot = () => document.querySelector('[data-slot="office-lights"]') as HTMLElement;
const line = () => document.querySelector('.u-office-line');
const chip = (name: string) => within(slot()).getByText(name).closest('button') as HTMLElement;
const names = () => within(slot()).queryAllByRole('button').map((b) => b.textContent);
const tipOf = async (el: Element) => {
  fireEvent.mouseEnter(el);
  await flush(300);
  return document.querySelector('.hover-tip')?.textContent ?? '';
};

it('hidden states leave the empty slot: no children, aria-hidden, no line, and no chip can be clicked', async () => {
  for (const word of ['not-configured', 'absent', 'studio-not-set-up', 'unreachable', 'failed']) {
    readWord = word;
    const { unmount } = await show();
    expect(slot().childElementCount).toBe(0);
    expect(slot().getAttribute('aria-hidden')).toBe('true');
    expect(slot().getAttribute('data-moods')).toBeNull();
    expect(line()).toBeNull();
    unmount();
    resetHome();
  }
  // Not read yet: before the first answer comes, nothing is drawn.
  render(<OfficeMoods />);
  expect(slot().childElementCount).toBe(0);
  // An empty list is the same.
  resetHome();
  readWord = null;
  list = [];
  document.body.innerHTML = '';
  await show();
  expect(slot().childElementCount).toBe(0);
  expect(slot().getAttribute('aria-hidden')).toBe('true');
});

it('a later read that fails hides the row again, and one that answers brings it back', async () => {
  await show();
  expect(names()).toEqual(['Bright desk', 'Evening lamp', 'Gaming']);
  readWord = 'unreachable';
  await flush(60_000);
  expect(slot().childElementCount).toBe(0);
  expect(slot().getAttribute('aria-hidden')).toBe('true');
  expect(line()).toBeNull();
  readWord = null;
  await flush(60_000);
  expect(names()).toEqual(['Bright desk', 'Evening lamp', 'Gaming']);
});

it('shown: a group named Office moods, the label, one chip per mood in the home app order, no Off without off, nothing lit', async () => {
  await show();
  expect(slot().getAttribute('role')).toBe('group');
  expect(slot().getAttribute('aria-label')).toBe('Office moods');
  expect(slot().getAttribute('aria-hidden')).toBeNull();
  expect(slot().getAttribute('data-moods')).toBe('shown');
  expect(screen.getByText('Office moods')).toBeTruthy();
  expect(names()).toEqual(['Bright desk', 'Evening lamp', 'Gaming']);
  expect(within(slot()).getAllByRole('button').every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);
  expect(line()?.textContent).toBe('No mood on.');
  // Every chip is a native button reached by Tab in this order.
  for (const b of within(slot()).getAllByRole('button')) {
    expect(b.tagName).toBe('BUTTON');
    expect(b.getAttribute('type')).toBe('button');
    expect(b.tabIndex).toBe(0);
  }
});

it('the fit rule is applied: twelve names of 40 characters drop the label and cut every name; a short row keeps both', async () => {
  // jsdom has no canvas, so the component measures with its rough guess (9 px a character): 360 px a name, far over 1250 in all.
  const forty = (i: number) => `Mood ${String(i).padStart(2, '0')} ${'x'.repeat(40 - 8)}`;
  list = Array.from({ length: 12 }, (_, i) => ({ id: `mood${i}`, label: forty(i), line: null, active: i === 0 }));
  off = { active: false };
  const { unmount } = await show();
  expect(forty(0)).toHaveLength(40);
  expect(slot().querySelector('.u-mood-label')).toBeNull();
  expect(slot().getAttribute('aria-label')).toBe('Office moods');
  const named = [...slot().querySelectorAll<HTMLElement>('.u-mood-name')].filter((n) => n.textContent !== 'Off');
  expect(named).toHaveLength(12);
  for (const n of named) expect(n.style.maxWidth).toMatch(/^\d+px$/);
  // Cut at the largest shared width that fits: more than the minimum text, and the full name still in the tip.
  expect(parseInt(named[0].style.maxWidth, 10)).toBeGreaterThanOrEqual(31);
  expect(await tipOf(chip(forty(0)))).toBe(`${forty(0)} is on.`);
  unmount();
  resetHome();
  resetTip();
  // Three short names fit as they are: the label stays and no name is cut.
  list = [
    { id: 'a', label: 'Bright desk', line: null, active: false },
    { id: 'b', label: 'Reading', line: null, active: false },
  ];
  off = null;
  await show();
  expect(slot().querySelector('.u-mood-label')).not.toBeNull();
  for (const n of slot().querySelectorAll<HTMLElement>('.u-mood-name')) expect(n.style.maxWidth).toBe('');
});

it('Off shows only when the home app offers it, always last; it is lit only with no mood on', async () => {
  off = { active: false };
  await show();
  expect(names()).toEqual(['Bright desk', 'Evening lamp', 'Gaming', 'Off']);
  expect(chip('Off').getAttribute('aria-pressed')).toBe('false');
  expect(chip('Off').querySelector('.u-mood-sw')).toBeNull();
  expect(line()?.textContent).toBe('No mood on.');
  fireEvent.click(chip('Off'));
  await flush();
  expect(count('wall2_office_off')).toBe(1);
  expect(chip('Off').getAttribute('aria-pressed')).toBe('true');
  expect(chip('Gaming').getAttribute('aria-pressed')).toBe('false');
  expect(line()?.textContent).toBe('Office lights are off.');
});

it('a click applies the mood and the chip shows what the home app read back; the line says what is on', async () => {
  await show();
  fireEvent.click(chip('Bright desk'));
  await flush();
  expect(calls.filter((c) => c.command === 'wall2_office_mood').map((c) => c.args)).toEqual([{ id: 'brightDesk' }]);
  expect(chip('Bright desk').getAttribute('aria-pressed')).toBe('true');
  expect(line()?.textContent).toBe('Bright desk: Room 70%, neon 20%');
  expect(line()?.querySelector('b')?.textContent).toBe('Bright desk:');
  fireEvent.click(chip('Evening lamp'));
  await flush();
  expect(line()?.textContent).toBe('Evening lamp is on.');
});

it('in flight: the swatch turns into a spinner, the line says asking, every chip ignores clicks until the answer', async () => {
  hold = true;
  await show();
  fireEvent.click(chip('Evening lamp'));
  await flush();
  expect(chip('Evening lamp').querySelector('.u-spin')).not.toBeNull();
  expect(chip('Evening lamp').querySelector('.u-mood-sw')).toBeNull();
  expect(chip('Gaming').querySelector('.u-mood-sw')).not.toBeNull();
  expect(line()?.textContent).toBe('Evening lamp: asking the home app');
  fireEvent.click(chip('Gaming'));
  fireEvent.click(chip('Evening lamp'));
  await flush();
  expect(count('wall2_office_mood')).toBe(1);
  expect(await tipOf(chip('Gaming'))).toContain('Asking the home app');
});

it('a refused write: an amber triangle and the words for 5 seconds, then the chips show the read', async () => {
  await show();
  writeWord = 'on-air';
  fireEvent.click(chip('Gaming'));
  await flush();
  expect(chip('Gaming').querySelector('.u-mood-ico.warn')).not.toBeNull();
  expect(line()?.textContent).toBe(TEXT.onAir);
  expect(line()?.className).toContain('warn');
  expect(chip('Gaming').getAttribute('aria-pressed')).toBe('false');
  await flush(NOTE_MS + 10);
  expect(chip('Gaming').querySelector('.u-mood-ico.warn')).toBeNull();
  expect(line()?.textContent).toBe('No mood on.');
});

it('a sticky word stays until a write works', async () => {
  await show();
  writeWord = 'forbidden';
  fireEvent.click(chip('Gaming'));
  await flush(NOTE_MS + 10);
  expect(line()?.textContent).toBe(TEXT.forbidden);
  writeWord = null;
  fireEvent.click(chip('Gaming'));
  await flush();
  expect(line()?.textContent).toBe('Gaming: Room 25%');
});

it('no token: dashed and aria-disabled, focusable with its tip, a click sends nothing, the amber line is the token words', async () => {
  canWrite = false;
  block = 'not-set-up';
  await show();
  const c = chip('Bright desk');
  expect(c.getAttribute('aria-disabled')).toBe('true');
  expect(c.className).toContain('blocked');
  c.focus();
  expect(document.activeElement).toBe(c);
  fireEvent.click(c);
  fireEvent.click(chip('Gaming'));
  await flush();
  expect(count('wall2_office_mood')).toBe(0);
  expect(count('wall2_office_off')).toBe(0);
  expect(line()?.textContent).toBe(TEXT.notSetUp);
  expect(line()?.className).toContain('warn');
  expect(await tipOf(c)).toContain(TEXT.notSetUp);
  // The other block says its own words.
  block = 'needs-private-address';
  await useHome.getState().readMoods();
  await flush();
  expect(line()?.textContent).toBe(TEXT.needsPrivate);
});

it('no token with a mood on: that chip keeps its lit state (the ring), the others stay unpressed, and a click still sends nothing', async () => {
  canWrite = false;
  block = 'not-set-up';
  list[2].active = true;
  await show();
  const lit = chip('Gaming');
  expect(lit.className).toContain('lit');
  expect(lit.className).toContain('blocked');
  expect(lit.getAttribute('aria-pressed')).toBe('true');
  expect(chip('Bright desk').getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(lit);
  await flush();
  expect(count('wall2_office_mood')).toBe(0);
  expect(line()?.textContent).toBe(TEXT.notSetUp);
});

it('stale: dimmed, the line ends (not fresh), a click still works', async () => {
  stale = true;
  list[0].active = true;
  await show();
  expect(slot().getAttribute('data-stale')).toBe('true');
  expect(line()?.textContent).toBe('Bright desk: Room 70%, neon 20% (not fresh)');
  fireEvent.click(chip('Gaming'));
  await flush();
  expect(count('wall2_office_mood')).toBe(1);
});

it('a tip carries the full name and the full line, for a long name and a long line too', async () => {
  list = [{ id: 'brightDesk', label: LONG, line: LINE, active: true }, ...list.slice(1)];
  off = { active: false };
  await show();
  expect(await tipOf(chip(LONG))).toBe(`${LONG}: ${LINE}`);
  fireEvent.mouseLeave(chip(LONG));
  await flush();
  expect(await tipOf(chip('Evening lamp'))).toBe('Evening lamp');
  fireEvent.mouseLeave(chip('Evening lamp'));
  await flush();
  expect(await tipOf(chip('Off'))).toBe('Turns the office lights off. No other room changes.');
  // The line above the row holds the same text, cut by the box and not by the text.
  expect(line()?.textContent).toBe(`${LONG}: ${LINE}`);
});

it('every chip is a real button in the tab order, and focusing one shows its card at once', async () => {
  off = { active: false };
  await show();
  const buttons = within(slot()).getAllByRole('button');
  expect(buttons.map((b) => b.textContent)).toEqual(['Bright desk', 'Evening lamp', 'Gaming', 'Off']);
  for (const b of buttons) {
    expect(b.tagName).toBe('BUTTON');
    expect(b.tabIndex).toBe(0);
  }
  act(() => chip('Bright desk').focus());
  await flush();
  expect(document.querySelector('.hover-tip')?.textContent).toBe('Bright desk: Room 70%, neon 20%');
});

it.each([
  ['Bright desk', 'wall2_office_mood', { id: 'brightDesk' }],
  ['Gaming', 'wall2_office_mood', { id: 'gaming' }],
  ['Off', 'wall2_office_off', undefined],
])('a click on %s calls the bridge once as %s', async (name, command, args) => {
  off = { active: false };
  await show();
  fireEvent.click(chip(name));
  await flush();
  const sent = calls.filter((c) => c.command !== 'wall2_office_moods');
  expect(sent).toEqual([{ command, ...(args ? { args } : {}) }]);
});

it('reads only while shown: one read on mount, none after it leaves, and the Off write adds one after about a second and a half', async () => {
  off = { active: false };
  const { unmount } = await show();
  expect(count('wall2_office_moods')).toBe(1);
  fireEvent.click(chip('Off'));
  await flush();
  expect(count('wall2_office_moods')).toBe(1);
  await flush(OFF_READ_DELAY_MS + 20);
  expect(count('wall2_office_moods')).toBe(2);
  unmount();
  await flush(120_000);
  expect(count('wall2_office_moods')).toBe(2);
});
