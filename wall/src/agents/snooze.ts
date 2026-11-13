import { useEffect, useState } from 'react';
import { create } from 'zustand';

/** "Later" quietens a waiting session's call to action for this long, on this display only. */
export const SNOOZE_MS = 15 * 60_000;
const KEY = 'wall2-agent-snooze';

type Snoozed = Record<string, number>;

function load(): Snoozed {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    if (!raw || typeof raw !== 'object') return {};
    const now = Date.now();
    const out: Snoozed = {};
    for (const [id, until] of Object.entries(raw as Record<string, unknown>)) if (typeof until === 'number' && until > now) out[id] = until;
    return out;
  } catch {
    return {};
  }
}

function save(s: Snoozed): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* no storage: the snooze lasts until the app restarts */
  }
}

/** Session id to the time its snooze ends. Kept in this display's storage; nothing is sent anywhere. */
export const useSnoozeStore = create<{ until: Snoozed }>(() => ({ until: load() }));

/** Snooze a waiting session for 15 minutes from `now`. */
export function snooze(id: string, now = Date.now()): void {
  const until = { ...useSnoozeStore.getState().until, [id]: now + SNOOZE_MS };
  save(until);
  useSnoozeStore.setState({ until });
}

/** Tests only: forget every snooze. */
export function resetSnooze(): void {
  save({});
  useSnoozeStore.setState({ until: {} });
}

/** The ids snoozed at `now`. */
export function snoozedAt(until: Snoozed, now: number): Set<string> {
  return new Set(Object.entries(until).filter(([, t]) => t > now).map(([id]) => id));
}

/**
 * The snoozed ids right now, and the snooze end times. Re-renders when the earliest snooze
 * ends, so a snoozed session comes back by itself.
 */
export function useSnoozed(): { ids: Set<string>; until: Snoozed } {
  const until = useSnoozeStore((s) => s.until);
  const [, setTick] = useState(0);
  const now = Date.now();
  const ids = snoozedAt(until, now);
  const next = Math.min(...Object.values(until).filter((t) => t > now));
  useEffect(() => {
    if (!Number.isFinite(next)) return;
    const id = setTimeout(() => setTick((n) => n + 1), next - Date.now() + 50);
    return () => clearTimeout(id);
  }, [next]);
  return { ids, until };
}
