import { IconVideo } from '@tabler/icons-react';
import { tip } from '../ui/HoverTip';
import { useToolsStore } from '../tools/store';
import { leaveIsFor, leaveWords, nextHeading, relationLine } from './heroModel';
import { daysAhead, dayWord, whenText } from './todayModel';
import { clockText, joinIsUrgent, laterEmpty, occurrenceId, timeRange, type Meeting, type MeetAccount } from './model';
import type { LeaveSignal } from '../signals/model';

/** Later one-liners under the next meeting. */
export const LATER_LINES = 2;

/** The meeting after the hero, with the Leave line or Join, and what comes after it. */
function After({ after, rest, hero, labels, now, inCall, leave, onJoin, todayCount, todayLastEnd }: {
  after: Meeting;
  rest: Meeting[];
  hero: Meeting | undefined;
  labels: Map<string, string>;
  now: number;
  inCall: boolean;
  leave: LeaveSignal | null;
  onJoin: (key: string) => void;
  todayCount: number;
  todayLastEnd: number | null;
}) {
  const heading = nextHeading(hero, after, inCall);
  const note = relationLine(heading.relation);
  const lines = rest.slice(0, LATER_LINES);
  // What the card shows of today, so the "+N" only counts what it does not show.
  const shown = [after, ...lines].filter((x) => daysAhead(Date.parse(x.start), now) === 0).length;
  const extra = todayCount - shown;
  const leaveHere = leaveIsFor(leave, after) && leave ? leaveWords(leave.leaveAt, hero, inCall) : null;
  const urgent = joinIsUrgent(after, now);
  const startMs = Date.parse(after.start);
  const day = dayWord(startMs, now);
  return (
    <>
      <div className="row sb meet-next-hd">
        <span className="k meet-k" data-amber={heading.amber ? 'true' : undefined}>
          {heading.text}
        </span>
        <span className="meet-xxs">{todayCount > 0 ? `${todayCount} more today` : 'Nothing more today'}</span>
      </div>
      <div className="meet-next-title" data-long={after.title.length > 40 ? 'true' : undefined} {...tip(after.title)}>
        {after.title}
      </div>
      <div className="meet-next-when">
        {day ? `${day} ` : ''}
        {timeRange(after)} · {labels.get(after.accountId) ?? ''}
      </div>
      {/* One row: the leave time when the leave signal is for this meeting, otherwise Join (with the amber line when it applies). */}
      {(leaveHere || after.canJoin) && (
        <div className="meet-next-act">
          {leaveHere ? (
            <span className={`meet-next-note ${leaveHere.amber ? 'amber' : 'cyan'}`} {...tip('Time to set off, from the travel block in the calendar')}>
              {leaveHere.text}
            </span>
          ) : (
            <>
              <button type="button" className={urgent ? 'meet-btn cy' : 'meet-btn'} aria-label={`Join: ${after.title}`} onClick={() => onJoin(after.key)} {...tip('Join this meeting')}>
                <IconVideo size={22} stroke={1.8} aria-hidden="true" />
                Join
              </button>
              {note && <span className="meet-next-note amber">{note}</span>}
            </>
          )}
        </div>
      )}
      {!leaveHere && !after.canJoin && note && (
        <div className="meet-next-act">
          <span className="meet-next-note amber">{note}</span>
        </div>
      )}
      {(lines.length > 0 || extra > 0) && (
        <div className="meet-after-list">
          <span className="k meet-k sm">Later</span>
          {lines.map((x) => (
            <div key={occurrenceId(x)} className="meet-later-row" {...tip(`${x.title}\n${dayWord(Date.parse(x.start), now) ? `${dayWord(Date.parse(x.start), now)} ` : ''}${timeRange(x)} · ${labels.get(x.accountId) ?? ''}`)}>
              <span className="meet-later-t">{whenText(Date.parse(x.start), now)}</span>
              <span className="meet-later-n ellipsis">{x.title}</span>
            </div>
          ))}
          {extra > 0 && todayLastEnd !== null && (
            <div className="meet-xxs meet-later-more">
              +{extra} more today, the last ends {clockText(todayLastEnd)}
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** Nothing after the hero (or nothing to say yet): the card keeps its place and says why. */
function Nothing({ accounts, lastOk, heading }: { accounts: readonly MeetAccount[]; lastOk: number | null; heading: string }) {
  const empty = laterEmpty(accounts, lastOk);
  const headline = empty.headline === 'Nothing else' ? 'Nothing else today' : empty.headline;
  return (
    <>
      <div className="row sb meet-next-hd">
        <span className="k meet-k">{heading}</span>
      </div>
      <div className="meet-next-none">
        <div className="meet-next-nothing">{headline}</div>
        {empty.notes.map((n) => (
          <div key={n} className="meet-xs meet-dimline">
            {n}
          </div>
        ))}
      </div>
    </>
  );
}

/** A card that only says why there is nothing to list, with Open Tools when no calendar can be read. */
function Note({ text, link }: { text: string; link?: boolean }) {
  const open = useToolsStore((s) => s.openDrawer);
  return (
    <>
      <div className="row sb meet-next-hd">
        <span className="k meet-k">Next</span>
      </div>
      <div className="meet-next-none">
        <div className="meet-next-nothing">
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
    </>
  );
}

export type NextCardProps =
  | { kind: 'after'; hero: Meeting | undefined; later: Meeting[]; todayCount: number; todayLastEnd: number | null; labels: Map<string, string>; now: number; inCall: boolean; leave: LeaveSignal | null; onJoin: (key: string) => void; accounts: readonly MeetAccount[]; lastOk: number | null }
  | { kind: 'nothing'; accounts: readonly MeetAccount[]; lastOk: number | null; heading?: string }
  | { kind: 'note'; text: string; link?: boolean };

/** The upper right card: the meeting after the hero, and the two after that. It keeps its place in every state. */
export function NextCard(p: NextCardProps) {
  return (
    <section className="panel meet-later" aria-label="Later meetings">
      {p.kind === 'note' ? (
        <Note text={p.text} link={p.link} />
      ) : p.kind === 'nothing' ? (
        <Nothing accounts={p.accounts} lastOk={p.lastOk} heading={p.heading ?? 'Next'} />
      ) : p.later.length === 0 ? (
        <Nothing accounts={p.accounts} lastOk={p.lastOk} heading={nextHeading(p.hero, undefined, p.inCall).text} />
      ) : (
        <After after={p.later[0]} rest={p.later.slice(1)} hero={p.hero} labels={p.labels} now={p.now} inCall={p.inCall} leave={p.leave} onJoin={p.onJoin} todayCount={p.todayCount} todayLastEnd={p.todayLastEnd} />
      )}
    </section>
  );
}
