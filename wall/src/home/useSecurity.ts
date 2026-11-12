import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { NOT_CONFIGURED } from '../tasks/model';
import { useVisible } from '../ui/useVisible';
import { REFRESH_MS, type SecuritySummary } from './model';

export interface SecurityState {
  status: 'loading' | 'ready' | 'unconfigured' | 'error';
  summary: SecuritySummary | null;
  now: number;
}

/** Firewall health and open alerts from the home app, every 5 minutes while visible. */
export function useSecurity(): SecurityState {
  const visible = useVisible();
  const [status, setStatus] = useState<SecurityState['status']>('loading');
  const [summary, setSummary] = useState<SecuritySummary | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(false);
  const inFlight = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await invoke<SecuritySummary>('wall2_home_security');
      if (!mounted.current) return;
      setSummary(next);
      setStatus('ready');
    } catch (e) {
      if (!mounted.current) return;
      const text = e instanceof Error ? e.message : String(e);
      setStatus(text === NOT_CONFIGURED ? 'unconfigured' : 'error');
    } finally {
      inFlight.current = false;
      if (mounted.current) setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearInterval(id);
      clearInterval(tick);
    };
  }, [visible, refresh]);

  return { status, summary, now };
}
