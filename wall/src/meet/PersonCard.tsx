import { useEffect, useRef, useState } from 'react';
import { IconAddressBook, IconBrandTeams, IconCopy, IconMail } from '@tabler/icons-react';
import { personAction, type PersonAction } from '../bridge/meetBrief';
import { tip } from '../ui/HoverTip';
import { useOnAirLive } from '../onair/useOnAirLiveReport';
import { initials, replyMark, replyWord, type PeopleBlock } from './heroModel';
import { PersonDetails } from './PersonDetails';

const POP_W = 440;
const ROW_W = 494;

const ACTIONS: { action: PersonAction; label: string; fail: string }[] = [
  { action: 'copy', label: 'Copy email', fail: 'Could not copy' },
  { action: 'email', label: 'Email', fail: 'Could not open email' },
  { action: 'teams', label: 'Message on Teams', fail: 'Could not open Teams' },
];
// Every action has an icon, so a new action fails to compile here until it gets one. `contact` is not in ACTIONS: its key
// is drawn only after the saved-contact lookup says it is available.
const ICON: Record<PersonAction, typeof IconCopy> = { copy: IconCopy, email: IconMail, teams: IconBrandTeams, contact: IconAddressBook };

/**
 * The people under the key grid: up to five round initials with a reply mark, and "N invited" with the replies.
 * A click on one opens the person card (a popover anchored at it): the name, how they replied and, for a person
 * the invite gave an address, Copy email, Email and Message on Teams. The invite's address is never drawn: the card
 * asks Rust for it once when it opens (`PersonDetails`, hidden while On Air is live), and adds Open contact card for a
 * saved contact. Nothing is sent: the actions only copy, or open a draft, a chat or a contact for the person to finish. It closes on Escape, on a click
 * outside, when the meeting changes and when that person is no longer in the list.
 */
export function People({ people, meetingId }: { people: PeopleBlock; meetingId: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  const [anchor, setAnchor] = useState(24);
  const [line, setLine] = useState<string | null>(null);
  const onAirLive = useOnAirLive();
  const rootRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  // Bumped on every open and close, so an answer that arrives after the card closed sets no line.
  const epoch = useRef(0);
  const person = open === null ? undefined : people.circles[open];
  const close = () => {
    epoch.current += 1;
    setOpen(null);
    setLine(null);
  };
  /** Escape: close and put the focus back on the initial that opened the card. */
  const closeToOpener = () => {
    const el = openerRef.current;
    close();
    el?.focus();
  };
  useEffect(close, [meetingId]);
  useEffect(() => {
    if (open !== null && !person) close();
  }, [open, person]);
  useEffect(() => {
    if (open === null) return;
    const key = (e: KeyboardEvent) => {
      // Ours only while the card is open; another handler that already took this Escape keeps it, and none is stopped.
      if (e.key === 'Escape' && !e.defaultPrevented) closeToOpener();
    };
    const down = (e: Event) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('keydown', key);
    document.addEventListener('mousedown', down);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('mousedown', down);
    };
  }, [open]);

  const toggle = (i: number, el: HTMLElement) => {
    if (open === i) return close();
    setLine(null);
    openerRef.current = el;
    epoch.current += 1;
    setOpen(i);
    // Anchored at the initials; kept inside the hero's right column.
    setLeft(Math.max(0, Math.min(el.offsetLeft - 8, ROW_W - POP_W)));
    setAnchor(el.offsetLeft + el.offsetWidth / 2);
  };
  const run = async (a: (typeof ACTIONS)[number]) => {
    const key = person?.key;
    if (!key) return;
    const mine = epoch.current;
    try {
      await personAction(key, a.action);
      if (epoch.current !== mine) return;
      if (a.action === 'copy') setLine('Copied');
      else close();
    } catch {
      if (epoch.current === mine) setLine(a.fail);
    }
  };

  const mark = person ? replyMark(person.reply) : null;
  return (
    <div className="meet-ppl" ref={rootRef}>
      <div className="meet-ppl-row">
        <div className="meet-ppl-circles">
          {people.circles.map((p, i) => {
            const m = replyMark(p.reply);
            return (
              <button key={`${p.name}-${i}`} type="button" className="meet-ini" aria-label={`${p.name}, ${replyWord(p.reply)}`} aria-expanded={open === i} data-open={open === i ? 'true' : undefined} onClick={(e) => toggle(i, e.currentTarget)} {...tip(`${p.name}, ${replyWord(p.reply)}. Click for the card.`)}>
                <span className="meet-ini-t">{initials(p.name)}</span>
                <b className="meet-ini-mark" data-tone={m.tone} aria-hidden="true">
                  {m.text}
                </b>
              </button>
            );
          })}
          {people.more > 0 && (
            <span className="meet-ini more" {...tip(`${people.more} more invited`)}>
              <span className="meet-ini-t">+{people.more}</span>
            </span>
          )}
        </div>
        <div className="meet-ppl-txt" {...tip(`${people.head}. ${people.replies}. Click the initials for a card.`)}>
          <div className="meet-ppl-n">{people.head}</div>
          <div className="meet-ppl-r">{people.replies}</div>
        </div>
      </div>
      {person && mark && (
        <div className="meet-pcard" role="dialog" aria-label={`${person.name}, card`} style={{ left, width: POP_W }}>
          <span className="meet-pcard-notch" style={{ left: Math.max(14, anchor - left - 8) }} aria-hidden="true" />
          <div className="meet-pcard-hd">
            <span className="meet-pcard-ini">{initials(person.name)}</span>
            <div className="meet-pcard-who">
              <div className="meet-pcard-name">{person.name}</div>
            </div>
            <span className="meet-pcard-reply" data-tone={mark.tone}>
              {replyWord(person.reply)}
            </span>
          </div>
          {person.key && <PersonDetails key={`${open}:${person.key}`} personKey={person.key} onAirLive={onAirLive} />}
          {person.key ? (
            <div className="meet-pcard-acts">
              {ACTIONS.map((a) => {
                const Icon = ICON[a.action];
                return (
                  <button key={a.action} type="button" className="meet-pcard-act" onClick={() => void run(a)}>
                    <Icon size={24} stroke={1.8} aria-hidden="true" />
                    <span>{a.label}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="meet-pcard-line">No address on the invite</div>
          )}
          {line && (
            <div className="meet-pcard-line" role="status">
              {line}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
