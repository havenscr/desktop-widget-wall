import { create } from 'zustand';
import { useSignalStore } from '../signals/store';
import type { KindId } from './islandModel';
import type { Meeting } from './model';

interface MeetStore {
  /** When the running call began (its first `since`), or null with no call. A change of the call's kind inside it does not change this. */
  callId: number | null;
  /** The meeting this call belongs to, kept until the call ends (the list no longer holds a meeting that has ended). */
  anchor: { callId: number; meeting: Meeting } | null;
  /** Items ticked for a meeting occurrence: its identity (see `occurrenceId`) to the item numbers. Memory only. */
  ticks: Record<string, number[]>;
  /** The island kind chosen for an occurrence. */
  selected: Record<string, KindId>;
  setAnchor: (callId: number, meeting: Meeting) => void;
  toggleTick: (id: string, index: number) => void;
  select: (id: string, kind: KindId) => void;
}

export const useMeetStore = create<MeetStore>((set) => ({
  callId: useSignalStore.getState().call?.since ?? null,
  anchor: null,
  ticks: {},
  selected: {},
  setAnchor: (callId, meeting) => set((s) => (s.callId === callId ? { anchor: { callId, meeting } } : s)),
  toggleTick: (id, index) =>
    set((s) => {
      const now = s.ticks[id] ?? [];
      return { ticks: { ...s.ticks, [id]: now.includes(index) ? now.filter((n) => n !== index) : [...now, index] } };
    }),
  select: (id, kind) => set((s) => ({ selected: { ...s.selected, [id]: kind } })),
}));

/** Tests: forget every tick and choice. */
export function resetMeetStore(): void {
  useMeetStore.setState({ callId: useSignalStore.getState().call?.since ?? null, anchor: null, ticks: {}, selected: {} });
}

// A call's meeting lives as long as the call: they start with it and end with it. A new kind inside the
// same call (Teams to Zoom) changes the signal's `since` but not the call, so nothing resets then.
useSignalStore.subscribe((s, prev) => {
  const was = prev.call !== null;
  const is = s.call !== null;
  if (!was && is) useMeetStore.setState({ callId: s.call!.since, anchor: null });
  else if (was && !is) useMeetStore.setState({ callId: null, anchor: null });
});
