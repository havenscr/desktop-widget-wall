import { create } from 'zustand';
import { useSignalStore } from '../signals/store';
import type { CallMark } from './islandModel';

interface MeetStore {
  /** The call these marks belong to (its `since`), or null when no call has run. */
  callSince: number | null;
  /** The marks made in this call, oldest first. Kept in memory only. */
  marks: CallMark[];
  /** Items ticked for a meeting: its key to the item numbers. Memory only, this meeting only. */
  ticks: Record<string, number[]>;
  addMark: (m: CallMark) => void;
  toggleTick: (key: string, index: number) => void;
}

export const useMeetStore = create<MeetStore>((set) => ({
  callSince: null,
  marks: [],
  ticks: {},
  addMark: (m) => set((s) => ({ marks: [...s.marks, m] })),
  toggleTick: (key, index) =>
    set((s) => {
      const now = s.ticks[key] ?? [];
      return { ticks: { ...s.ticks, [key]: now.includes(index) ? now.filter((n) => n !== index) : [...now, index] } };
    }),
}));

/** Tests: forget every mark and tick. */
export function resetMeetStore(): void {
  useMeetStore.setState({ callSince: null, marks: [], ticks: {} });
}

// The marks of a call end with it: a call ending, or a different call starting, clears them.
useSignalStore.subscribe((s, prev) => {
  const since = s.call?.since ?? null;
  if (since === (prev.call?.since ?? null)) return;
  if (since === null || since !== useMeetStore.getState().callSince) useMeetStore.setState({ callSince: since, marks: [] });
});
