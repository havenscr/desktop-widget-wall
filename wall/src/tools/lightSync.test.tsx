import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { usePlaceStore } from '../state/places';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import { LightSync } from './accounts';
import { PAIR_PROMPT, TEST_WORDS } from './lightSync';
import { resetTools } from './store';

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

type St = { paired: boolean; bridgeChanged?: boolean };
const status = (s: St) => ({ paired: s.paired, bridgeChanged: s.bridgeChanged ?? false, running: false, starting: false, lastError: null, stoppedHueSync: false });

beforeEach(() => {
  resetTools();
  resetTip();
  vi.useFakeTimers();
  usePlaceStore.setState({ active: 'meet' });
  mocks.set('wall2_youtube_status', () => ({ setup: false, signedIn: false, reason: 'not set up', searchesLeft: null }));
  mocks.set('wall2_meet_next', () => ({ accounts: [], meetings: [] }));
  mocks.set('wall2_meet_open_status', () => 'desktop');
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  usePlaceStore.setState({ active: 'work' });
});

const row = () => document.querySelector('[data-account="lightsync"]') as HTMLElement;
const note = () => document.querySelector('[data-lightsync-note]')?.textContent ?? '';
const open = async () => {
  render(
    <>
      <LightSync />
      <HoverTipLayer />
    </>,
  );
  await flush();
};
const hoverText = async (el: Element) => {
  fireEvent.mouseEnter(el);
  await flush(300);
  return document.querySelector('.hover-tip')?.textContent ?? '';
};

