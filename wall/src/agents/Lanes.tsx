import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { tip } from '../ui/HoverTip';
import { FreeRow, Lane } from './Lane';
import { ageText, allFreeText, cards, clockText, countText, questionFor, freeSlots, headerAsk, slotMeter, slotsShortText, slotsText, slotsTip, type OmniSummary } from './model';
import { scrollToCard, useCardScroll } from './cardScroll';
import { snooze, useSnoozed } from './snooze';
import { focusSession } from './open';
import { Shelf } from './Shelf';
import { AlarmChip } from '../home/AlarmChip';
import { useOpenAlarms } from '../home/useSecurity';
import { HeaderRecordingChip } from '../signals/RecordingChip';
import { useSignalStore } from '../signals/store';

/** Cards in view at once; the rest scroll. */
const IN_VIEW = 3;

/**
 * How far the header has given way to fit on one line: 0 everything in full, 1 the meter's
 * short sentence ("5 of 8 working"), 2 the pips alone, 3 the alarm chip as a dot and a count.
 * After that the ask button's title truncates with an ellipsis.
 */
export type HeaderFit = 0 | 1 | 2 | 3;

/**
 * True when the header cannot show everything on one line: a part runs past its box, or a
 * title is cut before its own maximum width.
 */
function headerTight(hd: HTMLElement): boolean {
  if (hd.scrollWidth > hd.clientWidth + 1) return true;
  for (const el of hd.querySelectorAll<HTMLElement>('.lanes-hd-l, .ellipsis')) {
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    const max = parseFloat(getComputedStyle(el).maxWidth);
    if (!Number.isFinite(max) || el.clientWidth < max - 1) return true;
  }
  return false;
}

/** The slot meter: a pip per slot, filled for each working session, "+N" past the last pip. */
function SlotMeter({ summary, stale, fit }: { summary: OmniSummary; stale: boolean; fit: HeaderFit }) {
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
      {fit < 2 && <span className="xs">{fit === 0 ? slotsText(summary) : slotsShortText(summary)}</span>}
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
  const snoozed = useSnoozed(summary);
  const ask = headerAsk(summary, step, snoozed.ids, snoozed.until);
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

  // Nothing in the header wraps: when it is tight its parts give way in order (`HeaderFit`).
  const alarms = useOpenAlarms();
  const recording = useSignalStore((s) => s.recording);
  const hd = useRef<HTMLDivElement>(null);
  const fitKey = `${slotsText(summary)}|${count}|${ask.text}|${ask.title ?? ''}|${ask.more ?? ''}|${ask.tone}|${alarms}|${stale}|${freshAt}|${recording}`;
  const [fitState, setFitState] = useState<{ key: string; level: HeaderFit }>({ key: fitKey, level: 0 });
  const fit: HeaderFit = fitState.key === fitKey ? fitState.level : 0;
  useLayoutEffect(() => {
    const el = hd.current;
    if (!el) return;
    if (fit < 3 && headerTight(el)) setFitState({ key: fitKey, level: (fit + 1) as HeaderFit });
    else if (fitState.key !== fitKey) setFitState({ key: fitKey, level: fit });
  }, [fitKey, fit, fitState.key]);

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
      <div className="lanes-hd" ref={hd} data-fit={fit}>
        <div className="row lanes-hd-l">
          <span className="k">Agents</span>
          <SlotMeter summary={summary} stale={stale} fit={fit} />
          <AlarmChip className="xs lanes-alarm" compact={fit >= 3} />
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
          <HeaderRecordingChip compact={fit >= 3} />
        </div>
        {ask.tone === 'amber' && stale ? (
          // Old data never reads as live: grey words, not a button.
          <div className="row calm t-quiet" {...tip(`${ask.title ?? 'Something'} was waiting on you ${asOf}; this may be out of date.`)}>
            <i className="dot" aria-hidden="true" />
            <span className="ellipsis">{ask.title ? `Last known: ${ask.title} was waiting on you` : 'Last known: something was waiting on you'}</span>
          </div>
        ) : ask.tone === 'amber' ? (
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
                    openAsk(headerAsk(summary, nextStep, snoozed.ids, snoozed.until).id);
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
            <span>{ask.text.includes('snoozed') ? `Last known: ${ask.text}` : freshAt === null ? 'Last known (time unknown): no agent needed you' : `Last known: no agent needed you, as of ${clockText(freshAt)}`}</span>
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
            later={(id) => snooze(id, summary)}
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
