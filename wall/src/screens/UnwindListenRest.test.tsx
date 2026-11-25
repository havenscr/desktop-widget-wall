// @ts-ignore node's own file call; the stylesheet rules are read as text.
import { readFileSync } from 'node:fs';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { resetNowPlaying } from '../music/store';
import { useToolsStore } from '../tools/store';
import { resetHome } from '../studio/homeStore';
import { resetLastPlayed } from '../unwind/lastPlayed';
import { CTL_REST_MS } from '../unwind/watch/rest';
import { useWatchRest } from '../unwind/watch/rest';
import { resetWatch, useWatchStore } from '../unwind/watch/store';
import { Unwind } from './Unwind';

// Listen's inactive state: the same trigger and timing as Watch's rest (rest.ts and useControlsFade).
const PLAYING = { title: 'Tokyo Burnout', artist: 'Tokyo Rose', playback_status: 'playing', position_seconds: 5, duration_seconds: 250 };
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetWatch();
  resetHome();
  useWatchStore.getState().setTab('listen');
  mocks.set('get_now_playing', () => PLAYING);
  mocks.set('wall2_office_moods', () => ({
    stale: false,
    moods: [{ id: 'brightDesk', label: 'Bright desk', line: 'Room 70%', active: false }],
    off: null,
    canWrite: false,
    writeBlock: 'not-set-up',
  }));
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  resetNowPlaying();
  resetLastPlayed();
  useToolsStore.setState({ open: false });
  document.querySelectorAll('.u-lib-menu').forEach((n) => n.remove());
  localStorage.clear();
});
const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const root = () => document.querySelector('.unwind')!.getAttribute('data-listen-rest');
const card = () => document.querySelector<HTMLElement>('.sp-card')!;
const line = () => document.querySelector<HTMLElement>('.u-office-line');
const css = () => (readFileSync('src/styles/unwind.css', 'utf8') as string).replace(/\r\n/g, '\n');
const toRest = async () => {
  await flush(CTL_REST_MS + 200);
  expect(root()).toBe('true');
};
const stays = async () => {
  await flush(CTL_REST_MS * 2);
  expect(root()).toBeNull();
};

it('enters the inactive state after the Watch rest time, and input wakes it', async () => {
  render(<Unwind />);
  await flush();
  expect(root()).toBeNull();
  expect(card().getAttribute('data-rest')).toBe('false');
  await flush(CTL_REST_MS - 100);
  expect(root()).toBeNull();
  await flush(200);
  expect(root()).toBe('true');
  expect(card().getAttribute('data-rest')).toBe('true');
  fireEvent.pointerEnter(card());
  await flush();
  expect(root()).toBeNull();
  expect(card().getAttribute('data-rest')).toBe('false');
  await flush(CTL_REST_MS + 500);
  expect(root()).toBeNull();
  fireEvent.pointerLeave(card());
  await flush(CTL_REST_MS + 1500); // the card closes first, then the rest time runs
  expect(root()).toBe('true');
  fireEvent.keyDown(document, { key: 'Tab' });
  await flush();
  expect(root()).toBeNull();
});

it('the gear zone wakes it and holds it while the pointer is there', async () => {
  render(<Unwind />);
  await toRest();
  const gear = document.querySelector<HTMLElement>('.u-listen-gear')!;
  fireEvent.pointerEnter(gear);
  await flush();
  expect(root()).toBeNull();
  await flush(CTL_REST_MS * 2);
  expect(root()).toBeNull();
  fireEvent.pointerLeave(gear);
  await toRest();
});

it('the Office moods row and line rest and wake with Listen', async () => {
  render(<Unwind />);
  await flush();
  await flush();
  expect(line()).not.toBeNull();
  expect(line()!.getAttribute('data-rest')).toBe('false');
  await toRest();
  expect(line()!.getAttribute('data-rest')).toBe('true');
  fireEvent.pointerEnter(document.querySelector('.u-office-slot')!);
  await flush();
  expect(line()!.getAttribute('data-rest')).toBe('false');
});

it('never rests while nothing plays or while paused', async () => {
  mocks.set('get_now_playing', () => ({ playback_status: 'stopped' }));
  render(<Unwind />);
  await stays();
  resetNowPlaying();
  mocks.set('get_now_playing', () => ({ ...PLAYING, playback_status: 'paused' }));
  await flush(3000);
  await stays();
});

it('a Watch video playing out of sight does not rest Listen', async () => {
  mocks.set('get_now_playing', () => ({ ...PLAYING, source_app: 'Msedgewebview2', source_app_id: 'msedgewebview2.exe' }));
  useWatchStore.setState({ playing: { kind: 'video', id: 'Ab3dEfGh1jK', label: 'Night drive mix' }, source: 'watch' });
  render(<Unwind />);
  await stays();
});

