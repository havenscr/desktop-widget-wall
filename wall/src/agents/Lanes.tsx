import { useEffect, useRef, useState, type ReactNode } from 'react';
import { tip } from '../ui/HoverTip';
import { FreeRow, Lane } from './Lane';
import { ageText, allFreeText, cards, clockText, countText, questionFor, freeSlots, headerAsk, slotMeter, slotsText, slotsTip, type OmniSummary } from './model';
import { scrollToCard, useCardScroll } from './cardScroll';
import { snooze, useSnoozed } from './snooze';
import { focusSession } from './open';
import { Shelf } from './Shelf';

/** Cards in view at once; the rest scroll. */
const IN_VIEW = 3;

/** The slot meter: a pip per slot, filled for each working session, "+N" past the last pip. */
function SlotMeter({ summary, stale }: { summary: OmniSummary; stale: boolean }) {
  const m = slotMeter(summary);
  return (
    <button
      type="button"
      className="slot-meter"
      disabled={stale}
      aria-label={slotsTip(summary)}
      onClick={() => focusSession()}
      {...tip(stale ? `${slotsTip(summary).replace(' Click to bring OmniGent forward.', '')} These numbers may be out of date.` : slotsTip(summary))}
    >
      <span className="pips" aria-hidden="true">
        {m.pips.map((on, i) => (
          <i key={i} className={on ? 'on' : ''} />
        ))}
        {m.over > 0 && <em>+{m.over}</em>}
      </span>
      <span className="xs">{slotsText(summary)}</span>
    </button>
  );
}

/**
 * The Work centre with the helper answering (concept `f_work`): the header ("Agents", the
 * slot meter, the "3 of 7" count, and "Nothing needs you" or "One thing for you: <title>"
 * as a button), the cards, and the shelf. Three cards are in view; more scroll with the
 * wheel (snapping a card at a time, a thin scrollbar on hover, the page never moves).
 * With fewer than three, slim "Free slot" rows fill the rest and the cards take the room
 * (with a third line for the facts). With none, one slim "All three slots free" row and
 * `idle` (the focus timer and weather). A stale answer says "updated N min ago" and dims
 * the cards.
 */
