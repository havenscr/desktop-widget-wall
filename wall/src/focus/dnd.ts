/**
 * Focus Do Not Disturb, ported from the old app (countdown.js "focus-dnd").
 *
 * Rule: at start read the state; if Do Not Disturb is already on, leave it
 * alone and remember nothing. Otherwise turn it on and remember that focus did
 * it. On pause, reset, finish and app start, turn it off only if focus turned
 * it on. Every call runs one at a time through a queue, so a quick start then
 * pause can never land the disable before the enable.
 */
export const DND_KEY = 'wall2-focus-dnd';

export interface DndDeps {
  invoke: (command: string) => Promise<unknown>;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

export interface FocusDnd {
  /** Call when focus starts or resumes. */
  enable: () => Promise<void>;
  /** Call on pause, reset, finish and app start. */
  release: () => Promise<void>;
}

export function createFocusDnd({ invoke, storage }: DndDeps): FocusDnd {
  let queue: Promise<unknown> = Promise.resolve();
  // Bumped synchronously by every release, so an enable that is still queued or
  // waiting on the state read knows focus was paused or reset meanwhile.
  let generation = 0;
  // Ownership is kept in memory as well as storage, so a storage failure never
  // leaves an enabled Do Not Disturb with no record of who turned it on.
  let owned = false;

  const flag = () => {
    if (owned) return true;
    try {
      return storage.getItem(DND_KEY) !== null;
    } catch {
      return false;
    }
  };
  const setFlag = () => {
    owned = true;
    try {
      storage.setItem(DND_KEY, '1');
    } catch {
      /* the in-memory marker still covers this run */
    }
  };
  const clearFlag = () => {
    owned = false;
    try {
      storage.removeItem(DND_KEY);
    } catch {
      /* ignore */
    }
  };

  async function call(command: string): Promise<{ ok: boolean; value: unknown }> {
    try {
      return { ok: true, value: await invoke(command) };
    } catch {
      return { ok: false, value: null };
    }
  }

  /** Whole operations run one at a time, so a release never lands inside an enable. */
  function op(fn: () => Promise<void>): Promise<void> {
    const next = queue.then(fn, fn);
    queue = next;
    return next;
  }

  function enable() {
    const gen = generation;
    return op(async () => {
      if (gen !== generation) return;
      if (flag()) return;
      const read = await call('get_do_not_disturb');
      const alreadyOn = read.ok && typeof read.value === 'boolean' ? read.value : null;
      if (gen !== generation) return;
      if (alreadyOn === true) return; // the user's own: not ours to undo
      // Set the marker before the enable so a pause during it still releases.
      setFlag();
      const { ok } = await call('enable_do_not_disturb');
      if (!ok) clearFlag();
    });
  }

  function release() {
    generation++;
    return op(async () => {
      if (!flag()) return;
      const { ok } = await call('disable_do_not_disturb');
      // Keep the marker after a failed disable so the next release or app start tries again.
      if (ok) clearFlag();
    });
  }

  return { enable, release };
}
