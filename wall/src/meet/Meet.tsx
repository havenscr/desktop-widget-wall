import { IconVideo } from '@tabler/icons-react';
import { useToolsStore } from '../tools/store';
import { troubleLine } from '../tools/trouble';
import {
  calendarNotAvailable,
  clockText,
  countdownText,
  isSoon,
  joinIsUrgent,
  laterEmpty,
  laterMeetings,
  mayBeOutOfDate,
  nextMeeting,
  timeRange,
  visibleMeetings,
  type Meeting,
} from './model';
import { useMeet, type MeetState } from './useMeet';

/** Left edge of the Meet body in stage pixels: the Work tab's first panel (`.focus`), right of the clock. */
export const MEET_LEFT_PX = 482;

/** The most meetings Later lists; the rest are a count in its header. */
export const LATER_MAX = 14;

/** Filled only for a meeting that is live or starts within 15 minutes; every other Join is quiet and outlined. */
function Join({ meeting, big, now, onJoin }: { meeting: Meeting; big?: boolean; now: number; onJoin: (key: string) => void }) {
  const urgent = joinIsUrgent(meeting, now);
  const size = big ? 'meet-join-big' : 'meet-join';
  return (
    <button
      type="button"
      className={urgent ? `btn cy ${size}` : `btn meet-quiet ${size}`}
      aria-label={`Join: ${meeting.title}`}
      onClick={() => onJoin(meeting.key)}
    >
      <IconVideo size={big ? 24 : 20} aria-hidden="true" />
      Join
    </button>
  );
}

/** The one amber line when a calendar account needs attention: its click opens Tools at Accounts. */
function TroubleLine({ text }: { text: string }) {
  const open = useToolsStore((s) => s.openDrawer);
  return (
    <div className="meet-trouble">
      {text}{' '}
      <button type="button" className="meet-trouble-link" onClick={() => open('accounts')}>
        Open Tools
      </button>
    </div>
  );
}

function NextPanel({ m, labels, asOf }: { m: MeetState; labels: Map<string, string>; asOf?: { meetings: Meeting[]; at: number } }) {
  const next = asOf ? nextMeeting(asOf.meetings, m.now) : nextMeeting(visibleMeetings(m.data), m.now);
  const soon = !asOf && isSoon(next, m.now);
  const trouble = troubleLine(m.data?.accounts ?? []);
  const outOfDate = !asOf && mayBeOutOfDate(m.data?.accounts ?? []);
  return (
    <section className={asOf ? 'panel meet-next dimmed' : 'panel meet-next'} aria-label="Next meeting">
      <span className="k">Next</span>
      {next ? (
        <>
          <div className="meet-title">{next.title}</div>
          <div className="s">
            {timeRange(next)} · {labels.get(next.accountId) ?? ''}
          </div>
          {!asOf && <div className={`meet-count${soon ? ' soon' : ''}`}>{countdownText(next, m.now)}</div>}
          {trouble ? <TroubleLine text={trouble} /> : outOfDate && <div className="xs meet-stale">may be out of date</div>}
          {asOf && <div className="xs meet-stale">as of {clockText(asOf.at)}</div>}
          {!asOf && next.canJoin && <Join meeting={next} big now={m.now} onJoin={m.join} />}
          {!asOf && m.notice && <div className="xs meet-notice">{m.notice}</div>}
        </>
      ) : (
        <div className="meet-count">{countdownText(undefined, m.now)}</div>
      )}
    </section>
  );
}

