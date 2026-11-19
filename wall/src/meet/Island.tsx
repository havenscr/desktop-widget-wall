import { IconCheck, IconChecklist, IconChevronLeft, IconChevronRight, IconCircle, IconFileText, IconMail, IconUsers } from '@tabler/icons-react';
import { useState, type ReactNode } from 'react';
import { invoke } from '../bridge/tauri';
import { useOnAirLive } from '../onair/useOnAirLiveReport';
import { tip } from '../ui/HoverTip';
import { BriefFeed } from './BriefFeed';
import { BriefConnect } from './BriefKey';
import { OFF_LINE, REFRESH_LINE, briefView } from './briefModel';
import { initials } from './heroModel';
import { HOW_TO, indexName, inviteSize, islandKinds, stepKind, type IslandKind, type KindId } from './islandModel';
import { type MeetingDetails, type Reply } from './model';
import { useMeetStore } from './meetStore';
import { useBrief } from './useBrief';
import type { ChecklistRead } from './useChecklist';

const ICONS = { mail: IconMail, users: IconUsers, checklist: IconChecklist } as const;

/** How many people rows the large pane draws; the rest are a count. */
export const PEOPLE_ROWS = 6;

const REPLY_WORDS: Record<Reply, string> = { yes: 'Said yes', maybe: 'Maybe', no: 'Declined', none: 'No reply yet', organizer: 'Organizer' };

function KindIcon({ kind, size }: { kind: IslandKind['icon']; size: number }) {
  const I = ICONS[kind];
  return <I size={size} stroke={1.8} aria-hidden="true" />;
}

/** The brief's quiet line (and Retry) under the island's usual pages; nothing when the brief has nothing to say. */
function BriefNote({ view, retry }: { view: ReturnType<typeof briefView>; retry: () => void }) {
  const line = view.stale ? REFRESH_LINE : view.line;
  if (!line) return null;
  if (view.mode === 'off' && line === OFF_LINE) return <BriefConnect onChanged={retry} />;
  return (
    <>
      <span className="meet-brief-note meet-xs meet-dimline ellipsis">{line}</span>
      {(view.retry || view.stale) && (
        <button type="button" className="meet-btn meet-retry" onClick={retry} {...tip('Read the brief again now')}>
          Retry
        </button>
      )}
    </>
  );
}

function InvitePane({ text }: { text: string }) {
  return (
    <div className="meet-isl-invite" data-size={inviteSize(text)} {...tip(text)}>
      {text}
    </div>
  );
}

function PeoplePane({ d }: { d: MeetingDetails }) {
  const named = d.people.slice(0, PEOPLE_ROWS);
  const hidden = d.people.length - named.length + d.peopleMore;
  return (
    <div className="meet-isl-people">
      {named.map((p, i) => (
        <div key={`${p.name}-${i}`} className="meet-isl-person" data-reply={p.reply} {...tip(`${p.name}: ${REPLY_WORDS[p.reply].toLowerCase()}`)}>
          <span className="meet-ini lg">{initials(p.name)}</span>
          <span className="meet-isl-name ellipsis">{p.name}</span>
          <span className="meet-isl-reply">{REPLY_WORDS[p.reply]}</span>
        </div>
      ))}
      {hidden > 0 && <div className="meet-xs meet-dimline">+{hidden} more invited</div>}
    </div>
  );
}

function ChecklistPane({ items, ticked, onTick }: { items: readonly string[]; ticked: readonly number[]; onTick: (i: number) => void }) {
  return (
    <div className="meet-isl-check">
      {items.map((t, i) => {
        const on = ticked.includes(i);
        return (
          <button key={`${t}-${i}`} type="button" className="meet-isl-item" data-on={on ? 'true' : undefined} role="checkbox" aria-checked={on} onClick={() => onTick(i)} {...tip(`${t}\nClick to tick it for this meeting only`)}>
            <span className="meet-isl-box" aria-hidden="true">
              {on ? <IconCheck size={20} stroke={2.4} /> : <IconCircle size={22} stroke={1.8} />}
            </span>
            <span className="meet-isl-itext ellipsis">{t}</span>
          </button>
        );
      })}
    </div>
  );
}

/** When no kind has anything: how the checklist file works, and its Open file button. Never an empty box. */
function HowTo({ checklist, reloadSoon, note: brief, top }: { checklist: ChecklistRead; reloadSoon: () => void; note: React.ReactNode; top: string | null }) {
  const [note, setNote] = useState<string | null>(null);
  return (
    <section className="panel meet-island" aria-label="Meeting notes">
      <div className="meet-isl-hd">
        <span className="meet-isl-ico">
          <IconChecklist size={22} stroke={1.8} aria-hidden="true" />
        </span>
        <span className="k meet-k">Your first-meeting list</span>
        {top && <span className="meet-brief-top meet-xs meet-dimline ellipsis">{top}</span>}
        <span className="meet-src" {...tip('The list lives in a text file you write yourself')}>
          From meet-checklist.txt
        </span>
      </div>
      <div className="meet-isl-howto">
        {checklist.state === 'refused' && checklist.reason && <div className="meet-trouble">{checklist.reason}</div>}
        {HOW_TO.map((l) => (
          <div key={l} className="meet-isl-how">
            {l}
          </div>
        ))}
        <div className="meet-isl-howrow">
          <button
            type="button"
            className="meet-btn cy"
            onClick={() =>
              void invoke('wall2_meet_checklist_open').then(
                () => {
                  setNote(null);
                  reloadSoon();
                },
                () => setNote('Could not open meet-checklist.txt'),
              )
            }
            {...tip('Open meet-checklist.txt in the default editor; a three-line starter is written first when there is none')}
          >
            <IconFileText size={20} aria-hidden="true" />
            Open file
          </button>
          {note && <span className="meet-notice meet-xs">{note}</span>}
          {brief}
        </div>
      </div>
    </section>
  );
}

