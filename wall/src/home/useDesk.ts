import { useEffect } from 'react';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { invoke } from '../bridge/tauri';
import { NOT_CONFIGURED } from '../tasks/model';
import { reviewNow } from '../ui/reviewClock';
import { useVisible } from '../ui/useVisible';
import { REFRESH_MS } from './model';

/** The wall clock, or the frozen review time in a dev review still (`?hz=&at=`). */
const clock = reviewNow ?? (() => Date.now());

/** The home app's desk routes answer `absent` until its change is live: the parts that read them hide. */
export const ABSENT = 'absent';
/** No `homeDeskToken` on this PC (or the home app has none): Clear all says "not set up". */
export const NOT_SET_UP = 'not-set-up';

export interface House {
  observedAt: string | null;
  insideF: number | null;
  litRooms: number | null;
  rooms: number | null;
  stale: boolean;
}

export interface Room {
  id: string;
  name: string;
  on: boolean;
}

export interface DeskRooms {
  rooms: Room[];
  stale: boolean;
}

export interface DeskAlert {
  id: string | null;
  severity: 'high' | 'medium' | 'low' | null;
  text: string;
  at: string | null;
  ageSeconds: number | null;
}

export interface DeskSecurity {
  available: boolean;
  stale: boolean;
  observedAt: string | null;
  devices: number | null;
  blocked: number | null;
  unseen: number | null;
  alerts: DeskAlert[];
  /** A desk token is set on this PC, so Clear all can be offered (the token stays in Rust). */
  canClear: boolean;
}

export interface FeedState<T> {
  status: 'loading' | 'ready' | 'absent' | 'unconfigured' | 'error';
  /** The last good read, kept while a later read fails (then shown as stale). */
  data: T | null;
  /** When the last good read landed, on the wall clock. */
  readAt: number | null;
  now: number;
}

export interface Feed<T> {
  use: UseBoundStore<StoreApi<FeedState<T>>>;
  refresh: () => Promise<void>;
  join: () => void;
  leave: () => void;
  watch: () => void;
  unwatch: () => void;
}

/**
 * One shared read of a desk route: read on the first visible user (and again on show
 * when the last read is a minute old), then every `everyMs` while any user is visible.
 * When the last user leaves it forgets everything, so a later user starts from Loading.
 */
function feed<T>(command: string, everyMs: number): Feed<T> {
  const initial = (): FeedState<T> => ({ status: 'loading', data: null, readAt: null, now: clock() });
  const use = create<FeedState<T>>(() => initial());
  let mounted = 0;
  let watching = 0;
  let poll: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  let lastRead: number | null = null;
  let epoch = 0;
  const refresh = async (): Promise<void> => {
    if (inFlight) return;
    const mine = epoch;
    inFlight = true;
    lastRead = Date.now();
    try {
      const data = await invoke<T>(command);
      if (mine !== epoch) return;
      use.setState({ status: 'ready', data, readAt: clock(), now: clock() });
    } catch (e) {
      if (mine !== epoch) return;
      const text = e instanceof Error ? e.message : String(e);
      // Absent and not set up drop the old data: nothing from a route that is gone stays on screen.
      if (text === ABSENT) use.setState({ status: 'absent', data: null, readAt: null, now: clock() });
      else if (text === NOT_CONFIGURED) use.setState({ status: 'unconfigured', data: null, readAt: null, now: clock() });
      else use.setState({ status: 'error', now: clock() });
    } finally {
      if (mine === epoch) inFlight = false;
    }
  };
  return {
    use,
    refresh,
    join: () => {
      mounted += 1;
    },
    leave: () => {
      mounted = Math.max(0, mounted - 1);
      if (mounted > 0) return;
      epoch += 1;
      inFlight = false;
      lastRead = null;
      use.setState(initial(), true);
    },
    watch: () => {
      watching += 1;
      use.setState({ now: clock() });
      if (watching === 1) poll = setInterval(() => void refresh(), everyMs);
      if (lastRead === null || Date.now() - lastRead >= 60_000) void refresh();
    },
    unwatch: () => {
      watching = Math.max(0, watching - 1);
      if (watching > 0) return;
      if (poll !== null) clearInterval(poll);
      poll = null;
    },
  };
}

/** House and rooms change with the lights: read every minute. */
export const HOUSE_REFRESH_MS = 60_000;

export const deskSecurity = feed<DeskSecurity>('wall2_desk_security', REFRESH_MS);
export const deskHouse = feed<House>('wall2_desk_house', HOUSE_REFRESH_MS);
export const deskRooms = feed<DeskRooms>('wall2_desk_rooms', HOUSE_REFRESH_MS);

function useFeed<T>(f: Feed<T>): FeedState<T> {
  const visible = useVisible();
  const state = f.use();
  useEffect(() => {
    f.join();
    return f.leave;
  }, [f]);
  useEffect(() => {
    if (!visible) return;
    f.watch();
    return f.unwatch;
  }, [f, visible]);
  return state;
}

/** The desk security read (alerts with ids, Clear all). */
export function useDeskSecurity(): FeedState<DeskSecurity> {
  return useFeed(deskSecurity);
}

/** The house line's two reads. */
export function useDeskHouse(): { house: FeedState<House>; rooms: FeedState<DeskRooms> } {
  return { house: useFeed(deskHouse), rooms: useFeed(deskRooms) };
}

/** A read older than this is stale on screen (two polls missed, and a minute). */
export const maxAge = (everyMs: number) => 2 * everyMs + 60_000;

/** Clear all on the home app (it marks every current alert seen), then a fresh read. */
export async function clearAllAlerts(): Promise<number> {
  const n = await invoke<number>('wall2_desk_clear_alerts');
  await deskSecurity.refresh();
  return n;
}
