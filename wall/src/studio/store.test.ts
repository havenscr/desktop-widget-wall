import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { chooseBackend, directBackend, type KeyLightBackend, type Pair, type Patch, type Target } from './keyLights';
import { useKeyLightPolling } from './useKeyLightPolling';
import { NOTE_MS, QUIET_READ_MS, resetKeyLights, setBackend, useKeyLights } from './store';

const flush = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
};
const L = (on: boolean, brightness: number, kelvin: number) => ({ on, brightness, kelvin });

/** A fake back end: the lights report what was last written unless a side is told to ignore writes. */
function world(start: Pair = { left: L(true, 60, 4400), right: L(true, 60, 4400) }) {
  const lights = { left: start.left as ReturnType<typeof L> | string, right: start.right as ReturnType<typeof L> | string };
  const calls: { target: Target; patch: Patch }[] = [];
  const stuck = new Set<string>();
  const failing = new Set<string>();
  let gate: Promise<void> | null = null;
  const backend: KeyLightBackend = {
    read: async () => ({ left: lights.left as never, right: lights.right as never }),
    set: async (target, patch) => {
      calls.push({ target, patch });
      if (gate) await gate;
      const sides = target === 'both' ? (['left', 'right'] as const) : ([target] as const);
      const out: Pair = { left: null, right: null };
      for (const side of sides) {
        const cur = lights[side];
        if (typeof cur === 'string' || failing.has(side)) {
          out[side] = (typeof cur === 'string' ? cur : 'failed') as never;
          continue;
        }
        if (!stuck.has(side)) {
          if (patch.on !== undefined) cur.on = patch.on;
          if (patch.brightness !== undefined) cur.brightness = patch.brightness;
          if (patch.kelvin !== undefined) cur.kelvin = patch.kelvin;
        }
        out[side] = { ...cur };
      }
      return out;
    },
  };
  return {
    backend,
    lights,
    calls,
    stuck,
    failing,
    hold: () => {
      let open!: () => void;
      gate = new Promise<void>((r) => (open = r));
      return () => {
        gate = null;
        open();
      };
    },
  };
}

const setUp = async (w: ReturnType<typeof world>, status = { left: true, right: true }) => {
  mocks.set('wall2_keylights_status', () => ({ left: { set: status.left }, right: { set: status.right } }));
  setBackend(w.backend);
  await useKeyLights.getState().refresh();
};

beforeEach(() => {
  vi.useFakeTimers();
  resetKeyLights();
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
});

describe('the seam', () => {
  it('has the direct back end, which speaks the native commands by side word and never an address', async () => {
    expect(chooseBackend()).toBe(directBackend);
    const seen: unknown[] = [];
    mocks.set('wall2_keylights_read', () => ({ left: { on: true, brightness: 60, kelvin: 4400 }, right: 'no-answer' }));
    mocks.set('wall2_keylights_set', (args) => {
      seen.push(args);
      return { left: { on: true, brightness: 61, kelvin: 4400 }, right: null };
    });
    expect(await directBackend.read()).toEqual({ left: L(true, 60, 4400), right: 'no-answer' });
    expect(await directBackend.set('left', { on: true, brightness: 60.6, kelvin: 4400.2 })).toEqual({ left: L(true, 61, 4400), right: null });
    expect(seen).toEqual([{ side: 'left', on: true, brightness: 61, kelvin: 4400 }]);
    await directBackend.set('both', { kelvin: 5000 });
    expect(seen[1]).toEqual({ side: 'both', kelvin: 5000 });
  });
});

