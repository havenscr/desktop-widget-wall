import { IconBulb, IconCheck, IconLoader2, IconMoon, IconSun, IconSunset, type Icon } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { NOT_CONFIGURED } from '../tasks/model';
import { useVisible } from '../ui/useVisible';

export interface Mood {
  id: string;
  label: string;
}

export const MOODS_REFRESH_MS = 10 * 60_000;
export const DONE_MS = 2000;
export const ERROR_MS = 5000;
export const LAST_MOOD_KEY = 'wall2-last-mood';

/** "lateNight" becomes "Late Night". The server sends a label from the id; this is the fallback. */
export function moodLabel(mood: Mood): string {
  return mood.label || mood.id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

/** Sun for day, sunset for evening, moon for lateNight, a plain bulb for anything else. */
export function moodIcon(id: string): Icon {
  if (id === 'day') return IconSun;
  if (id === 'evening') return IconSunset;
  if (id === 'lateNight') return IconMoon;
  return IconBulb;
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
  } catch {
    /* storage can be blocked; the mark is a convenience */
  }
}

type Phase = { id: string; kind: 'working' | 'done' } | null;

/** Mood buttons for the Home tab. Lights change only when a button is tapped. */
export function Moods() {
  const visible = useVisible();
  const [status, setStatus] = useState<'loading' | 'ready' | 'unconfigured' | 'error'>('loading');
  const [moods, setMoods] = useState<Mood[]>([]);
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
      setMoods(Array.isArray(list) ? list : []);
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
      setError(text && text !== NOT_CONFIGURED ? text : 'Could not set the mood');
      errorTimer.current = setTimeout(() => setError(null), ERROR_MS);
    } finally {
      busy.current = false;
    }
  }, []);

  if (status === 'ready' && moods.length === 0) return null;

  let body;
  if (status === 'unconfigured') {
    body = <div className="s">Not set up</div>;
  } else if (status === 'loading') {
    body = <div className="s">Loading</div>;
  } else if (status === 'error' && moods.length === 0) {
    body = <div className="s">Home app not reachable</div>;
  } else {
    body = (
      <div className="mood-row">
        {moods.map((m) => {
          const Glyph = phase?.id === m.id ? (phase.kind === 'working' ? IconLoader2 : IconCheck) : moodIcon(m.id);
          const cls = ['mood-btn', phase?.id === m.id ? phase.kind : '', last === m.id ? 'last' : ''].filter(Boolean).join(' ');
          return (
            <button
              key={m.id}
              type="button"
              className={cls}
              data-mood={m.id}
              disabled={phase?.kind === 'working'}
              aria-pressed={last === m.id}
              onClick={() => void tap(m.id)}
            >
              <Glyph size={40} stroke={1.6} aria-hidden="true" />
              <span className="mood-name">{moodLabel(m)}</span>
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <section className="moods" aria-label="Moods">
      <span className="k">Moods</span>
      {body}
      <div className="mood-error s" role="alert">
        {error}
      </div>
    </section>
  );
}
