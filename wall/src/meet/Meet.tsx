import { IconVideo } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { updatedText } from '../tasks/model';
import {
  accountWords,
  calendarNotAvailable,
  clockText,
  countdownText,
  isSoon,
  laterMeetings,
  needsSignIn,
  nextMeeting,
  reasonLine,
  timeRange,
  type MeetAccount,
  type Meeting,
} from './model';
import { useMeet, type MeetState } from './useMeet';

/** Left edge of the Meet body in stage pixels: the Work tab's first panel (`.focus`), right of the clock. */
export const MEET_LEFT_PX = 482;

function Join({ meeting, big, onJoin }: { meeting: Meeting; big?: boolean; onJoin: (key: string) => void }) {
  return (
    <button
      type="button"
      className={big ? 'btn cy meet-join-big' : 'btn cy meet-join'}
      aria-label={`Join: ${meeting.title}`}
      onClick={() => onJoin(meeting.key)}
    >
      <IconVideo size={big ? 24 : 20} aria-hidden="true" />
      Join
    </button>
  );
}

function NextPanel({ m, labels }: { m: MeetState; labels: Map<string, string> }) {
  const next = m.data ? nextMeeting(m.data.meetings, m.now) : undefined;
  const soon = isSoon(next, m.now);
  return (
    <section className="panel meet-next" aria-label="Next meeting">
      <span className="k">Next</span>
      {next ? (
        <>
          <div className="meet-title">{next.title}</div>
          <div className="s">
            {timeRange(next)} · {labels.get(next.accountId) ?? ''}
          </div>
          <div className={`meet-count${soon ? ' soon' : ''}`}>{countdownText(next, m.now)}</div>
          {next.canJoin && <Join meeting={next} big onJoin={m.join} />}
        </>
      ) : (
        <div className="meet-count">{countdownText(undefined, m.now)}</div>
      )}
    </section>
  );
}

function LaterPanel({ m, labels }: { m: MeetState; labels: Map<string, string> }) {
  const later = m.data ? laterMeetings(m.data.meetings, m.now) : [];
  return (
    <section className="panel meet-later" aria-label="Later meetings">
      <span className="k">Later</span>
      {later.length === 0 ? (
        <div className="s">Nothing else</div>
      ) : (
        <ul className="meet-list">
          {later.map((x) => (
            <li key={x.key} className="meet-row">
              <span className="meet-time">{timeRange(x)}</span>
              <span className="b6 ellipsis meet-name">{x.title}</span>
              <span className="xs meet-acct">{labels.get(x.accountId) ?? ''}</span>
              {x.canJoin && <Join meeting={x} onJoin={m.join} />}
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
  const why = !waiting && (a.state === 'unavailable' || a.state === 'needs-sign-in') ? reasonLine(a.reason) : null;
  const tried = a.state === 'unavailable' && !waiting ? m.tried[a.id] : undefined;
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
      <button type="button" className="btn cy meet-act" disabled={busy} onClick={() => m.signIn(a.id)}>
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
    <li className={a.state === 'unavailable' && !waiting ? 'meet-account unavailable' : 'meet-account'}>
      <div className="meet-account-text">
        <div className="b6 ellipsis">{a.label}</div>
        <div className="xs">{waiting ? 'Finish in your browser' : accountWords(a.state, a.reason)}</div>
        {why && <div className="xs meet-reason">{why}</div>}
        {tried !== undefined && <div className="xs meet-tried">Last try {clockText(tried)}</div>}
      </div>
      {action}
    </li>
  );
}

/** No meeting to show: one centred message instead of blank panels, and why when an account could not be read. */
function EmptyPanel({ m }: { m: MeetState }) {
  const accounts = m.data?.accounts ?? [];
  const none = calendarNotAvailable(accounts);
  const checking = accounts.some((a) => a.state === 'checking');
  const problem = accounts.filter((a) => a.state !== 'ok' && a.state !== 'checking');
  const headline = none ? 'Calendar not available' : checking ? 'Checking calendars' : 'Nothing scheduled in the next 24 hours';
  const sub =
    none || problem.length === 0
      ? m.lastOk !== null && !none
        ? `Last checked at ${clockText(m.lastOk)}`
        : null
      : `${problem.map((a) => a.label).join(' and ')} could not be read`;
  return (
    <section className="panel meet-empty" aria-label={none ? 'Calendar not available' : 'Nothing scheduled'}>
      <div className="meet-count">{headline}</div>
      {sub && <div className="s">{sub}</div>}
    </section>
  );
}

function AccountsPanel({ m }: { m: MeetState }) {
  const stale = (m.status === 'error' || m.stale) && m.lastOk !== null ? updatedText(m.lastOk, m.now) : null;
  return (
    <section className="panel meet-accounts" aria-label="Accounts">
      <div className="row sb">
        <span className="k">Accounts</span>
        {stale && <span className="xs">{stale}</span>}
      </div>
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
    message = 'Not set up';
    hint = 'Add meet.json. See the Meet section of the Wall 2 README.';
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
            {hint && <div className="s">{hint}</div>}
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
  const empty = !(m.data && nextMeeting(m.data.meetings, m.now));
  return (
    <section className="work meet" data-place="meet" aria-label="Meet">
      <div className="meet-body" style={{ left: MEET_LEFT_PX }}>
        {empty ? (
          <EmptyPanel m={m} />
        ) : (
          <>
            <NextPanel m={m} labels={labels} />
            <LaterPanel m={m} labels={labels} />
          </>
        )}
        <AccountsPanel m={m} />
      </div>
    </section>
  );
}
