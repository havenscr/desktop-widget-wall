import { create } from 'zustand';

export type ToolsFocus = 'accounts' | null;
export type SignInKind = 'calendar' | 'spotify';

interface ToolsState {
  open: boolean;
  /** The section ringed for 2 seconds after the drawer opens from a link. */
  focus: ToolsFocus;
  /** Bumped on every open, so the ring starts again when the drawer is opened twice. */
  opened: number;
  /** Which browser sign-ins are waiting, and how to cancel each. Set by the Accounts section. */
  waiting: Record<SignInKind, boolean>;
  cancelers: Partial<Record<SignInKind, () => void>>;
  /** One line shown at the top of Accounts after the drawer was closed on a waiting sign-in. */
  note: string | null;
  openDrawer: (focus?: ToolsFocus) => void;
  /** Close; a sign-in still waiting is cancelled and the next open says so. */
  close: () => void;
  toggle: () => void;
  setWaiting: (kind: SignInKind, on: boolean, cancel?: () => void) => void;
  clearNote: () => void;
}

const idle = { calendar: false, spotify: false };

export const useToolsStore = create<ToolsState>((set, get) => ({
  open: false,
  focus: null,
  opened: 0,
  waiting: { ...idle },
  cancelers: {},
  note: null,
  openDrawer: (focus = null) => set((s) => ({ open: true, focus, opened: s.opened + 1 })),
  close: () => {
    const s = get();
    let cancelled = false;
    for (const kind of ['calendar', 'spotify'] as const) {
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

/** True while any browser sign-in waits. */
export const anySignInWaiting = (): boolean => {
  const w = useToolsStore.getState().waiting;
  return w.calendar || w.spotify;
};

/** Tests only. */
export function resetTools(): void {
  useToolsStore.setState({ open: false, focus: null, opened: 0, waiting: { ...idle }, cancelers: {}, note: null });
}
