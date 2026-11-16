import { create } from 'zustand';
import { reviewNow } from '../ui/reviewClock';
import { useSignalStore } from '../signals/store';
import { backAfterGap, emptyDay, parseTakes, reduceTakes, STORAGE_KEY, TAKE_SEEN_EVERY_MS, type TakeEvent, type Takes } from './takeModel';

/** The wall's moment: the review clock in a development review still, else the system clock. */
const clock = (): number => (reviewNow ? reviewNow() : Date.now());

function storage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function read(): Takes {
  try {
    return parseTakes(storage()?.getItem(STORAGE_KEY) ?? null, clock());
  } catch {
    return emptyDay(clock());
  }
}

/** Today's takes, kept in local storage (`wall2-onair-takes`). */
export const useTakes = create<{ takes: Takes }>(() => ({ takes: read() }));

let lastSave = -Infinity;

function save(takes: Takes): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(takes));
  } catch {
    // Not kept across a reload this time; the takes still count.
  }
}

function apply(e: TakeEvent, force = true): void {
  const prev = useTakes.getState().takes;
  const next = reduceTakes(prev, e);
  if (next === prev) return;
  useTakes.setState({ takes: next });
  if (!force && e.now - lastSave < TAKE_SEEN_EVERY_MS) return;
  lastSave = e.now;
  save(next);
}

/** Tests: start again from an empty day (or from what storage holds) with no signal history. */
export function resetTakes(): void {
  undo = null;
  lastSave = -Infinity;
  useTakes.setState({ takes: read() });
}

/** The page's own heartbeat while a recorder runs: keeps the last-seen time, written to storage every 15 seconds. */
export function noteRecordingSeen(): void {
  if (useSignalStore.getState().recording) apply({ type: 'seen', now: clock() }, false);
}

/** The Pause key was taken by Rust without an error: the take is paused. */
export function notePaused(): void {
  apply({ type: 'pause', now: clock() });
}

/** The Resume key was taken by Rust without an error. */
export function noteResumed(): void {
  apply({ type: 'resume', now: clock() });
}

// A take starts when the signal says a recorder is on and ends when it goes off, as the Recording chip's start time does.
// Back within the gap of going off, the take goes on as it was.
let undo: { before: Takes; offAt: number } | null = null;

function follow(recording: boolean, was: boolean): void {
  const now = clock();
  if (recording && !was) {
    const back = undo ? backAfterGap(undo.before, undo.offAt, now) : null;
    undo = null;
    if (back) {
      useTakes.setState({ takes: back });
      save(back);
    } else apply({ type: 'on', now });
  } else if (!recording && was) {
    const before = useTakes.getState().takes;
    undo = before.current ? { before, offAt: now } : null;
    apply({ type: 'off', now });
  }
}
useSignalStore.subscribe((s, prev) => follow(s.recording, prev.recording));
// The signal may already be on when this module loads (the store was set before the page opened).
if (useSignalStore.getState().recording) follow(true, false);
