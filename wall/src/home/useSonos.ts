import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { NOT_CONFIGURED } from '../tasks/model';
import { reviewNow } from '../ui/reviewClock';
import { useVisible } from '../ui/useVisible';
import { SONOS_REFRESH_MS, STALE_MS, type SonosSummary } from './soundModel';

/** The wall clock, or the frozen review time in a dev review still (`?hz=&at=`). */
export const clock = reviewNow ?? (() => Date.now());

export interface SonosState {
  status: 'loading' | 'ready' | 'unconfigured' | 'error';
  /** The last good read, kept (dimmed) while the service is away. */
  summary: SonosSummary | null;
  /** When the last good read arrived, on `clock`. */
  okAt: number | null;
  now: number;
  /** True when the shown read is not live: the last read failed, or it is over two minutes old. */
  stale: boolean;
  refresh: () => Promise<void>;
}

/** The Sonos summary every 30 seconds while the wall is visible. Reads only; nothing plays from here. */
export function useSonos(): SonosState {
  const visible = useVisible();
  const [status, setStatus] = useState<SonosState['status']>('loading');
  const [summary, setSummary] = useState<SonosSummary | null>(null);
  const [okAt, setOkAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => clock());
  const mounted = useRef(false);
  const inFlight = useRef(false);
  /** A refresh asked for while one runs (a write's follow-up) runs once that one ends. */
  const again = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
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
    } catch (e) {
      if (!mounted.current) return;
      const text = e instanceof Error ? e.message : String(e);
      setStatus(text === NOT_CONFIGURED ? 'unconfigured' : 'error');
    } finally {
      inFlight.current = false;
      if (mounted.current) setNow(clock());
    }
    if (again.current && mounted.current) {
      again.current = false;
      await refresh();
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    void refresh();
    const id = setInterval(() => void refresh(), SONOS_REFRESH_MS);
    const tick = setInterval(() => setNow(clock()), 15_000);
    return () => {
      clearInterval(id);
      clearInterval(tick);
    };
  }, [visible, refresh]);

  const stale = status === 'error' || okAt === null || now - okAt > STALE_MS;
  return { status, summary, okAt, now, stale, refresh };
}