function LaterPanel({ m, labels }: { m: MeetState; labels: Map<string, string> }) {
  const all = laterMeetings(visibleMeetings(m.data), m.now);
  const later = all.slice(0, LATER_MAX);
  const empty = laterEmpty(m.data?.accounts ?? [], m.lastOk);
  return (
    <section className="panel meet-later" aria-label="Later meetings">
      <div className="row sb">
        <span className="k">Later</span>
        {all.length > later.length && <span className="xs">{all.length - later.length} more later today</span>}
      </div>
      {later.length === 0 ? (
        <div className="meet-later-empty">
          <div className="s">{empty.headline}</div>
          {empty.notes.map((n) => (
            <div key={n} className="xs meet-dimline">
              {n}
            </div>
          ))}
        </div>
      ) : (
        <ul className="meet-list">
          {later.map((x) => (
            <li key={x.key} className="meet-row" title={`${x.title}\n${timeRange(x)} · ${labels.get(x.accountId) ?? ''}`}>
              <div className="meet-row-text">
                <div className="b6 ellipsis meet-name">{x.title}</div>
                <div className="s ellipsis meet-when">
                  {timeRange(x)} · {labels.get(x.accountId) ?? ''}
                </div>
              </div>
              {x.canJoin && <Join meeting={x} now={m.now} onJoin={m.join} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A Later card that only states why the list is empty, so the upper right is filled in every state. */
function LaterNote({ text, link }: { text: string; link?: boolean }) {
  const open = useToolsStore((s) => s.openDrawer);
  return (
    <section className="panel meet-later" aria-label="Later meetings">
      <span className="k">Later</span>
      <div className="meet-later-empty">
        <div className="s">
          {text}
          {link && (
            <>
              {' '}
              <button type="button" className="meet-trouble-link" onClick={() => open('accounts')}>
                Open Tools
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/** No calendar can be read and there is no earlier meeting to show: the headline, the last good read and the way to Tools. */
function UnavailablePanel({ m }: { m: MeetState }) {
  const trouble = troubleLine(m.data?.accounts ?? []);
  return (
    <section className="panel meet-empty" aria-label="Calendar not available">
      <div className="meet-headline-block">
        <div className="meet-headline">Calendar not available</div>
        <div className="xs">{m.lastOk !== null ? `Last good read at ${clockText(m.lastOk)}` : 'No good read yet'}</div>
      </div>
      {trouble && <TroubleLine text={trouble} />}
      {m.notice && <div className="xs meet-notice">{m.notice}</div>}
    </section>
  );
}

/** Nothing scheduled: a small card as wide as its words, and which account could not be read when one could not. */
function EmptyPanel({ m }: { m: MeetState }) {
  const accounts = m.data?.accounts ?? [];
  const checking = accounts.some((a) => a.state === 'checking');
  const problem = accounts.filter((a) => a.state !== 'ok' && a.state !== 'checking');
  const headline = checking ? 'Checking calendars' : 'Nothing scheduled in the next 24 hours';
  const sub = problem.length > 0 ? `${problem.map((a) => a.label).join(' and ')} could not be read` : m.lastOk !== null ? `Last checked at ${clockText(m.lastOk)}` : null;
  return (
    <section className="panel meet-empty" aria-label="Nothing scheduled">
      <div className="meet-count">{headline}</div>
      {sub && <div className="s">{sub}</div>}
      {troubleLine(accounts) && <TroubleLine text={troubleLine(accounts) as string} />}
    </section>
  );
}

/** The Meet tab, laid out right of the clock like Work: next meeting and Join on the left, the rest of the day in the middle, accounts on the right. */
export function Meet() {
  const m = useMeet();
  let message: string | null = null;
  let hint: string | null = null;
  if (m.status === 'unconfigured') {
    message = 'Calendar is not connected yet.';
    hint = 'Setup steps are in the Wall 2 README, section Meet.';
  } else if (m.status === 'invalid') {
    message = 'Not set up';
    hint = 'meet.json is not valid. See the Meet section of the Wall 2 README.';
  } else if (m.status === 'loading') {
    message = 'Loading meetings';
  } else if (m.status === 'error' && !m.data) {
    message = 'Calendar unavailable';
  }

  if (message) {
    return (
      <section className="work meet" data-place="meet" aria-label="Meet">
        <div className="meet-body" style={{ left: MEET_LEFT_PX }}>
          <section className="panel meet-next" aria-label="Next meeting">
            <span className="k">Meet</span>
            <div className="meet-count">{message}</div>
            {hint && <div className="xs meet-dimline">{hint}</div>}
            {m.status === 'error' && (
              <button type="button" className="btn cy meet-retry" onClick={m.refresh}>
                Try again
              </button>
            )}
          </section>
          {m.status === 'loading' ? <LaterNote text="Calendar not read yet." /> : <LaterNote text="No calendar can be read." link />}
        </div>
      </section>
    );
  }

  const labels = new Map((m.data?.accounts ?? []).map((a) => [a.id, a.label]));
  const none = calendarNotAvailable(m.data?.accounts ?? []);
  // When no account can be read, the last known meeting stays up, dimmed and marked "as of"; the headline only when there is none.
  const lastNext = none && m.lastKnown ? nextMeeting(m.lastKnown.meetings, m.now) : undefined;
  const empty = none ? !lastNext : !nextMeeting(visibleMeetings(m.data), m.now);
  return (
    <section className="work meet" data-place="meet" aria-label="Meet">
      <div className="meet-body" style={{ left: MEET_LEFT_PX }}>
        {none && empty ? (
          <>
            <UnavailablePanel m={m} />
            <LaterNote text="No calendar can be read." link />
          </>
        ) : none && m.lastKnown ? (
          <>
            <NextPanel m={m} labels={labels} asOf={m.lastKnown} />
            <LaterPanel m={m} labels={labels} />
          </>
        ) : empty ? (
          <>
            <EmptyPanel m={m} />
            <LaterPanel m={m} labels={labels} />
          </>
        ) : (
          <>
            <NextPanel m={m} labels={labels} />
            <LaterPanel m={m} labels={labels} />
          </>
        )}
      </div>
    </section>
  );
}
