import { afterEach, expect, it } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { recorderWord, useRecorder } from './recorderStore';

const w = (open: boolean | null, recording = false, paused = false, known = true) => recorderWord({ open, recording, paused, known });

afterEach(() => {
  mocks.clear();
  useRecorder.setState({ open: null });
});

it('says each of the four words', () => {
  expect(w(false)).toBe('Not open');
  expect(w(true)).toBe('Ready');
  expect(w(true, true)).toBe('Recording');
  expect(w(true, true, true)).toBe('Paused');
});

it('a recording the wall sees wins even when the recorder was not seen open', () => {
  expect(w(false, true)).toBe('Recording');
  expect(w(null, true, true)).toBe('Paused');
});

it('an unknown never claims Ready', () => {
  expect(w(null)).toBe('Not known');
  expect(w(true, false, false, false)).toBe('Not known');
  expect(w(null, false, false, false)).toBe('Not known');
});

it('reads open, none and unknown, and a failed read is unknown', async () => {
  for (const [state, open] of [['open', true], ['none', false], ['unknown', null]] as const) {
    mocks.set('wall2_recorder_status', () => ({ state }));
    await useRecorder.getState().read();
    expect(useRecorder.getState().open).toBe(open);
  }
  useRecorder.setState({ open: true });
  mocks.clear();
  await useRecorder.getState().read();
  expect(useRecorder.getState().open).toBeNull();
});