export function Lanes({ summary, stale, freshAt, now, idle }: { summary: OmniSummary; stale: boolean; freshAt: number | null; now: number; idle: ReactNode }) {
  const [step, setStep] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const all = cards(summary);
  const snoozed = useSnoozed();
  const ask = headerAsk(summary, step, snoozed.ids);
  const n = all.length;
  const free = freeSlots(summary);
  const count = countText(n, IN_VIEW);
  const canOpen = summary.linksAvailable;
  // A new waiting list starts again from its first entry.
  const waitKey = ask.tone === 'amber' ? `${summary.yourMove.ids?.join(',') ?? ''}|${summary.yourMove.first?.sessionId ?? ''}` : '';
  useEffect(() => setStep(0), [waitKey]);
  // The ribbon's "+N more" asks for a card: bring it to the top of the list.
  const scrollReq = useCardScroll();
  useEffect(() => {
    if (!scrollReq.id || !list.current) return;
    const card = [...list.current.querySelectorAll<HTMLElement>('.lane[data-id]')].find((el) => el.dataset.id === scrollReq.id);
    card?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [scrollReq]);

  const openAsk = (id: string | null) => focusSession(canOpen ? id : null);
  /** "as of 4 min ago" (or "at an unknown time") for a stale answer. */
  const asOf = freshAt === null ? 'at an unknown time' : ageText(freshAt, now).replace('updated', 'as of');
  /** The count's click: the next three cards, back to the top after the last. */
  const nextPage = () => {
    const el = list.current;
    if (!el) return;
    const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
    el.scrollTo?.({ top: atEnd ? 0 : el.scrollTop + el.clientHeight + 12, behavior: 'smooth' });
  };

  return (
    <div className={`centre lanes${stale ? ' stale' : ''}`} data-lanes={Math.min(n, IN_VIEW)} aria-label="Agents">
      <div className="lanes-hd">
        <div className="row lanes-hd-l">
          <span className="k">Agents</span>
          <SlotMeter summary={summary} stale={stale} />
          {count && (
            <button
              type="button"
              className="xs lanes-count"
              onClick={nextPage}
              {...tip(`${count.replace(' of ', ' of the ')} sessions are in view. Scroll the cards with the wheel, or click for the next three.`)}
            >
              {count}
            </button>
          )}
          {stale && <span className="xs lanes-age">{ageText(freshAt, now)}</span>}
        </div>
        {ask.tone === 'amber' ? (
          <div className={`row calm lanes-ask ${stale ? 't-quiet' : 't-amber'}`}>
            <button
              type="button"
              className="ask-btn"
              disabled={stale}
              onClick={() => openAsk(ask.id)}
              aria-label={`${ask.text}: ${ask.title ?? ''}. Opens it in OmniGent`}
              {...tip(
                stale
                  ? `${ask.title ?? 'Something'} was waiting on you ${asOf}; this may be out of date.`
                  : ask.title
                    ? `${ask.title} waits on you. Click to open it in OmniGent.`
                    : 'Something waits on you. Click to bring OmniGent forward.',
              )}
            >
              <i className="dot" aria-hidden="true" />
              <span>{ask.title ? `${ask.text}:` : ask.text}</span>
              {ask.title && <span className="ask-title ellipsis">{ask.title}</span>}
            </button>
            {ask.more &&
              (ask.canStep && !stale ? (
                <button
                  type="button"
                  className="xs ask-more"
                  onClick={() => {
                    const nextStep = step + 1;
                    setStep(nextStep);
                    openAsk(headerAsk(summary, nextStep, snoozed.ids).id);
                  }}
                  {...tip('Open the next session that waits on you')}
                >
                  {ask.more}
                </button>
              ) : (
                <span className="xs">{ask.more}</span>
              ))}
          </div>
        ) : stale ? (
          // Old data never reads as an all-clear.
          <div className="row calm t-quiet" {...tip('The agents may have changed since then.')}>
            <i className="dot" aria-hidden="true" />
            <span>Last known: no agent needed you, {freshAt === null ? 'at an unknown time' : `as of ${clockText(freshAt)}`}</span>
          </div>
        ) : ask.tone === 'mint' ? (
          <div className="row calm t-mint lanes-ask">
            <button
              type="button"
              className="ask-btn"
              aria-label={`Ready to merge: ${ask.title}. Shows its card`}
              onClick={() => ask.id && scrollToCard(ask.id)}
              {...tip(`${ask.title} is ready for Hold to merge. Click to show its card.`)}
            >
              <i className="dot" aria-hidden="true" />
              <span>{ask.text}:</span>
              <span className="ask-title ellipsis">{ask.title}</span>
            </button>
          </div>
        ) : (
          <div className="row calm t-cyan">
            <i className="dot" aria-hidden="true" />
            <span>{ask.text}</span>
          </div>
        )}
      </div>
      <div className={`lanes-list${n > IN_VIEW ? ' scrolls' : ''}`} ref={list}>
        {all.map((l, i) => (
          <Lane
            key={l.id}
            lane={l}
            num={i + 1}
            canOpen={canOpen}
            open={(id) => focusSession(id)}
            roomy={n < IN_VIEW}
            asOf={stale ? asOf : null}
            question={questionFor(summary, l.id)}
            snoozedUntil={snoozed.ids.has(l.id) ? snoozed.until[l.id] : null}
            later={(id) => snooze(id)}
          />
        ))}
        {n > 0 && Array.from({ length: free }, (_, i) => <FreeRow key={i} text="Free slot" />)}
        {n === 0 && (
          <>
            <FreeRow text={allFreeText(summary)} />
            <div className="lanes-idle">{idle}</div>
          </>
        )}
      </div>
      <Shelf summary={summary} stale={stale} />
    </div>
  );
}
