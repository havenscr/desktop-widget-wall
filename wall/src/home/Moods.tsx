import { IconBulbOff, IconCheck, IconChevronLeft, IconChevronRight, IconLoader2, IconSun, IconSunLow } from '@tabler/icons-react';
import { tip } from '../ui/HoverTip';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { invoke } from '../bridge/tauri';
import { NOT_CONFIGURED } from '../tasks/model';
import { reviewNow } from '../ui/reviewClock';
import { useVisible } from '../ui/useVisible';
import { useCentreStatus } from './centreSources';
import { MoodArt } from './MoodArt';
import { OFFICE_NUDGE, useHome } from '../studio/homeStore';
import { blockText, moodFailText } from '../studio/moodRow';
import { attachPoll, isOn as lightSyncOn, SYNC_POLL_MS, useLightSync } from '../studio/lightsync/store';
import { useMoodsPolling } from '../studio/useMoodsPolling';

export interface Mood {
  id: string;
  label: string;
  /** False when the home app has never saved this mood (Still Working before its first
   * save): the card is quiet and a tap sends nothing. Missing counts as saved. */
  saved?: boolean;
  /** When the home app's schedule next runs this mood, epoch ms. The home app does not send
   * it yet; when it does, the card says "In N min" within the hour ahead. */
  nextAtMs?: number | null;
  /** "scene" for the three routine cards the wall adds after the home app's moods; a tap starts
   * that routine. Missing counts as a mood. */
  kind?: 'mood' | 'scene';
  /** The line under a scene's name, the routine's description. */
  line?: string;
}

/**
 * Four mood cards share the row. With more, a narrow More card follows them (the next
 * mood peeking, "N more", dots), and a click or the wheel slides by four; at the end it
 * reads Back and slides to the start.
 */
export const MOODS_PAGE = 4;
/** One wheel step per gesture: further wheel events within this time are ignored. */
export const WHEEL_MS = 450;

/** The first mood shown on page `page`: steps of four, the last page showing the last four. */
export function pageStart(page: number, count: number): number {
  return Math.max(0, Math.min(page * MOODS_PAGE, count - MOODS_PAGE));
}

/** Pages of four for `count` moods (one when four or fewer). */
export function pageCount(count: number): number {
  return Math.max(1, Math.ceil(count / MOODS_PAGE));
}

/** "In 4 min" when the mood is scheduled within the next hour, otherwise null. */
export function inText(nextAtMs: number | null | undefined, now: number): string | null {
  if (typeof nextAtMs !== 'number' || !Number.isFinite(nextAtMs)) return null;
  const mins = Math.ceil((nextAtMs - now) / 60_000);
  if (mins < 1 || mins > 60) return null;
  return `In ${mins} min`;
}

export const MOODS_REFRESH_MS = 10 * 60_000;
export const DONE_MS = 2000;
export const ERROR_MS = 5000;
export const LAST_MOOD_KEY = 'wall2-last-mood';
/**
 * When the last mood was applied, beside `wall2-last-mood` (whose plain id format stays as
 * it is): `{"id":"evening","at":<ms>}`. Unwind's Room card marks that mood for three hours.
 */
export const LAST_MOOD_AT_KEY = 'wall2-last-mood-at';
/** The last good list, so the cards stay when the home app is briefly away. */
export const MOODS_CACHE_KEY = 'wall2-moods-cache';

/** The line under each mood the concept drew, and Still Working's; other moods have none. */
const NOTES: Record<string, string> = {
  stillWorking: 'bright and focused',
  day: 'bright and cool',
  evening: 'warm and golden',
  lateNight: 'dim and violet',
  movie: 'TV on, lights low',
  goodnight: 'everything off',
};

export function moodNote(id: string): string | null {
  return NOTES[id] ?? null;
}

/** What an unsaved mood's card says in place of its line. */
export const UNSAVED_NOTE = 'Not set up yet';

