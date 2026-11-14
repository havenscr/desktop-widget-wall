import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { NOT_CONFIGURED } from '../tasks/model';
import { reviewNow } from '../ui/reviewClock';
import { registerRetry, reportRead } from '../tools/reports';
import { useVisible } from '../ui/useVisible';
import { failureKind, failureSentence, SONOS_REFRESH_MS, SONOS_RETRY_MS, SONOS_REVIEW_RETRY_MS, STALE_MS, type FailureKind, type SonosSummary } from './soundModel';

/** The wall clock, or the frozen review time in a dev review still (`?hz=&at=`). */
export const clock = reviewNow ?? (() => Date.now());

export interface SonosState {
  status: 'loading' | 'ready' | 'unconfigured' | 'error';
  /** The last good read, kept (dimmed) while the service is away. */
  summary: SonosSummary | null;
  /** When the last good read arrived, on `clock`. */
  okAt: number | null;
  now: number;
  /** Which kind of failure the last two reads were; null while reads work. */
  failure: FailureKind | null;
  /** True when the shown read is not live: the last read failed, or it is over two minutes old. */
  stale: boolean;
  refresh: () => Promise<void>;
}

/**
 * The Sonos summary every 30 seconds while the wall is visible. Reads only; nothing plays from here.
 * One failed read changes nothing on screen: the hook reads once more after 5 seconds (a quarter of
 * a second in a dev review frame, so stills reach the failed phase at once), and only that second
 * read's failure marks the read as failed (`status` error, with its `failure` kind).
 */
export function useSonos(): SonosState {
  const visible = useVisible();
  const [status, setStatus] = useState<SonosState['status']>('loading');
  const [summary, setSummary] = useState<SonosSummary | null>(null);
  const [okAt, setOkAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => clock());
  const [failure, setFailure] = useState<FailureKind | null>(null);
  const mounted = useRef(false);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  /** A read failed and its second try has not been read yet (waiting on `retryTimer`, or due). */
  const retryPending = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The retry's time came while another read was still running: it goes right after that one. */
  const retryDue = useRef(false);
  const inFlight = useRef(false);
  /** A refresh asked for while one runs (a write's follow-up) runs once that one ends. */
  const again = useRef(false);

  const cancelRetry = useCallback(() => {
    retryPending.current = false;
    retryDue.current = false;
    if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelRetry();
    };
  }, [cancelRetry]);

  /**
   * One read. Every read that is not itself a second try is the first of a pair: when it fails,
   * the page reads once more after 5 seconds, and until that second read ends the card shows what
   * it showed (a healthy card as it is, a dimmed one with its line and kind). Only the second
   * try's failure changes what is shown (two different kinds in a row: the second); any good read
   * clears it at once.
   */
  const run = useCallback(
    async (asRetry: boolean): Promise<void> => {
      if (inFlight.current) {
        again.current = true;
        return;
      }
      inFlight.current = true;
      try {
        const next = await invoke<SonosSummary>('wall2_sonos_summary');
        if (!mounted.current) return;
        setSummary(next);
        setOkAt(clock());
        setStatus('ready');
        setFailure(null);
        cancelRetry();
        reportRead('sound', 'ok');
      } catch (e) {
        if (!mounted.current) return;
        const text = e instanceof Error ? e.message : String(e);
        if (text === NOT_CONFIGURED) {
          cancelRetry();
          setStatus('unconfigured');
          reportRead('sound', 'unconfigured', 'Not set up');
        } else if (asRetry) {
          cancelRetry();
          const kind = failureKind(text);
          setStatus('error');
          setFailure(kind);
          reportRead('sound', 'failed', `${failureSentence(kind)}.`);
        } else if (!retryPending.current) {
          // The first of a pair: nothing changes on screen; read once more shortly.
          retryPending.current = true;
          retryTimer.current = setTimeout(() => {
            retryTimer.current = null;
            if (!mounted.current || !visibleRef.current) {
              cancelRetry();
              return;
            }
            if (inFlight.current) retryDue.current = true;
            else void run(true);
          }, reviewNow ? SONOS_REVIEW_RETRY_MS : SONOS_RETRY_MS);
        }
        // else: a second try is already waiting and decides what is shown.
      } finally {
        inFlight.current = false;
        if (mounted.current) setNow(clock());
      }
      if (!mounted.current) return;
      if (retryDue.current && retryPending.current && visibleRef.current) {
        retryDue.current = false;
        again.current = false;
        await run(true);
      } else if (again.current) {
        again.current = false;
        await run(false);
      }
    },
    [cancelRetry],
  );

  const refresh = useCallback((): Promise<void> => run(false), [run]);

  useEffect(() => registerRetry('sound', () => refresh()), [refresh]);

  useEffect(() => {
    if (!visible) return;
    setNow(clock());
    void refresh();
    const id = setInterval(() => void refresh(), SONOS_REFRESH_MS);
    const tick = setInterval(() => setNow(clock()), 15_000);
    return () => {
      clearInterval(id);
      clearInterval(tick);
      cancelRetry();
    };
  }, [visible, refresh, cancelRetry]);

  const stale = status === 'error' || okAt === null || now - okAt > STALE_MS;
  return { status, summary, okAt, now, failure, stale, refresh };
}
