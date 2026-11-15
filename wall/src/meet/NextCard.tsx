import { IconVideo } from '@tabler/icons-react';
import { tip } from '../ui/HoverTip';
import { useToolsStore } from '../tools/store';
import { leaveIsFor, nextHeading } from './heroModel';
import { clockText, joinIsUrgent, laterEmpty, timeRange, type Meeting, type MeetAccount } from './model';
import type { LeaveSignal } from '../signals/model';

/** Later one-liners under the next meeting. */
export const LATER_LINES = 2;

const END_WORDS = (m: Meeting) => `the last ends ${clockText(Date.parse(m.end))}`;

/** The one meeting after the hero, with Join or the leave time, and what comes after it. */
function After({ after, rest, hero, labels, now, inCall, leave, onJoin }: {
  after: Meeting;
  rest: Meeting[];
  hero: Meeting;
  labels: Map<string, string>;
  now: number;
  inCall: boolean;
  leave: LeaveSignal | null;
  onJoin: (key: string) => void;
}) {
  const heading = nextHeading(hero, after, inCall);
  const total = rest.length + 1;
  const lines = rest.slice(0, LATER_LINES);
  const more = rest.slice(LATER_LINES);
  const leaveHere = leaveIsFor(leave, after) ? leave : null;
  const urgent = joinIsUrgent(after, now);
  return (
    <>
      <div className="row sb meet-next-hd">
        <span className="k meet-k" data-amber={heading.amber ? 'true' : undefined}>
          {heading.text}
        </span>
        <span className="meet-xxs">{total} more today</span>
      </div>
      <div className="meet-next-title" data-long={after.title.length > 40 ? 'true' : undefined} {...tip(after.title)}>
        {after.title}
      </div>
      <div className="meet-next-when">
        {timeRange(after)} · {labels.get(after.accountId) ?? ''}
      </div>
      {(after.canJoin || leaveHere) && (
        <div className="meet-next-act">
          {after.canJoin && (
            <button type="button" className={urgent ? 'meet-btn cy' : 'meet-btn'} aria-label={`Join: ${after.title}`} onClick={() => onJoin(after.key)} {...tip('Join this meeting')}>
              <IconVideo size={22} stroke={1.8} aria-hidden="true" />
              Join
            </button>
          )}
          {heading.amber && <span className="meet-next-note amber">Starts as this one ends</span>}
          {leaveHere && (
            <span className="meet-next-note cyan" {...tip('Time to set off, from the travel block in the calendar')}>
              Leave by {clockText(leaveHere.leaveAt)}
            </span>
          )}
        </div>
      )}
      {(lines.length > 0 || more.length > 0) && (
        <div className="meet-after-list">
          <span className="k meet-k sm">Later</span>
          {lines.map((x) => (
            <div key={x.key} className="meet-later-row" {...tip(`${x.title}\n${timeRange(x)} · ${labels.get(x.accountId) ?? ''}`)}>
              <span className="meet-later-t">{clockText(Date.parse(x.start))}</span>
              <span className="meet-later-n ellipsis">{x.title}</span>
            </div>
          ))}
          {more.length > 0 && (
            <div className="meet-xxs meet-later-more">
              +{more.length} more today, {END_WORDS(more[more.length - 1])}
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
  | { kind: 'after'; hero: Meeting; later: Meeting[]; labels: Map<string, string>; now: number; inCall: boolean; leave: LeaveSignal | null; onJoin: (key: string) => void; accounts: readonly MeetAccount[]; lastOk: number | null }
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
        <After after={p.later[0]} rest={p.later.slice(1)} hero={p.hero} labels={p.labels} now={p.now} inCall={p.inCall} leave={p.leave} onJoin={p.onJoin} />
      )}
    </section>
  );
}
