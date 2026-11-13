import { useEffect, useState } from 'react';
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

/**
 * The first meeting that has not ended, for the Work "Next" block, from `wall2_meet_next`:
 * read on mount and every 5 minutes while visible; the time ticks every 30 seconds from the
 * last list. Not set up, a failed first read or no meeting gives undefined, so the block
 * hides. A later failed read keeps the last list and marks it stale, as does a reply the
 * feed itself marks `stale` (an account was unavailable).
 */
export function useNextMeeting(now: () => number = systemNow): NextMeetingState {
  const visible = useVisible();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [feedStale, setFeedStale] = useState(false);
  const [failed, setFailed] = useState(false);
  const [asOf, setAsOf] = useState<number | null>(null);
  const [noCalendar, setNoCalendar] = useState(false);
  const [t, setT] = useState(now);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    const read = () => {
      invoke<MeetData>('wall2_meet_next')
        .then((d) => {
          if (!live) return;
          const partial = d?.stale === true;
          setMeetings(Array.isArray(d?.meetings) ? d.meetings : []);
          setFeedStale(partial);
          setFailed(false);
          setNoCalendar(calendarNotAvailable(d?.accounts ?? []));
          if (!partial) setAsOf(now());
        })
        .catch((e) => {
          if (!live) return;
          const text = e instanceof Error ? e.message : String(e);
          if (text === 'not-configured' || text === 'invalid-config') {
            setMeetings([]);
            setFeedStale(false);
            setFailed(false);
            setAsOf(null);
            setNoCalendar(false);
          } else {
            setFailed(true);
          }
        })
        .finally(() => {
          if (live) setT(now());
        });
    };
    read();
    const poll = setInterval(read, REFRESH_MS);
    const tick = setInterval(() => setT(now()), TICK_MS);
    return () => {
      live = false;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [visible, now]);

  return { meeting: nextMeeting(meetings, t), now: t, stale: feedStale || failed, asOf, unavailable: noCalendar || (failed && asOf === null) };
}
