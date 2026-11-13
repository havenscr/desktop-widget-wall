import {
  IconAlertTriangle,
  IconChevronLeft,
  IconChevronRight,
  IconGitPullRequest,
  IconMessageCircle,
  IconVideo,
  type Icon,
} from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState, type WheelEvent } from 'react';
import { tip } from '../ui/HoverTip';
import { useVisible } from '../ui/useVisible';
import { useArrangeStatus, layoutOffReason, isLayoutAction } from './arrangeStatus';
import { runForYou, useForYou, type ForYouItem, type ForYouKind } from './forYou';
import { KeyIcon } from './keyIcons';
import { joinKeys, KEYS_POLL_MS, loadKeys, useKeysFeedStore } from './keysFeed';
import {
  acceptsFront,
  AUTO,
  autoPage,
  effectiveMode,
  FOR_YOU,
  pagesFor,
  readMode,
  saveMode,
  stepPage,
  type KeysSummary,
  type Mode,
  type Page,
  type SetInfo,
} from './keysModel';
import { useKeyPress } from './keyPress';
import { useBrief } from './useBrief';

export { KEYS_POLL_MS };
/** The wheel steps at most this often, so one turn of the wheel moves one page. */
export const WHEEL_GAP_MS = 250;
/** A set page shows at most this many keys. */
const MAX_KEYS = 8;
/** "For you" shows this many items at once; the heading counts the rest. */
export const FOR_YOU_SHOWN = 2;
/** A new "For you" item takes the Now row for this long when Auto is on. */
export const TAKEOVER_MS = 45_000;

/** Columns for n keys: one row up to five, then two rows. */
export const columnsFor = (n: number): number => (n <= 5 ? Math.max(n, 1) : n === 6 ? 3 : 4);

const KIND_ICON: Record<ForYouKind, Icon> = { meeting: IconVideo, waiting: IconMessageCircle, merge: IconGitPullRequest, alarm: IconAlertTriangle };
const KIND_TONE: Record<ForYouKind, string> = { meeting: 'mint', waiting: 'amber', merge: 'mint', alarm: 'amber' };

/** The pages and the keys feed for the Now row: shared read, started while visible. */
function useKeysRead() {
  const visible = useVisible();
  useEffect(() => (visible ? joinKeys() : undefined), [visible]);
  return { read: useKeysFeedStore((s) => s.read), refresh: loadKeys };
}

