import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { resetTip } from '../ui/HoverTip';
import { Keys, KEYS_POLL_MS, WHEEL_GAP_MS } from './Keys';
import { MODE_KEY, type KeysSummary } from './keysModel';

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const general = { id: 'general', name: 'General', general: true, keys: [{ label: 'Snip', icon: 'screenshot' }, { label: 'Clipboard', icon: 'clipboard' }] };
const sales = { id: 'sales', name: 'Sales app', general: false, keys: [{ label: 'Refresh', icon: 'refresh' }] };
let answer: KeysSummary;
let sent: unknown[];
let sendFails: string | null;
const front = (autoId: string | null, exe: string | null = null, sets = [general, sales]): KeysSummary => ({ front: 'app', autoId, exe, sets, source: 'file' });

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sent = [];
  sendFails = null;
  answer = front('sales');
  mocks.set('wall2_keys_summary', () => answer);
  mocks.set('wall2_keys_send', (args) => {
    sent.push(args);
    const set = [general, sales].find((s) => s.id === args?.setId);
    if (sendFails) throw sendFails;
    // The Rust rule: a specific set only types into its own app.
    if (set && !set.general && answer.autoId !== set.id) throw 'no app';
    return undefined;
  });
});
afterEach(() => {
  resetTip();
  vi.useRealTimers();
  mocks.clear();
});

it('shows the app own set under its name and sends only a set id and a key index', async () => {
  render(<Keys />);
  await flush();
  expect(screen.getByText('Keys for Sales app')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await flush();
  expect(sent).toEqual([{ setId: 'sales', index: 0 }]);
  expect(screen.getByText('Refresh sent to Sales app')).toBeTruthy();
});

it('shows the general set when the app in front has none of its own', async () => {
  answer = front('general', 'notepad.exe');
  render(<Keys />);
  await flush();
  expect(screen.getByText('Keys: General')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Clipboard' })).toBeTruthy();
});

it('says "No keys for this app" when there is no set and no general set, with a hint', async () => {
  answer = front(null, 'notepad.exe', [sales]);
  render(<Keys />);
  await flush();
  expect(screen.getByText('No keys for this app')).toBeTruthy();
});

it('Auto follows a change of app', async () => {
  render(<Keys />);
  await flush();
  expect(screen.getByText('Keys for Sales app')).toBeTruthy();
  answer = front('general', 'notepad.exe');
  await flush(KEYS_POLL_MS);
  expect(screen.getByText('Keys: General')).toBeTruthy();
  expect(screen.getByRole('switch', { name: /Auto/ }).getAttribute('aria-checked')).toBe('true');
});

it('stepping holds the set, which then survives a change of app until Auto is clicked', async () => {
  render(<Keys />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Next set' }));
  expect(screen.getByText('Keys: General')).toBeTruthy();
  expect(screen.getByRole('switch', { name: /Auto/ }).getAttribute('aria-checked')).toBe('false');
  expect(JSON.parse(localStorage.getItem(MODE_KEY) ?? '')).toEqual({ hold: true, setId: 'general' });
  answer = front(null, 'notepad.exe', [general, sales]);
  await flush(KEYS_POLL_MS);
  expect(screen.getByText('Keys: General')).toBeTruthy();
  fireEvent.click(screen.getByRole('switch', { name: /Auto/ }));
  expect(screen.getByText('No keys for this app')).toBeTruthy();
  expect(JSON.parse(localStorage.getItem(MODE_KEY) ?? '')).toEqual({ hold: false, setId: null });
});

it('the wheel steps one set at most every quarter second', async () => {
  render(<Keys />);
  await flush();
  const row = screen.getByRole('region', { name: 'Keys for Sales app' });
  fireEvent.wheel(row, { deltaY: 100 });
  fireEvent.wheel(row, { deltaY: 100 });
  expect(screen.getByText('Keys: General')).toBeTruthy();
  await flush(WHEEL_GAP_MS + 10);
  fireEvent.wheel(screen.getByRole('region', { name: 'Keys: General' }), { deltaY: -100 });
  expect(screen.getByText('Keys for Sales app')).toBeTruthy();
});

it('a held set in the wrong app is refused with fixed words and types nothing', async () => {
  localStorage.setItem(MODE_KEY, JSON.stringify({ hold: true, setId: 'sales' }));
  answer = front('general', 'notepad.exe');
  render(<Keys />);
  await flush();
  expect(screen.getByText('Keys for Sales app')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await flush();
  expect(screen.getByText('The app in front is not Sales app')).toBeTruthy();
  // The page asked; the Rust rule refused (the mock stands in for it).
  expect(sent).toEqual([{ setId: 'sales', index: 0 }]);
});

it('a held set that left keys.json is Auto again, in storage too', async () => {
  localStorage.setItem(MODE_KEY, JSON.stringify({ hold: true, setId: 'gone' }));
  render(<Keys />);
  await flush();
  expect(screen.getByText('Keys for Sales app')).toBeTruthy();
  expect(JSON.parse(localStorage.getItem(MODE_KEY) ?? '')).toEqual({ hold: false, setId: null });
});

it('bad storage is read as Auto', async () => {
  localStorage.setItem(MODE_KEY, '{"hold":true,"setId":"<script>"}');
  render(<Keys />);
  await flush();
  expect(screen.getByText('Keys for Sales app')).toBeTruthy();
});

it('shows each refusal as one fixed line and ignores a click while one is sending', async () => {
  sendFails = 'not forward';
  render(<Keys />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await flush();
  expect(screen.getByText('Could not bring Sales app forward')).toBeTruthy();
  let release: () => void = () => undefined;
  mocks.set('wall2_keys_send', (args) => new Promise((resolve) => { sent.push(args); release = () => resolve(undefined); }));
  sent = [];
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(sent).toHaveLength(1);
  release();
  await flush();
});

it('draws nothing where the commands do not exist, and a quiet line when keys.json is bad', async () => {
  mocks.set('wall2_keys_summary', () => {
    throw 'unsupported';
  });
  const { container, unmount } = render(<Keys />);
  await flush();
  expect(container.textContent).toBe('');
  unmount();
  mocks.set('wall2_keys_summary', () => {
    throw 'app 1, key 2: chord is not in the allowed key list';
  });
  render(<Keys />);
  await flush();
  expect(screen.getByText('keys.json has a problem')).toBeTruthy();
});

it('renders up to eight keys and no more', async () => {
  const ten = { id: 'ten', name: 'Ten', general: false, keys: Array.from({ length: 10 }, (_, i) => ({ label: `K${i}`, icon: 'keyboard' })) };
  answer = front('ten', null, [ten]);
  render(<Keys />);
  await flush();
  expect(screen.getAllByRole('button', { name: /^K\d$/ })).toHaveLength(8);
});