/**
 * The island: one kind large at the left, "Also on file" at the right, the order line, arrows and dots under them.
 * Arrows, a click on an index row and the dots change the large kind; nothing turns by itself.
 */
export function Island({ details, checklist, reloadSoon, meetingId, briefKey = null }: { details: MeetingDetails | null | undefined; checklist: ChecklistRead; reloadSoon: () => void; meetingId: string; briefKey?: string | null }) {
  const brief = useBrief(briefKey);
  const onAir = useOnAirLive();
  const view = briefView(brief.out, brief.err, Date.now(), { gaveUp: brief.gaveUp, onAir });
  // Ticks and the chosen kind belong to the occurrence of the meeting, so a refresh of the calendar keeps them.
  const ticked = useMeetStore((s) => s.ticks[meetingId]) ?? [];
  const toggle = useMeetStore((s) => s.toggleTick);
  const sel = useMeetStore((s) => s.selected[meetingId]) ?? null;
  const select = useMeetStore((s) => s.select);
  const setSel = (k: KindId) => select(meetingId, k);
  const kinds = islandKinds({ details, checklist: checklist.items });
  if (view.mode === 'feed' && brief.out) return <BriefFeed out={brief.out} view={view} onAir={onAir} retry={brief.retry} />;
  const note = <BriefNote view={view} retry={brief.retry} />;
  if (kinds.length === 0) return <HowTo checklist={checklist} reloadSoon={reloadSoon} note={view.mode === 'empty' && !view.stale ? null : note} top={view.mode === 'empty' ? [view.line, ...view.sourceLines].filter(Boolean).join(' · ') : null} />;
  const found = kinds.findIndex((k) => k.id === sel);
  const index = found < 0 ? 0 : found;
  const cur = kinds[index];
  const others = kinds.filter((_, i) => i !== index);
  const go = (dir: 1 | -1) => setSel(kinds[stepKind(index, kinds.length, dir)].id);
  let pane: ReactNode = null;
  if (cur.id === 'invite' && details?.invite) pane = <InvitePane text={details.invite} />;
  else if (cur.id === 'people' && details) pane = <PeoplePane d={details} />;
  else if (cur.id === 'checklist') pane = <ChecklistPane items={checklist.items} ticked={ticked} onTick={(i) => toggle(meetingId, i)} />;
  const many = kinds.length > 1;
  return (
    <section className="panel meet-island" aria-label="Meeting notes">
      <div className="meet-isl-hd">
        <span className="meet-isl-ico">
          <KindIcon kind={cur.icon} size={22} />
        </span>
        <span className="k meet-k">{cur.title}</span>
        {cur.count !== undefined && <span className="meet-cnt">{cur.count}</span>}
        {view.mode === 'empty' && <span className="meet-brief-top meet-xs meet-dimline ellipsis">{[view.line, ...view.sourceLines].filter(Boolean).join(' · ')}</span>}
        <span className="meet-src" {...tip('Where these words come from')}>
          {cur.source}
        </span>
      </div>
      <div className="meet-isl-body" data-many={many ? 'true' : undefined}>
        <div className="meet-isl-main">{pane}</div>
        {many && (
          <div className="meet-isl-index">
            <span className="k meet-k sm">Also on file</span>
            {others.map((k) => (
              <button key={k.id} type="button" className="meet-isl-row" onClick={() => setSel(k.id)} {...tip(`${k.title}: ${k.preview}\nClick to show it large`)}>
                <span className="meet-isl-rowhd">
                  <KindIcon kind={k.icon} size={20} />
                  <span className="meet-isl-rowname">{indexName(k)}</span>
                  {k.count !== undefined && <span className="meet-cnt">{k.count}</span>}
                </span>
                <span className="meet-xxs meet-isl-prev ellipsis">{k.preview}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="meet-isl-foot">
        {view.mode === 'empty' && !view.stale ? <span className="meet-isl-gap" aria-hidden="true" /> : view.line || view.stale ? note : <span className="meet-isl-gap" aria-hidden="true" />}
        {many && (
          <>
            <button type="button" className="meet-arrow" aria-label="Previous" onClick={() => go(-1)} {...tip('Show the previous kind')}>
              <IconChevronLeft size={20} aria-hidden="true" />
            </button>
            <span className="meet-dots" role="tablist" aria-label="Kinds">
              {kinds.map((k, i) => (
                <button key={k.id} type="button" role="tab" aria-selected={i === index} aria-label={k.title} className="meet-dot" data-on={i === index ? 'true' : undefined} onClick={() => setSel(k.id)} {...tip(k.title)}>
                  <i />
                </button>
              ))}
            </span>
            <button type="button" className="meet-arrow" aria-label="Next" onClick={() => go(1)} {...tip('Show the next kind')}>
              <IconChevronRight size={20} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </section>
  );
}
