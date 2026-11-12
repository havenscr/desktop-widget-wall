import { useCallback, useEffect, useRef, useState } from 'react';
import { IconLoader2 } from '@tabler/icons-react';
import { invoke } from '../bridge/tauri';
import { LAST_MOOD_KEY, moodLabel, type Mood } from '../home/Moods';
import { useVisible } from '../ui/useVisible';

const NOT_CONFIGURED = 'not-configured';
export const ROOM_REFRESH_MS = 10 * 60_000;
export const ROOM_ERROR_MS = 5000;

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
    /* the mark is a convenience */
  }
}

type Status = 'loading' | 'ready' | 'unconfigured' | 'error';

/**
 * The Room card (concept: "Room", mood chips, "TV off"). Chips apply a home mood with
 * `wall2_apply_mood`, and the last applied one is marked; Home's mood buttons share the
 * same mark. "TV off" waits for the home app reads (PR 24) and is not shown yet. When the
 * home app is not set up or not reachable the card shrinks to one line.
 */
export function RoomCard() {
  const visible = useVisible();
  const [status, setStatus] = useState<Status>('loading');
  const [moods, setMoods] = useState<Mood[]>([]);
  const [last, setLast] = useState<string | null>(readLast);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const mounted = useRef(true);
  const errorTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
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
      setStatus((e instanceof Error ? e.message : String(e)) === NOT_CONFIGURED ? 'unconfigured' : 'error');
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    void load();
    const id = setInterval(() => void load(), ROOM_REFRESH_MS);
    return () => clearInterval(id);
  }, [visible, load]);

  const apply = async (id: string) => {
    if (working) return;
    setWorking(id);
    setError(false);
    clearTimeout(errorTimer.current);
    try {
      await invoke('wall2_apply_mood', { id });
      if (!mounted.current) return;
      writeLast(id);
      setLast(id);
    } catch {
      if (!mounted.current) return;
      setError(true);
      errorTimer.current = setTimeout(() => setError(false), ROOM_ERROR_MS);
    } finally {
      if (mounted.current) setWorking(null);
    }
  };

  if (status === 'ready' && moods.length === 0) return null;

  let body;
  if (status === 'loading') body = <div className="u-s">Loading the rooms</div>;
  else if (status === 'unconfigured') body = <div className="u-s">Home app not set up</div>;
  else if (status === 'error' && moods.length === 0) body = <div className="u-s">Home app not reachable</div>;
  else
    body = (
      <div className="u-chips">
        {moods.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`u-chip${last === m.id ? ' on' : ''}`}
            data-mood={m.id}
            aria-pressed={last === m.id}
            disabled={working !== null}
            onClick={() => void apply(m.id)}
          >
            {working === m.id ? <IconLoader2 className="u-spin" size={22} aria-hidden="true" /> : null}
            {moodLabel(m)}
          </button>
        ))}
      </div>
    );

  return (
    <section className="u-card u-room" aria-label="Room">
      <div className="u-card-head">
        <span className="u-k">Room</span>
        {error ? (
          <span className="u-xs" role="alert">
            Could not set the mood
          </span>
        ) : null}
      </div>
      {body}
    </section>
  );
}
