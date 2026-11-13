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

function read(): void {
  const mine = epoch;
  lastRead = clock();
  inFlight = true;
  invoke<MeetData>('wall2_meet_next')
    .then((d) => {
      if (mine !== epoch) return;
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
        useMeetingFeed.setState({ meetings: [], feedStale: false, failed: false, asOf: null, noCalendar: false });
      } else {
        useMeetingFeed.setState({ failed: true });
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
  if (users === 1) {
    if (lastRead === null || clock() - lastRead >= REFRESH_MS) read();
    timer = setInterval(read, REFRESH_MS);
  }
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
  inFlight = false;
  clock = systemNow;
  useMeetingFeed.setState(initial(), true);
}

/**
 * The first meeting that has not ended, for the Work "Next" block and Watt, from
 * `wall2_meet_next`. One shared read for every user: on the first visible mount and every 5
 * minutes while at least one is mounted and visible. Each user's time ticks every 30 seconds
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
    const tick = setInterval(() => setT(now()), TICK_MS);
    return () => clearInterval(tick);
  }, [visible, now]);

  // A read landing moves this user's clock too.
  useEffect(() => {
    setT(now());
  }, [feed.reads, now]);

  const { meetings, feedStale, failed, asOf, noCalendar } = feed;
  return { meeting: nextMeeting(meetings, t), now: t, stale: feedStale || failed, asOf, unavailable: noCalendar || (failed && asOf === null) };
}
