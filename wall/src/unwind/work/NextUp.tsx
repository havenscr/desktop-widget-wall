import { useEffect, useState } from 'react';
import { IconBroadcast, IconVideo } from '@tabler/icons-react';
import { useAgents } from '../../agents/useAgents';
import { useSnoozed } from '../../agents/snooze';
import { invoke } from '../../bridge/tauri';
import { useFocusStore } from '../../focus/store';
import { drawnPeople, initials, NO_JOIN_LINK_LABEL } from '../../meet/heroModel';
import { countdownText } from '../../meet/model';
import { useMeetingFeed, useNextMeeting } from '../../work/useNextMeeting';
import { usePlaceStore } from '../../state/places';
import { FitTitle } from '../../ui/FitTitle';
import { tip } from '../../ui/HoverTip';
import { reviewNow } from '../../ui/reviewClock';
import { useWorkLayerStore } from './layerStore';
import { durationText, focusToday, meetingsLeft, waitingCount } from './stats';
import { LAYER_FADE_OUT_MS } from './UnwindTimeline';

/** The Next up line: the meeting and its start time, shown in full. */
function nextUpTitle(meeting: { title: string; start: string } | null | undefined): string {
  return meeting ? `${meeting.title} at ${clock(Date.parse(meeting.start))}` : 'Nothing booked';
}

/** "9:00 AM" for the quiet line. */
function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function Body() {
  const next = useNextMeeting(reviewNow);
  const meetings = useMeetingFeed((s) => s.meetings);
  const sessions = useFocusStore((s) => s.sessions);
  const agents = useAgents();
  const snoozed = useSnoozed(agents.summary);
  const { meeting, now } = next;
  const setActive = usePlaceStore((s) => s.setActive);
  const focus = durationText(focusToday(sessions, now));
  const left = meetingsLeft(meetings, now, meeting);
  const waiting = waitingCount(agents.summary, snoozed.ids);
  const stats = `${focus} focus · ${left} ${left === 1 ? 'meeting' : 'meetings'} · ${waiting} waiting`;
  const line = nextUpTitle(meeting);
  const people = drawnPeople(meeting?.details);
  const circles = people.slice(0, 3);
  const canJoin = !!meeting?.canJoin;
  return (
    <>
      <div className="u-nu-count">
        <span className="u-nu-cap">{meeting && Date.parse(meeting.start) <= now ? 'NOW' : 'NEXT UP'}</span>
        <span className={`u-nu-big${meeting ? '' : ' quiet'}`}>{meeting ? countdownText(meeting, now) : next.unavailable ? 'Calendar not available' : 'No meetings ahead'}</span>
      </div>
      <div className="u-nu-rule" aria-hidden="true" />
      <div className="u-nu-info">
        <div className="u-nu-l1">
          <FitTitle top={18} firstLines={2} maxLines={2} fade lh={1.1} className="u-nu-title" {...tip(line)}>
            {line}
          </FitTitle>
          {circles.length > 0 ? (
            <span className="u-nu-people" aria-hidden="true">
              {circles.map((p, i) => (
                <span key={`${p.name}-${i}`} className="u-nu-av">
                  {initials(p.name)}
                </span>
              ))}
            </span>
          ) : null}
        </div>
        <div className="u-nu-l2">{stats}</div>
      </div>
      {/* The tip sits on a wrapper: a disabled button never gets the pointer events a tip needs. */}
      <span className="u-nu-tipwrap" {...tip(canJoin ? 'Join the next meeting.' : meeting ? 'This meeting has no join link.' : 'There is no meeting to join.')}>
        <button
          type="button"
          className="u-nu-btn join"
          disabled={!canJoin}
          onClick={() => {
            if (meeting && canJoin) void invoke('wall2_meet_join', { key: meeting.key }).catch(() => undefined);
          }}
        >
          <IconVideo size={22} aria-hidden="true" />
          {meeting && !canJoin ? NO_JOIN_LINK_LABEL : 'Join'}
        </button>
      </span>
      <button type="button" className="u-nu-btn air" {...tip('Go to On Air.')} onClick={() => setActive('onair')}>
        <IconBroadcast size={22} aria-hidden="true" />
        Go On Air
      </button>
    </>
  );
}

/**
 * The wide "Countdown first" band of the work layer (Watch and Listen): the big countdown on the left, the meeting and
 * one quiet line of stats beside it, Join and Go On Air on the right. It fades with the layer and is `inert` while
 * hidden. Its reads (meetings, focus, agents) run only while it shows and for the fade out.
 */
export function NextUp({ tab }: { tab: 'watch' | 'listen' }) {
  const shown = useWorkLayerStore((s) => s.shown);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (shown) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    const id = setTimeout(() => setMounted(false), LAYER_FADE_OUT_MS);
    return () => clearTimeout(id);
  }, [shown, mounted]);
  return (
    <section className={`u-nu ${tab}`} data-shown={shown ? '' : undefined} inert={!shown} aria-label="Next up" data-testid="u-nu" style={{ ['--u-work-out' as string]: `${LAYER_FADE_OUT_MS}ms` }}>
      {mounted ? <Body /> : null}
    </section>
  );
}
