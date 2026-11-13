import { afterEach, expect, it } from 'vitest';
import { mocks } from '../tauri';
import type { SignalPayload } from '../../signals/model';
import { registerSignalMocks } from './signals';

afterEach(() => {
  mocks.clear();
  history.replaceState({}, '', '/');
});

const read = () => mocks.get('wall2_signals')?.() as SignalPayload;

it('creates no leave signal when the knob is absent', () => {
  registerSignalMocks();
  expect(read().mockLeave).toBeUndefined();
});

it('accepts only bounded leave minutes', () => {
  history.replaceState({}, '', '/?leave=15');
  registerSignalMocks();
  expect(read().mockLeave).toBeDefined();
  history.replaceState({}, '', '/?leave=181');
  registerSignalMocks();
  expect(read().mockLeave).toBeUndefined();
});
