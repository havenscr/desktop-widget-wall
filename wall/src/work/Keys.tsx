import {
  IconAlertTriangle,
  IconChevronLeft,
  IconChevronRight,
  IconGitPullRequest,
  IconMessageCircle,
  IconVideo,
  type Icon,
} from '@tabler/icons-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type WheelEvent } from 'react';
import { tip } from '../ui/HoverTip';
import { useVisible } from '../ui/useVisible';
import { useArrangeStatus, layoutOffReason, isLayoutAction } from './arrangeStatus';
import { runForYou, useForYou, type ForYouItem, type ForYouKind } from './forYou';
import { useGuard } from './useGuard';
import { ActionError } from './wallActions';
import { KeyIcon } from './keyIcons';
import { setKeyKind, type KeyKind } from './keyKind';
import { useLibIndex } from './keyLibrary';
import { joinKeys, KEYS_POLL_MS, loadKeys, useKeysFeedStore } from './keysFeed';
import {
  acceptsFront,
  AUTO,
  autoPage,
  DECK_TILE_GAP,
  DECK_TILE_H,
  deckFloorY,
  effectiveMode,
  FOR_YOU,
  keyChunks,
  keyLabel,
  KEYS_PER_ROW,
  MAX_DOTS,
  pagesFor,
  readMode,
  saveMode,
  sendReason,
  stepPage,
  type KeysSummary,
  type Mode,
  type Page,
  type SetInfo,
} from './keysModel';
import { keyboardOnMouseKey, useKeyPress } from './keyPress';
import { useBrief } from './useBrief';
import { RecordingKeyRow } from '../signals/RecordingKeyRow';
import { RECORDING_PAGE } from '../signals/recordingKeys';
import { useSignalStore } from '../signals/store';

export { KEYS_POLL_MS };
/** The wheel steps at most this often, so one turn of the wheel moves one page. */
export const WHEEL_GAP_MS = 250;
/** A set page shows at most this many keys. */
const MAX_KEYS = 8;
/** "For you" shows this many items at once; the heading counts the rest. */
export const FOR_YOU_SHOWN = 2;
/** A new "For you" item takes the Now row for this long when Auto is on. */
export const TAKEOVER_MS = 45_000;
/** An item that was gone this long counts as new again; one that blinks out for a poll does not. */
export const NEW_AGAIN_MS = 10 * 60_000;
/** What the take-over memory forgets after this long. */
const FORGET_MS = 24 * 60 * 60_000;

/** Columns in the Now row: always five, so every tile is the size of an Always here tile. */
export const columnsFor = (_n: number): number => KEYS_PER_ROW;
/** The stage y of the top of the main area (the right wing's top). */
const WING_TOP = 20;

/**
 * Whether a second row of tiles fits above the deck's floor (`deckFloorY`), measured from
 * where the first row starts on the stage. False when the page has no layout (tests).
 */
function secondRowFits(tiles: HTMLElement): boolean {
  const wing = tiles.closest<HTMLElement>('.right-wing');
  if (!wing || wing.offsetHeight === 0) return false;
  const w = wing.getBoundingClientRect();
  const scale = w.height / wing.offsetHeight;
  if (!Number.isFinite(scale) || scale <= 0) return false;
  const top = WING_TOP + (tiles.getBoundingClientRect().top - w.top) / scale;
  return top + 2 * DECK_TILE_H + DECK_TILE_GAP <= deckFloorY();
}

/**
 * How far the Now heading has given way to keep the page name whole: 0 the page dots (or
 * "8 of 12" past seven pages), 1 "8 of 12" in place of the dots, 2 the "For you" chip as a
 * dot and a count.
 */
type HeadFit = 0 | 1 | 2;

const KIND_ICON: Record<ForYouKind, Icon> = { meeting: IconVideo, waiting: IconMessageCircle, merge: IconGitPullRequest, alarm: IconAlertTriangle };
const KIND_TONE: Record<ForYouKind, string> = { meeting: 'mint', waiting: 'amber', merge: 'mint', alarm: 'amber' };
/** A plate takes the tone the app already gives its item: mint (ready) as an app key, amber (waits on you) as an agent key. */
const TONE_KIND: Record<string, KeyKind> = { mint: 'app', amber: 'agent' };

