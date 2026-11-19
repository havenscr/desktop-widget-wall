import { useEffect } from 'react';
import { create } from 'zustand';

/** A section that rings when a link opens the drawer at it, or a rail group id (opens the group, no ring). */
export type ToolsFocus = 'accounts' | 'keylights' | 'desktoken' | 'health' | 'lights' | 'display' | 'stagepop' | null;
/** The localStorage key holding the rail group this viewer had open last. */
export const GROUP_KEY = 'wall.tools.group';
/** One rail entry's status line: its text, and the dot beside it (ok mint, warn amber, none grey). */
export interface RailStatus {
  text: string;
  tone: 'ok' | 'warn' | 'none';
}
export type SignInKind = 'calendar' | 'spotify' | 'youtube';

interface ToolsState {
  open: boolean;
  /** The section ringed for 2 seconds after the drawer opens from a link. */
  focus: ToolsFocus;
  /** Bumped on every open, so the ring starts again when the drawer is opened twice. */
  opened: number;
  /** Which browser sign-ins are waiting, and how to cancel each. Set by the Accounts section. */
  waiting: Record<SignInKind, boolean>;
  cancelers: Partial<Record<SignInKind, () => void>>;
  /** The status line of each rail group, set by the group's panel (which stays mounted while the drawer is open). */
  rail: Record<string, RailStatus>;
  setRail: (id: string, status: RailStatus) => void;
  /** One line shown at the top of Accounts after the drawer was closed on a waiting sign-in. */
  note: string | null;
  openDrawer: (focus?: ToolsFocus) => void;
  /** Close; a sign-in still waiting is cancelled and the next open says so. */
  close: () => void;
  toggle: () => void;
  setWaiting: (kind: SignInKind, on: boolean, cancel?: () => void) => void;
  clearNote: () => void;
}

const idle = { calendar: false, spotify: false, youtube: false };

export const useToolsStore = create<ToolsState>((set, get) => ({
  open: false,
  focus: null,
  opened: 0,
  waiting: { ...idle },
  cancelers: {},
  note: null,
  rail: {},
  setRail: (id, status) =>
    set((s) => {
      const cur = s.rail[id];
      return cur && cur.text === status.text && cur.tone === status.tone ? s : { rail: { ...s.rail, [id]: status } };
    }),
  openDrawer: (focus = null) => set((s) => ({ open: true, focus, opened: s.opened + 1 })),
  close: () => {
    const s = get();
    let cancelled = false;
    for (const kind of ['calendar', 'spotify', 'youtube'] as const) {
      if (s.waiting[kind]) {
        cancelled = true;
        s.cancelers[kind]?.();
      }
    }
    set({ open: false, focus: null, note: cancelled ? 'Sign-in cancelled' : null });
  },
  toggle: () => (get().open ? get().close() : get().openDrawer()),
  setWaiting: (kind, on, cancel) => set((s) => ({ waiting: { ...s.waiting, [kind]: on }, cancelers: { ...s.cancelers, [kind]: on ? cancel : undefined } })),
  clearNote: () => set({ note: null }),
}));

/** A group's panel reports its rail status line with this; it is read back by the rail. */
export function useRailStatus(id: string, text: string, tone: RailStatus['tone']): void {
  const setRail = useToolsStore((s) => s.setRail);
  useEffect(() => setRail(id, { text, tone }), [id, text, tone, setRail]);
}

/** True while any browser sign-in waits. */
export const anySignInWaiting = (): boolean => {
  const w = useToolsStore.getState().waiting;
  return w.calendar || w.spotify || w.youtube;
};

/** Tests only. */
export function resetTools(): void {
  useToolsStore.setState({ open: false, focus: null, opened: 0, waiting: { ...idle }, cancelers: {}, note: null, rail: {} });
}