function ForYouList({ items }: { items: ForYouItem[] }) {
  return (
    <div className="fy-list">
      {items.slice(0, FOR_YOU_SHOWN).map((it) => {
        const I = KIND_ICON[it.kind];
        return (
          <div key={it.key} className={`fy-li ${KIND_TONE[it.kind]}`} {...tip(`${it.title}: ${it.reason}`)}>
            <I size={20} stroke={1.8} aria-hidden="true" />
            <span className="fy-tx">
              <b>{it.title}</b>
              <em>{it.reason}</em>
            </span>
            <button type="button" className="deck-mini" aria-label={`${it.action}: ${it.title}`} {...tip(it.actionTip)} onClick={() => runForYou(it)}>
              {it.action}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The "Now" row under "Always here": pages of keys (and a "For you" page when something
 * waits on the owner). Auto shows the set for the app in front, else the general set, and
 * shows "For you" for 45 seconds when something new arrives. The arrows, the dots or the
 * wheel step to another page and turn Hold on: the row then stays until Auto is clicked.
 * A key is only sent to an app its set allows; the page sends a set id and a key index.
 */
export function Keys() {
  const { read, refresh } = useKeysRead();
  const items = useForYou();
  const [mode, setModeState] = useState<Mode>(readMode);
  const [takeUntil, setTakeUntil] = useState(0);
  const [brief, showBrief] = useBrief();
  const { press, onKeyDown } = useKeyPress(showBrief, refresh);
  const arrange = useArrangeStatus();
  const lastWheel = useRef(0);
  const seen = useRef<Set<string> | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    saveMode(m);
  }, []);

  const forYouOn = items.length > 0;
  const sig = items.map((i) => i.key).join('|');
  const summary = read.status === 'ready' ? read.summary : null;

  // A held page that is gone (a set left keys.json, nothing waits any more) goes back to Auto.
  useEffect(() => {
    if (summary && mode.hold && effectiveMode(mode, summary.sets, forYouOn) === AUTO) setMode(AUTO);
  }, [summary, mode, forYouOn, setMode]);

  // A NEW item takes the row for 45 seconds (Auto only); one that stays does not keep it.
  useEffect(() => {
    const keys = sig ? sig.split('|') : [];
    const before = seen.current;
    seen.current = new Set(keys);
    if (before !== null && !modeRef.current.hold && keys.some((k) => !before.has(k))) setTakeUntil(Date.now() + TAKEOVER_MS);
  }, [sig]);
  useEffect(() => {
    if (takeUntil === 0) return;
    const id = setTimeout(() => setTakeUntil(0), Math.max(0, takeUntil - Date.now()));
    return () => clearTimeout(id);
  }, [takeUntil]);

  if (read.status === 'loading' || read.status === 'absent') return null;
  if (read.status === 'problem') {
    return (
      <section className="keys deck-row" aria-label="Now">
        <div className="row sb deck-hd">
          <span className="k">Now</span>
        </div>
        <div className="s deck-quiet" {...tip(`${read.text}. Fix keys.json in the app's config folder; the wall never writes it.`)}>
          keys.json has a problem
        </div>
      </section>
    );
  }

  const { summary: sum } = read;
  const m = effectiveMode(mode, sum.sets, forYouOn);
  const pages = pagesFor(sum, forYouOn);
  const hold = m.hold;
  let page: Page | null;
  if (hold) page = pages.find((p) => p.id === m.setId) ?? null;
  else if (takeUntil !== 0 && forYouOn) page = pages.find((p) => p.id === FOR_YOU) ?? null;
  else page = autoPage(sum);

  const goTo = (p: Page | null) => {
    if (!p) return;
    setTakeUntil(0);
    setMode({ hold: true, setId: p.id });
  };
  const stepTo = (dir: 1 | -1) => goTo(stepPage(pages, page?.id ?? null, dir));
  const onWheel = (e: WheelEvent) => {
    if (pages.length < 2 || e.deltaY === 0) return;
    const now = Date.now();
    if (now - lastWheel.current < WHEEL_GAP_MS) return;
    lastWheel.current = now;
    stepTo(e.deltaY > 0 ? 1 : -1);
  };

  const pageName = page ? (page.kind === 'foryou' ? 'For you' : page.set.name) : '';
  const more = page?.kind === 'foryou' && items.length > FOR_YOU_SHOWN ? ` · +${items.length - FOR_YOU_SHOWN} more` : '';
  const heading = page ? `Now · ${pageName}${more}` : 'Now';
  const showChip = forYouOn && page?.kind !== 'foryou';
  const where = sum.source === 'default' ? 'You are using the built-in keys. To change them put keys.json in the app\'s config folder; the wall never writes it.' : 'Keys come from keys.json and the built-in library.';

  const controls = (
    <span className="deck-hd-r">
      {showChip && (
        <button
          type="button"
          className="deck-chip"
          {...tip(`${items.length} thing${items.length === 1 ? '' : 's'} waiting on you. Click to see them.`)}
          onClick={() => goTo(pages.find((p) => p.id === FOR_YOU) ?? null)}
        >
          For you {items.length}
        </button>
      )}
      {pages.length > 1 && (
        <>
          <button type="button" className="deck-arrow" aria-label="Previous page" {...tip('Show the previous page of keys and hold it')} onClick={() => stepTo(-1)}>
            <IconChevronLeft size={20} stroke={2} aria-hidden="true" />
          </button>
          <span className="deck-dots" role="tablist" aria-label="Pages">
            {pages.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={p.id === page?.id}
                aria-label={p.kind === 'foryou' ? 'For you' : p.set.name}
                className={`deck-dot${p.id === page?.id ? ' on' : ''}${p.kind === 'foryou' ? ' am' : ''}`}
                {...tip(p.kind === 'foryou' ? 'For you: what waits on you' : `Keys: ${p.set.name}`)}
                onClick={() => goTo(p)}
              >
                <i aria-hidden="true" />
              </button>
            ))}
          </span>
          <button type="button" className="deck-arrow" aria-label="Next page" {...tip('Show the next page of keys and hold it')} onClick={() => stepTo(1)}>
            <IconChevronRight size={20} stroke={2} aria-hidden="true" />
          </button>
        </>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={!hold}
        className={`deck-auto${hold ? '' : ' on'}`}
        {...tip(hold ? 'Holding this page. Click to follow the app in front again.' : 'Following the app in front, and showing what waits on you. Step to another page to hold it.')}
        onClick={() => hold && setMode(AUTO)}
      >
        <i aria-hidden="true" />
        Auto
      </button>
    </span>
  );

  const head = (
    <div className="row sb deck-hd">
      {brief ? (
        <span className="deck-brief-l" role="status" title={brief}>
          {brief}
        </span>
      ) : (
        <span className="k ellipsis" {...tip(where)}>
          {heading}
        </span>
      )}
      {controls}
    </div>
  );

  if (page?.kind === 'foryou') {
    return (
      <section className="keys deck-row" aria-label={heading} onWheel={onWheel}>
        {head}
        <ForYouList items={items} />
      </section>
    );
  }

  // Nothing to show: no set of its own, no general set (or nothing in front yet).
  if (!page) {
    const idle = sum.front === 'idle';
    return (
      <section className="keys deck-row" aria-label="Now" onWheel={onWheel}>
        {head}
        <div
          className="s deck-quiet"
          {...tip(
            idle
              ? 'Click into a program and its keys show here. Sets come from keys.json and the built-in library.'
              : `Add a set for ${sum.exe ?? 'this app'} to keys.json (match it by its .exe file name), or a general set with "match": "*" for every app.`,
          )}
        >
          {idle ? 'Work in another app and its keys show here' : 'No keys for this app'}
        </div>
      </section>
    );
  }

  const set: SetInfo = page.set;
  const keys = set.keys.slice(0, MAX_KEYS);
  const ok = acceptsFront(sum, set);
  return (
    <section className="keys deck-row" aria-label={heading} onWheel={onWheel}>
      {head}
      <div className={`deck-tiles keys-tiles${keys.length > 5 ? ' two' : ''}`} style={{ gridTemplateColumns: `repeat(${columnsFor(keys.length)}, minmax(0, 1fr))` }}>
        {keys.map((k, i) => {
          const layoutOff = isLayoutAction(k.action) && arrange !== true;
          const wrongApp = k.action === null && hold && !ok;
          return (
            <button
              key={`${set.id}-${i}`}
              type="button"
              className={`deck-tile key-tile${wrongApp || layoutOff ? ' off' : ''}`}
              aria-label={k.label}
              aria-disabled={layoutOff || undefined}
              {...tip(
                layoutOff
                  ? layoutOffReason(arrange)
                  : wrongApp
                    ? `${k.label}: the app in front is not ${set.name}, so this would send nothing`
                    : k.action
                      ? k.label
                      : set.general
                        ? `Send ${k.label} to the app in front`
                        : `Send ${k.label} to ${set.name}`,
              )}
              onKeyDown={onKeyDown}
              onClick={(e) => !layoutOff && void press(`${set.id}:${i}`, e.detail, { command: 'wall2_keys_send', args: { setId: set.id, index: i } }, k.label, k.action, set, hold)}
            >
              <KeyIcon name={k.icon} size={keys.length > 5 ? 16 : 18} />
              <span className="deck-lbl">{k.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export type { KeysSummary };
