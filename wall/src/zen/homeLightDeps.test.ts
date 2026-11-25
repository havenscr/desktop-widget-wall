import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useHome } from '../studio/homeStore';
import { homeLightDeps } from './Sundown';

const moods = (level: number) => ({ stale: false, moods: [], off: null, nudge: { mood: 'a', level, floor: 45, step: 10 }, canWrite: true, writeBlock: null });
const FAIL = { id: 'office-nudge-down', word: 'failed' as const };

beforeEach(() => {
  vi.useFakeTimers();
  useHome.setState({ moods: moods(80), applying: null, moodFail: null });
});
afterEach(() => {
  vi.useRealTimers();
  useHome.setState({ applying: null, moodFail: null });
});

/** A fake store write: moves the level by `by` (0 refuses, as the store's own refusal leaves it). */
function fakeNudge(by: number) {
  const nudge = vi.fn(async (dir: 'up' | 'down') => {
    const lv = useHome.getState().moods!.nudge!.level;
    useHome.setState({ moods: moods(lv + (dir === 'down' ? -by : by)) });
  });
  useHome.setState({ nudgeMood: nudge });
  return nudge;
}

it('officeMoodOn needs a fresh, writable read with the nudge present', () => {
  const d = homeLightDeps();
  expect(d.officeMoodOn()).toBe(true);
  useHome.setState({ moods: { ...moods(80), stale: true } });
  expect(d.officeMoodOn()).toBe(false);
  useHome.setState({ moods: { ...moods(80), nudge: null } });
  expect(d.officeMoodOn()).toBe(false);
  useHome.setState({ moods: null });
  expect(d.officeMoodOn()).toBe(false);
});

it('a nudge that moved the level counts', async () => {
  const nudge = fakeNudge(10);
  expect(await homeLightDeps().nudge('down')).toBe(true);
  expect(nudge).toHaveBeenCalledTimes(1);
  expect(useHome.getState().moods!.nudge!.level).toBe(70);
});

it('a refusal (the level did not move) is false, with no second try', async () => {
  const nudge = fakeNudge(0);
  expect(await homeLightDeps().nudge('down')).toBe(false);
  expect(nudge).toHaveBeenCalledTimes(1);
});

it('a stale failure note from an earlier write does not make a good step down count as refused', async () => {
  useHome.setState({ moodFail: FAIL });
  fakeNudge(10);
  expect(await homeLightDeps().nudge('down')).toBe(true);
});

it('a stale failure note does not make a good step back up count as refused', async () => {
  useHome.setState({ moodFail: FAIL, moods: moods(60) });
  fakeNudge(10);
  expect(await homeLightDeps().nudge('up')).toBe(true);
  expect(useHome.getState().moods!.nudge!.level).toBe(70);
});

it('a write already in flight is waited out, then the step is sent (a mood click at the mark does not end the stepping)', async () => {
  const nudge = fakeNudge(10);
  useHome.setState({ applying: 'mood-x' });
  const p = homeLightDeps().nudge('down');
  await vi.advanceTimersByTimeAsync(500);
  expect(nudge).not.toHaveBeenCalled();
  useHome.setState({ applying: null });
  expect(await p).toBe(true);
  expect(nudge).toHaveBeenCalledTimes(1);
});

it('a nudge skipped behind a write that started in the gap is tried once more', async () => {
  let calls = 0;
  useHome.setState({
    nudgeMood: async (dir) => {
      calls += 1;
      if (calls === 1) {
        // The store skips it: another write holds the slot, then lets go.
        useHome.setState({ applying: 'mood-x' });
        setTimeout(() => useHome.setState({ applying: null }), 100);
        return;
      }
      const lv = useHome.getState().moods!.nudge!.level;
      useHome.setState({ moods: moods(lv + (dir === 'down' ? -10 : 10)) });
    },
  });
  const p = homeLightDeps().nudge('down');
  await vi.advanceTimersByTimeAsync(200);
  expect(await p).toBe(true);
  expect(calls).toBe(2);
});

it('a write that never finishes gives up after the wait and sends nothing', async () => {
  const nudge = fakeNudge(10);
  useHome.setState({ applying: 'mood-x' });
  const p = homeLightDeps().nudge('down');
  await vi.advanceTimersByTimeAsync(25_000);
  expect(await p).toBe(false);
  expect(nudge).not.toHaveBeenCalled();
});

it('no moods read at all: nothing sent', async () => {
  const nudge = fakeNudge(10);
  useHome.setState({ moods: null });
  expect(await homeLightDeps().nudge('down')).toBe(false);
  expect(nudge).not.toHaveBeenCalled();
});
