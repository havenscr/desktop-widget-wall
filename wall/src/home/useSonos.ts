import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { NOT_CONFIGURED } from '../tasks/model';
import { reviewNow } from '../ui/reviewClock';
import { registerRetry, reportRead } from '../tools/reports';
import { useVisible } from '../ui/useVisible';
import { failureKind, failureSentence, SONOS_REFRESH_MS, SONOS_RETRY_MS, STALE_MS, type FailureKind, type SonosSummary } from './soundModel';

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
 * One failed read changes nothing on screen: the hook reads once more after 5 seconds, and only a
 * second failure marks the read as failed (`status` error, with its `failure` kind).
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
  const statusRef = useRef(status);
  statusRef.current = status;
  /** One read failed and its second try is waiting on `retryTimer`. */
  const failedOnce = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  /** A refresh asked for while one runs (a write's follow-up) runs once that one ends. */
  const again = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    };
  }, []);

  const cancelRetry = useCallback(() => {
    failedOnce.current = false;
    if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
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
      } else if (statusRef.current !== 'error' && !failedOnce.current) {
        // The first failure: nothing changes on screen; read once more shortly.
        failedOnce.current = true;
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          if (!mounted.current || !visibleRef.current) {
            failedOnce.current = false;
            return;
          }
          void refresh();
        }, SONOS_RETRY_MS);
      } else {
        cancelRetry();
        const kind = failureKind(text);
        setStatus('error');
        setFailure(kind);
        reportRead('sound', 'failed', `${failureSentence(kind)}.`);
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setNow(clock());
    }
    if (again.current && mounted.current) {
      again.current = false;
      await refresh();
    }
  }, [cancelRetry]);

  useEffect(() => registerRetry('sound', () => refresh()), [refresh]);

  useEffect(() => {
    if (!visible) return;
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
