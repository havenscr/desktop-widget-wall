import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { calendarNotAvailable, type MeetAccount } from '../meet/model';
import type { DayEvent } from './model';

export const DAY_REFRESH_MS = 5 * 60_000;

/** The part of the `wall2_meet_day` answer the ribbon reads. */
interface DayPayload {
  events?: DayEvent[];
  accounts?: Pick<MeetAccount, 'state'>[];
}

const NOT_CONFIGURED = 'not-configured';

/** The day feed with its freshness. */
export interface DayFeed {
  events: DayEvent[];
  /** `Date.now()` of the last good read (or "not set up"), null before the first. */
  at: number | null;
  /** `Date.now()` of the last failed read when it came after the last good one, else null. */
  failedAt: number | null;
  /** No account could be read, so an empty row means "cannot tell", not "nothing today". */
  unavailable: boolean;
}

/**
 * The calendar day feed: read when `on` turns true, then every five minutes while it stays
 * true. Meet "Not set up" gives no events. Any other failed read keeps the last good list
 * and records when it failed, so a reader can tell cached events from current ones.
 */
export function useDayFeed(on: boolean): DayFeed {
  const [feed, setFeed] = useState<DayFeed>({ events: [], at: null, failedAt: null, unavailable: false });
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
      if (mounted.current) setFeed({ events: Array.isArray(r?.events) ? r.events : [], at: Date.now(), failedAt: null, unavailable: calendarNotAvailable(r?.accounts ?? []) });
    } catch (e) {
      if (!mounted.current) return;
      const text = e instanceof Error ? e.message : String(e);
      if (text === NOT_CONFIGURED) setFeed({ events: [], at: Date.now(), failedAt: null, unavailable: false });
      else setFeed((f) => ({ ...f, failedAt: Date.now(), unavailable: f.events.length === 0 ? true : f.unavailable }));
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