describe('reading', () => {
  it('reads the saved sides, then both lights', async () => {
    const w = world();
    await setUp(w);
    const s = useKeyLights.getState();
    expect(s.status).toEqual({ left: true, right: true, unreadable: false });
    expect(s.left).toEqual(L(true, 60, 4400));
    expect(s.right).toEqual(L(true, 60, 4400));
  });

  it('asks for no lights when none is saved', async () => {
    const w = world();
    const read = vi.spyOn(w.backend, 'read');
    await setUp(w, { left: false, right: false });
    expect(read).not.toHaveBeenCalled();
    expect(useKeyLights.getState().left).toBeNull();
  });

  it('a status that cannot be read is failed, with no lights asked', async () => {
    mocks.set('wall2_keylights_status', () => {
      throw 'failed';
    });
    await useKeyLights.getState().refresh();
    expect(useKeyLights.getState().status).toBe('failed');
  });

  it('a command that rejects with a word puts that word on every saved side', async () => {
    mocks.set('wall2_keylights_status', () => ({ left: { set: true }, right: { set: false } }));
    setBackend({
      read: async () => {
        throw 'timeout';
      },
      set: async () => ({ left: null, right: null }),
    });
    await useKeyLights.getState().refresh();
    expect(useKeyLights.getState().left).toBe('timeout');
    expect(useKeyLights.getState().right).toBeNull();
  });

  it('an older read never replaces a newer one', async () => {
    const w = world();
    await setUp(w);
    let release!: (p: Pair) => void;
    let first = true;
    setBackend({
      read: () => {
        if (first) {
          first = false;
          return new Promise<Pair>((r) => (release = r));
        }
        return Promise.resolve({ left: L(true, 10, 3000), right: L(true, 10, 3000) });
      },
      set: w.backend.set,
    });
    const slow = useKeyLights.getState().read();
    await useKeyLights.getState().read();
    release({ left: L(true, 99, 6500), right: L(true, 99, 6500) });
    await slow;
    expect(useKeyLights.getState().left).toEqual(L(true, 10, 3000));
  });
});

describe('writing', () => {
  it('shows what the light reports after the write, not what was asked', async () => {
    const w = world();
    await setUp(w);
    w.stuck.add('left');
    await useKeyLights.getState().set('left', { brightness: 80 });
    expect(useKeyLights.getState().left).toEqual(L(true, 60, 4400));
    await useKeyLights.getState().set('right', { brightness: 80 });
    expect(useKeyLights.getState().right).toEqual(L(true, 80, 4400));
  });

  it('counts a finished run, so a slider can let go of the value it held', async () => {
    const w = world();
    await setUp(w);
    const before = useKeyLights.getState().settled;
    await useKeyLights.getState().set('both', { on: false });
    expect(useKeyLights.getState().settled).toBe(before + 1);
    expect(useKeyLights.getState().busy).toBe(0);
    expect(useKeyLights.getState().left).toEqual(L(false, 60, 4400));
  });

  it('sends at most one write at a time per target and the latest values after it', async () => {
    const w = world();
    await setUp(w);
    const release = w.hold();
    const first = useKeyLights.getState().set('both', { brightness: 10 });
    for (let b = 11; b <= 30; b++) void useKeyLights.getState().set('both', { brightness: b });
    void useKeyLights.getState().set('both', { kelvin: 5000 });
    await flush();
    expect(w.calls).toHaveLength(1);
    release();
    await first;
    await flush();
    expect(w.calls).toHaveLength(2);
    expect(w.calls[1].patch).toEqual({ brightness: 30, kelvin: 5000 });
    expect(useKeyLights.getState().left).toEqual(L(true, 30, 5000));
  });

  it('a write a light did not take springs back to what it reports, with one amber line for five seconds', async () => {
    const w = world();
    await setUp(w);
    w.failing.add('left');
    await useKeyLights.getState().set('left', { brightness: 90 });
    const s = useKeyLights.getState();
    expect(s.left).toEqual(L(true, 60, 4400));
    expect(s.note).toBe('The left key light did not take that change');
    await flush(NOTE_MS - 1);
    expect(useKeyLights.getState().note).not.toBeNull();
    await flush(2);
    expect(useKeyLights.getState().note).toBeNull();
  });

  it('both lights refusing says so once', async () => {
    const w = world();
    await setUp(w);
    w.failing.add('left');
    w.failing.add('right');
    await useKeyLights.getState().set('both', { brightness: 90 });
    expect(useKeyLights.getState().note).toBe('The key lights did not take that change');
  });

  it('a light that stops answering turns into its word and says nothing amber', async () => {
    const w = world();
    await setUp(w);
    w.lights.right = 'no-answer';
    await useKeyLights.getState().set('right', { on: false });
    expect(useKeyLights.getState().right).toBe('no-answer');
    expect(useKeyLights.getState().note).toBeNull();
  });

  it('a rejected write is a failed write', async () => {
    const w = world();
    await setUp(w);
    setBackend({
      read: w.backend.read,
      set: async () => {
        throw 'refused';
      },
    });
    await useKeyLights.getState().set('left', { on: false });
    expect(useKeyLights.getState().note).toBe('The left key light did not take that change');
  });
});

