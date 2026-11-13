import { IconVideo } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { updatedText } from '../tasks/model';
import {
  accountWords,
  calendarNotAvailable,
  checkAgainText,
  clockText,
  countdownText,
  isSoon,
  joinIsUrgent,
  laterEmpty,
  laterMeetings,
  mayBeOutOfDate,
  needsSignIn,
  nextMeeting,
  nextReadAt,
  reasonCode,
  reasonLine,
  timeRange,
  visibleMeetings,
  type MeetAccount,
  type Meeting,
} from './model';
import { useMeet, type MeetState } from './useMeet';

/** Left edge of the Meet body in stage pixels: the Work tab's first panel (`.focus`), right of the clock. */
export const MEET_LEFT_PX = 482;

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

function NextPanel({ m, labels, asOf }: { m: MeetState; labels: Map<string, string>; asOf?: { meetings: Meeting[]; at: number } }) {
  const next = asOf ? nextMeeting(asOf.meetings, m.now) : nextMeeting(visibleMeetings(m.data), m.now);
  const soon = !asOf && isSoon(next, m.now);
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
          {outOfDate && <div className="xs meet-stale">may be out of date</div>}
          {asOf && <div className="xs meet-stale">as of {clockText(asOf.at)}</div>}
          {!asOf && next.canJoin && <Join meeting={next} big now={m.now} onJoin={m.join} />}
        </>
      ) : (
        <div className="meet-count">{countdownText(undefined, m.now)}</div>
      )}
    </section>
  );
}

function LaterPanel({ m, labels }: { m: MeetState; labels: Map<string, string> }) {
  const later = laterMeetings(visibleMeetings(m.data), m.now);
  const empty = laterEmpty(m.data?.accounts ?? [], m.lastOk);
  return (
    <section className="panel meet-later" aria-label="Later meetings">
      <span className="k">Later</span>
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
              <span className="meet-time">{timeRange(x)}</span>
              <span className="b6 ellipsis meet-name">{x.title}</span>
              <span className="xs meet-acct">{labels.get(x.accountId) ?? ''}</span>
              {x.canJoin && <Join meeting={x} now={m.now} onJoin={m.join} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One account: its state in plain words and one action. */
function AccountRow({ a, m }: { a: MeetAccount; m: MeetState }) {
  const waiting = m.signingIn === a.id;
  const busy = m.signingIn !== null;
  const unavailable = a.state === 'unavailable' && !waiting;
  const signedOut = needsSignIn(a.state) && !waiting;
  // The face: one plain line, then when it checks next. The code and the exact last try live in the hover.
  const again = unavailable ? checkAgainText(nextReadAt(m.retryAt, m.pollAt), m.now) : null;
  const code = unavailable ? reasonCode(a.reason) : !waiting && a.state === 'needs-sign-in' ? reasonLine(a.reason) : null;
  const tried = a.state === 'unavailable' && !waiting ? m.tried[a.id] : undefined;
  const hover = [code, tried !== undefined ? `Last try ${clockText(tried)}` : null].filter(Boolean).join('\n');
  let action: ReactNode = null;
  if (waiting) {
    action = (
      <button type="button" className="btn meet-act" onClick={m.cancelSignIn}>
        Cancel
      </button>
    );
  } else if (a.state === 'unavailable') {
    action = (
      <button type="button" className="btn cy meet-act" disabled={busy} onClick={m.refresh}>
        Try again
      </button>
    );
  } else if (needsSignIn(a.state)) {
    action = (
      <button type="button" className="btn meet-quiet meet-act" disabled={busy} onClick={() => m.signIn(a.id)}>
        Sign in
      </button>
    );
  } else if (a.state === 'ok') {
    action = (
      <button type="button" className="btn meet-out meet-act" disabled={busy} onClick={() => m.signOut(a.id)}>
        Sign out
      </button>
    );
  }
  return (
    <li className={a.state === 'unavailable' && !waiting ? 'meet-account unavailable' : 'meet-account'} title={hover || undefined}>
      <div className="meet-account-text">
        <div className="b6 ellipsis">{a.label}</div>
        <div className="xs">{waiting ? 'Finish in your browser' : accountWords(a.state, a.reason)}</div>
        {again && <div className="xs meet-dimline">{again}</div>}
        {signedOut && <div className="xs meet-dimline">Meetings on this account will not show.</div>}
      </div>
      {action}
    </li>
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
    </section>
  );
}

/** The accounts card. When no calendar can be read it also says so, with the last good read, so there is no separate empty card. */
function AccountsPanel({ m, unavailable }: { m: MeetState; unavailable?: boolean }) {
  const stale = (m.status === 'error' || m.stale) && m.lastOk !== null ? updatedText(m.lastOk, m.now) : null;
  return (
    <section className="panel meet-accounts" aria-label="Accounts">
      <div className="row sb">
        <span className="k">Accounts</span>
        {stale && <span className="xs">{stale}</span>}
      </div>
      {unavailable && (
        <div className="meet-headline-block">
          <div className="meet-headline">Calendar not available</div>
          <div className="xs">{m.lastOk !== null ? `Last good read at ${clockText(m.lastOk)}` : 'No good read yet'}</div>
        </div>
      )}
      <ul className="meet-account-list">
        {(m.data?.accounts ?? []).map((a) => (
          <AccountRow key={a.id} a={a} m={m} />
        ))}
      </ul>
      {m.notice && <div className="xs meet-notice">{m.notice}</div>}
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
        {none && empty ? null : none && m.lastKnown ? (
          <NextPanel m={m} labels={labels} asOf={m.lastKnown} />
        ) : empty ? (
          <EmptyPanel m={m} />
        ) : (
          <>
            <NextPanel m={m} labels={labels} />
            <LaterPanel m={m} labels={labels} />
          </>
        )}
        <AccountsPanel m={m} unavailable={none && empty} />
      </div>
    </section>
  );
}
