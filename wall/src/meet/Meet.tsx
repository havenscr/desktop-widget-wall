import { useEffect } from 'react';
import { formatClock } from '../clock/format';
import { useDayFeed } from '../ribbon/useDayEvents';
import { usePlaceStore } from '../state/places';
import { useSignalStore } from '../signals/store';
import { troubleLine } from '../tools/trouble';
import { tip } from '../ui/HoverTip';
import { useVisible } from '../ui/useVisible';
import { Hero } from './Hero';
import { Island } from './Island';
import { NextCard, type NextCardProps } from './NextCard';
import { pickCallMeeting, refreshCallMeeting } from './callMeeting';
import {
  calendarNotAvailable,
  clockText,
  nextMeeting,
  occurrenceId,
  timeRange,
  visibleMeetings,
  type Meeting,
} from './model';
import { HeroChip, TroubleLine } from './parts';
import { useMeetStore } from './meetStore';
import { latestEnd, meetingsAfter, todayRest } from './todayModel';
import { useChecklist } from './useChecklist';
import { useMeet, type MeetState } from './useMeet';

/** A hero that only says one thing (not set up, loading, nothing scheduled): a label, a headline and a line or two. */
function HeroNote({ label, headline, lines, children }: { label?: string; headline: string; lines?: (string | null)[]; children?: React.ReactNode }) {
  return (
    <div className="meet-hero meet-hero-note" aria-label="Next meeting">
      {label && <span className="k meet-k">{label}</span>}
      <div className="meet-count">{headline}</div>
      {(lines ?? []).filter((l): l is string => !!l).map((l) => (
        <div key={l} className="meet-xs meet-dimline">
          {l}
        </div>
      ))}
      {children}
      <HeroChip />
    </div>
  );
}

/** No calendar can be read and there is no earlier meeting to show: the headline, the last good read and the way to Tools. */
function UnavailableHero({ m }: { m: MeetState }) {
  const trouble = troubleLine(m.data?.accounts ?? []);
  return (
    <div className="meet-hero meet-hero-note" aria-label="Calendar not available">
      <div className="meet-headline-block">
        <div className="meet-headline">Calendar not available</div>
        <div className="meet-xs meet-dimline">{m.lastOk !== null ? `Last good read at ${clockText(m.lastOk)}` : 'No good read yet'}</div>
      </div>
      {trouble && <TroubleLine text={trouble} />}
      {m.notice && <div className="meet-xs meet-notice">{m.notice}</div>}
      <ReadAgain m={m} />
      <HeroChip />
    </div>
  );
}

/** Reads the calendar again now, for a state where nothing can be shown fresh. */
function ReadAgain({ m }: { m: MeetState }) {
  return (
    <button type="button" className="meet-btn meet-retry" onClick={m.refresh} {...tip('Read the calendar again now')}>
      Read again
    </button>
  );
}

/** Nothing scheduled: what the calendar says, and which account could not be read when one could not. */
function EmptyHero({ m }: { m: MeetState }) {
  const accounts = m.data?.accounts ?? [];
  const checking = accounts.some((a) => a.state === 'checking');
  const problem = accounts.filter((a) => a.state !== 'ok' && a.state !== 'checking');
  const headline = checking ? 'Checking calendars' : 'Nothing scheduled in the next 24 hours';
  const sub = problem.length > 0 ? `${problem.map((a) => a.label).join(' and ')} could not be read` : m.lastOk !== null ? `Last checked at ${clockText(m.lastOk)}` : null;
  const trouble = troubleLine(accounts);
  return (
    <HeroNote headline={headline} lines={[sub]}>
      {trouble && <TroubleLine text={trouble} />}
    </HeroNote>
  );
}

/** The last known meeting when no account can be read: dimmed, marked "as of", no countdown, no keys. */
function StaleHero({ m, meeting, label, at }: { m: MeetState; meeting: Meeting; label: string; at: number }) {
  const trouble = troubleLine(m.data?.accounts ?? []);
  const clock = formatClock(new Date(m.now));
  return (
    <div className="meet-hero dimmed" aria-label="Next meeting" data-tone="stale">
      <div className="meet-hero-st">
        <span className="meet-st" data-tone="stale">
          <i aria-hidden="true" />
          Last known meeting
        </span>
        <span className="meet-time">
          {clock.time}
          <small>{clock.meridiem}</small>
        </span>
      </div>
      <div className="meet-hero-title" data-long={meeting.title.length > 50 ? 'true' : undefined} {...tip(meeting.title)}>
        {meeting.title}
      </div>
      <div className="meet-hero-below">
        <div className="meet-by ellipsis">
          {timeRange(meeting)} · {label}
        </div>
        <div className="meet-xs meet-stale">as of {clockText(at)}</div>
        {trouble && <TroubleLine text={trouble} />}
      </div>
      <div className="meet-hero-last">
        <ReadAgain m={m} />
        <HeroChip />
      </div>
    </div>
  );
}

function Layout({ hero, next, island }: { hero: React.ReactNode; next: NextCardProps; island: React.ReactNode }) {
  return (
    <section className="work meet" data-place="meet" aria-label="Meet">
      <div className="meet-body">
        {hero}
        {island}
        <NextCard {...next} />
      </div>
    </section>
  );
}

/** What a state of the calendar puts on the screen, before a running call takes the hero. */
interface Parts {
  hero: React.ReactNode;
  next: NextCardProps;
  /** The meeting the island is about, if any. */
  meeting?: Meeting;
  /** Details the island may show (none for a dimmed, last known meeting). */
  details?: Meeting['details'];
  /** True when the calendar is in its ordinary state (a meeting is next), so a call's Next card can be rebuilt. */
  ordinary?: boolean;
}

