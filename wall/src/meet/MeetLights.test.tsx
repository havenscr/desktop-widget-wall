import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { resetTools } from '../tools/store';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import { studioAnswer, studioWith } from '../studio/homeKit';
import { resetHome } from '../studio/homeStore';
import { resetKeyLights } from '../studio/store';
import { MeetLights, officeChipLabel } from './MeetLights';
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

const show = async () => {
  const view = render(
    <>
      <MeetLights />
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
