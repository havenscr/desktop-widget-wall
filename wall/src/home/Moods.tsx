import { IconBulbOff, IconCheck, IconLoader2 } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { NOT_CONFIGURED } from '../tasks/model';
import { reviewNow } from '../ui/reviewClock';
import { useVisible } from '../ui/useVisible';
import { MoodArt } from './MoodArt';

export interface Mood {
  id: string;
  label: string;
  /** When the home app's schedule next runs this mood, epoch ms. The home app does not send
   * it yet; when it does, the card says "In N min" within the hour ahead. */
  nextAtMs?: number | null;
}

/** Up to this many mood cards share the row; more scroll sideways (the wheel scrolls them). */
export const MOODS_PER_ROW = 6;

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

/** The concept's line under each mood it drew; other moods have none. */
const NOTES: Record<string, string> = {
  day: 'bright and cool',
  evening: 'warm and golden',
  lateNight: 'dim and violet',
  movie: 'TV on, lights low',
  goodnight: 'everything off',
};

export function moodNote(id: string): string | null {
  return NOTES[id] ?? null;
}

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
    localStorage.setItem(MOODS_CACHE_KEY, JSON.stringify(list.map((m) => ({ id: m.id, label: m.label }))));
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

/** Mood cards for the Home tab, each with its painted art. Lights change only when a card is tapped. */
export function Moods() {
  const visible = useVisible();
  const [status, setStatus] = useState<'loading' | 'ready' | 'unconfigured' | 'error'>('loading');
  const [moods, setMoods] = useState<Mood[]>(readCache);
  const [phase, setPhase] = useState<Phase>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(readLast);
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

  const tap = useCallback(async (id: string) => {
    if (busy.current) return;
    busy.current = true;
    clearTimeout(doneTimer.current);
    clearTimeout(errorTimer.current);
    setError(null);
    setPhase({ id, kind: 'working' });
    try {
      await invoke('wall2_apply_mood', { id });
      if (!mounted.current) return;
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

  if (status === 'ready' && moods.length === 0) {
    return (
      <section className="moods" aria-label="Moods">
        <div className="moods-head">
          <span className="k">Moods</span>
        </div>
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
  let note: string | null = null;
  if (status === 'unconfigured') note = 'Not set up';
  else if (status === 'loading' && !showCards) note = 'Loading';
  else if (status === 'error') note = 'Home app not reachable';
  const scroll = moods.length > MOODS_PER_ROW;
  const rowStyle = scroll ? undefined : { gridTemplateColumns: `repeat(${Math.max(moods.length, 1)}, minmax(0, 1fr))` };
  const now = (reviewNow ?? Date.now)();
  return (
    <section className={showCards ? 'moods' : 'moods bare'} aria-label="Moods">
      <div className="moods-head">
        <span className="k">Moods</span>
        <span className={error || status === 'error' ? 's warn-text' : 's'} role="alert">
          {error ?? note}
        </span>
      </div>
      {showCards && (
        <div
          className={scroll ? 'mood-row scroll' : 'mood-row'}
          style={rowStyle}
          onWheel={scroll ? (e) => (e.currentTarget.scrollLeft += e.deltaY) : undefined}
        >
          {moods.map((m) => {
            const busyHere = phase?.id === m.id ? phase.kind : null;
            const on = last === m.id;
            const sub = moodNote(m.id);
            const soon = on ? null : inText(m.nextAtMs, now);
            const cls = ['mood-btn', busyHere ?? '', on ? 'last' : ''].filter(Boolean).join(' ');
            return (
              <button
                key={m.id}
                type="button"
                className={cls}
                data-mood={m.id}
                disabled={phase?.kind === 'working'}
                aria-label={on ? `${moodLabel(m)}, on now` : soon ? `${moodLabel(m)}, ${soon.toLowerCase()}` : moodLabel(m)}
                title={`Set the ${moodLabel(m)} mood${sub ? `: ${sub}` : ''}${on ? '. Last set from this wall' : ''}`}
                onClick={() => void tap(m.id)}
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
          })}
        </div>
      )}
    </section>
  );
}
