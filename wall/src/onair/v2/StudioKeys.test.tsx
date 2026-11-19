import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LIBRARY_DATA } from '../../bridge/devMocks/libraryData';
import { mocks } from '../../bridge/tauri';
import { resetTip } from '../../ui/HoverTip';
import { resetLibIndex } from '../../work/keyLibrary';
import { useYtLive } from '../ytliveStore';
import { StudioKeys } from './StudioKeys';
import { StudioStatus } from './StudioStatus';
import { STUDIO_CONFIRM_MS } from './studioModel';
import { useStudio } from './studioStore';

const NOW = 1_700_000_000_000;
let sends: { key: string; confirm: boolean }[];
let keysSet: string[];
let state: string;
let refuse: string | null;

const both = () => (
  <>
    <StudioKeys now={NOW} />
    <StudioStatus now={NOW} />
  </>
);
const open = async () => {
  render(both());
  await act(async () => {
    await useStudio.getState().read();
  });
};

beforeEach(() => {
  sends = [];
  keysSet = ['solo', 'two', 'share', 'golive', 'end'];
  state = 'picked';
  refuse = null;
  useStudio.getState().reset();
  useYtLive.getState().reset();
  resetLibIndex();
  mocks.set('wall2_keys_library', () => LIBRARY_DATA);
  mocks.set('wall2_studio_pick_start', () => ({ state: 'waiting' }));
  mocks.set('wall2_studio_pick_status', () => ({ state, browser: state === 'none' ? null : 'firefox', keys: keysSet }));
  mocks.set('wall2_studio_key', (args) => {
    sends.push({ key: String(args?.key), confirm: args?.confirm === true });
    if (refuse) throw refuse;
    return { sent: args?.key, at: NOW - 120_000 };
  });
  mocks.set('wall2_open_keys_file', () => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  resetTip();
  mocks.clear();
});

it('draws the four keys dashed and dim with no chords, and one button in the heading: Pick window, then Open keys file', async () => {
  keysSet = [];
  state = 'none';
  await open();
  const tiles = [...document.querySelectorAll('.oa2-skrow1 .key-tile')];
  expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual(['Solo', 'Two up', 'Share', 'Go live']);
  expect(tiles.every((t) => t.classList.contains('off') && t.getAttribute('aria-disabled') === 'true')).toBe(true);
  const head = document.querySelector('.oa2-studiokeys .oa2-hd') as HTMLElement;
  expect(head.querySelectorAll('button').length).toBe(1);
  expect(head.textContent).toContain('Pick window');
  state = 'picked';
  await act(async () => {
    await useStudio.getState().read();
  });
  expect(head.textContent).toContain('Open keys file');
  expect(sends.length).toBe(0);
});

it('Go live needs a second click within 3 seconds and sends confirm only then', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await open();
  const go = () => screen.getByRole('button', { name: /^Go live/ });
  fireEvent.click(go(), { detail: 1 });
  expect(sends.length).toBe(0);
  expect(screen.getByRole('button', { name: 'Go live? Click again' })).toBeTruthy();
  // Too late: the arm runs out and the next click only arms again.
  act(() => void vi.advanceTimersByTime(STUDIO_CONFIRM_MS + 50));
  expect(screen.queryByRole('button', { name: 'Go live? Click again' })).toBeNull();
  fireEvent.click(go(), { detail: 1 });
  expect(sends.length).toBe(0);
  fireEvent.click(go(), { detail: 1 });
  await waitFor(() => expect(sends).toEqual([{ key: 'golive', confirm: true }]));
});

it('the half of a double click never confirms', async () => {
  await open();
  const go = screen.getByRole('button', { name: /^Go live/ });
  fireEvent.click(go, { detail: 1 });
  fireEvent.click(go, { detail: 2 });
  expect(sends.length).toBe(0);
});

it('Solo sends at once, without confirm, and the Sent line says what the wall sent', async () => {
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Two up' }), { detail: 1 });
  await waitFor(() => expect(sends).toEqual([{ key: 'two', confirm: false }]));
  await waitFor(() => expect(screen.getAllByText(/Sent: Two up, 2 min ago/).length).toBe(1));
  expect(screen.getByText('Last key sent: Two up, 2 min ago')).toBeTruthy();
  expect(screen.getByText('The wall cannot see which layout is live. It shows what it sent.')).toBeTruthy();
  expect(document.querySelector('.oa2-skrow1 [aria-pressed="true"]')).toBeNull();
});

it('says each refusal in words and leaves the Sent line alone', async () => {
  await open();
  const cases: [string, RegExp][] = [
    ['no studio window', /Pick the StreamYard window first/],
    ['gone', /The studio window is gone/],
    ['not forward', /would not come forward/],
    ['busy', /still sending/],
    ['not set up', /No chord for that key/],
  ];
  for (const [word, text] of cases) {
    refuse = word;
    fireEvent.click(screen.getByRole('button', { name: 'Share' }), { detail: 1 });
    await waitFor(() => expect(screen.getAllByText(text).length).toBeGreaterThan(0));
    await act(async () => void (await new Promise((r) => setTimeout(r, 600))));
  }
  expect(useStudio.getState().sent).toBeNull();
  expect(screen.getByText('No key sent yet', { selector: '.oa2-hd-r' })).toBeTruthy();
});

it('the status block warns in amber when the window is minimized', async () => {
  state = 'minimized';
  await open();
  const line = screen.getByText('Studio window: minimized');
  expect(line.getAttribute('data-warn')).toBe('true');
});
