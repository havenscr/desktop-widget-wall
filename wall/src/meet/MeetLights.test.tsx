import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { resetTools } from '../tools/store';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import { studioAnswer, studioWith } from '../studio/homeKit';
import { resetHome } from '../studio/homeStore';
import { resetKeyLights } from '../studio/store';
import { MeetLights, officeChipLabel, useLightsNotice } from './MeetLights';
import { useKeyLights } from '../studio/store';
import { rowModel } from '../studio/moodRow';

vi.setConfig({ testTimeout: 20_000 });

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const keysOn = { on: true, brightness: 60, kelvin: 4400 };
let answer: Record<string, unknown>;
let writes: { command: string; args?: Record<string, unknown> }[];
const moods = (active: string | null) => ({
  stale: false,
  moods: [
    { id: 'meeting', label: 'Meeting', line: null, active: active === 'meeting' },
    { id: 'unwind', label: 'Unwind', line: null, active: active === 'unwind' },
  ],
  off: null,
  canWrite: true,
  writeBlock: null,
});
let moodNow: string | null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-11-14T10:00:00-08:00'));
  resetKeyLights();
  resetTools();
  resetTip();
  resetHome();
  answer = studioWith('onAir');
  writes = [];
  moodNow = 'meeting';
  mocks.set('wall2_keylights_status', () => ({ left: { set: true }, right: { set: true } }));
  mocks.set('wall2_keylights_read', () => ({ left: keysOn, right: keysOn }));
  mocks.set('wall2_keylights_set', (args) => (writes.push({ command: 'wall2_keylights_set', args }), { left: keysOn, right: keysOn }));
  mocks.set('wall2_studio', () => answer);
  mocks.set('wall2_office_moods', () => moods(moodNow));
  for (const c of ['wall2_studio_preset', 'wall2_studio_normal', 'wall2_studio_group', 'wall2_studio_look']) {
    mocks.set(c, (args) => (writes.push({ command: c, args }), answer));
  }
  mocks.set('wall2_office_mood', (args) => {
    writes.push({ command: 'wall2_office_mood', args });
    moodNow = String(args?.id);
    return moods(moodNow);
  });
});
afterEach(() => {
  resetHome();
  vi.useRealTimers();
  mocks.clear();
});

function Notice() {
  const n = useLightsNotice();
  return <p data-testid="notice">{n ?? ''}</p>;
}
const show = async () => {
  const view = render(
    <>
      <MeetLights />
      <Notice />
      <HoverTipLayer />
    </>,
  );
  await flush(10);
  return view;
};

it('two rows: moods with Back to normal and Fine tune, then Key lights, Panels and the office chip', async () => {
  await show();
  const rows = [...document.querySelectorAll('.meet-lights-row')];
  expect(rows).toHaveLength(2);
  const first = within(rows[0] as HTMLElement);
  expect(first.getByRole('button', { name: 'On air' })).toBeTruthy();
  expect(first.getByRole('button', { name: 'Back to normal' })).toBeTruthy();
  expect(first.getByRole('button', { name: 'Fine tune' })).toBeTruthy();
  const second = within(rows[1] as HTMLElement);
  expect(second.getByRole('switch', { name: 'Key lights' })).toBeTruthy();
  expect(second.getByRole('switch', { name: 'Panels' })).toBeTruthy();
  expect(second.getByRole('button', { name: 'Office: Meeting' })).toBeTruthy();
  // The old Lights key and chip are gone.
  expect(screen.queryByText('Lights: later')).toBeNull();
});

it('draws exactly the presets the home app returns: two presets, two chips', async () => {
  await show();
  expect(answer.presets).toHaveLength(2);
  expect(document.querySelectorAll('.meet-lights .st-preset[data-preset]')).toHaveLength(2);
});

it('with three presets it draws three chips, never more', async () => {
  const more = (answer.presets as Record<string, unknown>[]).concat([
    { id: 'call', label: 'Call', line: 'x', active: false, setsKeyLights: false },
    { id: 'extra', label: 'Extra', line: 'x', active: false, setsKeyLights: false },
  ]);
  answer = studioAnswer({ presets: more });
  await show();
  expect(document.querySelectorAll('.meet-lights .st-preset[data-preset]')).toHaveLength(3);
});

it('the chips send the real calls: preset, normal, group, key lights, office mood', async () => {
  await show();
  fireEvent.click(screen.getByRole('button', { name: 'Recording' }));
  await flush(50);
  fireEvent.click(screen.getByRole('button', { name: 'Back to normal' }));
  await flush(50);
  fireEvent.click(screen.getByRole('switch', { name: 'Panels' }));
  await flush(50);
  fireEvent.click(screen.getByRole('switch', { name: 'Key lights' }));
  await flush(50);
  fireEvent.click(screen.getByRole('button', { name: 'Office: Meeting' }));
  fireEvent.click(within(screen.getByRole('group', { name: 'Office moods' })).getByRole('button', { name: 'Unwind' }));
  await flush(50);
  expect(writes.map((w) => w.command)).toEqual(['wall2_studio_preset', 'wall2_studio_normal', 'wall2_studio_group', 'wall2_keylights_set', 'wall2_office_mood']);
  expect(writes[4].args).toEqual({ id: 'unwind' });
});

