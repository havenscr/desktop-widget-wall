import { create } from 'zustand';
import { chooseBackend, isLight, readStatus, wordOf, type KeyLightBackend, type Pair, type Patch, type Side, type Target, type Word } from './keyLights';
import { SIDES, sideReading, type Snapshot } from './model';

/** The amber line after a write a light did not take stays this long. */
export const NOTE_MS = 5000;
/** Reads while On Air or the drawer is visible. */
export const READ_EVERY_MS = 30_000;

interface KeyLightState extends Snapshot {
  /** The drawer (Fine tune) is open. */
  drawer: boolean;
  /** The Linked switch: one pair of sliders for both lights. */
  linked: boolean;
  /** One amber line for a write a light did not take. */
  note: string | null;
  /** Writes in flight or waiting. */
  busy: number;
  /** Counts finished runs of writes (the answer is in); a slider lets go of the value it held then. */
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

let backend: KeyLightBackend = chooseBackend();
let readSeq = 0;
let noteTimer: ReturnType<typeof setTimeout> | undefined;
const waiting = new Map<Target, Patch>();
const running = new Set<Target>();

/** Tests only: another back end. */
export function setBackend(b: KeyLightBackend): void {
  backend = b;
}

const fresh = (): Snapshot => ({ status: null, left: null, right: null });

export const useKeyLights = create<KeyLightState>((set, get) => {
  const apply = (pair: Pair) => {
    const next: Partial<Snapshot> = {};
    if (pair.left !== null) next.left = pair.left;
    if (pair.right !== null) next.right = pair.right;
    set(next);
  };
  const raise = (text: string) => {
    clearTimeout(noteTimer);
    set({ note: text });
    noteTimer = setTimeout(() => set({ note: null }), NOTE_MS);
  };
  const failedPair = (target: Target, word: Word): Pair => ({
    left: target === 'right' ? null : word,
    right: target === 'left' ? null : word,
  });

  /** One run for a target: send what is waiting, again while more arrived, then show what the lights say. */
  const drain = async (target: Target) => {
    running.add(target);
    const failedSides = new Set<Side>();
    try {
      for (let patch = waiting.get(target); patch; patch = waiting.get(target)) {
        waiting.delete(target);
        let pair: Pair;
        try {
          pair = await backend.set(target, patch);
        } catch (e) {
          pair = failedPair(target, wordOf(e));
        }
        for (const side of SIDES) {
          const r = pair[side];
          if (r !== null && !isLight(r)) failedSides.add(side);
          if (r !== null && isLight(r)) failedSides.delete(side);
        }
        // A light that took the write shows what it reports; one that did not is settled by the read below.
        const ok: Pair = { left: isLight(pair.left) ? pair.left : null, right: isLight(pair.right) ? pair.right : null };
        apply(ok);
      }
    } finally {
      running.delete(target);
    }
    if (failedSides.size > 0) {
      await get().read();
      // Still answering: the write failed and the slider springs back to what the light reports.
      const stillThere = [...failedSides].filter((side) => isLight(sideReading(get(), side)));
      if (stillThere.length === 2) raise('The key lights did not take that change');
      else if (stillThere.length === 1) raise(`The ${stillThere[0]} key light did not take that change`);
    }
    set((s) => ({ busy: Math.max(0, s.busy - 1), settled: s.settled + 1 }));
  };

  return {
    ...fresh(),
    drawer: false,
    linked: true,
    note: null,
    busy: 0,
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
      const status = get().status;
      if (status === null || status === 'failed') return;
      if (!status.left && !status.right) {
        set({ left: null, right: null });
        return;
      }
      const seq = ++readSeq;
      let pair: Pair;
      try {
        pair = await backend.read();
      } catch (e) {
        const w = wordOf(e);
        pair = { left: status.left ? w : null, right: status.right ? w : null };
      }
      // An older read never replaces a newer answer, and nothing replaces a value a write is still working on.
      if (seq !== readSeq || running.size > 0) return;
      apply(pair);
    },
    async set(target, patch) {
      const merged = { ...waiting.get(target), ...patch };
      waiting.set(target, merged);
      if (running.has(target)) return;
      set((s) => ({ busy: s.busy + 1 }));
      await drain(target);
    },
  };
});

/** Tests only: back to nothing known. */
export function resetKeyLights(): void {
  clearTimeout(noteTimer);
  waiting.clear();
  running.clear();
  readSeq = 0;
  backend = chooseBackend();
  useKeyLights.setState({ ...fresh(), drawer: false, linked: true, note: null, busy: 0, settled: 0 });
}
