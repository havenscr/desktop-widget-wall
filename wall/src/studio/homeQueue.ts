/**
 * One home write at a time from the wall, for every write that goes to the home app (presets, groups,
 * looks, Back to normal and the key lights' fallback). A write waiting for its turn is replaced by a newer
 * one with the same key, which keeps a slider drag to the newest value. The module holds no other state
 * and imports nothing, so the key light seam and the home store can share it.
 */

interface Job {
  key: string;
  run: () => Promise<void>;
  /** Called when a newer write with the same key replaced this one before it started. */
  replaced: () => void;
}

const queue: Job[] = [];
let draining = false;
let count = 0;
const listeners = new Set<(n: number) => void>();

const announce = (): void => {
  for (const l of listeners) l(count);
};

/** Tells `listener` how many writes are running or waiting, now and after each change. */
export function watchHomeWrites(listener: (n: number) => void): () => void {
  listeners.add(listener);
  listener(count);
  return () => listeners.delete(listener);
}

async function drain(): Promise<void> {
  draining = true;
  try {
    while (queue.length > 0) {
      const next = queue.shift();
      if (next) await next.run();
      count = Math.max(0, count - 1);
      announce();
    }
  } finally {
    draining = false;
  }
}

/** Runs `run` in its turn. Resolves with its result, or with `whenReplaced` when a newer write with the same key took its place. */
export function queueHomeWrite<T>(key: string, run: () => Promise<T>, whenReplaced: T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const job: Job = {
      key,
      run: async () => {
        try {
          resolve(await run());
        } catch (e) {
          reject(e);
        }
      },
      replaced: () => resolve(whenReplaced),
    };
    const waiting = queue.findIndex((q) => q.key === key);
    if (waiting >= 0) {
      // The newer write goes to the END of the queue: it was made after everything already waiting, and must not
      // run before a write that came between (a preset would otherwise override it). The count stays as it was.
      queue[waiting].replaced();
      queue.splice(waiting, 1);
      queue.push(job);
      return;
    }
    queue.push(job);
    count++;
    announce();
    if (!draining) void drain();
  });
}

/** Tests only. */
export function resetHomeQueue(): void {
  queue.length = 0;
  draining = false;
  count = 0;
  announce();
}