it.each([
  ['the sheet is open', () => useWatchStore.getState().setSheet(true, 'lines')],
  ['the Tools drawer is open', () => useToolsStore.setState({ open: true })],
  ['a library menu is open', () => document.body.appendChild(Object.assign(document.createElement('div'), { className: 'u-lib-menu' }))],
  ['the card reports it is held', () => useWatchRest.setState({ cardHeld: true })],
  [
    'a text field in the card has focus',
    () => {
      const field = Object.assign(document.createElement('input'), { type: 'text' });
      card().appendChild(field);
      field.focus();
    },
  ],
])('does not rest while %s', async (_name, open) => {
  render(<Unwind />);
  await flush();
  act(() => {
    open();
  });
  await flush();
  await stays();
  expect(card().getAttribute('data-rest')).toBe('false');
});

it('an opened (tall) card holds the controls shown, and says so', async () => {
  render(<Unwind />);
  await flush();
  act(() => {
    fireEvent.click(document.querySelector('.sp-top')!);
  });
  await flush();
  expect(card().getAttribute('data-tall')).toBe('true');
  expect(useWatchRest.getState().cardHeld).toBe(true);
  expect(root()).toBeNull();
  expect(card().getAttribute('data-rest')).toBe('false');
});

it('the rest comes back after the open thing closes', async () => {
  render(<Unwind />);
  await flush();
  act(() => useWatchStore.getState().setSheet(true, 'lines'));
  await flush(CTL_REST_MS * 2);
  expect(root()).toBeNull();
  act(() => useWatchStore.getState().setSheet(false));
  await flush(CTL_REST_MS * 2 + 500); // the close is noticed on the next render, then the rest time runs
  expect(root()).toBe('true');
});

it('a tab switch never leaks the rest or mounts rested', async () => {
  render(<Unwind />);
  await toRest();
  expect(useWatchRest.getState().rest).toBe(true);
  act(() => useWatchStore.getState().setTab('watch'));
  expect(useWatchRest.getState().rest).toBe(false);
  expect(root()).toBeNull();
  expect(line()?.getAttribute('data-rest') ?? 'false').toBe('false');
  act(() => useWatchStore.getState().setTab('listen'));
  expect(useWatchRest.getState().rest).toBe(false);
  expect(card().getAttribute('data-rest')).toBe('false');
  await flush(CTL_REST_MS + 200);
  expect(root()).toBe('true');
});

it('on Watch the Listen rest is off', async () => {
  useWatchStore.getState().setTab('watch');
  render(<Unwind />);
  await flush(CTL_REST_MS + 200);
  expect(root()).toBeNull();
  expect(document.querySelector('.sp-card')).toBeNull();
});

it('rests the real elements: the CSS rules match classes the page renders, and hide what should hide', async () => {
  const { container } = render(<Unwind />);
  await toRest();
  // Real elements the rest rules name exist in the rendered Listen page.
  for (const sel of ['.u-listen-gear > *', '.u-listen .u-transport', '.u-listen .u-art', '.u-listen .u-np', '.u-listen .u-artist', '.sp-card']) {
    expect(container.querySelector(sel), sel).not.toBeNull();
  }
  const style = document.createElement('style');
  style.textContent = css();
  document.head.appendChild(style);
  const op = (sel: string) => getComputedStyle(container.querySelector(sel)!).opacity;
  expect(op('.sp-card')).toBe('0');
  expect(op('.u-listen .u-transport')).toBe('0');
  expect(op('.u-listen-gear > *')).toBe('0');
  expect(op('.u-listen .u-np')).toBe('0.5');
  expect(op('.u-listen .u-artist')).toBe('0.5');
  expect(op('.u-listen .u-art')).toBe('0.5');
  fireEvent.pointerEnter(card());
  await flush();
  expect(op('.sp-card')).not.toBe('0');
  expect(op('.u-listen .u-transport')).not.toBe('0');
  style.remove();
});

it('reduced motion stops the fades but keeps the card size animation', () => {
  const rules = css();
  const at = rules.indexOf('@media (prefers-reduced-motion: reduce) {\n  .u-listen-gear,');
  expect(at).toBeGreaterThan(-1);
  expect(rules.slice(at, rules.indexOf('\n}', at))).toContain('transition: none');
  const card = rules.indexOf('@media (prefers-reduced-motion: reduce) {\n  /* Only the fade stops');
  expect(card).toBeGreaterThan(-1);
  const block = rules.slice(card, rules.indexOf('\n}\n', card + 60));
  expect(block).toContain('left 400ms ease-out, width 400ms ease-out, height 400ms ease-out');
  expect(block).not.toContain('opacity');
});