/**
 * The Meet tab: the next or running meeting as the hero at the left, an island of what the wall knows about it in the
 * centre, the meeting after it at the right. The frame clock is hidden here; the hero
 * draws the time. Every state keeps its words and fills its place. While a call is sensed the hero is the call: the
 * meeting that was current when it started, kept until it ends (or a plain call when there is none), whatever the
 * calendar says.
 */
export function Meet() {
  const m = useMeet();
  const call = useSignalStore((s) => s.call);
  const leave = useSignalStore((s) => s.leave);
  const callId = useMeetStore((s) => s.callId);
  const stored = useMeetStore((s) => s.anchor);
  const setAnchor = useMeetStore((s) => s.setAnchor);
  const visible = useVisible();
  const onMeet = usePlaceStore((s) => s.active === 'meet');
  const day = useDayFeed(visible && onMeet);
  const { read, reloadSoon } = useChecklist();

  const accounts = m.data?.accounts ?? [];
  const labels = new Map(accounts.map((a) => [a.id, a.label]));
  const list = visibleMeetings(m.data);

  // The meeting a running call belongs to: kept for the call's whole life, found again (same occurrence) in each new read.
  const cid = call ? (callId ?? call.since) : null;
  const kept = call && stored && stored.callId === cid ? stored.meeting : undefined;
  const callMeeting = cid === null ? undefined : kept ? refreshCallMeeting(kept, list) : pickCallMeeting(list, cid);
  useEffect(() => {
    if (cid !== null && callMeeting && callMeeting !== kept) setAnchor(cid, callMeeting);
  }, [cid, callMeeting, kept, setAnchor]);

  /** The Next card's words about what follows `hero`: today's count and latest end come from the day feed (the larger of it and the read). */
  const after = (hero: Meeting | undefined, inCall: boolean, leaveSignal: typeof leave): NextCardProps => {
    const later = meetingsAfter(list, hero, m.now);
    const fromDay = todayRest(day.at !== null ? day.events : [], hero, m.now);
    const fromRead = todayRest(later, hero, m.now);
    const rest = fromDay.length >= fromRead.length ? fromDay : fromRead;
    return { kind: 'after', hero, later, todayCount: rest.length, todayLastEnd: latestEnd(rest), labels, now: m.now, inCall, leave: leaveSignal, onJoin: m.join, accounts, lastOk: m.lastOk };
  };

  let message: string | null = null;
  let hint: string | null = null;
  if (m.status === 'unconfigured') {
    message = 'Calendar is not connected yet.';
    hint = 'Setup steps are in the Ridgeline README, section Meet.';
  } else if (m.status === 'invalid') {
    message = 'Not set up';
    hint = 'meet.json is not valid. See the Meet section of the Ridgeline README.';
  } else if (m.status === 'loading') {
    message = 'Loading meetings';
  } else if (m.status === 'error' && !m.data) {
    message = 'Calendar unavailable';
  }

  const none = calendarNotAvailable(accounts);
  // When no account can be read, the last known meeting stays up, dimmed and marked "as of"; the headline only when there is none.
  const lastNext = none && m.lastKnown ? nextMeeting(m.lastKnown.meetings, m.now) : undefined;
  const empty = none ? !lastNext : !nextMeeting(list, m.now);

  let parts: Parts;
  if (message) {
    parts = {
      hero: (
        <HeroNote label="Meet" headline={message} lines={[hint]}>
          {m.status === 'error' && (
            <button type="button" className="meet-btn cy meet-retry" onClick={m.refresh} {...tip('Read the calendar again')}>
              Try again
            </button>
          )}
        </HeroNote>
      ),
      next: m.status === 'loading' ? { kind: 'note', text: 'Calendar not read yet.' } : { kind: 'note', text: 'No calendar can be read.', link: true },
    };
  } else if (none && empty) {
    parts = { hero: <UnavailableHero m={m} />, next: { kind: 'note', text: 'No calendar can be read.', link: true } };
  } else if (none && m.lastKnown && lastNext) {
    parts = {
      hero: <StaleHero m={m} meeting={lastNext} label={labels.get(lastNext.accountId) ?? ''} at={m.lastKnown.at} />,
      meeting: lastNext,
      next: after(lastNext, false, null),
    };
  } else if (empty) {
    parts = { hero: <EmptyHero m={m} />, next: { kind: 'nothing', accounts, lastOk: m.lastOk } };
  } else {
    const hero = nextMeeting(list, m.now) as Meeting;
    parts = {
      hero: <Hero m={m} meeting={hero} label={labels.get(hero.accountId) ?? ''} events={day.events} />,
      meeting: hero,
      details: hero.details,
      next: after(hero, false, leave),
      ordinary: true,
    };
  }
  if (call) {
    // The call is the hero, whatever the calendar says; the Next card shows what follows the call's meeting.
    parts = {
      ...parts,
      hero: <Hero m={m} meeting={callMeeting} label={callMeeting ? (labels.get(callMeeting.accountId) ?? '') : ''} events={day.events} />,
      meeting: callMeeting,
      details: callMeeting?.details,
      next: parts.ordinary || (parts.next.kind === 'after' && !none) ? after(callMeeting, true, leave) : parts.next,
    };
  }

  return (
    <Layout
      hero={parts.hero}
      island={<Island key={parts.meeting ? occurrenceId(parts.meeting) : 'none'} details={parts.details} checklist={read} reloadSoon={reloadSoon} meetingId={parts.meeting ? occurrenceId(parts.meeting) : 'none'} />}
      next={parts.next}
    />
  );
}
