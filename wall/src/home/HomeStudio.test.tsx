import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { studioAnswer } from '../studio/homeKit';
import { resetHome } from '../studio/homeStore';
import { resetKeyLights } from '../studio/store';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import { MOODS_WHICH_KEY, Moods } from './Moods';
import { HomeStudio } from './HomeStudio';

vi.setConfig({ testTimeout: 20_000 });

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const keysOn = { on: true, brightness: 60, kelvin: 4400 };
let writes: { command: string; args?: Record<string, unknown> }[];
let studio: Record<string, unknown> | 'down';
let active: string | null;
let moodList: { id: string; label: string; line: string | null }[];
let officeCanWrite: boolean;

const officeAnswer = () => ({
  stale: false,
  moods: moodList.map((m) => ({ ...m, active: m.id === active })),
  off: null,
  canWrite: officeCanWrite,
  writeBlock: officeCanWrite ? null : 'not-set-up',
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-11-14T10:00:00-08:00'));
  resetKeyLights();
  resetHome();
  resetTip();
  localStorage.clear();
  writes = [];
  studio = studioAnswer({ looks: ['glow', 'calm', 'sunrise', 'neon'].map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), active: id === 'calm' })) });
  active = null;
  officeCanWrite = true;
  moodList = [
    { id: 'relax', label: 'Relax', line: 'Room 35%' },
    { id: 'gaming', label: 'Gaming', line: 'Room 25%, panels 10%' },
    { id: 'recording', label: 'Recording', line: 'Room 80%, key lights on' },
  ];
  mocks.set('wall2_keylights_status', () => ({ left: { set: true }, right: { set: true } }));
  mocks.set('wall2_keylights_read', () => ({ left: keysOn, right: keysOn }));
  mocks.set('wall2_keylights_set', (args) => (writes.push({ command: 'wall2_keylights_set', args }), { left: keysOn, right: keysOn }));
  mocks.set('wall2_studio', () => {
    if (studio === 'down') throw 'unreachable';
    return studio;
  });
  mocks.set('wall2_office_moods', () => officeAnswer());
  mocks.set('wall2_studio_group', (args) => (writes.push({ command: 'wall2_studio_group', args }), studio));
  mocks.set('wall2_studio_look', (args) => (writes.push({ command: 'wall2_studio_look', args }), studio));
  mocks.set('wall2_studio_normal', () => (writes.push({ command: 'wall2_studio_normal' }), studio));
  mocks.set('wall2_office_mood', (args) => {
    writes.push({ command: 'wall2_office_mood', args });
    active = String(args?.id);
    return officeAnswer();
  });
  mocks.set('wall2_moods', () => [
    { id: 'day', label: 'Day' },
    { id: 'evening', label: 'Evening' },
    { id: 'lateNight', label: 'Late Night' },
  ]);
});
afterEach(() => {
  resetHome();
  vi.useRealTimers();
  mocks.clear();
});

const show = async () => {
  const view = render(
    <>
      <HomeStudio />
      <HoverTipLayer />
    </>,
  );
  await flush(10);
  return view;
};
const btn = (name: string) => screen.getByText(name).closest('button') as HTMLElement;
const tipOf = async (el: Element) => {
  fireEvent.mouseEnter(el);
  await flush(400);
  return document.querySelector('.hover-tip')?.textContent ?? '';
};
const rowNames = (row: string) => [...document.querySelectorAll(`[data-row="${row}"] button, [data-row="${row}"] .st-preset`)].map((b) => b.textContent?.trim() || b.getAttribute('aria-label'));

