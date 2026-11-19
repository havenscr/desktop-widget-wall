import { useCallback, useEffect, useRef, useState } from 'react';
import { readBrief, type BriefError, type BriefOut } from '../bridge/meetBrief';
import { useAwake } from '../onair/useNow';
import { usePlaceStore } from '../state/places';

/** While the box is still building the brief: how often to ask again, and for how long. */
export const BUILDING_RETRY_MS = 20_000;
export const BUILDING_GIVE_UP_MS = 5 * 60_000;
/** A ready brief is read again this often while Meet shows. */
export const READY_REREAD_MS = 10 * 60_000;

const WORDS: BriefError[] = ['not-configured', 'invalid-config', 'not-set-up', 'forbidden', 'gone', 'failed'];
const asWord = (e: unknown): BriefError => (typeof e === 'string' && (WORDS as string[]).includes(e) ? (e as BriefError) : 'failed');

export interface BriefRead {
  out: BriefOut | null;
  err: BriefError | null;
  /** The box stopped building the brief and it never came up; the island offers Retry. */
  gaveUp: boolean;
  /** Read again now (the Retry button). */
  retry: () => void;
}

/**
 * The brief for the hero meeting's key. Reads on a key change, then follows the rules above; nothing is read while the page
 * is hidden, the display is off or Meet is not the place on screen. The answer lives in component memory only: no storage, no log.
 */
export function useBrief(key: string | null): BriefRead {
  const awake = useAwake();
  const onMeet = usePlaceStore((s) => s.active === 'meet');
  const [state, setState] = useState<{ key: string | null; out: BriefOut | null; err: BriefError | null; gaveUp: boolean }>({ key, out: null, err: null, gaveUp: false });
  const [again, setAgain] = useState(0);
  const retry = useCallback(() => setAgain((n) => n + 1), []);
  const firstAt = useRef<{ key: string | null; at: number }>({ key: null, at: 0 });
  const live = awake && onMeet;

  useEffect(() => {
    if (!key || !live) return;
    let dead = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (firstAt.current.key !== key || again > 0) firstAt.current = { key, at: Date.now() };
    const run = () => {
      readBrief(key).then(
        (out) => {
          if (dead) return;
          let gaveUp = false;
          if (out.state === 'building') {
            if (Date.now() - firstAt.current.at < BUILDING_GIVE_UP_MS) timer = setTimeout(run, BUILDING_RETRY_MS);
            else gaveUp = true;
          }
          setState({ key, out, err: null, gaveUp });
          if (out.state !== 'building') timer = setTimeout(run, READY_REREAD_MS);
        },
        (e) => {
          if (dead) return;
          const err = asWord(e);
          // A failed re-read keeps the last good brief of the same key; any other word means the setup changed.
          setState((prev) => ({ key, out: err === 'failed' && prev.key === key && prev.out && prev.out.state !== 'building' ? prev.out : null, err, gaveUp: false }));
          if (err !== 'failed') timer = setTimeout(run, READY_REREAD_MS);
        },
      );
    };
    run();
    return () => {
      dead = true;
      if (timer) clearTimeout(timer);
    };
  }, [key, live, again]);

  // An answer belongs to its key; a new key starts empty.
  if (state.key !== key) return { out: null, err: null, gaveUp: false, retry };
  return { out: key ? state.out : null, err: key ? state.err : null, gaveUp: key ? state.gaveUp : false, retry };
}
