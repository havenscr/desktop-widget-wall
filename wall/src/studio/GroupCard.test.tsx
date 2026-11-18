import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { resetTools, useToolsStore } from '../tools/store';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import { resetCard, useCard } from './cardStore';
import { group, studioAnswer } from './homeKit';
import { resetHome } from './homeStore';
import { StudioBlock } from './StudioBlock';
import { resetKeyLights } from './store';

vi.setConfig({ testTimeout: 20_000 });

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

let answer: Record<string, unknown>;
let writes: { command: string; args?: Record<string, unknown> }[];
let keySent: Record<string, unknown>[];
const keysOn = { on: true, brightness: 60, kelvin: 4400 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-11-14T10:00:00-08:00'));
  resetKeyLights();
  resetTools();
  resetTip();
  resetHome();
  resetCard();
  answer = studioAnswer({ groups: [group('panels', 'Panels', true, 70), group('behindMonitor', 'Behind monitor', true, 80), group('overhead', 'Overhead', true, 90)] });
  writes = [];
  keySent = [];
  mocks.set('wall2_keylights_status', () => ({ left: { set: true }, right: { set: true } }));
  mocks.set('wall2_keylights_read', () => ({ left: keysOn, right: keysOn }));
  mocks.set('wall2_keylights_set', (args) => {
    keySent.push(args ?? {});
    return { left: keysOn, right: keysOn };
  });
  mocks.set('wall2_studio', () => answer);
  for (const c of ['wall2_studio_preset', 'wall2_studio_normal', 'wall2_studio_group', 'wall2_studio_look']) {
    mocks.set(c, (args) => {
      writes.push({ command: c, args });
      return answer;
    });
  }
});
afterEach(() => {
  resetHome();
  resetCard();
  vi.useRealTimers();
  mocks.clear();
});

const show = async () => {
  render(
    <>
      <StudioBlock />
      <HoverTipLayer />
    </>,
  );
  await flush();
};
const name = (n: string) => screen.getByRole('button', { name: n });
const card = () => document.querySelector('.st-gcard') as HTMLElement | null;
const drag = (track: HTMLElement, x: number) => {
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 200, bottom: 26, width: 200, height: 26, x: 0, y: 0, toJSON: () => ({}) });
  track.setPointerCapture = () => {};
  fireEvent.pointerDown(track, { clientX: x, button: 0, pointerId: 1 });
  fireEvent.pointerUp(track, { pointerId: 1 });
};

it('the name opens that group card; the switch still switches and opens nothing', async () => {
  await show();
  expect(card()).toBeNull();
  fireEvent.click(screen.getByRole('switch', { name: 'Panels' }));
  await flush();
  expect(card()).toBeNull();
  expect(writes).toEqual([{ command: 'wall2_studio_group', args: { id: 'panels', on: false } }]);
  fireEvent.click(name('Key lights'));
  await flush();
  expect(card()?.getAttribute('aria-label')).toBe('Key lights settings');
  expect(name('Key lights').getAttribute('aria-expanded')).toBe('true');
  // The same name again closes it.
  fireEvent.click(name('Key lights'));
  expect(card()).toBeNull();
});

it('Escape closes the card and puts focus back on the name; a press outside closes it too', async () => {
  await show();
  fireEvent.click(name('Panels'));
  await flush();
  expect(card()).not.toBeNull();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(card()).toBeNull();
  expect(document.activeElement).toBe(name('Panels'));
  fireEvent.click(name('Panels'));
  await flush();
  fireEvent.pointerDown(document.body);
  expect(card()).toBeNull();
  // A press inside the card keeps it.
  fireEvent.click(name('Panels'));
  await flush();
  fireEvent.pointerDown(card()!);
  expect(card()).not.toBeNull();
});

