import { beforeEach, expect, it } from 'vitest';
import { usePlaceStore } from './places';

beforeEach(() => usePlaceStore.setState({ active: 'work' }));

it('starts on work', () => {
  expect(usePlaceStore.getState().active).toBe('work');
});
it('switches place', () => {
  usePlaceStore.getState().setActive('unwind');
  expect(usePlaceStore.getState().active).toBe('unwind');
});
