import { create } from 'zustand';
import { invoke as bridgeInvoke } from '../bridge/tauri';
import * as m from './model';

type Storage2 = Pick<Storage, 'getItem' | 'setItem'>;

export interface OnAirDeps {
  now: () => number;
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  storage: () => Storage2 | null;
}

export interface OnAirState {
  /** The timer and the current part, kept across reloads and place changes. */
  saved: m.Saved;
  /** The last good answer for the run of show; null before the first. */
  show: m.Show | null;
  /** Why the last read failed (one line); null when it did not. */
  showError: string | null;
  reading: boolean;
  marks: m.MarkResult | null;
  /** The local date the marks were counted for; null before the first read. */
  marksDate: string | null;
  /** One line after a refused or failed mark, marks read or Open marks.txt (shown under Mark a moment). */
  marksNote: string | null;
  /** One line after a failed Open run-of-show.txt (shown in the run of show's file line). */
  showNote: string | null;
  /** True while a mark is being written. */
  marking: boolean;
  /** Restore the saved timer once (safe to call again). */
  hydrate: () => void;
  /** Stop the timer itself once it has run 24 hours (called as the clock ticks and when the place opens). */
  settle: () => void;
  /** Forget a delayed read of the run of show that Open file asked for (the place was closed). */
  cancelPending: () => void;
  start: () => void;
  stop: () => void;
  /** Back to 00:00 and the first part. Only while stopped. */
  reset: () => void;
  /** Make part `index` current (held to the parts there are). */
  goPart: (index: number) => void;
  /** Read the run of show, unless it was asked for less than five seconds ago. Answers whether a read started. */
  loadShow: () => Promise<boolean>;
  loadMarks: () => Promise<void>;
  /** One mark (a second within a second counts once). */
  mark: () => Promise<void>;
  open: (which: 'show' | 'marks') => Promise<void>;
}

/**
 * On Air's state. The timer lives in the store (not in the place), so it keeps counting while
 * another place is open, and in local storage, so a reload or a restart of the wall goes on from
 * the stored start. Storage that throws or holds something odd gives an idle timer.
 */