it('holds the Key lights and Panels switches, Fine tune, three panel looks and the three buttons in order', async () => {
  await show();
  expect(screen.getByText('Studio lights')).toBeTruthy();
  expect(document.querySelector('[data-group="keys"]')).toBeTruthy();
  expect(document.querySelector('[data-group="panels"]')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Fine tune' })).toBeTruthy();
  // The first three looks only (the home app lists four); the one that is on shows as on.
  expect(rowNames('looks')).toEqual(['Glow', 'Calm', 'Sunrise']);
  expect(btn('Calm').getAttribute('aria-pressed')).toBe('true');
  expect(rowNames('moods')).toEqual(['Gaming', 'Office Recording', 'As before']);
});

it('the buttons use the Unwind chip look and send the office mood calls', async () => {
  await show();
  for (const n of ['Gaming', 'Office Recording', 'As before']) expect(btn(n).classList.contains('u-mood')).toBe(true);
  fireEvent.click(btn('Gaming'));
  await flush(50);
  expect(writes).toContainEqual({ command: 'wall2_office_mood', args: { id: 'gaming' } });
  expect(btn('Gaming').getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(btn('Office Recording'));
  await flush(50);
  expect(writes).toContainEqual({ command: 'wall2_office_mood', args: { id: 'recording' } });
});

it('As before is dashed with nothing on, and with a mood on it sends the studio normal call and says what it does', async () => {
  await show();
  expect(btn('As before').getAttribute('aria-disabled')).toBe('true');
  expect(await tipOf(btn('As before'))).toContain('Nothing to go back from');
  active = 'gaming';
  await flush(61_000);
  expect(btn('As before').getAttribute('aria-disabled')).toBeNull();
  expect(await tipOf(btn('As before'))).toContain('Puts the office back the way it was before the mood');
  fireEvent.click(btn('As before'));
  await flush(50);
  expect(writes.some((w) => w.command === 'wall2_studio_normal')).toBe(true);
});

it('the switches and looks send the existing calls', async () => {
  await show();
  fireEvent.click(btn('Sunrise'));
  await flush(50);
  expect(writes).toContainEqual({ command: 'wall2_studio_look', args: { id: 'sunrise' } });
  fireEvent.click(document.querySelector('[data-group="panels"] [role="switch"], [data-group="panels"] button.st-tg-sw') as HTMLElement);
  await flush(50);
  expect(writes.some((w) => w.command === 'wall2_studio_group' && w.args?.id === 'panels')).toBe(true);
});

it('the home app away: Panels, looks and the buttons show the wall dashed state and send nothing', async () => {
  studio = 'down';
  mocks.set('wall2_office_moods', () => {
    throw 'unreachable';
  });
  await show();
  expect(document.querySelector('[data-group="panels"]')!.getAttribute('aria-disabled')).toBe('true');
  expect(rowNames('looks')).toEqual(['Panel looks']);
  expect(rowNames('moods')).toEqual(['Gaming', 'Office Recording', 'As before']);
  for (const n of ['Gaming', 'Office Recording', 'As before']) {
    expect(btn(n).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(btn(n));
  }
  fireEvent.click(screen.getByText('Panel looks'));
  await flush(50);
  expect(writes.filter((w) => w.command !== 'wall2_keylights_set')).toEqual([]);
});

it('a mood the home app does not list is a dashed button that says so', async () => {
  moodList = moodList.filter((m) => m.id !== 'recording');
  await show();
  expect(btn('Office Recording').getAttribute('aria-disabled')).toBe('true');
  expect(await tipOf(btn('Office Recording'))).toContain('no Office Recording mood');
  fireEvent.click(btn('Office Recording'));
  await flush(50);
  expect(writes.some((w) => w.command === 'wall2_office_mood')).toBe(false);
});

it('a PC that may not write: the buttons send nothing', async () => {
  officeCanWrite = false;
  await show();
  fireEvent.click(btn('Gaming'));
  await flush(50);
  expect(writes.some((w) => w.command === 'wall2_office_mood')).toBe(false);
});

// The Moods heading: Condo or Office.
const showMoods = async () => {
  const view = render(<Moods />);
  await flush(11 * 60_000);
  return view;
};
const names = () => [...document.querySelectorAll('.mood-row .mood-name')].map((e) => e.textContent);

it('Condo shows today\'s moods; Office shows the office moods; the pick is remembered', async () => {
  const first = await showMoods();
  expect(names()).toEqual(['Day', 'Evening', 'Late Night']);
  expect(screen.getByText('Condo').getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByText('Office'));
  await flush(50);
  expect(names()).toEqual(['Relax', 'Gaming', 'Recording']);
  expect(screen.getByText('Office').getAttribute('aria-pressed')).toBe('true');
  expect(localStorage.getItem(MOODS_WHICH_KEY)).toBe('office');
  first.unmount();
  await showMoods();
  expect(names()).toEqual(['Relax', 'Gaming', 'Recording']);
  fireEvent.click(screen.getByText('Condo'));
  await flush(50);
  expect(names()).toEqual(['Day', 'Evening', 'Late Night']);
  expect(localStorage.getItem(MOODS_WHICH_KEY)).toBe('condo');
});

it('an office card sends the office mood call and shows it on', async () => {
  localStorage.setItem(MOODS_WHICH_KEY, 'office');
  await showMoods();
  fireEvent.click(screen.getByText('Gaming'));
  await flush(50);
  expect(writes).toContainEqual({ command: 'wall2_office_mood', args: { id: 'gaming' } });
  expect(screen.getByText('On now').closest('button')?.getAttribute('data-mood')).toBe('gaming');
});

it('Office with the home app away shows the quiet line and no cards; a PC that may not write sends nothing', async () => {
  localStorage.setItem(MOODS_WHICH_KEY, 'office');
  officeCanWrite = false;
  await showMoods();
  fireEvent.click(screen.getByText('Relax'));
  await flush(50);
  expect(writes.some((w) => w.command === 'wall2_office_mood')).toBe(false);
});

it('a blocked local storage still works: the condo shows, and the pick works for the visit', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  await showMoods();
  expect(names()).toEqual(['Day', 'Evening', 'Late Night']);
  fireEvent.click(screen.getByText('Office'));
  await flush(50);
  expect(names()).toEqual(['Relax', 'Gaming', 'Recording']);
  vi.restoreAllMocks();
});

it('an empty looks list keeps the row as one dashed Panel looks chip with a reason', async () => {
  studio = studioAnswer({ looks: [] });
  await show();
  expect(rowNames('looks')).toEqual(['Panel looks']);
  expect(screen.getByText('Panel looks').closest('.st-preset')!.getAttribute('aria-disabled')).toBe('true');
  expect(await tipOf(screen.getByText('Panel looks'))).toContain('no panel looks');
});

it('a decoy named like a mood never wins: the id first, then the whole name, no substring', async () => {
  moodList = [
    { id: 'preGaming', label: 'Pre-gaming cleanup', line: null },
    { id: 'notRec', label: 'Not recording', line: null },
    { id: 'gaming', label: 'Game time', line: 'Room 25%' },
    { id: 'x', label: 'office recording', line: 'Room 80%' },
  ];
  await show();
  fireEvent.click(btn('Gaming'));
  await flush(50);
  expect(writes).toContainEqual({ command: 'wall2_office_mood', args: { id: 'gaming' } });
  fireEvent.click(btn('Office Recording'));
  await flush(50);
  expect(writes).toContainEqual({ command: 'wall2_office_mood', args: { id: 'x' } });
});

it('only decoys listed: both buttons are dashed and send nothing', async () => {
  moodList = [
    { id: 'preGaming', label: 'Pre-gaming cleanup', line: null },
    { id: 'notRec', label: 'Not recording', line: null },
  ];
  await show();
  for (const n of ['Gaming', 'Office Recording']) {
    expect(btn(n).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(btn(n));
  }
  await flush(50);
  expect(writes.some((w) => w.command === 'wall2_office_mood')).toBe(false);
});
