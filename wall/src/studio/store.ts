import { create } from 'zustand';
import { usePlaceStore } from '../state/places';
import { chooseBackend, currentInfo, resetSeam, isLight, isQuiet, readStatus, wordOf, type KeyLightBackend, type Light, type Pair, type Patch, type Reading, type Side, type Target, type Word } from './keyLights';
import { notTaken, SIDES, sideReading, type Snapshot } from './model';

/** The amber line after a write a light did not take stays this long. */
export const NOTE_MS = 5000;
/** Reads while On Air or the drawer is visible. */
export const READ_EVERY_MS = 30_000;
/** After an answer that only said "not now" for a side, the lights are read once more this long after. */
export const QUIET_READ_MS = 1000;

interface KeyLightState extends Snapshot {
  /** The drawer (Fine tune) is open. */
  drawer: boolean;
  /** The Linked switch: one pair of sliders for both lights. */
  linked: boolean;
  /** One amber line for a write a light did not take. */
  note: string | null;
  /** Writes in flight or waiting. */
  busy: number;
  /** The same count per light: a write to both lights counts for each. A slider waits only on its own lights. */
  busySides: Record<Side, number>;
  /** Counts finished runs of writes (the answer is in). */
  settled: number;
  setDrawer: (open: boolean) => void;
  setLinked: (linked: boolean) => void;
  /** The saved sides, then both lights. */
  refresh: () => Promise<void>;
  /** Both lights, read now. */
  read: () => Promise<void>;
  /** Writes (coalesced here to the latest value for a target) and shows what the lights report after. */
  set: (target: Target, patch: Patch) => Promise<void>;
}

/** Tests only: a fixed back end. Otherwise the seam chooses on every read and write. */
let override: KeyLightBackend | null = null;
let noteTimer: ReturnType<typeof setTimeout> | undefined;
let quietTimer: ReturnType<typeof setTimeout> | undefined;
/** The sides the pending follow-up read was asked for by a quiet answer. */
const quietPending = new Set<Side>();
const waiting = new Map<Target, Patch>();
const running = new Set<Target>();
/**
 * Which answer may land. Per side, a read answers only if no newer read, write start or write answer
 * has happened since it began (`readGen`); a write answers only if no newer write for that side has
 * started (`writeGen`). So an older answer never lands after a newer one, whichever target it came from.
 */
const readGen: Record<Side, number> = { left: 0, right: 0 };
const writeGen: Record<Side, number> = { left: 0, right: 0 };

/** Tests only: another back end. */
export function setBackend(b: KeyLightBackend): void {
  override = b;
}

/** Drops the follow-up read a quiet answer asked for: a newer write brings its own read back, and with nothing showing the lights there is no one to read for. */
export function cancelQuietRead(): void {
  clearTimeout(quietTimer);
  quietTimer = undefined;
  quietPending.clear();
}

let pollUsers = 0;
/** The polling hook's users: when the last one goes, a waiting follow-up read is dropped with it. */
export function pollUserChange(by: 1 | -1): void {
  pollUsers = Math.max(0, pollUsers + by);
  if (pollUsers === 0) cancelQuietRead();
}

const fresh = (): Snapshot => ({ status: null, left: null, right: null });
const sidesOf = (target: Target): readonly Side[] => (target === 'both' ? SIDES : [target]);
const bump = (counts: Record<Side, number>, sides: readonly Side[], by: number): Record<Side, number> => {
  const next = { ...counts };
  for (const side of sides) next[side] = Math.max(0, next[side] + by);
  return next;
};

