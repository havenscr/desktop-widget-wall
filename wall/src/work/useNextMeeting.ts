import { useEffect, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { nextMeeting, REFRESH_MS, TICK_MS, type Meeting, type MeetData } from '../meet/model';
import { useVisible } from '../ui/useVisible';

const systemNow = () => Date.now();

/**
 * The first meeting that has not ended, for the Work "Next" block, from `wall2_meet_next`:
 * read on mount and every 5 minutes while visible; the time ticks every 30 seconds from the
 * last list. Not set up, a failed first read or no meeting gives undefined, so the block
 * hides. A later failed read keeps the last list.
 */
export function useNextMeeting(now: () => number = systemNow): { meeting: Meeting | undefined; now: number } {
  const visible = useVisible();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [t, setT] = useState(now);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    const read = () => {
      invoke<MeetData>('wall2_meet_next')
        .then((d) => {
          if (live) setMeetings(Array.isArray(d?.meetings) ? d.meetings : []);
        })
        .catch((e) => {
          const text = e instanceof Error ? e.message : String(e);
          if (live && (text === 'not-configured' || text === 'invalid-config')) setMeetings([]);
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

  return { meeting: nextMeeting(meetings, t), now: t };
}
