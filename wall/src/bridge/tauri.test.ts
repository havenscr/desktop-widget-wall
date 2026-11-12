import { afterEach, expect, it } from 'vitest';
import { invoke, isTauri, mocks } from './tauri';

afterEach(() => {
  for (const k of Object.keys(mocks)) delete mocks[k];
});

it('is not Tauri in jsdom', () => {
  expect(isTauri()).toBe(false);
});
it('resolves a known mocked command', async () => {
  mocks['ping'] = (args) => ({ pong: args?.n });
  await expect(invoke<{ pong: number }>('ping', { n: 3 })).resolves.toEqual({ pong: 3 });
});
it('rejects an unknown command', async () => {
  await expect(invoke('nope')).rejects.toThrow(/No mock registered for command "nope"/);
});
