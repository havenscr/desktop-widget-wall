// @ts-ignore node's own file calls; this test reads the Rust contract as text.
import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LIBRARY_DATA } from '../bridge/devMocks/libraryData';
import { mocks } from '../bridge/tauri';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import { Keys } from '../work/Keys';
import { resetKeysFeed } from '../work/keysFeed';
import type { KeysSummary } from '../work/keysModel';
import { RECORDING_KEYS, recordingKeyTip, resetRecordingHows } from './recordingKeys';
import { useSignalStore } from './store';

// Fake timers step through up to a minute here; the stepped span stays short, and the limit is generous for a slow runner.
vi.setConfig({ testTimeout: 20_000 });

vi.mock('../work/forYou', async (orig) => ({ ...(await orig<typeof import('../work/forYou')>()), useForYou: () => [] }));

const rust: string = readFileSync('../src-tauri/src/wall2_keys.rs', 'utf8');
const keylib: string = readFileSync('../src-tauri/src/wall2_keylib.rs', 'utf8');
const k = (label: string) => ({ label, icon: 'keyboard', action: null });
const sales = { id: 'sales', name: 'Sales app', general: false, keys: [k('Refresh')] };
const general = { id: 'general', name: 'General', general: true, keys: [k('Lock')] };
const summary: KeysSummary = { front: 'app', autoId: 'sales', exe: null, sets: [sales, general], source: 'file', defaultPins: [], filePins: [] };
let sent: unknown[];

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const record = (on: boolean) => act(() => useSignalStore.setState({ known: true, recording: on }));

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetKeysFeed();
  resetRecordingHows();
  sent = [];
  mocks.set('wall2_keys_summary', () => summary);
  mocks.set('wall2_arrange_status', () => true);
  mocks.set('wall2_keys_library', () => LIBRARY_DATA);
  mocks.set('wall2_keys_send', (args) => (sent.push({ set: args }), null));
  mocks.set('wall2_keys_send_library', (args) => (sent.push({ library: args }), null));
});
afterEach(() => {
  resetTip();
  resetKeysFeed();
  vi.useRealTimers();
  mocks.clear();
  useSignalStore.setState({ known: false, recording: false });
});

it('shows the Recording page under Auto while a recorder runs, with the four keys, and goes back by itself', async () => {
  render(<Keys />);
  await flush();
  expect(screen.getByText('Now · Sales app')).toBeTruthy();
  record(true);
  await flush();
  expect(screen.getByText('Now · Recording')).toBeTruthy();
  expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label')).filter((l) => RECORDING_KEYS.some((r) => r.label === l))).toEqual(['Stop recording', 'Pause', 'Mark moment', 'Snip']);
  record(false);
  await flush();
  expect(screen.getByText('Now · Sales app')).toBeTruthy();
});

it('uses the deck key tile, the capture kind, and the red edge only on Stop', async () => {
  record(true);
  render(<Keys />);
  await flush();
  const tiles = [...document.querySelectorAll<HTMLElement>('.rec-keys .deck-tile.key-tile')];
  expect(tiles).toHaveLength(4);
  expect(tiles.every((t) => t.getAttribute('data-kind') === 'capture')).toBe(true);
  expect(tiles.map((t) => t.getAttribute('data-rec'))).toEqual(['stop', null, null, null]);
});

it('each key sends one fixed library id and nothing else', async () => {
  record(true);
  render(<Keys />);
  await flush();
  for (const name of ['Stop recording', 'Pause', 'Mark moment', 'Snip']) {
    fireEvent.click(screen.getByRole('button', { name }));
    await flush(2_000);
  }
  expect(sent).toEqual([{ library: { id: 'rec-stop' } }, { library: { id: 'rec-toggle' } }, { library: { id: 'rec-marker' } }, { library: { id: 'snip' } }]);
  expect(screen.getByText('Snip sent')).toBeTruthy();
});

it('says where a recorder key went, and the refusal in plain words', async () => {
  record(true);
  mocks.set('wall2_keys_send_library', () => {
    throw 'no app';
  });
  render(<Keys />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
  await flush();
  expect(screen.getByText(/not in front any more/)).toBeTruthy();
});

it('Hold on another page wins over the Recording page, and Auto brings it back', async () => {
  render(<Keys />);
  await flush();
  record(true);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await flush();
  expect(screen.queryByText('Now · Recording')).toBeNull();
  expect(screen.getByText(/^Now · /)).toBeTruthy();
  fireEvent.click(screen.getByRole('switch'));
  await flush();
  expect(screen.getByText('Now · Recording')).toBeTruthy();
});

it('stepping by hand from the Recording page goes to a page and holds it', async () => {
  record(true);
  render(<Keys />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
  await flush();
  expect(screen.queryByText('Now · Recording')).toBeNull();
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
});

it('the hover card names the shortcut from the library so it can be checked on the PC', async () => {
  record(true);
  render(
    <>
      <Keys />
      <HoverTipLayer />
    </>,
  );
  await flush();
  fireEvent.mouseEnter(screen.getByRole('button', { name: 'Stop recording' }));
  await flush(600);
  expect(document.querySelector('.hover-tip')?.textContent).toContain('It sends F10.');
  expect(document.querySelector('.hover-tip')?.textContent).toContain('check on your PC');
  expect(recordingKeyTip(RECORDING_KEYS[3], 'Win+Shift+S')).not.toContain('check on your PC');
});

it('the keys are the library ids Rust lets through, in the order drawn, and Rust names the same three', () => {
  expect(RECORDING_KEYS.map((r) => r.id)).toEqual(['rec-stop', 'rec-toggle', 'rec-marker', 'snip']);
  const rustKeys = [...rust.matchAll(/RECORDING_KEYS: \[\(&str, &str\); 3\] = \[(.*)\];/g)][0][1];
  const pairs = [...rustKeys.matchAll(/\("([a-z-]+)", "([^"]+)"\)/g)].map((m) => [m[1], m[2]]);
  expect(pairs.map((p) => p[0])).toEqual(RECORDING_KEYS.slice(0, 3).map((r) => r.id));
  for (const [id, chord] of pairs) expect(keylib).toMatch(new RegExp(`id: "${id}"[^\\n]*spec: "${chord.replace('+', '\\+')}"`));
  // The page can show only keys the library has.
  for (const r of RECORDING_KEYS) expect(LIBRARY_DATA.some((g) => g.keys.some((key) => key.id === r.id)), r.id).toBe(true);
});
