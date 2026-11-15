import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { chooseBackend, directBackend, type KeyLightBackend, type Pair, type Patch, type Target } from './keyLights';
import { NOTE_MS, resetKeyLights, setBackend, useKeyLights } from './store';

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
    expect(s.status).toEqual({ left: true, right: true });
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