export function createOnAirStore(deps: OnAirDeps) {
  let hydrated = false;
  let lastRead = -Infinity;
  let lastMark = -Infinity;
  let readSeq = 0;
  let pendingRead: ReturnType<typeof setTimeout> | undefined;
  return create<OnAirState>((set, get) => {
    const save = (saved: m.Saved) => {
      set({ saved });
      try {
        deps.storage()?.setItem(m.STORAGE_KEY, JSON.stringify(saved));
      } catch {
        // Not kept across a reload this time; the timer still runs.
      }
    };
    const partCount = () => {
      const show = get().show;
      return show?.state === 'ok' ? show.parts.length : 0;
    };
    const settle = () => {
      const s = get().saved;
      if (!s.running || s.startedAt === null) return;
      if (s.accumulatedMs + Math.max(0, deps.now() - s.startedAt) >= m.MAX_SHOW_MS) save(m.stoppedAtLimit(s, s.startedAt + (m.MAX_SHOW_MS - s.accumulatedMs)));
    };
    return {
      saved: m.IDLE,
      show: null,
      showError: null,
      reading: false,
      marks: null,
      marksDate: null,
      marksNote: null,
      showNote: null,
      marking: false,
      hydrate: () => {
        if (hydrated) return;
        hydrated = true;
        let raw: string | null = null;
        try {
          raw = deps.storage()?.getItem(m.STORAGE_KEY) ?? null;
        } catch {
          raw = null;
        }
        set({ saved: m.parseSaved(raw, deps.now()) });
      },
      settle,
      cancelPending: () => {
        clearTimeout(pendingRead);
        pendingRead = undefined;
      },
      start: () => {
        const s = get().saved;
        // A timer that stopped itself at 24 hours starts again only after Reset.
        if (s.running || m.atLimit(s)) return;
        const now = deps.now();
        save({ ...s, running: true, startedAt: now, firstStartAt: s.firstStartAt ?? now, stoppedAt: null });
      },
      stop: () => {
        const s = get().saved;
        if (!s.running) return;
        const now = deps.now();
        save({ ...s, running: false, startedAt: null, accumulatedMs: m.elapsedMs(s, now), stoppedAt: now });
      },
      reset: () => {
        if (get().saved.running) return;
        save(m.IDLE);
      },
      goPart: (index) => {
        const s = get().saved;
        const to = m.clampIndex(index, partCount());
        // Compared with the part the page shows (the clamped index), never the raw stored one.
        if (to === m.clampIndex(s.partIndex, partCount())) return;
        save({ ...s, partIndex: to, partSinceMs: m.elapsedMs(s, deps.now()) });
      },
      loadShow: async () => {
        const now = deps.now();
        if (now - lastRead < m.READ_FLOOR_MS) return false;
        lastRead = now;
        const seq = ++readSeq;
        set({ reading: true });
        try {
          const answer = await deps.invoke<unknown>('wall2_onair_show');
          if (seq !== readSeq) return true;
          if (!m.isShow(answer)) throw new Error('failed');
          set({ show: answer, showError: null, reading: false });
          // The current part follows the file: held to the parts there are, kept that way, and the
          // time in the part starts again when that moves it.
          const cur = get().saved;
          const held = answer.state === 'ok' && answer.parts.length > 0 ? m.clampIndex(cur.partIndex, answer.parts.length) : cur.partIndex;
          if (held !== cur.partIndex) save({ ...cur, partIndex: held, partSinceMs: m.elapsedMs(cur, deps.now()) });
        } catch (e) {
          if (seq !== readSeq) return true;
          set({ showError: m.showErrorText(e), reading: false });
        }
        return true;
      },
      loadMarks: async () => {
        const day = m.localDate(deps.now());
        try {
          const r = await deps.invoke<unknown>('wall2_onair_marks_today');
          if (m.isMarkResult(r)) set({ marks: r, marksDate: day, marksNote: null });
        } catch (e) {
          set({ marksNote: m.markErrorText(e) });
        }
      },
      mark: async () => {
        const now = deps.now();
        if (get().marking || now - lastMark < m.MARK_QUIET_MS) return;
        lastMark = now;
        const st = get();
        const parts = st.show?.state === 'ok' ? st.show.parts : [];
        const part = parts[m.clampIndex(st.saved.partIndex, parts.length)]?.name ?? null;
        set({ marking: true });
        try {
          const r = await deps.invoke<unknown>('wall2_onair_mark', { showMs: Math.floor(m.elapsedMs(st.saved, now)), part });
          set(m.isMarkResult(r) ? { marks: r, marksDate: m.localDate(now), marksNote: null } : { marksNote: 'Could not write marks.txt' });
        } catch (e) {
          set({ marksNote: m.markErrorText(e) });
        } finally {
          set({ marking: false });
        }
      },
      open: async (which) => {
        try {
          await deps.invoke('wall2_onair_open', { which });
          if (which === 'show') {
            set({ showNote: null });
            // Open file makes a starter when there was none: read it as soon as the five second floor allows.
            if (get().show?.state !== 'ok') {
              clearTimeout(pendingRead);
              pendingRead = setTimeout(() => {
                pendingRead = undefined;
                void get().loadShow();
              }, Math.max(0, lastRead + m.READ_FLOOR_MS - deps.now()) + 50);
            }
          } else if (get().marksNote?.startsWith('Could not open') || get().marksNote === 'No config folder on this PC') set({ marksNote: null });
        } catch (e) {
          if (which === 'show') set({ showNote: m.openErrorText(e, which) });
          else set({ marksNote: m.openErrorText(e, which) });
        }
      },
    };
  });
}

export const useOnAirStore = createOnAirStore({
  now: () => Date.now(),
  invoke: bridgeInvoke,
  storage: () => {
    try {
      return typeof window !== 'undefined' ? window.localStorage : null;
    } catch {
      return null;
    }
  },
});
