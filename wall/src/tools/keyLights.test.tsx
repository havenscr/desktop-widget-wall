// @ts-ignore node's own file calls; one test reads the Rust command registration as text.
import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { resetKeyLights } from '../studio/store';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import { KeyLights, saveError, testLine } from './KeyLights';

vi.setConfig({ testTimeout: 20_000 });

const lib: string = readFileSync('../src-tauri/src/lib.rs', 'utf8');
const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

// An invented value; the native side decides what is a good address.
const ADDRESS = '192.168.77.5';
let saved: { left: boolean; right: boolean };
let calls: { command: string; args: Record<string, unknown> }[];
let tests: Record<string, string | null>;
let saveWord: string | null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 14, 9, 42, 0));
  resetKeyLights();
  resetTip();
  saved = { left: false, right: false };
  calls = [];
  tests = {};
  saveWord = null;
  mocks.set('wall2_keylights_status', () => ({ left: { set: saved.left }, right: { set: saved.right } }));
  mocks.set('wall2_keylights_read', () => ({ left: saved.left ? { on: true, brightness: 60, kelvin: 4400 } : 'not-set-up', right: saved.right ? { on: true, brightness: 60, kelvin: 4400 } : 'not-set-up' }));
  mocks.set('wall2_keylights_set_address', (args) => {
    calls.push({ command: 'set_address', args: args ?? {} });
    if (saveWord) throw saveWord;
    saved[args?.side as 'left' | 'right'] = true;
  });
  mocks.set('wall2_keylights_forget', (args) => {
    calls.push({ command: 'forget', args: args ?? {} });
    saved[args?.side as 'left' | 'right'] = false;
  });
  mocks.set('wall2_keylights_test', (args) => {
    calls.push({ command: 'test', args: args ?? {} });
    const word = tests[args?.side as string];
    if (word) throw word;
    return { on: true, brightness: 60, kelvin: 4400 };
  });
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
});

