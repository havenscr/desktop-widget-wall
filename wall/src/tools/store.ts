import { create } from 'zustand';

export type ToolsFocus = 'accounts' | null;

interface ToolsState {
  open: boolean;
  /** The section ringed for 2 seconds after the drawer opens from a link. */
  focus: ToolsFocus;
  /** Bumped on every open, so the ring starts again when the drawer is opened twice. */
  opened: number;
  openDrawer: (focus?: ToolsFocus) => void;
  close: () => void;
  toggle: () => void;
}

export const useToolsStore = create<ToolsState>((set, get) => ({
  open: false,
  focus: null,
  opened: 0,
  openDrawer: (focus = null) => set((s) => ({ open: true, focus, opened: s.opened + 1 })),
  close: () => set({ open: false, focus: null }),
  toggle: () => (get().open ? get().close() : get().openDrawer()),
}));

/** Tests only. */
export function resetTools(): void {
  useToolsStore.setState({ open: false, focus: null, opened: 0 });
}
