import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import type { DayEvent } from './model';

export const DAY_REFRESH_MS = 5 * 60_000;

/** The part of the `wall2_meet_day` answer the ribbon reads. */
interface DayPayload {
  events?: DayEvent[];
  accounts?: { state?: string }[];
}

const NOT_CONFIGURED = 'not-configured';

/** The day feed with its freshness. */
export interface DayFeed {
  events: DayEvent[];
  /** `Date.now()` of the last good read (or "not set up"), null before the first. */
  at: number | null;
  /** `Date.now()` of the last failed read when it came after the last good one, else null. */
  failedAt: number | null;
  /**
   * What the last read says about the calendar: `ok` after a good read with at least one
   * account that could be read (or no account list), `unavailable` after a good read in
   * which no account could be read (signed out, failing), `unknown` before the first read,
   * after a failed read, and when Meet is not set up.
   */
  calendar: 'unknown' | 'ok' | 'unavailable';
}

/** `ok` unless the answer lists accounts and none of them is `ok`. */
function calendarState(r: DayPayload | null | undefined): 'ok' | 'unavailable' {
  const accounts = Array.isArray(r?.accounts) ? r.accounts : null;
  if (!accounts || accounts.length === 0) return 'ok';
  return accounts.some((a) => a?.state === 'ok') ? 'ok' : 'unavailable';
}

/**
 * The calendar day feed: read when `on` turns true, then every five minutes while it stays
 * true. Meet "Not set up" gives no events. Any other failed read keeps the last good list
 * and records when it failed, so a reader can tell cached events from current ones.
 */
export function useDayFeed(on: boolean): DayFeed {
  const [feed, setFeed] = useState<DayFeed>({ events: [], at: null, failedAt: null, calendar: 'unknown' });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const read = useCallback(async () => {
    try {
      const r = await invoke<DayPayload>('wall2_meet_day');
      if (mounted.current) setFeed({ events: Array.isArray(r?.events) ? r.events : [], at: Date.now(), failedAt: null, calendar: calendarState(r) });
    } catch (e) {
      if (!mounted.current) return;
      const text = e instanceof Error ? e.message : String(e);
      if (text === NOT_CONFIGURED) setFeed({ events: [], at: Date.now(), failedAt: null, calendar: 'unknown' });
      else setFeed((f) => ({ ...f, failedAt: Date.now(), calendar: 'unknown' }));
    }
  }, []);

  useEffect(() => {
    if (!on) return;
    void read();
    const id = setInterval(() => void read(), DAY_REFRESH_MS);
    return () => clearInterval(id);
  }, [on, read]);

  return feed;
}

/**
 * Today's calendar for the ribbon's first row, from `useDayFeed`. A failed refresh keeps
 * the last good list. Nothing here ever shows error text.
 */
export function useDayEvents(on: boolean): DayEvent[] {
  return useDayFeed(on).events;
}