const show = async () => {
  const view = render(
    <>
      <KeyLights />
      <HoverTipLayer />
    </>,
  );
  await flush();
  return view;
};
const row = (side: 'left' | 'right') => document.querySelector(`.kl-row[data-side="${side}"]`) as HTMLElement;
const btn = (side: 'left' | 'right', label: string) => [...row(side).querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;
const field = () => document.querySelector('.kl-field') as HTMLInputElement;
const type = (value: string) => fireEvent.change(field(), { target: { value } });
const tipOf = async (el: Element) => {
  fireEvent.mouseEnter(el);
  await flush(300);
  const text = document.querySelector('.hover-tip')?.textContent ?? '';
  fireEvent.mouseLeave(el);
  await flush(10);
  return text;
};

it('shows two rows, Left and Right, each Not set up with a Set up button, and no address anywhere', async () => {
  await show();
  expect(screen.getByText('Key lights')).toBeTruthy();
  for (const side of ['left', 'right'] as const) {
    expect(row(side).textContent).toContain('Not set up');
    expect(btn(side, 'Set up')).toBeTruthy();
    expect(btn(side, 'Test')).toBeUndefined();
  }
  expect(screen.getByText('Left')).toBeTruthy();
  expect(screen.getByText('Right')).toBeTruthy();
});

it('Set up opens one field with the placeholder and its tip; Save is off until something is typed', async () => {
  await show();
  fireEvent.click(btn('left', 'Set up'));
  expect(field().placeholder).toBe('192.168.x.x');
  expect(field().type).toBe('text');
  expect(btn('left', 'Save').disabled).toBe(true);
  expect(await tipOf(field())).toBe("The key light's address on your network, from the Elgato Control Center app or your router. Saved on this PC only.");
  type(ADDRESS);
  expect(btn('left', 'Save').disabled).toBe(false);
  expect(await tipOf(btn('left', 'Save'))).toBe('Saves the address on this PC; it is never shown again');
});

it('Save sends the side word and the typed value once, clears the field, and the row says Saved without showing it', async () => {
  await show();
  fireEvent.click(btn('left', 'Set up'));
  type(`  ${ADDRESS} `);
  fireEvent.click(btn('left', 'Save'));
  await flush();
  expect(calls).toEqual([{ command: 'set_address', args: { side: 'left', address: ADDRESS } }]);
  expect(document.querySelector('.kl-field')).toBeNull();
  expect(row('left').textContent).toContain('Saved');
  expect(document.body.textContent).not.toContain(ADDRESS);
  expect(btn('left', 'Test')).toBeTruthy();
  expect(btn('left', 'Change').textContent).toBe('Change');
});

it('Enter saves and Escape closes the field and clears what was typed, without closing anything else', async () => {
  await show();
  fireEvent.click(btn('right', 'Set up'));
  type(ADDRESS);
  const esc = fireEvent.keyDown(field(), { key: 'Escape' });
  expect(esc).toBe(false);
  expect(document.querySelector('.kl-field')).toBeNull();
  fireEvent.click(btn('right', 'Set up'));
  expect(field().value).toBe('');
  type(ADDRESS);
  fireEvent.keyDown(field(), { key: 'Enter' });
  await flush();
  expect(calls.map((c) => c.command)).toEqual(['set_address']);
});

it('a refused address says one fixed line, clears the field and saves nothing', async () => {
  await show();
  saveWord = 'bad-address';
  fireEvent.click(btn('left', 'Set up'));
  type('8.8.8.8');
  fireEvent.click(btn('left', 'Save'));
  await flush();
  expect(screen.getByRole('alert').textContent).toBe(saveError('bad-address'));
  expect(saveError('bad-address')).toBe('That is not an address on your own network. Use four numbers like 192.168.x.x.');
  expect(field().value).toBe('');
  expect(row('left').textContent).not.toContain('Saved');
  expect(document.body.textContent).not.toContain('8.8.8.8');
});

it('only one form is open at a time', async () => {
  await show();
  fireEvent.click(btn('left', 'Set up'));
  fireEvent.click(btn('right', 'Set up'));
  expect(document.querySelectorAll('.kl-field')).toHaveLength(1);
  expect(row('right').querySelector('.kl-field')).toBeTruthy();
});

it('Test reads the light and the row itself says it answered at the time', async () => {
  saved = { left: true, right: true };
  await show();
  fireEvent.click(btn('left', 'Test'));
  await flush();
  expect(calls).toEqual([{ command: 'test', args: { side: 'left' } }]);
  expect(row('left').querySelector('.kl-state')?.textContent).toBe('Left key light answered at 9:42 AM');
  expect(await tipOf(btn('left', 'Test'))).toBe('Reads the light once and says whether it answered');
});

it('a Test that fails says the fixed words in the row itself', async () => {
  saved = { left: true, right: true };
  tests = { left: 'no-answer', right: 'other-model' };
  await show();
  fireEvent.click(btn('left', 'Test'));
  fireEvent.click(btn('right', 'Test'));
  await flush();
  expect(row('left').querySelector('.kl-state')?.textContent).toBe('Left key light: no answer');
  expect(row('right').querySelector('.kl-state')?.textContent).toBe('Right key light: different model');
  expect(testLine('right', 'other-model')).toBe('Right key light: different model');
  expect(testLine('left', 'timeout')).toBe('Left key light: no answer');
  expect(testLine('left', 'failed')).toBe('Left key light: bad answer');
});

it('a saved row has Test, Change and Forget side by side, and Forget needs no form', async () => {
  saved = { left: true, right: false };
  await show();
  expect([...row('left').querySelectorAll('.kl-head button')].map((b) => b.textContent)).toEqual(['Test', 'Change', 'Forget']);
  fireEvent.click(btn('left', 'Forget'));
  await flush();
  expect(calls).toEqual([{ command: 'forget', args: { side: 'left' } }]);
  expect(row('left').textContent).toContain('Not set up');
});

it('"slow-down" on a save or a test is a quiet line, not a fault', async () => {
  saved = { left: true, right: false };
  tests = { left: 'slow-down' };
  await show();
  fireEvent.click(btn('left', 'Test'));
  await flush();
  expect(row('left').querySelector('.kl-state')?.textContent).toBe('Left key light: try again soon');
  expect(row('left').querySelector('.kl-state.bad')).toBeNull();
  fireEvent.click(btn('right', 'Set up'));
  saveWord = 'slow-down';
  type(ADDRESS);
  fireEvent.click(btn('right', 'Save'));
  await flush();
  const line = screen.getByRole('alert');
  expect(line.textContent).toBe('Too many tries. Wait a minute, then try again.');
  expect(line.classList.contains('bad')).toBe(false);
  expect(saveError('busy')).toBe(saveError('slow-down'));
});

it('a file that cannot be read says so once, in one line, until an address is typed again', async () => {
  mocks.set('wall2_keylights_status', () => ({ left: { set: saved.left }, right: { set: saved.right }, unreadable: !saved.left }));
  await show();
  expect(screen.getAllByText('The saved addresses could not be read. Type them again.')).toHaveLength(1);
  fireEvent.click(btn('left', 'Set up'));
  type(ADDRESS);
  fireEvent.click(btn('left', 'Save'));
  await flush();
  expect(screen.queryByText('The saved addresses could not be read. Type them again.')).toBeNull();
});

it('Change opens the field again, with Forget; Forget removes the address and the row goes back to Not set up', async () => {
  saved = { left: true, right: false };
  await show();
  fireEvent.click(btn('left', 'Change'));
  expect(btn('left', 'Forget')).toBeTruthy();
  expect(btn('left', 'Test')).toBeUndefined();
  expect(await tipOf(btn('left', 'Forget'))).toBe('Removes the saved address from this PC. The light goes back to Not set up.');
  fireEvent.click(btn('left', 'Forget'));
  await flush();
  expect(calls).toEqual([{ command: 'forget', args: { side: 'left' } }]);
  expect(row('left').textContent).toContain('Not set up');
});

it('the section is ringed when Tools opens at it', async () => {
  const { container } = render(<KeyLights ringed />);
  await flush();
  expect(container.querySelector('.tools-ringed')).toBeTruthy();
});

it('the native commands the page calls are all registered', () => {
  for (const c of ['status', 'set_address', 'forget', 'test', 'read', 'set']) expect(lib).toContain(`wall2_keylights_cmd::wall2_keylights_${c}`);
  expect(lib).toContain('mod wall2_keylights;');
  expect(lib).toContain('wall2_keylights_cmd::start_log');
});
