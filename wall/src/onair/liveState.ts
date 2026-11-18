import { create } from 'zustand';
import type { CallSignal } from '../signals/model';
import type { PlaceId } from '../state/places';
import { pickMode } from './modes';

export interface LiveInput {
  active: PlaceId;
  known: boolean;
  recording: boolean;
  call: CallSignal | null;
  browserAv: boolean;
  now: number;
}

/**
 * Whether On Air counts as live for the address rule, failing safe: the On Air place is open, or the mode picker
 * sees a broadcast or a recorder on (whatever the hold says; a hold never makes it less live).
 */
export function isOnAirLive(i: LiveInput): boolean {
  if (i.active === 'onair') return true;
  const pick = pickMode({ known: i.known, recording: i.recording, call: i.call, browserAv: i.browserAv, live: null, held: null, now: i.now });
  return pick.seen.includes('live') || pick.seen.includes('rec');
}

interface LiveState {
  live: boolean;
  set: (live: boolean) => void;
}

/** The one shared answer; the person card reads it, `useOnAirLiveReport` writes it. */
export const useOnAirLiveStore = create<LiveState>((set) => ({
  live: false,
  set: (live) => set({ live }),
}));
