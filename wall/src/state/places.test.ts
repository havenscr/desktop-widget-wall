import { beforeEach, expect, it } from 'vitest';
import { usePlaceStore } from './places';

beforeEach(() => usePlaceStore.setState({ active: 'work' }));

it('starts on work', () => {
  expect(usePlaceStore.getInitialState().active).toBe('work');
});
it('switches place', () => {
  usePlaceStore.getState().setActive('unwind');
  expect(usePlaceStore.getState().active).toBe('unwind');
});
it('opens Zen in Dream once from openDream, remembering where it came from', () => {
  usePlaceStore.setState({ active: 'unwind', from: 'work', zenDream: false });
  usePlaceStore.getState().openDream();
  expect(usePlaceStore.getState().active).toBe('zen');
  expect(usePlaceStore.getState().from).toBe('unwind');
  expect(usePlaceStore.getState().takeZenDream()).toBe(true);
  expect(usePlaceStore.getState().takeZenDream()).toBe(false);
});
