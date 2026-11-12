import { afterEach, expect, it } from 'vitest';
import { invoke, isTauri, mocks } from './tauri';

afterEach(() => {
  mocks.clear();
});

it('is not Tauri in jsdom', () => {
  expect(isTauri()).toBe(false);
});
it('resolves a known mocked command', async () => {
  mocks.set('ping', (args) => ({ pong: args?.n }));
  await expect(invoke<{ pong: number }>('ping', { n: 3 })).resolves.toEqual({ pong: 3 });
});
it('rejects an unknown command', async () => {
  await expect(invoke('nope')).rejects.toThrow(/No mock registered for command "nope"/);
});
it('rejects names inherited from Object.prototype', async () => {
  for (const name of ['constructor', 'toString', '__proto__']) {
    await expect(invoke(name)).rejects.toThrow(/No mock registered for command/);
  }
});
