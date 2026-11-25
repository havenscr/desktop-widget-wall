// @ts-ignore node's own file call; the stylesheet rules are read as text.
import { readFileSync } from 'node:fs';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { resetNowPlaying } from '../music/store';
import { resetLastPlayed } from '../unwind/lastPlayed';
import { resetWatch, useWatchStore } from '../unwind/watch/store';
import { CTL_REST_MS } from '../unwind/watch/Watch';
import { Unwind } from './Unwind';

// Listen's inactive state: the same trigger and timing as Watch's rest (rest.ts and useControlsFade).
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetWatch();
  useWatchStore.getState().setTab('listen');
  mocks.set('get_now_playing', () => ({ title: 'Tokyo Burnout', artist: 'Tokyo Rose', playback_status: 'playing', position_seconds: 5, duration_seconds: 250 }));
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  resetNowPlaying();
  resetLastPlayed();
  localStorage.clear();
});
const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const root = () => document.querySelector('.unwind')!.getAttribute('data-listen-rest');
const css = () => (readFileSync('src/styles/unwind.css', 'utf8') as string).replace('\r\n', '\n');

it('enters the inactive state after the Watch rest time, and input wakes it', async () => {
  render(<Unwind />);
  await flush();
  expect(root()).toBeNull();
  await flush(CTL_REST_MS - 100);
  expect(root()).toBeNull();
  await flush(200);
  expect(root()).toBe('true');
  expect(document.querySelector('.sp-card')!.getAttribute('data-rest')).toBe('true');
  // Pointer into the card wakes everything, and it stays awake while the pointer is there.
  fireEvent.pointerEnter(document.querySelector('.sp-card')!);
  await flush();
  expect(root()).toBeNull();
  await flush(CTL_REST_MS + 500);
  expect(root()).toBeNull();
  fireEvent.pointerLeave(document.querySelector('.sp-card')!);
  await flush(CTL_REST_MS + 100);
  expect(root()).toBe('true');
  // A Tab press wakes it too, as on Watch.
  fireEvent.keyDown(document, { key: 'Tab' });
  await flush();
  expect(root()).toBeNull();
});

it('never rests while nothing plays', async () => {
  mocks.set('get_now_playing', () => ({ playback_status: 'stopped' }));
  render(<Unwind />);
  await flush(CTL_REST_MS * 3);
  expect(root()).toBeNull();
});

it('keeps the title, artist and cover shown (dimmed) and hides the card, gear and transport', async () => {
  const { getByText } = render(<Unwind />);
  await flush(CTL_REST_MS + 200);
  expect(root()).toBe('true');
  expect(getByText('Tokyo Burnout')).toBeTruthy();
  expect(getByText('Tokyo Rose')).toBeTruthy();
  const rules = css();
  const block = (sel: string) => {
    const at = rules.indexOf(sel + ' {');
    expect(at).toBeGreaterThan(-1);
    return rules.slice(at, rules.indexOf('}', at));
  };
  const hidden = block(`.unwind[data-listen-rest='true'] .u-listen-gear > *,\n.unwind[data-listen-rest='true'] .u-listen .u-transport,\n.unwind[data-listen-rest='true'] .u-listen .u-src`);
  expect(hidden).toContain('opacity: 0');
  expect(hidden).toContain('pointer-events: none');
  expect(block(`.unwind[data-listen-rest='true'] .u-listen :is(.u-art, .u-np, .u-artist)`)).toContain('opacity: 0.5');
  expect(block(`.sp-card[data-rest='true']`)).toContain('opacity: 0');
});

it('honours reduced motion like Watch: the transitions are switched off', () => {
  const rules = css();
  const at = rules.indexOf('@media (prefers-reduced-motion: reduce) {\n  .u-listen-gear,');
  expect(at).toBeGreaterThan(-1);
  expect(rules.slice(at, rules.indexOf('\n}', at))).toContain('transition: none');
});

it('does not run beside Watch: on Watch the Listen rest is off', async () => {
  useWatchStore.getState().setTab('watch');
  render(<Unwind />);
  await flush(CTL_REST_MS + 200);
  expect(root()).toBeNull();
});
