import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { invoke } from '../bridge/tauri';
import { calendarNotAvailable, nextMeeting, REFRESH_MS, TICK_MS, type Meeting, type MeetData } from '../meet/model';
import { useVisible } from '../ui/useVisible';

const systemNow = () => Date.now();

export interface NextMeetingState {
  meeting: Meeting | undefined;
  now: number;
  /** The list may be out of date: the feed said `stale`, or the last refresh failed. */
  stale: boolean;
  /** Time of the last complete good read, or null. */
  asOf: number | null;
  /** No account could be read (all signed out or not answering), or the first read failed. */
  unavailable: boolean;
}

interface MeetingFeed {
  meetings: Meeting[];
  feedStale: boolean;
  failed: boolean;
  asOf: number | null;
  noCalendar: boolean;
  /** Bumped after every read, so each user refreshes its own clock then. */
  reads: number;
}

const initial = (): MeetingFeed => ({ meetings: [], feedStale: false, failed: false, asOf: null, noCalendar: false, reads: 0 });

/** The one shared meeting list every `useNextMeeting` user reads. */
export const useMeetingFeed = create<MeetingFeed>(() => initial());

let users = 0;
let timer: ReturnType<typeof setInterval> | null = null;
/** Bumped when the last user leaves, so a read started before that cannot land after it. */
let epoch = 0;
/** The injected clock of the most recently joined user (tests pass their own). */
let clock: () => number = systemNow;
let lastRead: number | null = null;
let inFlight = false;
/** A screen that mounts reads again when the last read is this old or older. */
const MOUNT_READ_MS = 60_000;
/** After failed reads the next try waits 30, then 60, then 120 s; the 5 minute poll runs regardless. */
export const RETRY_STEPS_MS: readonly number[] = [30_000, 60_000, 120_000];
/** Failed reads in a row. */
let failures = 0;

/** How long to wait before trying again after the n-th failed read in a row (n from 1). */
export function retryDelay(n: number): number {
  return RETRY_STEPS_MS[Math.min(Math.max(n, 1), RETRY_STEPS_MS.length) - 1];
}

function due(): boolean {
  return lastRead === null || clock() - lastRead >= MOUNT_READ_MS;
}

function read(): void {
  const mine = epoch;
  lastRead = clock();
  inFlight = true;
  invoke<MeetData>('wall2_meet_next')
    .then((d) => {
      if (mine !== epoch) return;
      failures = 0;
      const partial = d?.stale === true;
      useMeetingFeed.setState((s) => ({
        meetings: Array.isArray(d?.meetings) ? d.meetings : [],
        feedStale: partial,
        failed: false,
        noCalendar: calendarNotAvailable(d?.accounts ?? []),
        asOf: partial ? s.asOf : clock(),
      }));
    })
    .catch((e) => {
      if (mine !== epoch) return;
      const text = e instanceof Error ? e.message : String(e);
      if (text === 'not-configured' || text === 'invalid-config') {
        failures = 0;
        useMeetingFeed.setState({ meetings: [], feedStale: false, failed: false, asOf: null, noCalendar: false });
      } else {
        useMeetingFeed.setState({ failed: true });
        // Retry soon, backing off 30, 60, 120 s while reads keep failing, so a dead network is not hammered.
        failures += 1;
        lastRead = clock() - (MOUNT_READ_MS - retryDelay(failures));
      }
    })
    .finally(() => {
      if (mine === epoch) {
        inFlight = false;
        useMeetingFeed.setState((s) => ({ reads: s.reads + 1 }));
      }
    });
}

function join(now: () => number): void {
  clock = now;
  users += 1;
  if (users === 1) timer = setInterval(read, REFRESH_MS);
  // Every mount reads when the last read is a minute old or more, even with other users mounted.
  if (!inFlight && due()) read();
}

/** On each user's tick: try again after a failed read. */
function retryIfFailed(): void {
  if (useMeetingFeed.getState().failed && !inFlight && due()) read();
}

function leave(): void {
  users = Math.max(0, users - 1);
  if (users > 0) return;
  if (timer !== null) clearInterval(timer);
  timer = null;
  // Keep the meetings, the stale flags, `asOf` and the last read time, so a hide then show
  // still shows the old list and does not read again inside the interval.
  epoch += 1;
  // A read we just dropped never landed, so the next show may read again.
  if (inFlight) lastRead = null;
  inFlight = false;
}

/** Forget everything. For tests only. */
export function resetMeetingFeed(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
  users = 0;
  epoch += 1;
  lastRead = null;
  failures = 0;
  inFlight = false;
  clock = systemNow;
  useMeetingFeed.setState(initial(), true);
}

/**
 * The first meeting that has not ended, for the Work "Next" block and Watt, from
 * `wall2_meet_next`. One shared read for every user: on a visible mount when the last read is a minute old, and every 5
 * minutes while at least one is mounted and visible; a failed read is retried on the next tick, mount or show (backing off 30, 60, then 120 seconds). Each user's time ticks every 30 seconds
 * (and after each read) from its own `now`. Not set up, a failed first read or no meeting gives
 * undefined, so the block hides. A later failed read keeps the last list and marks it stale, as
 * does a reply the feed itself marks `stale` (an account was unavailable).
 */
export function useNextMeeting(now: () => number = systemNow): NextMeetingState {
  const visible = useVisible();
  const feed = useMeetingFeed();
  const [t, setT] = useState(now);
  const nowRef = useRef(now);
  nowRef.current = now;

  useEffect(() => {
    if (!visible) return;
    join(nowRef.current);
    return leave;
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    // Shown again: the clock is current at once, not up to a tick old.
    setT(now());
    const tick = setInterval(() => {
      setT(now());
      retryIfFailed();
    }, TICK_MS);
    return () => clearInterval(tick);
  }, [visible, now]);

  // A read landing moves this user's clock too.
  useEffect(() => {
    setT(now());
  }, [feed.reads, now]);

  const { meetings, feedStale, failed, asOf, noCalendar } = feed;
  return { meeting: nextMeeting(meetings, t), now: t, stale: feedStale || failed, asOf, unavailable: noCalendar || (failed && asOf === null) };
}

/**
 * The Tools drawer's Retry for Calendar: one read now, outside the 5 minute poll (none is started
 * while one runs). Settles when a read lands (a read that was running counts).
 */
export function refreshMeetingFeed(): Promise<void> {
  const before = useMeetingFeed.getState().reads;
  if (!inFlight) read();
  return new Promise((resolve) => {
    const stop = useMeetingFeed.subscribe((s) => {
      if (s.reads === before) return;
      stop();
      resolve();
    });
  });
}
