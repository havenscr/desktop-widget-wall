import { IconVideo } from '@tabler/icons-react';
import { updatedText } from '../tasks/model';
import {
  countdownText,
  isSoon,
  laterMeetings,
  needsSignIn,
  nextMeeting,
  statusWord,
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
      <IconVideo size={big ? 40 : 28} aria-hidden="true" />
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

function AccountRow({ a, m }: { a: MeetAccount; m: MeetState }) {
  const waiting = m.signingIn === a.id;
  return (
    <li className="meet-account">
      <div className="meet-account-text">
        <div className="b6 ellipsis">{a.label}</div>
        <div className="xs">{waiting ? 'Finish in your browser' : statusWord(a.state)}</div>
      </div>
      {waiting ? (
        <button type="button" className="btn" onClick={m.cancelSignIn}>
          Cancel
        </button>
      ) : needsSignIn(a.state) ? (
        <button type="button" className="btn cy" disabled={m.signingIn !== null} onClick={() => m.signIn(a.id)}>
          Sign in
        </button>
      ) : (
        <button type="button" className="btn meet-out" disabled={m.signingIn !== null} onClick={() => m.signOut(a.id)}>
          Sign out
        </button>
      )}
    </li>
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
  return (
    <section className="work meet" data-place="meet" aria-label="Meet">
      <div className="meet-body" style={{ left: MEET_LEFT_PX }}>
        <NextPanel m={m} labels={labels} />
        <LaterPanel m={m} labels={labels} />
        <AccountsPanel m={m} />
      </div>
    </section>
  );
}