it('shows Not paired with a Pair button', async () => {
  mocks.set('wall2_lightsync_status', () => status({ paired: false }));
  await open();
  expect(row().textContent).toContain('Not paired');
  expect(screen.getByRole('button', { name: 'Pair' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Forget' })).toBeNull();
  expect(await hoverText(screen.getByRole('button', { name: 'Pair' }))).toContain('Hue bridge');
});

it('Pair shows the link button line and polls status until paired', async () => {
  let paired = false;
  let finish: (v: string) => void = () => undefined;
  const statusFn = vi.fn(() => status({ paired }));
  mocks.set('wall2_lightsync_status', statusFn);
  mocks.set('wall2_lightsync_pair', () => new Promise<string>((d) => { finish = d; }));
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Pair' }));
  await flush();
  expect(note()).toBe(PAIR_PROMPT);
  const before = statusFn.mock.calls.length;
  await flush(4100);
  expect(statusFn.mock.calls.length).toBeGreaterThan(before);
  expect(note()).toBe(PAIR_PROMPT);
  paired = true;
  await flush(2100);
  expect(row().textContent).toContain('Paired');
  expect(note()).not.toBe(PAIR_PROMPT);
  finish('paired');
  await flush();
  expect(screen.getByRole('button', { name: 'Test the light link' })).toBeTruthy();
});

it.each([
  ['link-not-pressed', 'The link button was not pressed in time'],
  ['bridge-unreachable', 'The Hue bridge did not answer'],
  ['cert', 'The bridge did not match the one the home app knows'],
  ['busy', 'Another pairing or test is running'],
  ['failed', 'Pairing did not finish'],
])('Pair refused with %s says it in plain words and offers Pair again', async (w, line) => {
  mocks.set('wall2_lightsync_status', () => status({ paired: false }));
  mocks.set('wall2_lightsync_pair', () => Promise.reject(w));
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Pair' }));
  await flush();
  expect(note()).toBe(line);
  expect(row().textContent).toContain('Not paired');
  expect(screen.getByRole('button', { name: 'Pair' })).toBeTruthy();
});

it('shows Paired with Test and Forget, each with a hover tip', async () => {
  mocks.set('wall2_lightsync_status', () => status({ paired: true }));
  await open();
  expect(row().textContent).toContain('Paired');
  expect(screen.queryByRole('button', { name: 'Pair' })).toBeNull();
  expect(await hoverText(screen.getByRole('button', { name: 'Test the light link' }))).toContain('3 seconds');
  expect(await hoverText(screen.getByRole('button', { name: 'Forget' }))).toContain('Hue app');
});

it('Test spins while it runs, then says ok', async () => {
  let finish: (v: string) => void = () => undefined;
  mocks.set('wall2_lightsync_status', () => status({ paired: true }));
  mocks.set('wall2_lightsync_test', () => new Promise<string>((d) => { finish = d; }));
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Test the light link' }));
  await flush();
  expect(row().querySelector('.tools-spin')).not.toBeNull();
  expect((screen.getByRole('button', { name: 'Test the light link' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Forget' }) as HTMLButtonElement).disabled).toBe(true);
  finish('ok');
  await flush();
  expect(row().querySelector('.tools-spin')).toBeNull();
  expect(note()).toBe('The light link works');
});

it.each([
  ['dtls', 'The bridge did not take the light stream'],
  ['stop-failed', 'The test ran, but the bridge kept streaming'],
  ['panels-unavailable', 'The Plays worked, the panels did not answer'],
  ['busy', 'Another test or pairing is running'],
  ['not-paired', 'Not paired yet'],
  ['no-area', 'The home app has no entertainment area'],
])('Test refused with %s says it in plain words', async (w, line) => {
  mocks.set('wall2_lightsync_status', () => status({ paired: true }));
  mocks.set('wall2_lightsync_test', () => Promise.reject(w));
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Test the light link' }));
  await flush();
  expect(note()).toBe(line);
  expect(TEST_WORDS[w]).toBe(line);
});

it('Test with an unknown word falls back to a plain line', async () => {
  mocks.set('wall2_lightsync_status', () => status({ paired: true }));
  mocks.set('wall2_lightsync_test', () => Promise.reject('something-new'));
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Test the light link' }));
  await flush();
  expect(note()).toBe('The test did not finish');
});

it('Forget returns the row to Not paired', async () => {
  let paired = true;
  const forget = vi.fn(() => { paired = false; });
  mocks.set('wall2_lightsync_status', () => status({ paired }));
  mocks.set('wall2_lightsync_forget', forget);
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Forget' }));
  await flush();
  expect(forget).toHaveBeenCalledTimes(1);
  expect(row().textContent).toContain('Not paired');
});

it('a failed Forget says so and stays paired', async () => {
  mocks.set('wall2_lightsync_status', () => status({ paired: true }));
  mocks.set('wall2_lightsync_forget', () => Promise.reject('failed'));
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Forget' }));
  await flush();
  expect(note()).toBe('Could not forget the pairing');
  expect(row().textContent).toContain('Paired');
});

it('bridgeChanged says so, with Forget and Pair', async () => {
  mocks.set('wall2_lightsync_status', () => status({ paired: true, bridgeChanged: true }));
  await open();
  expect(row().textContent).toContain('Bridge changed');
  expect(screen.getByRole('button', { name: 'Forget' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Pair' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Test the light link' })).toBeNull();
  expect(note()).toBe('Pair again with the new bridge');
});

it('unavailable (status fails) says so and Retry asks again', async () => {
  let fail = true;
  mocks.set('wall2_lightsync_status', () => (fail ? Promise.reject('failed') : status({ paired: false })));
  await open();
  expect(row().textContent).toContain('Could not check');
  fail = false;
  fireEvent.click(row().querySelector('button')!);
  await flush();
  expect(row().textContent).toContain('Not paired');
});

it('never shows a key, a client key or an address, even if the answer carried them', async () => {
  mocks.set('wall2_lightsync_status', () => ({ ...status({ paired: true }), username: 'user-secret-1', clientkey: 'CLIENTKEY-SECRET-1', ip: '192.168.1.20', bridgeId: '001788fffe123456' }));
  mocks.set('wall2_lightsync_test', () => Promise.reject('dtls'));
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Test the light link' }));
  await flush();
  const text = row().parentElement!.textContent ?? '';
  for (const secret of ['user-secret-1', 'CLIENTKEY-SECRET-1', '192.168.1.20', '001788fffe123456']) expect(text).not.toContain(secret);
  expect(document.body.innerHTML).not.toContain('CLIENTKEY-SECRET-1');
});
