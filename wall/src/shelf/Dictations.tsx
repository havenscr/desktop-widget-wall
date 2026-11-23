import { IconCopy, IconMicrophone } from '@tabler/icons-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { copyDictation, dictationError, readDictations, type Dictation, type DictationError, type DictationText } from '../bridge/dictations';
import { tip } from '../ui/HoverTip';
import { useListEdge } from '../ui/useListEdge';
import { useVisible } from '../ui/useVisible';
import { PREVIEW_DELAY_MS, recentWhen } from './recent';

/** How often the list is read while the Shelf is visible. */
export const DICTATIONS_POLL_MS = 30_000;
/** How long a button says Copied. */
export const COPIED_MS = 1400;
/** The pointer leaving a row has this long to reach the hover card before the card closes. */
const LEAVE_MS = 150;

const STAGE_W = 2560;
const STAGE_H = 720;
const CARD_W = 440;
const CARD_GAP = 16;
const CARD_EDGE = 20;
const BAND_FLOOR = 510;

/** Words for each answer Rust gives when it cannot list. */
const LINES: Record<'not-installed' | 'no-history' | 'changed', string> = {
  'not-installed': 'Wispr Flow is not installed on this PC.',
  'no-history': 'Wispr Flow has no dictation history. Check its privacy setting.',
  changed: 'Wispr Flow changed its history format. The wall cannot read it yet.',
};

interface State {
  status: 'loading' | 'ready' | 'error';
  items: Dictation[];
  error: DictationError | null;
}

/** The dictations, read now, every 30 seconds while the page is visible and when the window gets focus. A busy or failed read keeps the list already shown. */
export function useDictations(): [State, () => void] {
  const visible = useVisible();
  const [state, setState] = useState<State>({ status: 'loading', items: [], error: null });
  const seq = useRef(0);
  const reader = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    const read = () => {
      const mine = ++seq.current;
      readDictations().then(
        (items) => {
          if (alive && mine === seq.current) setState({ status: 'ready', items, error: null });
        },
        (e: unknown) => {
          if (!alive || mine !== seq.current) return;
          const word = dictationError(e);
          const soft = word === 'busy' || word === 'failed';
          setState((s) => (soft && s.items.length > 0 ? s : { status: 'error', items: [], error: word }));
        },
      );
    };
    reader.current = read;
    read();
    const timer = setInterval(read, DICTATIONS_POLL_MS);
    window.addEventListener('focus', read);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('focus', read);
    };
  }, [visible]);
  return [state, useCallback(() => reader.current(), [])];
}

/** "9:40 AM" today, "Yesterday", a weekday, or a date; empty when the time is not known. */
function whenOf(d: Dictation): string {
  const ms = d.at ? Date.parse(d.at) : NaN;
  return Number.isFinite(ms) ? recentWhen(ms) : '';
}

/** "9:40 AM · Outlook": the time and the app, whichever are known. */
function metaOf(d: Dictation): string {
  return [whenOf(d), d.app].filter((x) => x !== '').join(' · ');
}

/** Where the hover card for a row goes, in the stage's design pixels: right of the card, level with the row. */
interface Place {
  left: number;
  mid: number;
  host: Element | null;
  /** The lowest the card may reach: the band's floor, above the ribbon. */
  floor: number;
}

function placeFor(row: HTMLElement): Place {
  const stage = row.closest('.stage');
  const card = (row.closest('.rf-card') ?? row).getBoundingClientRect();
  const r = row.getBoundingClientRect();
  const s = stage ? stage.getBoundingClientRect() : { left: 0, top: 0, width: 0 };
  const scale = stage && s.width > 0 ? s.width / STAGE_W : 1;
  const rib = document.querySelector('.rib');
  const ribTop = rib ? (rib.getBoundingClientRect().top - s.top) / scale : STAGE_H;
  return {
    left: (card.right - s.left) / scale + CARD_GAP,
    mid: (r.top + r.height / 2 - s.top) / scale,
    host: stage,
    floor: Math.min(BAND_FLOOR, ribTop),
  };
}