describe('Linked and the drawer', () => {
  it('starts linked, and the choice is kept', () => {
    expect(useKeyLights.getState().linked).toBe(true);
    useKeyLights.getState().setLinked(false);
    expect(useKeyLights.getState().linked).toBe(false);
    useKeyLights.getState().setDrawer(true);
    expect(useKeyLights.getState().drawer).toBe(true);
  });
});

/** A promise to answer by hand. */
const later = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

describe('which answer lands', () => {
  it('a slow poll that began before a write never puts the old numbers back over its read back', async () => {
    const w = world();
    await setUp(w);
    const poll = later<Pair>();
    let reads = 0;
    setBackend({
      read: () => (reads++ === 0 ? poll.promise : w.backend.read()),
      set: w.backend.set,
    });
    const slow = useKeyLights.getState().read();
    await useKeyLights.getState().set('both', { brightness: 80 });
    expect(useKeyLights.getState().left).toEqual(L(true, 80, 4400));
    // The poll answers last, with what the lights said before the write.
    poll.resolve({ left: L(true, 60, 4400), right: L(true, 60, 4400) });
    await slow;
    expect(useKeyLights.getState().left).toEqual(L(true, 80, 4400));
    expect(useKeyLights.getState().right).toEqual(L(true, 80, 4400));
  });

  it('a read that began while a write was out cannot hide the write own answer, which comes after it', async () => {
    const w = world();
    await setUp(w);
    const answer = later<Pair>();
    setBackend({ read: w.backend.read, set: () => answer.promise });
    const writing = useKeyLights.getState().set('left', { brightness: 80 });
    await flush();
    await useKeyLights.getState().read();
    answer.resolve({ left: L(true, 80, 4400), right: null });
    await writing;
    expect(useKeyLights.getState().left).toEqual(L(true, 80, 4400));
  });

  it.each([
    ['the left answer first', true],
    ['the both answer first', false],
  ])('a both write and a left write that overlap: the older answer never lands after the newer one (%s)', async (_name, leftFirst) => {
    const w = world();
    await setUp(w);
    const both = later<Pair>();
    const only = later<Pair>();
    setBackend({ read: w.backend.read, set: (target) => (target === 'both' ? both.promise : only.promise) });
    const a = useKeyLights.getState().set('both', { brightness: 10 });
    const b = useKeyLights.getState().set('left', { brightness: 20 });
    await flush();
    const answerBoth = () => both.resolve({ left: L(true, 10, 4400), right: L(true, 10, 4400) });
    const answerLeft = () => only.resolve({ left: L(true, 20, 4400), right: null });
    if (leftFirst) {
      answerLeft();
      await flush();
      answerBoth();
    } else {
      answerBoth();
      await flush();
      answerLeft();
    }
    await Promise.all([a, b]);
    // The left write began after the both write: left shows 20 whatever the order; right was only in the both write.
    expect(useKeyLights.getState().left).toEqual(L(true, 20, 4400));
    expect(useKeyLights.getState().right).toEqual(L(true, 10, 4400));
  });

  it('a quiet "both" answer that overtook a left write is followed by one read about a second later', async () => {
    const w = world();
    await setUp(w);
    // A screen that shows the lights is polling them: the follow-up read is armed only then.
    renderHook(() => useKeyLightPolling());
    await flush();
    const both = later<Pair>();
    const only = later<Pair>();
    let reads = 0;
    const truth: Pair = { left: L(true, 20, 4400), right: L(true, 10, 4400) };
    setBackend({
      read: async () => (reads++, truth),
      set: (target) => (target === 'both' ? both.promise : only.promise),
    });
    const a = useKeyLights.getState().set('left', { brightness: 20 });
    const b = useKeyLights.getState().set('both', { brightness: 10 });
    await flush();
    // The older left write answers after the newer both write began: its answer is not shown.
    only.resolve({ left: L(true, 20, 4400), right: null });
    await flush();
    expect(useKeyLights.getState().left).toEqual(L(true, 60, 4400));
    // The both write answers "not now" for the left light and with a reading for the right one.
    both.resolve({ left: 'slow-down', right: L(true, 10, 4400) });
    await Promise.all([a, b]);
    expect(useKeyLights.getState().left).toEqual(L(true, 60, 4400));
    expect(reads).toBe(0);
    await flush(QUIET_READ_MS - 1);
    expect(reads).toBe(0);
    await flush(1);
    expect(reads).toBe(1);
    expect(useKeyLights.getState().left).toEqual(L(true, 20, 4400));
    // One pending read at most: nothing more is read before the next poll.
    await flush(QUIET_READ_MS * 10);
    expect(reads).toBe(1);
  });

  it('a newer write that starts inside the second drops the quiet read: it brings its own read back', async () => {
    const w = world();
    await setUp(w);
    renderHook(() => useKeyLightPolling());
    await flush();
    let reads = 0;
    const second = later<Pair>();
    let sets = 0;
    setBackend({
      read: async () => (reads++, { left: L(true, 60, 4400), right: L(true, 60, 4400) }),
      set: () => (sets++ === 0 ? Promise.resolve({ left: 'busy', right: null } as Pair) : second.promise),
    });
    await useKeyLights.getState().set('left', { brightness: 20 });
    await flush(QUIET_READ_MS / 2);
    // A newer write starts while the quiet read waits, and is still out when the second is up.
    const writing = useKeyLights.getState().set('left', { brightness: 30 });
    await flush(QUIET_READ_MS);
    expect(reads).toBe(0);
    second.resolve({ left: L(true, 30, 4400), right: null });
    await writing;
    await flush(QUIET_READ_MS * 3);
    expect(reads).toBe(0);
    expect(useKeyLights.getState().left).toEqual(L(true, 30, 4400));
  });

  it('a write to the other light leaves a pending quiet read alone; one that covers the same light or both drops it', async () => {
    const w = world();
    await setUp(w);
    renderHook(() => useKeyLightPolling());
    await flush();
    let reads = 0;
    const second = later<Pair>();
    let sets = 0;
    let answer: (t: Target) => Promise<Pair> = async () => ({ left: 'busy', right: null });
    setBackend({ read: async () => (reads++, { left: L(true, 60, 4400), right: L(true, 60, 4400) }), set: (t) => answer(t) });
    await useKeyLights.getState().set('left', { brightness: 20 });
    await flush(QUIET_READ_MS / 2);
    // A write to the right light, still out when the second is up: the read for the left one is still made.
    answer = () => (sets++, second.promise);
    const writing = useKeyLights.getState().set('right', { brightness: 30 });
    await flush(QUIET_READ_MS);
    expect(reads).toBe(1);
    second.resolve({ left: null, right: L(true, 30, 4400) });
    await writing;
    // A write to both lights covers the left one: it drops the read.
    answer = async () => ({ left: 'busy', right: null });
    await useKeyLights.getState().set('left', { brightness: 25 });
    await flush(QUIET_READ_MS / 2);
    const slow = later<Pair>();
    answer = () => slow.promise;
    const both = useKeyLights.getState().set('both', { brightness: 40 });
    await flush(QUIET_READ_MS * 2);
    expect(reads).toBe(1);
    slow.resolve({ left: L(true, 40, 4400), right: L(true, 40, 4400) });
    await both;
    await flush(QUIET_READ_MS * 2);
    expect(reads).toBe(1);
  });

  it('a quiet answer arms no read when no polling user is mounted (the last one left while the write was out)', async () => {
    const w = world();
    await setUp(w);
    const user = renderHook(() => useKeyLightPolling());
    await flush();
    let reads = 0;
    const out = later<Pair>();
    setBackend({ read: async () => (reads++, { left: L(true, 60, 4400), right: L(true, 60, 4400) }), set: () => out.promise });
    const writing = useKeyLights.getState().set('left', { brightness: 20 });
    await flush();
    user.unmount();
    out.resolve({ left: 'busy', right: null });
    await writing;
    await flush(QUIET_READ_MS * 3);
    expect(reads).toBe(0);
  });

  it('the last polling user going away drops the pending quiet read; one still polling keeps it', async () => {
    const w = world();
    await setUp(w);
    let reads = 0;
    setBackend({ read: async () => (reads++, { left: L(true, 60, 4400), right: L(true, 60, 4400) }), set: async () => ({ left: 'busy', right: null }) });
    const a = renderHook(() => useKeyLightPolling());
    const b = renderHook(() => useKeyLightPolling());
    await flush();
    const base = reads;
    await useKeyLights.getState().set('left', { brightness: 20 });
    // One of two users goes: the read still happens.
    a.unmount();
    await flush(QUIET_READ_MS);
    expect(reads).toBe(base + 1);
    await useKeyLights.getState().set('left', { brightness: 25 });
    b.unmount();
    await flush(QUIET_READ_MS * 3);
    expect(reads).toBe(base + 1);
  });

  it('resetting the store cancels the pending quiet read', async () => {
    const w = world();
    await setUp(w);
    renderHook(() => useKeyLightPolling());
    await flush();
    let reads = 0;
    setBackend({ read: async () => (reads++, { left: L(true, 60, 4400), right: L(true, 60, 4400) }), set: async () => ({ left: 'busy', right: null }) });
    await useKeyLights.getState().set('left', { brightness: 20 });
    resetKeyLights();
    await flush(QUIET_READ_MS * 3);
    expect(reads).toBe(0);
  });

  it('answers that only say "not now" never replace what is shown', async () => {
    const w = world();
    await setUp(w);
    setBackend({ read: async () => ({ left: 'slow-down', right: 'busy' }), set: w.backend.set });
    await useKeyLights.getState().read();
    expect(useKeyLights.getState().left).toEqual(L(true, 60, 4400));
    expect(useKeyLights.getState().right).toEqual(L(true, 60, 4400));
  });
});

