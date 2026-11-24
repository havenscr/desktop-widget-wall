import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Sundown } from './Sundown';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(lights: boolean, done = false) {
  const sent: string[] = [];
  const deps = {
    officeMoodOn: () => true,
    nudge: async (d: 'up' | 'down') => {
      sent.push(d);
      return true;
    },
  };
  const t0 = Date.now();
  const ui = (
    <Sundown startedAt={t0} minutes={10} left="10:00 left." lights={lights} now={Date.now} doneRef={{ current: done }} deps={deps} />
  );
  return { sent, ui };
}
const run = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

it('with the setting off it never talks to the lights', async () => {
  const { sent, ui } = setup(false);
  const r = render(ui);
  await run(10 * 60_000 + 1000);
  r.unmount();
  await run(1000);
  expect(sent).toEqual([]);
});

it('three steps down over a full session, and they stay down after it ends', async () => {
  const { sent, ui } = setup(true, true);
  const r = render(ui);
  await run(10 * 60_000 + 1000);
  r.unmount();
  await run(1000);
  expect(sent).toEqual(['down', 'down', 'down']);
});

it('leaving after two steps steps back up twice', async () => {
  const { sent, ui } = setup(true);
  const r = render(ui);
  await run(5.5 * 60_000);
  expect(sent).toEqual(['down', 'down']);
  r.unmount();
  await run(1000);
  expect(sent).toEqual(['down', 'down', 'up', 'up']);
});

it('the caption names the session and the time left', () => {
  const { ui } = setup(false);
  const r = render(ui);
  expect(r.container.textContent).toContain('TEN MINUTES OF SUNDOWN');
  expect(r.container.textContent).toContain('10:00 left.');
});

it('leaving in the closing moment, before Dream opened, still steps back up', async () => {
  const { sent, ui } = setup(true, false);
  const r = render(ui);
  await run(10 * 60_000 + 1000);
  expect(sent).toEqual(['down', 'down', 'down']);
  r.unmount();
  await run(1000);
  expect(sent).toEqual(['down', 'down', 'down', 'up', 'up', 'up']);
});
