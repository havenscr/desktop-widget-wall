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
  // Bumped by every release, so an enable still waiting on the state read
  // knows focus was paused or reset meanwhile and backs off.
  let generation = 0;

  const flag = () => {
    try {
      return storage.getItem(DND_KEY);
    } catch {
      return null;
    }
  };
  const setFlag = () => {
    try {
      storage.setItem(DND_KEY, '1');
    } catch {
      /* no storage: cannot remember, still works for this run */
    }
  };
  const clearFlag = () => {
    try {
      storage.removeItem(DND_KEY);
    } catch {
      /* ignore */
    }
  };

  function call(command: string): Promise<{ ok: boolean; value: unknown }> {
    const run = () =>
      Promise.resolve()
        .then(() => invoke(command))
        .then((value) => ({ ok: true, value }))
        .catch(() => ({ ok: false, value: null as unknown }));
    const next = queue.then(run, run);
    queue = next;
    return next;
  }

  async function enable() {
    if (flag()) return;
    const gen = generation;
    const read = await call('get_do_not_disturb');
    const alreadyOn = read.ok && typeof read.value === 'boolean' ? read.value : null;
    if (gen !== generation) return;
    if (flag()) return;
    if (alreadyOn === true) return; // the user's own: not ours to undo
    // Set the flag before the enable so a pause during it still releases.
    setFlag();
    const { ok } = await call('enable_do_not_disturb');
    if (!ok) clearFlag();
  }

  async function release() {
    generation++;
    if (!flag()) return;
    // Clear the flag first so a failing call cannot trap us in a retry loop.
    clearFlag();
    await call('disable_do_not_disturb');
  }

  return { enable, release };
}
