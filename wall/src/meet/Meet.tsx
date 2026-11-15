import { formatClock } from '../clock/format';
import { useSignalStore } from '../signals/store';
import { troubleLine } from '../tools/trouble';
import { tip } from '../ui/HoverTip';
import { Capture } from './Capture';
import { Hero } from './Hero';
import { Island } from './Island';
import { NextCard, type NextCardProps } from './NextCard';
import {
  calendarNotAvailable,
  clockText,
  laterMeetings,
  nextMeeting,
  timeRange,
  visibleMeetings,
  type Meeting,
} from './model';
import { TroubleLine } from './parts';
import { useMeetStore } from './meetStore';
import { useChecklist } from './useChecklist';
import { useMeet, type MeetState } from './useMeet';

/** The most meetings the day lists in the Next card's "+N more" count; the card itself shows the next one and two more. */
export const LATER_MAX = 14;

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
      {/* The Next card beside this carries the one Open Tools link. */}
      {trouble && <TroubleLine text={trouble} plain />}
      {m.notice && <div className="meet-xs meet-notice">{m.notice}</div>}
    </div>
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
    </div>
  );
}

function Layout({ hero, next, island, title }: { hero: React.ReactNode; next: NextCardProps; island: React.ReactNode; title?: string }) {
  return (
    <section className="work meet" data-place="meet" aria-label="Meet">
      <div className="meet-body">
        {hero}
        {island}
        <NextCard {...next} />
        <Capture title={title} />
      </div>
    </section>
  );
}

/**
 * The Meet tab: the next or running meeting as the hero at the left, an island of what the wall knows about it in the
 * centre, the meeting after it at the upper right and Capture under it. The frame clock is hidden here; the hero
 * draws the time. Every state keeps its words and fills its place.
 */
export function Meet() {
  const m = useMeet();
  const call = useSignalStore((s) => s.call);
  const leave = useSignalStore((s) => s.leave);
  const marks = useMeetStore((s) => s.marks);
  const { read, reload } = useChecklist();
  const island = (meeting: Meeting | undefined, details: Meeting['details']) => (
    <Island key={meeting?.key ?? 'none'} details={details} checklist={read} reload={reload} meetingKey={meeting?.key ?? 'none'} marks={marks} />
  );

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

  if (message) {
    return (
      <Layout
        hero={
          <HeroNote label="Meet" headline={message} lines={[hint]}>
            {m.status === 'error' && (
              <button type="button" className="meet-btn cy meet-retry" onClick={m.refresh} {...tip('Read the calendar again')}>
                Try again
              </button>
            )}
          </HeroNote>
        }
        island={island(undefined, null)}
        next={m.status === 'loading' ? { kind: 'note', text: 'Calendar not read yet.' } : { kind: 'note', text: 'No calendar can be read.', link: true }}
      />
    );
  }

  const accounts = m.data?.accounts ?? [];
  const labels = new Map(accounts.map((a) => [a.id, a.label]));
  const none = calendarNotAvailable(accounts);
  // When no account can be read, the last known meeting stays up, dimmed and marked "as of"; the headline only when there is none.
  const lastNext = none && m.lastKnown ? nextMeeting(m.lastKnown.meetings, m.now) : undefined;
  const empty = none ? !lastNext : !nextMeeting(visibleMeetings(m.data), m.now);

  if (none && empty) {
    return <Layout hero={<UnavailableHero m={m} />} island={island(undefined, null)} next={{ kind: 'note', text: 'No calendar can be read.', link: true }} />;
  }
  if (none && m.lastKnown && lastNext) {
    const later = laterMeetings(visibleMeetings(m.data), m.now).slice(0, LATER_MAX);
    return (
      <Layout
        hero={<StaleHero m={m} meeting={lastNext} label={labels.get(lastNext.accountId) ?? ''} at={m.lastKnown.at} />}
        island={island(lastNext, null)}
        next={{ kind: 'after', hero: lastNext, later, labels, now: m.now, inCall: false, leave: null, onJoin: m.join, accounts, lastOk: m.lastOk }}
        title={lastNext.title}
      />
    );
  }
  if (empty) {
    return <Layout hero={<EmptyHero m={m} />} island={island(undefined, null)} next={{ kind: 'nothing', accounts, lastOk: m.lastOk }} />;
  }
  const hero = nextMeeting(visibleMeetings(m.data), m.now) as Meeting;
  const later = laterMeetings(visibleMeetings(m.data), m.now).slice(0, LATER_MAX);
  return (
    <Layout
      hero={<Hero m={m} meeting={hero} label={labels.get(hero.accountId) ?? ''} />}
      island={island(hero, hero.details)}
      next={{ kind: 'after', hero, later, labels, now: m.now, inCall: call !== null, leave, onJoin: m.join, accounts, lastOk: m.lastOk }}
      title={hero.title}
    />
  );
}
