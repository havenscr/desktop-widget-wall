import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import type { DayEvent } from './model';

export const DAY_REFRESH_MS = 5 * 60_000;

/** The part of the `wall2_meet_day` answer the ribbon reads. */
interface DayPayload {
  events?: DayEvent[];
}

const NOT_CONFIGURED = 'not-configured';

/**
 * Today's calendar for the ribbon's first row: read when `on` turns true, then every
 * five minutes while it stays true. Meet "Not set up" gives no events. Any other failed
 * read keeps the last good list. Nothing here ever shows error text.
 */
export function useDayEvents(on: boolean): DayEvent[] {
  const [events, setEvents] = useState<DayEvent[]>([]);
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
      if (mounted.current) setEvents(Array.isArray(r?.events) ? r.events : []);
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      if (mounted.current && text === NOT_CONFIGURED) setEvents([]);
    }
  }, []);

  useEffect(() => {
    if (!on) return;
    void read();
    const id = setInterval(() => void read(), DAY_REFRESH_MS);
    return () => clearInterval(id);
  }, [on, read]);

  return events;
}