/** The pages and the keys feed for the Now row: shared read, started while visible. */
function useKeysRead() {
  const visible = useVisible();
  useEffect(() => (visible ? joinKeys() : undefined), [visible]);
  return { read: useKeysFeedStore((s) => s.read), refresh: loadKeys };
}

/**
 * The For you page: up to two plates side by side, each the height of a key, so the Now row is
 * one height on every page. A long title is cut; the full title and reason show on hover. One
 * item leaves the second half empty (the plate never stretches past half the row).
 */
function ForYouList({ items, onRun }: { items: ForYouItem[]; onRun: (item: ForYouItem, detail: number) => void }) {
  return (
    <div className="fy-list">
      {items.slice(0, FOR_YOU_SHOWN).map((it) => {
        const I = KIND_ICON[it.kind];
        const tone = KIND_TONE[it.kind];
        return (
          <div key={it.key} className={`fy-li fy-plate ${tone}`} data-kind={TONE_KIND[tone]} {...tip(`${it.title}: ${it.reason}`)}>
            <I size={20} stroke={1.8} aria-hidden="true" />
            <span className="fy-tx">
              <b>{it.title}</b>
              <em>{it.reason}</em>
            </span>
            <button type="button" className="deck-mini" aria-label={`${it.action}: ${it.title}`} {...tip(it.actionTip)} onClick={(e) => onRun(it, e.detail)}>
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
  const recording = useSignalStore((s) => s.recording);
  const libIdx = useLibIndex();
  const [mode, setModeState] = useState<Mode>(readMode);
  const [takeUntil, setTakeUntil] = useState(0);
  const [brief, showBrief] = useBrief();
  const { press, onKeyDown } = useKeyPress(showBrief, refresh);
  const arrange = useArrangeStatus();
  const lastWheel = useRef(0);
  const rowRef = useRef<HTMLElement | null>(null);
  const present = useRef<Set<string> | null>(null);
  /** When each item that has been shown last left the list. */
  const lastGone = useRef(new Map<string, number>());
  /** Presses in flight on this row (pointer down to up, key down to up), and a take-over held back for them. */
  const inFlight = useRef(0);
  const pendingTake = useRef(false);
  const fyGuard = useGuard();
  const modeRef = useRef(mode);
  modeRef.current = mode;

  /** Which five of a set with more than five keys show, when a second row does not fit. */
  const [chunk, setChunk] = useState<{ setId: string | null; at: number }>({ setId: null, at: 0 });
  const [twoRows, setTwoRows] = useState(false);
  const tilesRef = useRef<HTMLDivElement | null>(null);
  const headRef = useRef<HTMLDivElement | null>(null);
  const [headFit, setHeadFit] = useState<{ key: string; level: HeadFit }>({ key: '', level: 0 });

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

  // A NEW item takes the row for 45 seconds (Auto only). New means never seen, or gone for 10
  // minutes or more; an item that blinks out for a poll (a source stale for a moment) is the same
  // item. Items already waiting when the row mounts are not new. The take-over waits for any press
  // in flight, so the key under the pointer never changes between press and release.
  useEffect(() => {
    const now = Date.now();
    const keys = sig ? sig.split('|') : [];
    const before = present.current;
    const gone = lastGone.current;
    present.current = new Set(keys);
    for (const [k, t] of gone) if (now - t > FORGET_MS) gone.delete(k);
    if (before === null) return;
    for (const k of before) if (!present.current.has(k)) gone.set(k, now);
    const fresh = keys.filter((k) => !before.has(k) && (gone.get(k) === undefined || now - (gone.get(k) as number) >= NEW_AGAIN_MS));
    for (const k of keys) gone.delete(k);
    if (fresh.length === 0 || modeRef.current.hold) return;
    if (inFlight.current > 0) pendingTake.current = true;
    else setTakeUntil(now + TAKEOVER_MS);
  }, [sig]);
  useEffect(() => {
    const down = (e: Event) => {
      if (!rowRef.current?.contains(e.target as Node)) return;
      if (e.type === 'keydown' && (e as KeyboardEvent).repeat) return;
      inFlight.current = 1;
    };
    const up = () => {
      if (inFlight.current === 0) return;
      inFlight.current = 0;
      // After the click that follows the release has been dispatched.
      setTimeout(() => {
        if (inFlight.current > 0 || !pendingTake.current) return;
        pendingTake.current = false;
        if (!modeRef.current.hold) setTakeUntil(Date.now() + TAKEOVER_MS);
      }, 0);
    };
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    document.addEventListener('keyup', up, true);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', down, true);
    return () => {
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
      document.removeEventListener('keyup', up, true);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', down, true);
    };
  }, []);
  useEffect(() => {
    if (takeUntil === 0) return;
    const id = setTimeout(() => setTakeUntil(0), Math.max(0, takeUntil - Date.now()));
    return () => clearTimeout(id);
  }, [takeUntil]);

  /** What the last render drew, for the measuring below (set after the early returns). */
  const drawn = useRef<{ many: boolean; headKey: string } | null>(null);
  drawn.current = null;
  // After each render: whether a long set's second row fits above the deck's floor, and how far
  // the heading must give way so the page name shows whole. Never measured in tests (no layout).
  useLayoutEffect(() => {
    const m = drawn.current;
    if (!m) return;
    const tiles = tilesRef.current;
    const fits = m.many && tiles !== null && secondRowFits(tiles);
    if (fits !== twoRows) setTwoRows(fits);
    const hd = headRef.current;
    if (!hd) return;
    const level = headFit.key === m.headKey ? headFit.level : 0;
    if (level < 2 && hd.scrollWidth > hd.clientWidth + 1) setHeadFit({ key: m.headKey, level: (level + 1) as HeadFit });
    else if (headFit.key !== m.headKey) setHeadFit({ key: m.headKey, level });
  });

  if (read.status === 'loading' || read.status === 'absent') return null;
  /** The deck's lowest allowed stage y, on the row for the fit check to read. */
  const floor = deckFloorY();
  if (read.status === 'problem') {
    return (
      <section className="keys deck-row" data-floor={floor} aria-label="Now">
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
  // While a recorder runs, Auto shows the Recording page (Hold still wins, and stepping by hand still works).
  const onRecording = !hold && recording;
  if (hold) page = pages.find((p) => p.id === m.setId) ?? null;
  else if (takeUntil !== 0 && forYouOn) page = pages.find((p) => p.id === FOR_YOU) ?? null;
  else page = autoPage(sum);

  const pageSet = !onRecording && page?.kind === 'set' ? page.set : null;
  const allKeys = pageSet ? pageSet.keys.slice(0, MAX_KEYS) : [];
  const chunks = keyChunks(allKeys);
  const paged = allKeys.length > KEYS_PER_ROW && !twoRows;
  const chunkAt = paged && chunk.setId === pageSet?.id ? Math.min(chunk.at, chunks.length - 1) : 0;

  const runItem = (item: ForYouItem, detail: number) =>
    void fyGuard.run(`fy:${item.key}`, detail, async () => {
      try {
        showBrief(await runForYou(item));
      } catch (e) {
        showBrief(e instanceof ActionError ? e.message : 'Could not do that');
      }
    });

  const goTo = (p: Page | null) => {
    if (!p) return;
    setTakeUntil(0);
    setChunk({ setId: p.id, at: 0 });
    setMode({ hold: true, setId: p.id });
  };
  /** The arrows and the wheel step through the five-key parts of a long set first, then the pages. */
  const stepTo = (dir: 1 | -1) => {
    const next = chunkAt + dir;
    if (paged && pageSet && next >= 0 && next < chunks.length) {
      setTakeUntil(0);
      setChunk({ setId: pageSet.id, at: next });
      setMode({ hold: true, setId: pageSet.id });
      return;
    }
    goTo(stepPage(pages, onRecording ? null : (page?.id ?? null), dir));
  };
  const onWheel = (e: WheelEvent) => {
    if ((pages.length < 2 && !paged) || e.deltaY === 0) return;
    const now = Date.now();
    if (now - lastWheel.current < WHEEL_GAP_MS) return;
    lastWheel.current = now;
    stepTo(e.deltaY > 0 ? 1 : -1);
  };

  const pageName = onRecording ? RECORDING_PAGE : page ? (page.kind === 'foryou' ? 'For you' : page.set.name) : '';
  const more = !onRecording && page?.kind === 'foryou' && items.length > FOR_YOU_SHOWN ? ` · +${items.length - FOR_YOU_SHOWN} more` : '';
  const heading = page || onRecording ? `Now · ${pageName}${more}` : 'Now';
  const showChip = forYouOn && (onRecording || page?.kind !== 'foryou');
  const shownId = onRecording ? null : page?.id;
  // The Recording page is none of the pages: no dot is lit and no position is written while it shows.
  const pageAt = onRecording ? -1 : Math.max(0, pages.findIndex((p) => p.id === shownId));
  const headKey = `${heading}|${pages.length}|${showChip}|${items.length}|${brief ?? ''}`;
  const fit: HeadFit = headFit.key === headKey ? headFit.level : 0;
  drawn.current = { many: allKeys.length > KEYS_PER_ROW, headKey };
  const dotsShown = pages.length <= MAX_DOTS && fit < 1;
  const partText = paged ? `${chunkAt + 1}/${chunks.length}` : null;
  const where = sum.source === 'default' ? 'You are using the built-in keys. To change them put keys.json in the app\'s config folder; the wall never writes it.' : 'Keys come from keys.json and the built-in library.';

  const controls = (
    <span className="deck-hd-r">
      {showChip && (
        <button
          type="button"
          className={`deck-chip${fit >= 2 ? ' small' : ''}`}
          aria-label={`For you ${items.length}`}
          {...tip(`${items.length} thing${items.length === 1 ? '' : 's'} waiting on you. Click to see them.`)}
          onClick={() => goTo(pages.find((p) => p.id === FOR_YOU) ?? null)}
        >
          {fit >= 2 ? (
            <>
              <i className="deck-chip-dot" aria-hidden="true" />
              {items.length}
            </>
          ) : (
            `For you ${items.length}`
          )}
        </button>
      )}
      {(pages.length > 1 || paged) && (
        <>
          <button type="button" className="deck-arrow" aria-label="Previous page" {...tip(paged && chunkAt > 0 ? `Show keys ${(chunkAt - 1) * KEYS_PER_ROW + 1} to ${chunkAt * KEYS_PER_ROW} of ${pageName} and hold it` : 'Show the previous page of keys and hold it')} onClick={() => stepTo(-1)}>
            <IconChevronLeft size={20} stroke={2} aria-hidden="true" />
          </button>
          {!dotsShown && pages.length > 1 && !onRecording && (
            <span className="xs deck-pos" {...tip(`Page ${pageAt + 1} of ${pages.length}: ${pageName}. The arrows or the wheel step through them.`)}>
              {pageAt + 1} of {pages.length}
            </span>
          )}
          <span className={`deck-dots${onRecording ? ' rec' : ''}`} role="tablist" aria-label="Pages" hidden={!dotsShown || pages.length < 2}>
            {pages.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={p.id === shownId}
                aria-label={p.kind === 'foryou' ? 'For you' : p.set.name}
                className={`deck-dot${p.id === shownId ? ' on' : ''}${p.kind === 'foryou' ? ' am' : ''}`}
                {...tip(p.kind === 'foryou' ? 'For you: what waits on you' : `Keys: ${p.set.name}`)}
                onClick={() => goTo(p)}
              >
                <i aria-hidden="true" />
              </button>
            ))}
          </span>
          <button type="button" className="deck-arrow" aria-label="Next page" {...tip(paged && chunkAt < chunks.length - 1 ? `Show the rest of ${pageName}'s keys and hold it` : 'Show the next page of keys and hold it')} onClick={() => stepTo(1)}>
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
    <div className="row sb deck-hd" ref={headRef}>
      {brief ? (
        <span className="deck-brief-l" role="status" title={brief}>
          {brief}
        </span>
      ) : (
        <span className="k deck-name" {...tip(partText ? `${where} Keys ${chunkAt * KEYS_PER_ROW + 1} to ${Math.min(allKeys.length, (chunkAt + 1) * KEYS_PER_ROW)} of ${allKeys.length}; the arrows show the rest.` : where)}>
          {heading}
          {partText && <span className="deck-part">{partText}</span>}
        </span>
      )}
      {controls}
    </div>
  );

  if (onRecording) {
    return (
      <section className="keys deck-row" data-floor={floor} aria-label={heading} onWheel={onWheel} ref={rowRef}>
        {head}
        <RecordingKeyRow press={press} onKeyDown={onKeyDown} />
      </section>
    );
  }

  if (page?.kind === 'foryou') {
    return (
      <section className="keys deck-row" data-floor={floor} aria-label={heading} onWheel={onWheel} ref={rowRef}>
        {head}
        <ForYouList items={items} onRun={runItem} />
      </section>
    );
  }

  // Nothing to show: no set of its own, no general set (or nothing in front yet).
  if (!page) {
    const idle = sum.front === 'idle';
    return (
      <section className="keys deck-row" data-floor={floor} aria-label="Now" onWheel={onWheel} ref={rowRef}>
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
  const base = paged ? chunkAt * KEYS_PER_ROW : 0;
  const keys = paged ? chunks[chunkAt] : allKeys;
  const ok = acceptsFront(sum, set);
  return (
    <section className="keys deck-row" data-floor={floor} aria-label={heading} onWheel={onWheel} ref={rowRef}>
      {head}
      <div ref={tilesRef} className={`deck-tiles keys-tiles${keys.length > KEYS_PER_ROW ? ' two' : ''}`} style={{ gridTemplateColumns: `repeat(${columnsFor(keys.length)}, minmax(0, 1fr))` }}>
        {keys.map((k, j) => {
          const i = base + j;
          const layoutOff = isLayoutAction(k.action) && arrange !== true;
          const wrongApp = k.action === null && hold && !ok;
          const label = keyLabel(k.label, set.name);
          return (
            <button
              key={`${set.id}-${i}`}
              type="button"
              className={`deck-tile key-tile${wrongApp || layoutOff ? ' off' : ''}`}
              aria-label={k.label}
              data-kind={wrongApp || layoutOff ? undefined : setKeyKind(set, k, i, libIdx)}
              aria-disabled={layoutOff || wrongApp || undefined}
              {...tip(
                layoutOff
                  ? layoutOffReason(arrange)
                  : wrongApp
                    ? `${k.label}: ${set.name} is not in front, so this would send nothing. Bring ${set.name} forward, or click Auto to follow the app in front.`
                    : k.action
                      ? k.label
                      : set.general
                        ? `Send ${k.label} to the app in front`
                        : `Send ${k.label} to ${set.name}`,
              )}
              onKeyDown={onKeyDown(k.action)}
              onClick={(e) => {
                // A key that cannot be sent never reaches Rust: the heading says why, nothing is invoked.
                if (wrongApp) return showBrief(sendReason('no app', set, hold));
                if (!layoutOff && !keyboardOnMouseKey(k.action, e.detail)) void press(`${set.id}:${i}`, e.detail, { command: 'wall2_keys_send', args: { setId: set.id, index: i } }, k.label, k.action, set, hold);
              }}
            >
              <KeyIcon name={k.icon} size={20} />
              <span className="deck-lbl">{label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export type { KeysSummary };
