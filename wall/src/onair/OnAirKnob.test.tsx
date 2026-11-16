import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

/** The new frame is reached only by `?onair=v2` in a development build. Each case loads On Air fresh, because the knob is read once when the module loads. */
async function load(search: string, dev = true) {
  vi.resetModules();
  vi.stubEnv('DEV', dev);
  window.history.replaceState(null, '', `/${search}`);
  const { mocks } = await import('../bridge/tauri');
  mocks.set('wall2_onair_show', () => ({ state: 'missing', title: null, parts: [], skipped: 0, reason: null, readAt: 1 }));
  mocks.set('wall2_onair_marks_today', () => ({ today: 0, last: [] }));
  mocks.set('wall2_keys_library', () => []);
  mocks.set('wall2_signals_report', () => null);
  const { OnAir } = await import('./OnAir');
  return render(<OnAir />);
}

const today = (c: HTMLElement) => {
  expect(c.querySelector('section.onair')).not.toBeNull();
  expect(c.querySelector('section.onair > .oa-left')).not.toBeNull();
  expect(c.querySelector('section.onair > .oa-card')).not.toBeNull();
  expect(c.querySelector('section.onair > .oa-right')).not.toBeNull();
  expect(c.querySelector('.oa2')).toBeNull();
};

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  window.history.replaceState(null, '', '/');
});

it('with no knob, On Air is today\'s page and there is no new frame', async () => {
  const { container } = await load('');
  today(container);
});

it('a knob that is not exactly v2 is today\'s page too', async () => {
  for (const search of ['?onair=v1', '?onair=V2', '?onair=', '?onair=v2x', '?on_air=v2']) {
    const { container, unmount } = await load(search);
    today(container);
    unmount();
  }
});

it('?onair=v2 in a development build is the new frame, and not today\'s', async () => {
  const { container } = await load('?onair=v2');
  await waitFor(() => expect(container.querySelector('section.oa2[data-place="onair"]')).not.toBeNull());
  expect(container.querySelector('.onair')).toBeNull();
});

it('?onair=v2 in a production build (DEV false) is today\'s page', async () => {
  const { container } = await load('?onair=v2', false);
  today(container);
});