describe('a write the light accepted but did not take', () => {
  it('says so when the read back is still what it was and not what was asked, and keeps the reported number', async () => {
    const w = world();
    await setUp(w);
    w.stuck.add('left');
    await useKeyLights.getState().set('both', { brightness: 80 });
    const s = useKeyLights.getState();
    expect(s.note).toBe('The left key light did not take that change');
    expect(s.left).toEqual(L(true, 60, 4400));
    expect(s.right).toEqual(L(true, 80, 4400));
  });

  it('says so once for both lights, and for warmth and for on and off', async () => {
    const w = world();
    await setUp(w);
    w.stuck.add('left');
    w.stuck.add('right');
    await useKeyLights.getState().set('both', { kelvin: 6000 });
    expect(useKeyLights.getState().note).toBe('The key lights did not take that change');
    await vi.advanceTimersByTimeAsync(NOTE_MS + 1);
    await useKeyLights.getState().set('both', { on: false });
    expect(useKeyLights.getState().note).toBe('The key lights did not take that change');
  });

  it('a read back that moved to within the light\'s own rounding is a success and shows the reported number', async () => {
    const w = world();
    await setUp(w);
    const rounding: KeyLightBackend = {
      read: w.backend.read,
      set: async (_t, p) => ({ left: L(true, (p.brightness ?? 60) - 2, (p.kelvin ?? 4400) + 100), right: null }),
    };
    setBackend(rounding);
    await useKeyLights.getState().set('left', { brightness: 80, kelvin: 5000 });
    expect(useKeyLights.getState().note).toBeNull();
    expect(useKeyLights.getState().left).toEqual(L(true, 78, 5100));
  });

  it('a read back that moved part of the way is not called a refusal', async () => {
    const w = world();
    await setUp(w);
    setBackend({ read: w.backend.read, set: async () => ({ left: L(true, 70, 4400), right: null }) });
    await useKeyLights.getState().set('left', { brightness: 90 });
    expect(useKeyLights.getState().note).toBeNull();
    expect(useKeyLights.getState().left).toEqual(L(true, 70, 4400));
  });

  it('asking for what the light already has is not a refusal', async () => {
    const w = world();
    await setUp(w);
    w.stuck.add('left');
    await useKeyLights.getState().set('left', { brightness: 61 });
    expect(useKeyLights.getState().note).toBeNull();
  });

  it('judges the last value of a burst against the value from before the burst', async () => {
    const w = world();
    await setUp(w);
    w.stuck.add('left');
    const release = w.hold();
    const first = useKeyLights.getState().set('left', { brightness: 70 });
    void useKeyLights.getState().set('left', { brightness: 90 });
    release();
    await first;
    await flush();
    expect(useKeyLights.getState().note).toBe('The left key light did not take that change');
  });

  it('the follow-up read after a failed write still runs while another target is busy, so the line is not lost', async () => {
    const w = world();
    await setUp(w);
    const right = later<Pair>();
    setBackend({
      read: w.backend.read,
      set: async (target) => (target === 'right' ? right.promise : { left: 'failed', right: null }),
    });
    const busyRight = useKeyLights.getState().set('right', { brightness: 70 });
    await flush();
    await useKeyLights.getState().set('left', { brightness: 90 });
    expect(useKeyLights.getState().note).toBe('The left key light did not take that change');
    right.resolve({ left: null, right: L(true, 70, 4400) });
    await busyRight;
  });

  it('a second line replaces the first and the five seconds count from the second', async () => {
    const w = world();
    await setUp(w);
    w.stuck.add('left');
    await useKeyLights.getState().set('left', { brightness: 80 });
    await vi.advanceTimersByTimeAsync(3000);
    await useKeyLights.getState().set('left', { brightness: 85 });
    // 5.5 s after the first line: its timer would have cleared this one.
    await vi.advanceTimersByTimeAsync(2500);
    expect(useKeyLights.getState().note).toBe('The left key light did not take that change');
    await vi.advanceTimersByTimeAsync(2600);
    expect(useKeyLights.getState().note).toBeNull();
  });

  it('"busy" and "slow-down" answers raise no line', async () => {
    const w = world();
    await setUp(w);
    setBackend({ read: w.backend.read, set: async () => ({ left: 'busy', right: 'slow-down' }) });
    await useKeyLights.getState().set('both', { brightness: 80 });
    expect(useKeyLights.getState().note).toBeNull();
  });
});

describe('the drawer follows the place', () => {
  it('closes when the place changes, and stays open while it does not', async () => {
    const { usePlaceStore } = await import('../state/places');
    usePlaceStore.setState({ active: 'onair' });
    useKeyLights.getState().setDrawer(true);
    usePlaceStore.setState({ active: 'onair' });
    expect(useKeyLights.getState().drawer).toBe(true);
    usePlaceStore.setState({ active: 'work' });
    expect(useKeyLights.getState().drawer).toBe(false);
  });
});
