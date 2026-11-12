import { expect, it } from 'vitest';
import { createFocusDnd, DND_KEY } from './dnd';

function setup(dndState: boolean | null, opts: { failEnable?: boolean; failDisable?: boolean; brokenStorage?: boolean } = {}) {
  const calls: string[] = [];
  const store = new Map<string, string>();
  let active = 0;
  let overlap = false;
  const invoke = async (command: string) => {
    active++;
    if (active > 1) overlap = true;
    calls.push(command);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    if (command === 'get_do_not_disturb') return dndState;
    if (command === 'enable_do_not_disturb' && opts.failEnable) throw new Error('wnf');
    if (command === 'disable_do_not_disturb' && opts.failDisable) throw new Error('wnf');
    return undefined;
  };
  const storage = opts.brokenStorage
    ? {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
        removeItem: () => {
          throw new Error('denied');
        },
      }
    : {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      };
  return { dnd: createFocusDnd({ invoke, storage }), calls, store, overlapped: () => overlap };
}

it('never touches a Do Not Disturb that was already on', async () => {
  const t = setup(true);
  await t.dnd.enable();
  await t.dnd.release();
  expect(t.calls).toEqual(['get_do_not_disturb']);
  expect(t.store.has(DND_KEY)).toBe(false);
});

it('turns it on when off and off again on release', async () => {
  const t = setup(false);
  await t.dnd.enable();
  expect(t.calls).toEqual(['get_do_not_disturb', 'enable_do_not_disturb']);
  expect(t.store.get(DND_KEY)).toBe('1');
  await t.dnd.release();
  expect(t.calls.at(-1)).toBe('disable_do_not_disturb');
  expect(t.store.has(DND_KEY)).toBe(false);
});

it('enables when the state cannot be read', async () => {
  const t = setup(null);
  await t.dnd.enable();
  expect(t.calls).toContain('enable_do_not_disturb');
});

it('releases at app start when focus left it on, and only then', async () => {
  const t = setup(false);
  t.store.set(DND_KEY, '1'); // a previous run turned it on and never released
  await t.dnd.release();
  expect(t.calls).toEqual(['disable_do_not_disturb']);
  const u = setup(false);
  await u.dnd.release();
  expect(u.calls).toEqual([]);
});

it('forgets the flag when enable fails', async () => {
  const t = setup(false, { failEnable: true });
  await t.dnd.enable();
  expect(t.store.has(DND_KEY)).toBe(false);
});

it('runs calls one at a time and a quick start then reset never lands disable first', async () => {
  const t = setup(false);
  const started = t.dnd.enable();
  const released = t.dnd.release();
  await Promise.all([started, released]);
  expect(t.overlapped()).toBe(false);
  // The release came before the enable ran, so the enable backs off.
  expect(t.calls).toEqual([]);
  expect(t.store.has(DND_KEY)).toBe(false);
});

it('serialises enable then release issued back to back after the flag is set', async () => {
  const t = setup(false);
  await t.dnd.enable();
  await Promise.all([t.dnd.release(), t.dnd.enable()]);
  expect(t.overlapped()).toBe(false);
  expect(t.calls[2]).toBe('disable_do_not_disturb');
});

it('keeps the marker after a failed disable and retries on the next release', async () => {
  const t = setup(false, { failDisable: true });
  await t.dnd.enable();
  await t.dnd.release();
  expect(t.store.get(DND_KEY)).toBe('1');
  await t.dnd.release();
  expect(t.calls.filter((c) => c === 'disable_do_not_disturb')).toHaveLength(2);
});

it('still releases when storage fails, because ownership is also in memory', async () => {
  const t = setup(false, { brokenStorage: true });
  await t.dnd.enable();
  await t.dnd.release();
  expect(t.calls).toEqual(['get_do_not_disturb', 'enable_do_not_disturb', 'disable_do_not_disturb']);
});

it('a resume right after a pause ends with Do Not Disturb on', async () => {
  const t = setup(false);
  await t.dnd.enable();
  const r = t.dnd.release();
  const e = t.dnd.enable();
  await Promise.all([r, e]);
  expect(t.calls.slice(2)).toEqual(['disable_do_not_disturb', 'get_do_not_disturb', 'enable_do_not_disturb']);
  expect(t.store.get(DND_KEY)).toBe('1');
});
