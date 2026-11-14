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
  /** One line after a refused or failed mark or open; cleared by the next success. */
  note: string | null;
  /** True while a mark is being written. */
  marking: boolean;
  /** Restore the saved timer once (safe to call again). */
  hydrate: () => void;
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
  return create<OnAirState>((set, get) => {
    const save = (saved: m.Saved) => {
      set({ saved });
      try {
        deps.storage()?.setItem(m.STORAGE_KEY, JSON.stringify(saved));
      } catch {
        // Not kept across a reload this time; the timer still runs.
      }
    };
    const partCount = () => get().show?.parts.length ?? 0;
    return {
      saved: m.IDLE,
      show: null,
      showError: null,
      reading: false,
      marks: null,
      note: null,
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
      start: () => {
        const s = get().saved;
        if (s.running) return;
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
        if (to === s.partIndex) return;
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
        } catch (e) {
          if (seq !== readSeq) return true;
          set({ showError: m.showErrorText(e), reading: false });
        }
        return true;
      },
      loadMarks: async () => {
        try {
          const r = await deps.invoke<unknown>('wall2_onair_marks_today');
          if (m.isMarkResult(r)) set({ marks: r });
        } catch (e) {
          set({ note: m.markErrorText(e) });
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
          set(m.isMarkResult(r) ? { marks: r, note: null } : { note: 'Could not write marks.txt' });
        } catch (e) {
          set({ note: m.markErrorText(e) });
        } finally {
          set({ marking: false });
        }
      },
      open: async (which) => {
        try {
          await deps.invoke('wall2_onair_open', { which });
          // Open file makes a starter when there was none: read it as soon as the five second floor allows.
          if (which === 'show' && get().show?.state !== 'ok') setTimeout(() => void get().loadShow(), Math.max(0, lastRead + m.READ_FLOOR_MS - deps.now()) + 50);
          if (get().note?.startsWith('Could not open') || get().note === 'No config folder on this PC') set({ note: null });
        } catch (e) {
          set({ note: m.openErrorText(e, which) });
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