it('one card at a time: another name replaces the open one', async () => {
  await show();
  fireEvent.click(name('Key lights'));
  await flush();
  fireEvent.click(name('Panels'));
  await flush();
  expect(document.querySelectorAll('.st-gcard')).toHaveLength(1);
  expect(card()?.getAttribute('data-card')).toBe('panels');
  expect(name('Key lights').getAttribute('aria-expanded')).toBe('false');
});

it('by keyboard: the name is a button, Enter opens the card with focus inside, Tab past its end closes it back to the name', async () => {
  await show();
  const key = name('Panels');
  key.focus();
  // A key press clicks with detail 0.
  fireEvent.click(key, { detail: 0 });
  await flush();
  expect(card()?.contains(document.activeElement)).toBe(true);
  expect(card()?.getAttribute('role')).toBe('dialog');
  const last = [...card()!.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')].pop()!;
  last.focus();
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(card()).toBeNull();
  expect(document.activeElement).toBe(key);
});

it('the Key lights card holds brightness, warmth and the Linked control, and writes go through the key light path', async () => {
  await show();
  fireEvent.click(name('Key lights'));
  await flush();
  const c = within(card()!);
  expect(c.getByText('Linked')).toBeTruthy();
  expect(c.getByText('Left and right move together. Click Linked to set each one.')).toBeTruthy();
  drag(c.getByRole('slider', { name: 'Both key lights brightness' }), 150);
  await flush();
  expect(keySent.at(-1)).toMatchObject({ side: 'both', brightness: 76 });
  drag(c.getByRole('slider', { name: 'Both key lights warmth' }), 100);
  await flush();
  expect(keySent.at(-1)).toHaveProperty('kelvin');
  // Apart: one pair of sliders for each light.
  fireEvent.click(c.getByText('Linked'));
  await flush();
  expect(c.getByRole('slider', { name: 'Left key light brightness' })).toBeTruthy();
  expect(c.getByRole('slider', { name: 'Right key light warmth' })).toBeTruthy();
});

it('the Panels card holds brightness and one Effect row; the list ticks the current effect and writes the look', async () => {
  answer = studioAnswer({
    groups: [group('panels', 'Panels', true, 70), group('behindMonitor', 'Behind monitor', true, 80), group('overhead', 'Overhead', true, 90)],
    looks: ['Studio Blue', 'Slow Ember Drift', 'Soft Daylight', 'Harbour Mist'].map((label, i) => ({ id: `l${i}`, label, active: i === 0 })),
  });
  await show();
  fireEvent.click(name('Panels'));
  await flush();
  const c = within(card()!);
  drag(c.getByRole('slider', { name: 'Panels brightness' }), 50);
  await flush();
  expect(writes.at(-1)).toEqual({ command: 'wall2_studio_group', args: { id: 'panels', on: true, level: 26 } });
  const row = c.getByRole('button', { name: /Effect/ });
  expect(row.textContent).toContain('Studio Blue');
  fireEvent.click(row);
  await flush();
  const list = within(document.querySelector('.st-eflist') as HTMLElement);
  expect(list.getAllByRole('option')).toHaveLength(4);
  expect(list.getByRole('option', { name: 'Studio Blue' }).getAttribute('aria-selected')).toBe('true');
  // Escape closes the list first and leaves the card.
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(document.querySelector('.st-eflist')).toBeNull();
  expect(card()).not.toBeNull();
  fireEvent.click(row);
  await flush();
  fireEvent.click(within(document.querySelector('.st-eflist') as HTMLElement).getByRole('option', { name: 'Soft Daylight' }));
  await flush();
  expect(writes.at(-1)).toEqual({ command: 'wall2_studio_look', args: { id: 'l2' } });
  expect(card()).not.toBeNull();
});

it('a list of eight effects is one row in the card; nothing else in the card grows', async () => {
  answer = studioAnswer({ looks: Array.from({ length: 8 }, (_, i) => ({ id: `l${i}`, label: `Effect number ${i + 1}`, active: i === 0 })) });
  await show();
  fireEvent.click(name('Panels'));
  await flush();
  expect(card()!.querySelectorAll('.st-effect')).toHaveLength(1);
  expect(card()!.querySelectorAll('[role="option"]')).toHaveLength(0);
  fireEvent.click(card()!.querySelector('.st-effect')!);
  await flush();
  expect(document.querySelectorAll('.st-eflist [role="option"]')).toHaveLength(8);
  expect(card()!.querySelectorAll('[role="option"]')).toHaveLength(0);
});

it('a group that cannot be switched shows its full reason, with none of its words cut', async () => {
  answer = studioAnswer({ groups: [group('panels', 'Panels', true, 70), group('behindMonitor', 'Behind monitor', false, 0, { canSwitch: false, canDim: false, setTo: 'Needs a Hue zone', floor: null }), group('overhead', 'Overhead', true, 90)] });
  await show();
  fireEvent.click(name('Behind monitor'));
  await flush();
  const c = card()!;
  expect(c.textContent).toContain('Needs a Hue zone before the wall can switch it.');
  expect(c.textContent).toContain('The home app makes the zone. Its README says how.');
  expect(c.querySelector('[role="slider"]')).toBeNull();
  expect(c.style.width).toBe('380px');
});

it('without a desk token the card says so and offers the Tools section; the slider and effect are not there to change', async () => {
  answer = studioAnswer({ canWrite: false, writeBlock: 'not-set-up', groups: [group('panels', 'Panels', true, 70), group('behindMonitor', 'Behind monitor', true, 80), group('overhead', 'Overhead', true, 90)] });
  await show();
  fireEvent.click(name('Panels'));
  await flush();
  expect(card()!.textContent).toContain('View only here.');
  expect(card()!.textContent).toContain("To switch it from the wall, add the home app's desk token in Tools.");
  expect(card()!.querySelector('[role="slider"]')).toBeNull();
  fireEvent.click(within(card()!).getByRole('button', { name: /Desk token/ }));
  expect(card()).toBeNull();
  expect(useToolsStore.getState().focus).toBe('desktoken');
  expect(writes).toHaveLength(0);
});

it('a room group card has its brightness slider and the floor line, and writes a level with on', async () => {
  await show();
  fireEvent.click(name('Overhead'));
  await flush();
  const c = within(card()!);
  expect(c.getByText('The 45 percent floor keeps the room comfortable on camera.')).toBeTruthy();
  drag(c.getByRole('slider', { name: 'Overhead brightness' }), 150);
  await flush();
  expect(writes.at(-1)).toEqual({ command: 'wall2_studio_group', args: { id: 'overhead', on: true, level: 75 } });
});

it('opening the whole sheet closes the card', async () => {
  await show();
  fireEvent.click(name('Panels'));
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Fine tune' }));
  await flush();
  expect(card()).toBeNull();
  expect(useCard.getState().open).toBeNull();
  expect(document.querySelector('.st-drawer')).not.toBeNull();
});

it('the Panels slider is in the sheet too, and "Needs a Hue zone" shows whole on its own line', async () => {
  answer = studioAnswer({ groups: [group('panels', 'Panels', true, 70), group('behindMonitor', 'Behind monitor', false, 0, { canSwitch: false, canDim: false, setTo: 'Needs a Hue zone', floor: null }), group('overhead', 'Overhead', false, 0, { canSwitch: false, canDim: false, setTo: 'Needs a Hue zone', floor: null })] });
  await show();
  fireEvent.click(screen.getByRole('button', { name: 'Fine tune' }));
  await flush();
  const sheet = within(document.querySelector('.st-drawer') as HTMLElement);
  expect(sheet.getByRole('slider', { name: 'Panels brightness' })).toBeTruthy();
  const zones = document.querySelectorAll('.st-drawer .st-zone');
  expect(zones).toHaveLength(2);
  expect([...zones].every((z) => z.textContent === 'Needs a Hue zone')).toBe(true);
});