function readCache(): Mood[] {
  try {
    const raw = JSON.parse(localStorage.getItem(MOODS_CACHE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((m): m is Mood => !!m && typeof m.id === 'string' && typeof m.label === 'string');
  } catch {
    return [];
  }
}

function writeCache(list: Mood[]): void {
  try {
    localStorage.setItem(MOODS_CACHE_KEY, JSON.stringify(list.map((m) => ({ id: m.id, label: m.label, ...(m.saved === false ? { saved: false } : {}), ...(m.kind === 'scene' ? { kind: 'scene' as const } : {}), ...(m.line ? { line: m.line } : {}) }))));
  } catch {
    /* storage can be blocked; the cache is a convenience */
  }
}

/** "lateNight" becomes "Late Night". The server sends a label from the id; this is the fallback. */
export function moodLabel(mood: Mood): string {
  return mood.label || mood.id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

function readLast(): string | null {
  try {
    return localStorage.getItem(LAST_MOOD_KEY);
  } catch {
    return null;
  }
}

function writeLast(id: string): void {
  try {
    localStorage.setItem(LAST_MOOD_KEY, id);
    localStorage.setItem(LAST_MOOD_AT_KEY, JSON.stringify({ id, at: Date.now() }));
  } catch {
    /* storage can be blocked; the mark is a convenience */
  }
}

type Phase = { id: string; kind: 'working' | 'done' } | null;

/** Which moods the Home tab shows: the condo's (the home app's mood cards) or the office's (its office switch presets). */
export type MoodsWhich = 'condo' | 'office';
export const MOODS_WHICH_KEY = 'wall2-moods-which';

/** The choice this viewer made last (this browser only); the condo until one is made. */
export function readWhich(): MoodsWhich {
  try {
    return localStorage.getItem(MOODS_WHICH_KEY) === 'office' ? 'office' : 'condo';
  } catch {
    return 'condo';
  }
}

function writeWhich(w: MoodsWhich): void {
  try {
    localStorage.setItem(MOODS_WHICH_KEY, w);
  } catch {
    /* storage can be blocked; the choice is a convenience */
  }
}

/** The heading: two words to pick from, Condo and Office; the one showing is lit. */
function MoodsSwitch({ which, pick }: { which: MoodsWhich; pick: (w: MoodsWhich) => void }) {
  return (
    <span className="k moods-switch" role="group" aria-label="Moods for">
      {(['condo', 'office'] as const).map((w) => (
        <button
          key={w}
          type="button"
          className={`moods-pick${which === w ? ' on' : ''}`}
          data-moods-which={w}
          aria-pressed={which === w}
          onClick={() => pick(w)}
          {...tip(w === 'condo' ? "Shows the condo's moods" : "Shows the office moods, the ones on Unwind's Office moods row")}
        >
          {w === 'condo' ? 'Condo' : 'Office'}
        </button>
      ))}
    </span>
  );
}

type Status = 'loading' | 'ready' | 'unconfigured' | 'error';

/** Why the nudge buttons do nothing: the home app is away, this PC may not write, or music sync owns the lights. */
export type NudgeMode = 'ready' | 'offline' | 'blocked' | 'sync';

/** The level bar on the active Office card: the live room level, the floor, and the two step buttons. */
export interface NudgeUi {
  /** The card that carries the bar (the active mood). */
  id: string;
  level: number;
  floor: number;
  mode: NudgeMode;
  /** The tip of a button that does nothing because of `mode`. */
  modeTip: string | null;
  /** The button whose write is out. */
  busy: 'up' | 'down' | null;
  onNudge: (dir: 'up' | 'down') => void;
}

export const NUDGE_TIPS = {
  offline: 'The home app is not answering',
  sync: 'Music sync is driving the lights',
  up: 'One step brighter. Setting the mood again resets the level',
} as const;

export const floorTip = (floor: number): string => `Floor ${floor}%: dimmer stops here so the room stays bright enough to work`;

function NudgeBar({ nudge }: { nudge: NudgeUi }) {
  // The bar reads the music sync state, so it keeps that state fresh while mounted: an
  // initial read, then a steady read (the store's own timer runs only while sync is on).
  useEffect(() => {
    const detach = attachPoll();
    void useLightSync.getState().poll();
    const id = setInterval(() => void useLightSync.getState().poll(), SYNC_POLL_MS);
    return () => {
      clearInterval(id);
      detach();
    };
  }, []);
  const { level, floor, mode, busy } = nudge;
  const atFloor = level <= floor;
  const atMax = level >= 100;
  const live = mode === 'ready';
  const downOff = !live || atFloor || busy !== null;
  const upOff = !live || atMax || busy !== null;
  const dim = mode === 'offline' || mode === 'blocked';
  const downTip = !live ? nudge.modeTip : atFloor ? floorTip(floor) : `One step dimmer, never under ${floor}%. Setting the mood again resets the level`;
  const upTip = !live ? nudge.modeTip : atMax ? 'Already at full brightness' : NUDGE_TIPS.up;
  const word = atFloor && live ? 'Floor' : atMax && live ? 'Max' : `${level}%`;
  const cls = (off: boolean, disabledLook: boolean) => `nudge-btn${disabledLook ? ' off' : off ? ' dis' : ''}`;
  return (
    <div className="mood-nudge" data-nudge="bar">
      <button
        type="button"
        className={cls(downOff, dim)}
        data-nudge-dir="down"
        aria-label={downOff ? 'Dimmer (disabled)' : 'Dimmer'}
        aria-disabled={downOff || undefined}
        onClick={() => !downOff && nudge.onNudge('down')}
        {...tip(downTip ?? '')}
      >
        {busy === 'down' ? <IconLoader2 className="nudge-spin" size={22} stroke={2} aria-hidden="true" /> : <IconSunLow size={22} stroke={2} aria-hidden="true" />}
      </button>
      <span className={dim ? 'nudge-track offt' : 'nudge-track'} role="img" aria-label={`Room at ${level}%, floor ${floor}%`}>
        <span className="nudge-fz" style={{ width: `${floor}%` }} />
        <span className="nudge-fill" style={{ left: `${floor}%`, width: `${Math.max(0, level - floor)}%` }} />
        <span className="nudge-tick" style={{ left: `${floor}%` }} />
      </span>
      <span className={`nudge-lv${atFloor && live ? ' floorword' : ''}${mode === 'offline' ? ' faded' : ''}`}>{word}</span>
      <button
        type="button"
        className={cls(upOff, dim)}
        data-nudge-dir="up"
        aria-label={upOff ? 'Brighter (disabled)' : 'Brighter'}
        aria-disabled={upOff || undefined}
        onClick={() => !upOff && nudge.onNudge('up')}
        {...tip(upTip ?? '')}
      >
        {busy === 'up' ? <IconLoader2 className="nudge-spin" size={22} stroke={2} aria-hidden="true" /> : <IconSun size={22} stroke={2} aria-hidden="true" />}
      </button>
    </div>
  );
}

interface SectionProps {
  /** Office only: the level bar for the active card, or null when none shows. Undefined (Condo) wraps nothing and shows nothing. */
  nudge?: NudgeUi | null;
  head: ReactNode;
  moods: Mood[];
  status: Status;
  error: string | null;
  phase: Phase;
  onTap: (id: string) => void;
  isOn: (id: string) => boolean;
  subOf: (m: Mood) => string | null;
  now: number;
  visible: boolean;
}

/** The condo's moods: read from the home app, a tap applies one. Always mounted, so the centre card hears it whichever list shows. */
function useCondoMoods(): Omit<SectionProps, 'head'> {
  const visible = useVisible();
  const [status, setStatus] = useState<Status>('loading');
  const [moods, setMoods] = useState<Mood[]>(readCache);
  const [phase, setPhase] = useState<Phase>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(readLast);
  const [now, setNow] = useState(() => (reviewNow ?? Date.now)());
  const [okAt, setOkAt] = useState<number | null>(null);
  const mounted = useRef(false);
  const busy = useRef(false);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(doneTimer.current);
      clearTimeout(errorTimer.current);
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const list = await invoke<Mood[]>('wall2_moods');
      if (!mounted.current) return;
      const next = Array.isArray(list) ? list : [];
      setMoods(next);
      writeCache(next);
      setStatus('ready');
      setOkAt((reviewNow ?? Date.now)());
    } catch (e) {
      if (!mounted.current) return;
      const text = e instanceof Error ? e.message : String(e);
      setStatus(text === NOT_CONFIGURED ? 'unconfigured' : 'error');
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    void load();
    const id = setInterval(() => void load(), MOODS_REFRESH_MS);
    return () => clearInterval(id);
  }, [visible, load]);

  // "In N min" counts down: a tick every 30 seconds while a mood carries a schedule.
  const scheduled = moods.some((m) => typeof m.nextAtMs === 'number');
  useEffect(() => {
    if (!visible || !scheduled) return;
    const id = setInterval(() => setNow((reviewNow ?? Date.now)()), 30_000);
    return () => clearInterval(id);
  }, [visible, scheduled]);

  const tap = useCallback(async (id: string, saved: boolean) => {
    // A mood the home app never saved would answer 409: nothing is sent.
    if (busy.current || !saved) return;
    busy.current = true;
    clearTimeout(doneTimer.current);
    clearTimeout(errorTimer.current);
    setError(null);
    setPhase({ id, kind: 'working' });
    try {
      const outcome = await invoke<{ superseded?: boolean } | null | undefined>('wall2_apply_mood', { id });
      if (!mounted.current) return;
      // A newer press took over: this mood did not run, so it is not marked as set.
      if (outcome?.superseded === true) {
        setPhase(null);
        return;
      }
      writeLast(id);
      setLast(id);
      setPhase({ id, kind: 'done' });
      doneTimer.current = setTimeout(() => setPhase(null), DONE_MS);
    } catch (e) {
      if (!mounted.current) return;
      setPhase(null);
      const text = e instanceof Error ? e.message : String(e);
      if (text === NOT_CONFIGURED) {
        setStatus('unconfigured');
        return;
      }
      setError(text || 'Could not set the mood');
      errorTimer.current = setTimeout(() => setError(null), ERROR_MS);
    } finally {
      busy.current = false;
    }
  }, []);

  // Tell the centre what this source can show, so two missing sources become one card.
  const publish = useCentreStatus((st) => st.set);
  const centreState = status === 'unconfigured' ? 'unconfigured' : moods.length > 0 || status === 'ready' ? 'ok' : status === 'error' ? 'down' : 'loading';
  useEffect(() => {
    publish('moods', { state: centreState, okAt, check: () => void load() });
  }, [publish, centreState, okAt, load]);

  return { moods, status, error, phase, onTap: (id) => void tap(id, moods.find((x) => x.id === id)?.saved !== false), isOn: (id) => last === id, subOf: (m) => (m.saved === false ? UNSAVED_NOTE : (m.line ?? moodNote(m.id))), now, visible };
}

/** The cards, one row of three with the More card past three. The same for either list. */
function MoodSection({ nudge, head, moods, status, error, phase, onTap, isOn, subOf, now, visible }: SectionProps) {
  const [page, setPage] = useState(0);
  const wheelAt = useRef(-Infinity);
  if (status === 'ready' && moods.length === 0) {
    return (
      <section className="moods" aria-label="Moods">
        <div className="moods-head">{head}</div>
        <div className="mood-empty">
          <IconBulbOff size={34} stroke={1.6} aria-hidden="true" />
          <span>No moods set up in the home app yet</span>
        </div>
      </section>
    );
  }
  if (status === 'loading' && !visible && moods.length === 0) return null;

  // A list (fresh, or the last good one while the home app is away) shows as cards.
  const showCards = moods.length > 0 && status !== 'unconfigured';
  let note: string | null = null as string | null;
  if (status === 'unconfigured') note = 'Not set up';
  else if (status === 'error') note = 'Home app not reachable';
  const paged = moods.length > MOODS_PAGE;
  const pages = pageCount(moods.length);
  const p = Math.min(page, pages - 1);
  const start = paged ? pageStart(p, moods.length) : 0;
  const shown = paged ? moods.slice(start, start + MOODS_PAGE) : moods;
  const atEnd = start + MOODS_PAGE >= moods.length;
  const peek = paged ? (atEnd ? moods[0] : moods[start + MOODS_PAGE]) : null;
  const left = moods.length - (start + MOODS_PAGE);
  const step = (dir: 1 | -1) => setPage((cur) => Math.max(0, Math.min(pages - 1, Math.min(cur, pages - 1) + dir)));
  const rowStyle = paged ? undefined : { gridTemplateColumns: `repeat(${Math.max(moods.length, 1)}, minmax(0, 1fr))` };
  if (!note && !error && paged) note = `${moods.length} moods`;
  return (
    <section className={showCards ? 'moods' : 'moods bare'} aria-label="Moods">
      <div className="moods-head">
        {head}
        <span className={error || status === 'error' ? 's warn-text' : 's'} role="alert">
          {error ?? note}
        </span>
      </div>
      {!showCards && status === 'loading' && <div className="mood-skel" aria-hidden="true" />}
      {showCards && (
        <div
          className={paged ? (start > 0 ? 'mood-row paged has-back' : 'mood-row paged') : 'mood-row'}
          style={rowStyle}
          onWheel={
            paged
              ? (e) => {
                  const d = e.deltaY || e.deltaX;
                  if (!d || e.timeStamp - wheelAt.current < WHEEL_MS) return;
                  wheelAt.current = e.timeStamp;
                  step(d > 0 ? 1 : -1);
                }
              : undefined
          }
        >
          {shown.map((m) => {
            const busyHere = phase?.id === m.id ? phase.kind : null;
            const on = isOn(m.id);
            const saved = m.saved !== false;
            const barHere = nudge != null && nudge.id === m.id && saved;
            // The live level replaces the preset line on the card that carries the bar.
            const sub = barHere ? null : subOf(m);
            const soon = on || !saved ? null : inText(m.nextAtMs, now);
            const cls = ['mood-btn', busyHere ?? '', on ? 'last' : '', saved ? '' : 'unsaved', barHere ? 'nudged' : ''].filter(Boolean).join(' ');
            const rowKey = paged ? `${start}:${m.id}` : m.id;
            const card = (
              <button
                key={nudge === undefined ? rowKey : undefined}
                type="button"
                className={cls}
                data-mood={m.id}
                disabled={phase?.kind === 'working'}
                aria-label={!saved ? `${moodLabel(m)}, not set up yet` : on ? `${moodLabel(m)}, on now` : soon ? `${moodLabel(m)}, ${soon.toLowerCase()}` : moodLabel(m)}
                aria-disabled={saved ? undefined : true}
                title={saved ? `Set the ${moodLabel(m)} mood${sub ? `: ${sub}` : ''}${on ? '. Last set from this wall' : ''}` : `${moodLabel(m)} is not set up in the home app yet`}
                onClick={() => onTap(m.id)}
              >
                <MoodArt id={m.id} />
                {on && <u className="mood-tag">On now</u>}
                {soon && <u className="mood-tag soon">{soon}</u>}
                {busyHere && (
                  <span className="mood-busy" aria-hidden="true">
                    {busyHere === 'working' ? <IconLoader2 size={26} stroke={2} /> : <IconCheck size={26} stroke={2.4} />}
                  </span>
                )}
                <span className="mood-lb">
                  <b className="mood-name">{moodLabel(m)}</b>
                  {sub && <span className="mood-sub">{sub}</span>}
                </span>
              </button>
            );
            if (nudge === undefined) return card;
            return (
              <div key={rowKey} className="mood-cell">
                {card}
                {barHere && nudge && <NudgeBar nudge={nudge} />}
              </div>
            );
          })}
          {paged && start > 0 && (
            <button type="button" className="mood-back" aria-label="Previous moods" onClick={() => step(-1)} {...tip('Back to the moods before these')}>
              <IconChevronLeft size={22} stroke={2.2} aria-hidden="true" />
            </button>
          )}
          {paged && peek && (
            <button
              type="button"
              className={atEnd ? 'mood-more back' : 'mood-more'}
              aria-label={atEnd ? 'Back to the first moods' : `${left} more moods`}
              onClick={() => (atEnd ? setPage(0) : step(1))}
              {...tip(atEnd ? 'Back to the first moods' : `Next: ${moods.slice(start + MOODS_PAGE, start + MOODS_PAGE * 2).map(moodLabel).join(', ')}`)}
            >
              <span className="mood-peek" aria-hidden="true">
                <MoodArt id={peek.id} />
              </span>
              <span className="mood-more-in">
                <span className="mood-arrow" aria-hidden="true">
                  {atEnd ? <IconChevronLeft size={22} stroke={2.2} /> : <IconChevronRight size={22} stroke={2.2} />}
                </span>
                <b>{atEnd ? 'Back' : `${left} more`}</b>
                <span className="mood-dots" aria-hidden="true">
                  {Array.from({ length: pages }, (_, i) => (
                    <i key={i} className={i === p ? 'on' : ''} />
                  ))}
                </span>
              </span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** The office moods as the same cards: the office switch presets the home app lists, a tap applies one. */
function useOfficeMoods(): Omit<SectionProps, 'head'> {
  useMoodsPolling();
  const m = useHome((s) => s.moods);
  const word = useHome((s) => s.moodsWord);
  const applying = useHome((s) => s.applying);
  const fail = useHome((s) => s.moodFail);
  const visible = useVisible();
  const syncing = useLightSync((st) => lightSyncOn(st));
  const list = m ? m.moods : [];
  const status: Status = word === 'not-set-up' || word === 'home-not-set-up' ? 'unconfigured' : word !== null ? 'error' : m ? 'ready' : 'loading';
  const blocked = m !== null && !m.canWrite;
  const phase: Phase = applying !== null && list.some((x) => x.id === applying) ? { id: applying, kind: 'working' } : null;
  const error = fail ? moodFailText(fail.word) : blocked ? (m.writeBlock === 'needs-private-address' ? moodFailText('needs-private-address') : moodFailText('not-set-up')) : null;
  const n = m?.nudge ?? null;
  const mode: NudgeMode = word !== null ? 'offline' : blocked ? 'blocked' : syncing ? 'sync' : 'ready';
  const busy = applying === `${OFFICE_NUDGE}-up` ? 'up' : applying === `${OFFICE_NUDGE}-down` ? 'down' : null;
  const nudge: NudgeUi | null = n
    ? {
        id: n.mood,
        level: n.level,
        floor: n.floor,
        mode,
        modeTip: mode === 'offline' ? NUDGE_TIPS.offline : mode === 'blocked' && m ? blockText(m) : mode === 'sync' ? NUDGE_TIPS.sync : null,
        busy,
        onNudge: (dir) => {
          if (mode !== 'ready' || useHome.getState().applying !== null) return;
          void useHome.getState().nudgeMood(dir);
        },
      }
    : null;
  return {
    nudge,
    moods: list.map((x) => ({ id: x.id, label: x.label })),
    status,
    error,
    phase,
    onTap: (id) => {
      if (blocked || applying !== null) return;
      void useHome.getState().applyMood(id);
    },
    isOn: (id) => list.some((x) => x.id === id && x.active),
    subOf: (x) => list.find((y) => y.id === x.id)?.line ?? null,
    now: 0,
    visible,
  };
}

function OfficeSection({ head }: { head: ReactNode }) {
  return <MoodSection head={head} {...useOfficeMoods()} />;
}

/**
 * The Home tab's mood cards, each with its painted art. The heading picks Condo (today's moods) or Office (the office
 * moods from the home app); the pick is remembered for this viewer. Lights change only when a card is tapped.
 */
export function Moods() {
  const [which, setWhich] = useState<MoodsWhich>(readWhich);
  const condo = useCondoMoods();
  const pick = (w: MoodsWhich) => {
    setWhich(w);
    writeWhich(w);
  };
  const head = <MoodsSwitch which={which} pick={pick} />;
  return which === 'office' ? <OfficeSection key="office" head={head} /> : <MoodSection key="condo" head={head} {...condo} />;
}