/** The Shelf's Dictations list: the newest dictations from Wispr Flow's history, each with Copy (cleaned text) and Raw (before the AI pass). Resting on a row shows both versions in full. */
export function Dictations() {
  const [state, retry] = useDictations();
  const { items } = state;
  const edge = useListEdge([items.length, state.status]);
  const [done, setDone] = useState<{ key: string; word: string } | null>(null);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [shown, setShown] = useState<{ id: string; place: Place } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (doneTimer.current) clearTimeout(doneTimer.current);
    };
  }, []);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setShown(null);
  }, []);

  /** The pointer left the row or the card: closes after a short grace so it can cross the gap. */
  const leave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(hide, LEAVE_MS);
  }, [hide]);

  const rest = (d: Dictation, row: HTMLElement) => {
    hide();
    timer.current = setTimeout(() => {
      timer.current = null;
      if (alive.current) setShown({ id: d.id, place: placeFor(row) });
    }, PREVIEW_DELAY_MS);
  };

  const shownId = shown?.id;
  useEffect(() => {
    if (shownId !== undefined && !items.some((d) => d.id === shownId)) hide();
  }, [items, shownId, hide]);
  useEffect(() => {
    if (shownId === undefined) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shownId, hide]);

  const copy = (d: Dictation, which: DictationText) => {
    const key = `${d.id}:${which}`;
    const say = (word: string) => {
      if (!alive.current) return;
      setDone({ key, word });
      if (doneTimer.current) clearTimeout(doneTimer.current);
      doneTimer.current = setTimeout(() => setDone(null), COPIED_MS);
    };
    copyDictation(d.id, which).then(
      () => say('Copied'),
      () => say('Failed'),
    );
  };

  const label = (d: Dictation, which: DictationText, idle: string) => (done?.key === `${d.id}:${which}` ? done.word : idle);

  if (state.status === 'loading') return null;
  if (state.status === 'error') {
    const soft = state.error === 'busy' || state.error === 'failed';
    return (
      <div className="dc-state">
        <p className="shelf-note">{soft ? 'Could not read the Wispr Flow history.' : LINES[state.error as keyof typeof LINES]}</p>
        {soft ? (
          <button type="button" className="dc-btn" onClick={retry} {...tip('Reads the Wispr Flow history again')}>
            Try again
          </button>
        ) : null}
      </div>
    );
  }
  if (items.length === 0) return <p className="shelf-note">No dictations yet.</p>;

  const shownItem = shown ? items.find((d) => d.id === shown.id) : undefined;
  return (
    <>
      <ul
        ref={edge.ref}
        className={`dc-rows ${edge.className}`}
        onScroll={() => {
          hide();
          edge.onScroll();
        }}
      >
        {items.map((d) => (
          <li key={d.id} className="dc-row" onPointerEnter={(e: ReactPointerEvent<HTMLLIElement>) => rest(d, e.currentTarget)} onPointerLeave={leave}>
            <div className="dc-text">
              <span className="dc-line">{d.clean.replace(/\s+/g, ' ')}</span>
              <span className="dc-meta">{metaOf(d)}</span>
            </div>
            <button type="button" className="dc-btn" aria-label={`Copy the cleaned text, ${metaOf(d) || 'dictation'}`} onClick={() => copy(d, 'clean')} {...tip('Copies the cleaned text')}>
              <span className="dc-btn-text">{label(d, 'clean', 'Copy')}</span>
            </button>
            <button type="button" className="dc-btn dc-raw" aria-label={`Raw: copy what you said, ${metaOf(d) || 'dictation'}`} onClick={() => copy(d, 'raw')} {...tip("Copies what you said, before Wispr Flow's AI pass")}>
              <span className="dc-btn-text">{label(d, 'raw', 'Raw')}</span>
            </button>
          </li>
        ))}
      </ul>
      {shown && shownItem ? <HoverCard item={shownItem} place={shown.place} label={label} copy={copy} onEnter={() => {
          if (timer.current) clearTimeout(timer.current);
          timer.current = null;
        }} onLeave={leave} /> : null}
    </>
  );
}

/** Both versions in full, with a copy button for each. It sits right of the Recent files card and stays inside the band. */
function HoverCard({
  item,
  place,
  label,
  copy,
  onEnter,
  onLeave,
}: {
  item: Dictation;
  place: Place;
  label: (d: Dictation, which: DictationText, idle: string) => string;
  copy: (d: Dictation, which: DictationText) => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [top, setTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    const lowest = Math.max(CARD_EDGE, place.floor - h);
    setTop(Math.max(CARD_EDGE, Math.min(place.mid - h / 2, lowest)));
  }, [place, item]);
  const meta = [metaOf(item), item.words > 0 ? `${item.words} words` : ''].filter((x) => x !== '').join(' · ');
  const card = (
    <div
      ref={ref}
      className="dc-card"
      role="group"
      aria-label="Both versions of this dictation"
      style={{ left: place.left, top: top ?? CARD_EDGE, width: CARD_W, maxHeight: place.floor - CARD_EDGE, visibility: top === null ? 'hidden' : 'visible' }}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <span className="dc-card-meta">{meta}</span>
      <b className="dc-card-key">Cleaned</b>
      <div className="dc-card-text">{item.clean}</div>
      <b className="dc-card-key">What you said</b>
      <div className="dc-card-text dc-card-raw">{item.raw}</div>
      <div className="dc-card-acts">
        <button type="button" className="dc-btn" onClick={() => copy(item, 'clean')} {...tip('Copies the cleaned text')}>
          <IconCopy size={20} stroke={1.8} aria-hidden="true" />
          <span className="dc-btn-text">{label(item, 'clean', 'Copy cleaned')}</span>
        </button>
        <button type="button" className="dc-btn dc-raw" onClick={() => copy(item, 'raw')} {...tip("Copies what you said, before Wispr Flow's AI pass")}>
          <IconMicrophone size={20} stroke={1.8} aria-hidden="true" />
          <span className="dc-btn-text">{label(item, 'raw', 'Copy raw')}</span>
        </button>
      </div>
    </div>
  );
  return place.host ? createPortal(card, place.host) : card;
}