it('the office chip names the mood now on, else Office lights', () => {
  const none = rowModel({ moods: moods(null), moodsWord: null, applying: null, moodFail: null, sticky: null });
  expect(officeChipLabel(none)).toBe('Office lights');
  const on = rowModel({ moods: moods('unwind'), moodsWord: null, applying: null, moodFail: null, sticky: null });
  expect(officeChipLabel(on)).toBe('Office: Unwind');
});

const officeButtons = () => [...document.querySelectorAll('.meet-office-list .st-preset')] as HTMLElement[];

it('a refused office mood keeps the picker open, marks the chip and says why on the notice line', async () => {
  mocks.set('wall2_office_mood', () => {
    throw 'refused';
  });
  await show();
  fireEvent.click(screen.getByRole('button', { name: 'Office: Meeting' }));
  fireEvent.click(officeButtons()[1]);
  await flush(50);
  expect(document.querySelector('.meet-office-list')).toBeTruthy();
  expect(officeButtons()[1].className).toContain('failed');
  expect(screen.getByTestId('notice').textContent).not.toBe('');
});

it('a key light note reaches the notice line', async () => {
  await show();
  act(() => useKeyLights.setState({ note: 'Left key light did not answer' }));
  expect(screen.getByTestId('notice').textContent).toBe('Left key light did not answer');
});

it('twelve long moods all draw inside the scrolling list', async () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, label: `A very long office mood name number ${i}`, line: null, active: false }));
  mocks.set('wall2_office_moods', () => ({ ...moods(null), moods: many }));
  await show();
  fireEvent.click(screen.getByRole('button', { name: 'Office lights' }));
  expect(officeButtons()).toHaveLength(12);
  expect(document.querySelector('.meet-office-list')?.getAttribute('aria-label')).toBe('Office moods');
});

it('a held panel write locks the office picker; nothing is sent until it ends', async () => {
  let release: () => void = () => undefined;
  mocks.set('wall2_studio_group', (args) => {
    writes.push({ command: 'wall2_studio_group', args });
    return new Promise((r) => {
      release = () => r(answer);
    });
  });
  await show();
  fireEvent.click(screen.getByRole('switch', { name: 'Panels' }));
  await flush(10);
  fireEvent.click(screen.getByRole('button', { name: 'Office: Meeting' }));
  expect(officeButtons()[1].getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(officeButtons()[1]);
  await flush(50);
  expect(writes.map((w) => w.command)).toEqual(['wall2_studio_group']);
  release();
  await flush(50);
  expect(officeButtons()[1].getAttribute('aria-disabled')).toBeNull();
});

it('a PC that may not write: presets, Back to normal and the office picker send nothing', async () => {
  answer = studioAnswer({ canWrite: false, writeBlock: 'not-set-up' });
  mocks.set('wall2_office_moods', () => ({ ...moods('meeting'), canWrite: false, writeBlock: 'not-set-up' }));
  await show();
  const chips = [...document.querySelectorAll('.meet-lights .st-preset[data-preset]')] as HTMLElement[];
  for (const c of chips) {
    expect(c.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(c);
  }
  fireEvent.click(screen.getByRole('button', { name: 'Office: Meeting' }));
  fireEvent.click(officeButtons()[1]);
  await flush(50);
  expect(writes).toEqual([]);
  expect(officeButtons()[1].getAttribute('aria-disabled')).toBe('true');
});

it('a failed home read dims the presets and sends nothing', async () => {
  mocks.set('wall2_studio', () => {
    throw 'unreachable';
  });
  await show();
  for (const c of document.querySelectorAll('.meet-lights .st-preset[data-preset]')) {
    expect(c.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(c);
  }
  await flush(50);
  expect(writes).toEqual([]);
});

it('a failed moods read leaves no office chip', async () => {
  mocks.set('wall2_office_moods', () => {
    throw 'unreachable';
  });
  await show();
  expect(document.querySelector('[data-office-chip]')).toBeNull();
});

it('Fine tune opens the sheet', async () => {
  await show();
  fireEvent.click(screen.getByRole('button', { name: 'Fine tune' }));
  await flush(10);
  expect(useKeyLights.getState().drawer).toBe(true);
  expect(document.querySelector('.st-drawer')).toBeTruthy();
});
