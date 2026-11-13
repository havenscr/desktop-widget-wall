import { useCallback, useEffect, useRef, useState } from 'react';
import { IconLoader2 } from '@tabler/icons-react';
import { invoke } from '../bridge/tauri';
import { LAST_MOOD_AT_KEY, LAST_MOOD_KEY, moodLabel, type Mood } from '../home/Moods';
import { useVisible } from '../ui/useVisible';

const NOT_CONFIGURED = 'not-configured';
export const ROOM_REFRESH_MS = 10 * 60_000;
export const ROOM_ERROR_MS = 5000;
/** While loading or in error, read the moods again this often. */
export const ROOM_RETRY_MS = 30_000;
/** The mark on the last applied mood goes after this long. */
export const MOOD_MARK_MS = 3 * 3_600_000;
export { LAST_MOOD_AT_KEY };

interface Mark {
  id: string;
  at: number;
}

/** The marked mood: the shared last mood, if it carries a time under three hours old. */
function readMark(nowMs: number): Mark | null {
  try {
    const id = localStorage.getItem(LAST_MOOD_KEY);
    const raw = localStorage.getItem(LAST_MOOD_AT_KEY);
    if (!id || !raw) return null;
    const v = JSON.parse(raw) as Partial<Mark> | null;
    if (!v || v.id !== id || typeof v.at !== 'number' || !Number.isFinite(v.at)) return null;
    const age = nowMs - v.at;
    return age >= 0 && age < MOOD_MARK_MS ? { id, at: v.at } : null;
  } catch {
    return null;
  }
}

function writeMark(mark: Mark): void {
  try {
    localStorage.setItem(LAST_MOOD_KEY, mark.id);
    localStorage.setItem(LAST_MOOD_AT_KEY, JSON.stringify(mark));
  } catch {
    /* the mark is a convenience */
  }
}

type Status = 'loading' | 'ready' | 'unconfigured' | 'error';

/**
 * The Room card as `f_unwind` draws it: "Room" over a row of mood chips, at the concept's
 * size and place in the right wing (its lower half, where it ends level with the player;
 * Live now, PR 27, stacks above it). Chips apply a home mood with `wall2_apply_mood`, and
 * the last mood applied (here or on Home's mood cards; the id is shared through
 * `wall2-last-mood`, the time beside it) is marked for three hours. "TV off" waits for the
 * home app reads (PR 24) and is not shown yet. When the home app is not set up or not
 * reachable the card says so in one line at the same size.
 */
export function RoomCard() {
  const visible = useVisible();
  const [status, setStatus] = useState<Status>('loading');
  const [moods, setMoods] = useState<Mood[]>([]);
  const [mark, setMark] = useState<Mark | null>(() => readMark(Date.now()));
  const last = mark?.id ?? null;
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

  // Not loaded yet or failing: try again every 30 seconds until the moods arrive.
  useEffect(() => {
    if (!visible || status === 'ready' || status === 'unconfigured') return;
    const id = setInterval(() => void load(), ROOM_RETRY_MS);
    return () => clearInterval(id);
  }, [visible, status, load]);

  // The mark goes three hours after the mood was applied.
  useEffect(() => {
    if (!mark) return;
    const id = setTimeout(() => setMark(readMark(Date.now())), Math.max(0, mark.at + MOOD_MARK_MS - Date.now()) + 50);
    return () => clearTimeout(id);
  }, [mark]);

  const apply = async (id: string) => {
    if (working) return;
    setWorking(id);
    setError(false);
    clearTimeout(errorTimer.current);
    try {
      await invoke('wall2_apply_mood', { id });
      if (!mounted.current) return;
      const next = { id, at: Date.now() };
      writeMark(next);
      setMark(next);
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
