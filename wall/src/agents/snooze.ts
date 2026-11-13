import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { laneWaits, questionFor, waitingIds, cards, type OmniSummary } from './model';

/** "Later" quietens a waiting session's call to action for this long, on this display only. */
export const SNOOZE_MS = 15 * 60_000;
const KEY = 'wall2-agent-snooze';
/** Most snoozes kept at once (anything beyond is dropped on read and on save). */
export const MAX_SNOOZES = 20;
/** The stored question is cut to this many characters. */
const QUESTION_MAX = 200;
/** A waiting-since time that moved by more than this is a new request (the helper counts whole seconds). */
const SINCE_SLACK_MS = 90_000;
const ID_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;

/** What a snooze remembers about the request it quietened, so a new request ends it. */
export interface SnoozeEntry {
  until: number;
  /** When the session began waiting (helper clock), or null when the helper did not say. */
  since: number | null;
  /** The helper's question text, bounded; empty when it sent none. */
  question: string;
}

type Snoozed = Record<string, SnoozeEntry>;

/** The session's waiting-since time and question as the helper reports them now. */
export function waitMark(s: OmniSummary, id: string): { since: number | null; question: string } {
  const l = cards(s).find((c) => c.id === id) ?? s.lanes.find((c) => c.id === id);
  const helperNow = Date.parse(s.now);
  const since = l?.waitingSinceS != null && Number.isFinite(helperNow) ? helperNow - l.waitingSinceS * 1000 : null;
  return { since, question: (questionFor(s, id) ?? '').slice(0, QUESTION_MAX) };
}

/** True when the entry still describes the request the helper reports now. */
export function sameRequest(e: SnoozeEntry, s: OmniSummary, id: string): boolean {
  const l = cards(s).find((c) => c.id === id) ?? s.lanes.find((c) => c.id === id);
  const stillWaits = waitingIds(s).includes(id) || (l !== undefined && laneWaits(l));
  if (!stillWaits) return false;
  const m = waitMark(s, id);
  if (m.question !== e.question) return false;
  if (m.since !== null && e.since !== null && Math.abs(m.since - e.since) > SINCE_SLACK_MS) return false;
  return true;
}

/** Keep only well-formed, unexpired entries (an end no later than one snooze from now), at most 20. */
function clean(raw: unknown, now: number): Snoozed {
  const out: Snoozed = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_SNOOZES) break;
    if (!ID_SHAPE.test(id) || !v || typeof v !== 'object') continue;
    const e = v as Record<string, unknown>;
    if (typeof e.until !== 'number' || !Number.isFinite(e.until) || e.until <= now || e.until > now + SNOOZE_MS) continue;
    if (e.since !== null && !(typeof e.since === 'number' && Number.isFinite(e.since))) continue;
    if (typeof e.question !== 'string' || e.question.length > QUESTION_MAX) continue;
    out[id] = { until: e.until, since: e.since as number | null, question: e.question };
  }
  return out;
}

function load(): Snoozed {
  try {
    return clean(JSON.parse(localStorage.getItem(KEY) ?? '{}'), Date.now());
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

/** Session id to its snooze. Kept in this display's storage; nothing is sent anywhere. */
export const useSnoozeStore = create<{ entries: Snoozed }>(() => ({ entries: load() }));

function put(entries: Snoozed): void {
  save(entries);
  useSnoozeStore.setState({ entries });
}

/** Snooze a waiting session for 15 minutes from `now`, remembering which request it was. */
export function snooze(id: string, summary: OmniSummary, now = Date.now()): void {
  const m = waitMark(summary, id);
  const next = clean({ ...useSnoozeStore.getState().entries, [id]: { until: now + SNOOZE_MS, since: m.since, question: m.question } }, now);
  put(next);
}

/** Tests only: forget every snooze. */
export function resetSnooze(): void {
  put({});
}

/** The ids snoozed at `now`. */
export function snoozedAt(entries: Snoozed, now: number): Set<string> {
  return new Set(Object.entries(entries).filter(([, e]) => e.until > now).map(([id]) => id));
}

/**
 * The snoozed ids right now, and their end times. With the helper's answer (`summary`), a
 * snooze ends as soon as the session reports a different question or waiting-since time, or
 * stops waiting. Re-renders when the earliest snooze ends, so a snoozed session comes back
 * by itself.
 */
export function useSnoozed(summary: OmniSummary | null = null): { ids: Set<string>; until: Record<string, number> } {
  const entries = useSnoozeStore((s) => s.entries);
  const [, setTick] = useState(0);
  const now = Date.now();
  const live = Object.entries(entries).filter(([id, e]) => e.until > now && (summary === null || sameRequest(e, summary, id)));
  const next = Math.min(...live.map(([, e]) => e.until));
  // Forget entries that ended: a new request, or the session stopped waiting.
  const stale = summary === null ? [] : Object.entries(entries).filter(([id, e]) => e.until > now && !sameRequest(e, summary, id));
  const staleKey = stale.map(([id]) => id).join(',');
  useEffect(() => {
    if (!staleKey) return;
    const keep = { ...useSnoozeStore.getState().entries };
    for (const id of staleKey.split(',')) delete keep[id];
    put(keep);
  }, [staleKey]);
  useEffect(() => {
    if (!Number.isFinite(next)) return;
    const id = setTimeout(() => setTick((n) => n + 1), next - Date.now() + 50);
    return () => clearTimeout(id);
  }, [next]);
  return { ids: new Set(live.map(([id]) => id)), until: Object.fromEntries(live.map(([id, e]) => [id, e.until])) };
}
