import { beforeEach, expect, it } from 'vitest';
import { SILENCE_MS, hasSound, loudness, smoothStep } from './model';
import { ingestLevels, resetAudio, tickAudio, useAudioStore } from './store';

const loud = { bass: 0.8, mid: 0.4, high: 0.2, bands: [1], waveform: [0.1] };
const empty = { bass: 0, mid: 0, high: 0, bands: [], waveform: [] };

beforeEach(() => resetAudio());

it('treats an empty waveform as silence and a filled one as sound', () => {
  expect(hasSound(empty)).toBe(false);
  expect(hasSound(null)).toBe(false);
  expect(hasSound(loud)).toBe(true);
});

it('smooths toward the levels: quick up, slower down, never past the target', () => {
  ingestLevels(loud, 0);
  tickAudio(0);
  tickAudio(33);
  const first = useAudioStore.getState().bass;
  expect(first).toBeGreaterThan(0);
  expect(first).toBeLessThan(0.8);
  for (let t = 66; t < 1000; t += 33) {
    ingestLevels(loud, t);
    tickAudio(t);
  }
  expect(useAudioStore.getState().bass).toBeCloseTo(0.8, 2);
  expect(smoothStep(0, 1, 0.05)).toBeGreaterThan(1 - smoothStep(1, 0, 0.05));
});

it('is playing while sound arrived within 0.35 s and silent after', () => {
  ingestLevels(loud, 1000);
  tickAudio(1000);
  expect(useAudioStore.getState().playing).toBe(true);
  tickAudio(1000 + SILENCE_MS);
  expect(useAudioStore.getState().playing).toBe(true);
  tickAudio(1000 + SILENCE_MS + 1);
  expect(useAudioStore.getState().playing).toBe(false);
});

it('silence is decided by the clock, not by counting events', () => {
  ingestLevels(loud, 0);
  tickAudio(0);
  // A flood of empty events does not end the sound early, and none are needed to end it.
  for (let i = 0; i < 50; i++) ingestLevels(empty, 100);
  tickAudio(200);
  expect(useAudioStore.getState().playing).toBe(true);
  tickAudio(400);
  expect(useAudioStore.getState().playing).toBe(false);
});

it('levels fall to zero after silence', () => {
  for (let t = 0; t < 600; t += 33) {
    ingestLevels(loud, t);
    tickAudio(t);
  }
  expect(useAudioStore.getState().bass).toBeGreaterThan(0.7);
  for (let t = 600; t < 3000; t += 33) tickAudio(t);
  const s = useAudioStore.getState();
  expect([s.bass, s.mid, s.high]).toEqual([0, 0, 0]);
  expect(s.playing).toBe(false);
});

it('levels are exactly zero at SILENCE_MS + 1, not decaying', () => {
  for (let t = 0; t <= 600; t += 33) {
    ingestLevels(loud, t);
    tickAudio(t);
  }
  expect(useAudioStore.getState().bass).toBeGreaterThan(0.7);
  tickAudio(600 + SILENCE_MS + 1);
  expect(useAudioStore.getState()).toMatchObject({ bass: 0, mid: 0, high: 0, playing: false });
});

it('a long hidden gap leaves no stale levels when ticking resumes', () => {
  for (let t = 0; t <= 300; t += 33) {
    ingestLevels(loud, t);
    tickAudio(t);
  }
  tickAudio(60_000);
  expect(useAudioStore.getState()).toMatchObject({ bass: 0, mid: 0, high: 0, playing: false });
});

it('loudness weights bass over mid over high and stays within 0 to 1', () => {
  expect(loudness({ bass: 1, mid: 0, high: 0 })).toBeGreaterThan(loudness({ bass: 0, mid: 1, high: 0 }));
  expect(loudness({ bass: 0, mid: 1, high: 0 })).toBeGreaterThan(loudness({ bass: 0, mid: 0, high: 1 }));
  expect(loudness({ bass: 1, mid: 1, high: 1 })).toBe(1);
  expect(loudness({ bass: 0, mid: 0, high: 0 })).toBe(0);
});
