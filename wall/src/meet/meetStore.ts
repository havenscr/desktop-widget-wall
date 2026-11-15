import { create } from 'zustand';
import { useSignalStore } from '../signals/store';
import type { CallMark, KindId } from './islandModel';
import type { Meeting } from './model';

interface MeetStore {
  /** When the running call began (its first `since`), or null with no call. A change of the call's kind inside it does not change this. */
  callId: number | null;
  /** The marks made in this call, oldest first. Kept in memory only. */
  marks: CallMark[];
  /** The meeting this call belongs to, kept until the call ends (the list no longer holds a meeting that has ended). */
  anchor: { callId: number; meeting: Meeting } | null;
  /** Items ticked for a meeting occurrence: its identity (see `occurrenceId`) to the item numbers. Memory only. */
  ticks: Record<string, number[]>;
  /** The island kind chosen for an occurrence. */
  selected: Record<string, KindId>;
  /** Adds a mark only when the store still belongs to the call it was made in; true when it was added. */
  addMark: (callId: number, m: CallMark) => boolean;
  setAnchor: (callId: number, meeting: Meeting) => void;
  toggleTick: (id: string, index: number) => void;
  select: (id: string, kind: KindId) => void;
}

export const useMeetStore = create<MeetStore>((set, get) => ({
  callId: useSignalStore.getState().call?.since ?? null,
  marks: [],
  anchor: null,
  ticks: {},
  selected: {},
  addMark: (callId, m) => {
    if (get().callId !== callId) return false;
    set((s) => ({ marks: [...s.marks, m] }));
    return true;
  },
  setAnchor: (callId, meeting) => set((s) => (s.callId === callId ? { anchor: { callId, meeting } } : s)),
  toggleTick: (id, index) =>
    set((s) => {
      const now = s.ticks[id] ?? [];
      return { ticks: { ...s.ticks, [id]: now.includes(index) ? now.filter((n) => n !== index) : [...now, index] } };
    }),
  select: (id, kind) => set((s) => ({ selected: { ...s.selected, [id]: kind } })),
}));

/** Tests: forget every mark, tick and choice. */
export function resetMeetStore(): void {
  useMeetStore.setState({ callId: useSignalStore.getState().call?.since ?? null, marks: [], anchor: null, ticks: {}, selected: {} });
}

// A call's marks and meeting live as long as the call: they start with it and end with it. A new kind inside the
// same call (Teams to Zoom) changes the signal's `since` but not the call, so nothing resets then.
useSignalStore.subscribe((s, prev) => {
  const was = prev.call !== null;
  const is = s.call !== null;
  if (!was && is) useMeetStore.setState({ callId: s.call!.since, marks: [], anchor: null });
  else if (was && !is) useMeetStore.setState({ callId: null, marks: [], anchor: null });
});
