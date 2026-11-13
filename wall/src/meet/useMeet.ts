import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { usePlaceStore } from '../state/places';
import { useVisible } from '../ui/useVisible';
import {
  FAST_RETRY_MS,
  INVALID_CONFIG,
  NOT_CONFIGURED,
  READ_LIMIT_MS,
  REFRESH_MS,
  TICK_MS,
  TIMED_OUT,
  signInMessage,
  type MeetAccount,
  type MeetData,
} from './model';

export type MeetStatus = 'loading' | 'ready' | 'unconfigured' | 'invalid' | 'error';

export interface MeetState {
  status: MeetStatus;
  data: MeetData | null;
  /** Time of the last complete good read, or null. */
  lastOk: number | null;
  /** The list holds meetings kept from an earlier read (an account was unavailable). */
  stale: boolean;
  /** When each account last answered (or failed to), by id. */
  tried: Record<string, number>;
  now: number;
  /** Account id while a sign-in is waiting for the browser. */
  signingIn: string | null;
  notice: string | null;
  signIn: (id: string) => void;
  cancelSignIn: () => void;
  signOut: (id: string) => void;
  refresh: () => void;
  join: (key: string) => void;
}

const text = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The promise's answer, or a rejection with `timeout` after `ms`. */
function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}

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
  const [stale, setStale] = useState(false);
  const [tried, setTried] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  const [signingIn, setSigningIn] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const queued = useRef(false);
  const signingRef = useRef<string | null>(null);
  const onRef = useRef(false);
  const fastStep = useRef(0);
  const fastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seqRef = useRef(0);
  /** Accounts that did not answer in time or failed outright, shown instead of "checking". */
  const overrides = useRef<Record<string, MeetAccount>>({});
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // After a read that left an account unavailable, read again after 30 s, then 60 s, then
  // leave it to the normal 5 minute poll. A read with nothing unavailable resets the steps.
  const planFastRetry = useCallback((unavailable: boolean) => {
    clearTimeout(fastTimer.current);
    fastTimer.current = undefined;
    if (!unavailable) {
      fastStep.current = 0;
      return;
    }
    const delay = FAST_RETRY_MS[fastStep.current];
    if (delay === undefined || !onRef.current || !mounted.current) return;
    // Only the timer moves the step on, so a manual Try again never uses up the fast retries.
    fastTimer.current = setTimeout(() => {
      fastStep.current += 1;
      void refreshRef.current();
    }, delay);
  }, []);

  // The accounts come back at once (peek), then each account is asked on its own and shown
  // the moment it answers. An answer older than one already shown is dropped. Nothing waits
  // longer than READ_LIMIT_MS: an account that has not answered by then shows as not
  // answering, with the time of the try.
  const readOnce = useCallback(async () => {
    const cur: { shown: MeetData | null } = { shown: null };
    const show = (next: MeetData) => {
      if (typeof next.seq === 'number') {
        if (next.seq <= seqRef.current) return;
        seqRef.current = next.seq;
      }
      const accounts = (next.accounts ?? []).map((a) => overrides.current[a.id] ?? a);
      cur.shown = { accounts, meetings: next.meetings ?? [] };
      setData(cur.shown);
      setStatus('ready');
      setStale(next.stale === true);
    };
    const show2 = (base: MeetData) => {
      cur.shown = { ...base, accounts: base.accounts.map((x) => overrides.current[x.id] ?? x) };
      setData(cur.shown);
    };
    try {
      const first = await within(invoke<MeetData>('wall2_meet_next', { peek: true }), READ_LIMIT_MS);
      if (!mounted.current) return;
      overrides.current = {};
      show(first);
      const accounts = first?.accounts ?? [];
      let lastStale = first?.stale === true;
      await Promise.all(
        accounts.map(async (a) => {
          try {
            const r = await within(invoke<MeetData>('wall2_meet_next', { only: a.id }), READ_LIMIT_MS);
            if (!mounted.current) return;
            delete overrides.current[a.id];
            setTried((t) => ({ ...t, [a.id]: Date.now() }));
            lastStale = r?.stale === true;
            show(r);
          } catch (e) {
            if (!mounted.current) return;
            const timedOut = text(e) === 'timeout';
            overrides.current[a.id] = { id: a.id, label: a.label, state: 'unavailable', ...(timedOut ? { reason: TIMED_OUT } : {}) };
            setTried((t) => ({ ...t, [a.id]: Date.now() }));
            const base = cur.shown;
            if (base) show2(base);
          }
        }),
      );
      if (!mounted.current) return;
      const done = cur.shown;
      planFastRetry((done?.accounts ?? []).some((x) => x.state === 'unavailable'));
      setStale(lastStale);
      if (!lastStale) setLastOk(Date.now());
    } catch (e) {
      if (!mounted.current) return;
      const t = text(e);
      if (t === NOT_CONFIGURED) setStatus('unconfigured');
      else if (t === INVALID_CONFIG) setStatus('invalid');
      else setStatus('error');
    }
  }, [planFastRetry]);

  // One read at a time. A read requested while one runs queues a single re-run, so a
  // request made right after sign-in is never dropped.
  const refresh = useCallback(async () => {
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    inFlight.current = true;
    try {
      do {
        queued.current = false;
        await readOnce();
      } while (queued.current && mounted.current);
    } finally {
      inFlight.current = false;
      if (mounted.current) setNow(Date.now());
    }
  }, [readOnce]);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    onRef.current = on;
    if (!on) return;
    fastStep.current = 0;
    void refresh();
    const poll = setInterval(() => void refresh(), REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      clearTimeout(fastTimer.current);
      fastTimer.current = undefined;
    };
  }, [on, refresh]);

  // Leaving Meet (or the window) during a sign-in ends the wait, so the native side is not
  // left busy for five minutes.
  useEffect(() => {
    if (!active) return;
    const pending = signingRef;
    return () => {
      if (pending.current) invoke('wall2_meet_cancel_sign_in').catch(() => undefined);
    };
  }, [active]);

  const signIn = useCallback(
    (id: string) => {
      setNotice(null);
      signingRef.current = id;
      setSigningIn(id);
      invoke('wall2_meet_sign_in', { id })
        .then(() => {
          if (mounted.current) void refresh();
        })
        .catch((e) => {
          if (mounted.current) setNotice(signInMessage(text(e)));
        })
        .finally(() => {
          signingRef.current = null;
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

  return { status, data, lastOk, stale, tried, now, signingIn, notice, signIn, cancelSignIn, signOut, refresh: () => void refresh(), join };
}