export const useKeyLights = create<KeyLightState>((set, get) => {
  /** The back end now: which sides have an address, what the direct one has answered, what the home app can set. */
  const backend = {
    read: () => (override ?? choose()).read(),
    set: (target: Target, patch: Patch) => (override ?? choose()).set(target, patch),
  };
  function choose(): KeyLightBackend {
    const st = get().status;
    return chooseBackend(currentInfo(st && st !== 'failed' ? { left: st.left, right: st.right } : null));
  }
  const raise = (text: string) => {
    clearTimeout(noteTimer);
    set({ note: text });
    noteTimer = setTimeout(() => set({ note: null }), NOTE_MS);
  };
  const failedPair = (target: Target, word: Word): Pair => ({
    left: target === 'right' ? null : word,
    right: target === 'left' ? null : word,
  });

  /** Both lights from the back end. Applies each side only while it is still the newest answer; always returns what was read. */
  const fetchRead = async (): Promise<Pair | null> => {
    const status = get().status;
    if (status === null || status === 'failed') return null;
    if (!status.left && !status.right) {
      set({ left: null, right: null });
      return null;
    }
    const token = { left: ++readGen.left, right: ++readGen.right };
    let pair: Pair;
    try {
      pair = await backend.read();
    } catch (e) {
      const w = wordOf(e);
      pair = { left: status.left ? w : null, right: status.right ? w : null };
    }
    const next: Partial<Snapshot> = {};
    for (const side of SIDES) {
      const r: Reading | null = pair[side];
      // A word that only says "not now" never replaces what is shown; the next read corrects it.
      if (r !== null && !isQuiet(r) && readGen[side] === token[side]) next[side] = r;
    }
    set(next);
    return pair;
  };

  /** One run for a target: send what is waiting, again while more arrived, then show what the lights say. */
  const drain = async (target: Target) => {
    running.add(target);
    const sides = sidesOf(target);
    const state = get();
    const before: Partial<Record<Side, Light>> = {};
    for (const side of sides) {
      const r = sideReading(state, side);
      if (isLight(r)) before[side] = r;
    }
    const asked: Patch = {};
    const failedSides = new Set<Side>();
    // Sides whose newest write answered only "not now": what is shown for them may be old.
    const quietSides = new Set<Side>();
    let last: Pair = { left: null, right: null };
    try {
      for (let patch = waiting.get(target); patch; patch = waiting.get(target)) {
        waiting.delete(target);
        Object.assign(asked, patch);
        const token = { left: 0, right: 0 };
        // This write brings its own read back; one that an earlier quiet answer asked for this side (or both) would land in
        // its middle. A write to the other light leaves it alone.
        if (sides.some((side) => quietPending.has(side))) cancelQuietRead();
        for (const side of sides) {
          token[side] = ++writeGen[side];
          // Reads that began before this write cannot know its result.
          readGen[side]++;
        }
        let pair: Pair;
        try {
          pair = await backend.set(target, patch);
        } catch (e) {
          pair = failedPair(target, wordOf(e));
        }
        last = pair;
        const next: Partial<Snapshot> = {};
        for (const side of sides) {
          const r = pair[side];
          if (r !== null && isQuiet(r)) {
            if (writeGen[side] === token[side]) quietSides.add(side);
            continue;
          }
          if (r === null) continue;
          if (isLight(r)) {
            failedSides.delete(side);
            if (writeGen[side] === token[side]) quietSides.delete(side);
            // Only the newest write for a side shows its answer.
            if (writeGen[side] === token[side]) {
              next[side] = r;
              readGen[side]++;
            }
          } else {
            failedSides.add(side);
          }
        }
        set(next);
      }
    } finally {
      running.delete(target);
    }
    // A write the light took in words but not in fact: the read back still equals what it was before.
    const refused = new Set<Side>();
    for (const side of sides) {
      const r = last[side];
      const b = before[side];
      if (isLight(r) && b && !failedSides.has(side) && notTaken(b, asked, r)) refused.add(side);
    }
    if (failedSides.size > 0) {
      // The follow-up read still runs when another target is busy, and what it read decides the line.
      const pair = await fetchRead();
      for (const side of failedSides) if (isLight(pair?.[side])) refused.add(side);
    }
    // One more read soon, so a side that kept an old value after a quiet answer is corrected before the next poll.
    // Nothing is armed with no one polling: no screen shows the lights, so there is no one to read for.
    if (quietSides.size > 0 && pollUsers > 0) {
      for (const side of quietSides) quietPending.add(side);
      if (quietTimer === undefined) {
        quietTimer = setTimeout(() => {
          quietTimer = undefined;
          quietPending.clear();
          void fetchRead();
        }, QUIET_READ_MS);
      }
    }
    if (refused.size === 2) raise('The key lights did not take that change');
    else if (refused.size === 1) raise(`The ${[...refused][0]} key light did not take that change`);
    set((s) => ({ busy: Math.max(0, s.busy - 1), busySides: bump(s.busySides, sides, -1), settled: s.settled + 1 }));
  };

  return {
    ...fresh(),
    drawer: false,
    linked: true,
    note: null,
    busy: 0,
    busySides: { left: 0, right: 0 },
    settled: 0,
    setDrawer: (open) => set({ drawer: open }),
    setLinked: (linked) => set({ linked }),
    async refresh() {
      try {
        set({ status: await readStatus() });
      } catch {
        set({ status: 'failed' });
        return;
      }
      await get().read();
    },
    async read() {
      await fetchRead();
    },
    async set(target, patch) {
      const merged = { ...waiting.get(target), ...patch };
      waiting.set(target, merged);
      if (running.has(target)) return;
      set((s) => ({ busy: s.busy + 1, busySides: bump(s.busySides, sidesOf(target), 1) }));
      await drain(target);
    },
  };
});

// Leaving the place a drawer was opened on closes it: its host is a different one on each place.
usePlaceStore.subscribe((s, prev) => {
  if (s.active !== prev.active && useKeyLights.getState().drawer) useKeyLights.getState().setDrawer(false);
});

/** Tests only: back to nothing known. */
export function resetKeyLights(): void {
  clearTimeout(noteTimer);
  cancelQuietRead();
  pollUsers = 0;
  waiting.clear();
  running.clear();
  readGen.left = readGen.right = writeGen.left = writeGen.right = 0;
  override = null;
  resetSeam();
  useKeyLights.setState({ ...fresh(), drawer: false, linked: true, note: null, busy: 0, busySides: { left: 0, right: 0 }, settled: 0 });
}
