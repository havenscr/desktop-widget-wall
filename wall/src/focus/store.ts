import { create } from 'zustand';
import { invoke as bridgeInvoke } from '../bridge/tauri';
import { createFocusDnd, type FocusDnd } from './dnd';
import * as m from './model';

type Storage3 = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface FocusDeps {
  now: () => number;
  invoke: (command: string) => Promise<unknown>;
  storage: () => Storage3 | null;
}

export interface FocusStore {
  state: m.FocusState;
  /** Last time the display was refreshed; the on-screen ticker updates it. */
  now: number;
  /** Idempotent: restore saved state, arm the end timer, undo a leftover Do Not Disturb. */
  init: () => void;
  start: () => void;
  pause: () => void;
  resume: () => void;
  reset: () => void;
  setMinutes: (minutes: number) => void;
  /** Finish an overdue timer now. Safe to call at any time. */
  reconcile: () => void;
  /** Refresh `now` for the display and reconcile. */
  touch: () => void;
  /** Test helper: drop timers and state. */
  dispose: () => void;
}

const nullStorage: Storage3 = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

/**
 * Focus timer state for the whole app. It lives outside any screen, so the end
 * timer fires and Do Not Disturb is released whichever screen is shown and
 * whether or not the window is visible.
 */
export function createFocusStore(deps: FocusDeps) {
  const store = () => deps.storage() ?? nullStorage;
  const dnd: FocusDnd = createFocusDnd({
    invoke: deps.invoke,
    storage: {
      getItem: (k) => store().getItem(k),
      setItem: (k, v) => store().setItem(k, v),
      removeItem: (k) => store().removeItem(k),
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Bumped on every state change; a deferred Do Not Disturb step compares it.
  let generation = 0;
  let initialized = false;
  let onVisible: (() => void) | null = null;

  return create<FocusStore>((set, get) => {
    const disarm = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const arm = () => {
      disarm();
      const s = get().state;
      if (s.status !== 'running') return;
      timer = setTimeout(() => get().reconcile(), Math.max(0, s.endAt - deps.now()));
    };
    const commit = (next: m.FocusState) => {
      const prev = get().state;
      if (next === prev) return;
      generation++;
      set({ state: next, now: deps.now() });
      try {
        store().setItem(m.FOCUS_KEY, m.serialize(next));
      } catch {
        /* storage unavailable: the timer still works until restart */
      }
      arm();
      if (next.status === 'running' && prev.status !== 'running') void dnd.enable();
      else if (next.status !== 'running' && prev.status === 'running') void dnd.release();
    };

    return {
      state: m.initialFocus,
      now: deps.now(),
      init: () => {
        if (initialized) return;
        initialized = true;
        let restored = m.initialFocus;
        try {
          restored = m.restore(store().getItem(m.FOCUS_KEY), deps.now());
        } catch {
          /* unreadable: idle */
        }
        generation++;
        set({ state: restored, now: deps.now() });
        arm();
        // Undo a Do Not Disturb a previous run left on, then take it again only if
        // this same state is still running when that finishes.
        const g = generation;
        void dnd.release().then(() => {
          if (g === generation && get().state.status === 'running') void dnd.enable();
        });
        if (typeof document !== 'undefined') {
          onVisible = () => {
            if (!document.hidden) get().reconcile();
          };
          document.addEventListener('visibilitychange', onVisible);
        }
      },
      start: () => commit(m.start(get().state, deps.now())),
      pause: () => commit(m.pause(get().state, deps.now())),
      resume: () => commit(m.resume(get().state, deps.now())),
      reset: () => commit(m.reset(get().state)),
      setMinutes: (minutes) => {
        const s = get().state;
        if (s.status === 'idle' || s.status === 'finished') commit({ status: 'idle', minutes: m.clampMinutes(minutes) });
      },
      reconcile: () => {
        const now = deps.now();
        const s = get().state;
        const next = m.tick(s, now);
        if (next !== s) commit(next);
        else if (s.status === 'running') arm(); // fired early: wait out the rest
      },
      touch: () => {
        set({ now: deps.now() });
        get().reconcile();
      },
      dispose: () => {
        disarm();
        generation++;
        initialized = false;
        if (onVisible) document.removeEventListener('visibilitychange', onVisible);
        onVisible = null;
        set({ state: m.initialFocus, now: deps.now() });
      },
    };
  });
}

function realStorage(): Storage3 | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export const useFocusStore = createFocusStore({
  now: () => Date.now(),
  invoke: (c) => bridgeInvoke(c),
  storage: realStorage,
});
