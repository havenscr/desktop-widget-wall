import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { usePlaceStore } from '../state/places';
import { useVisible } from '../ui/useVisible';
import { INVALID_CONFIG, NOT_CONFIGURED, REFRESH_MS, TICK_MS, signInMessage, type MeetData } from './model';

export type MeetStatus = 'loading' | 'ready' | 'unconfigured' | 'invalid' | 'error';

export interface MeetState {
  status: MeetStatus;
  data: MeetData | null;
  /** Time of the last good read, or null. */
  lastOk: number | null;
  now: number;
  /** Account id while a sign-in is waiting for the browser. */
  signingIn: string | null;
  notice: string | null;
  signIn: (id: string) => void;
  cancelSignIn: () => void;
  signOut: (id: string) => void;
  join: (key: string) => void;
}

const text = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Reads the next meetings when Meet opens, then every 5 minutes while Meet is the active
 * place and the page is visible. The countdown ticks from the last list every 30 seconds
 * without calling the native side. A failed read keeps the last good list.
 */
export function useMeet(): MeetState {
  const visible = useVisible();
  const active = usePlaceStore((s) => s.active === 'meet');
  const on = visible && active;
  const [status, setStatus] = useState<MeetStatus>('loading');
  const [data, setData] = useState<MeetData | null>(null);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [signingIn, setSigningIn] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
      const next = await invoke<MeetData>('wall2_meet_next');
      if (!mounted.current) return;
      setData({ accounts: next?.accounts ?? [], meetings: next?.meetings ?? [] });
      setStatus('ready');
      setLastOk(Date.now());
    } catch (e) {
      if (!mounted.current) return;
      const t = text(e);
      if (t === NOT_CONFIGURED) setStatus('unconfigured');
      else if (t === INVALID_CONFIG) setStatus('invalid');
      else setStatus('error');
    } finally {
      inFlight.current = false;
      if (mounted.current) setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    if (!on) return;
    void refresh();
    const poll = setInterval(() => void refresh(), REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [on, refresh]);

  const signIn = useCallback(
    (id: string) => {
      setNotice(null);
      setSigningIn(id);
      invoke('wall2_meet_sign_in', { id })
        .then(() => {
          if (mounted.current) void refresh();
        })
        .catch((e) => {
          if (mounted.current) setNotice(signInMessage(text(e)));
        })
        .finally(() => {
          if (mounted.current) setSigningIn(null);
        });
    },
    [refresh],
  );

  const cancelSignIn = useCallback(() => {
    invoke('wall2_meet_cancel_sign_in').catch(() => undefined);
  }, []);

  const signOut = useCallback(
    (id: string) => {
      setNotice(null);
      invoke('wall2_meet_sign_out', { id })
        .then(() => {
          if (mounted.current) void refresh();
        })
        .catch(() => {
          if (mounted.current) setNotice('Could not sign out');
        });
    },
    [refresh],
  );

  const join = useCallback(
    (key: string) => {
      setNotice(null);
      invoke('wall2_meet_join', { key }).catch((e) => {
        if (!mounted.current) return;
        if (text(e) === 'gone') void refresh();
        else setNotice('Could not open the meeting');
      });
    },
    [refresh],
  );

  return { status, data, lastOk, now, signingIn, notice, signIn, cancelSignIn, signOut, join };
}
