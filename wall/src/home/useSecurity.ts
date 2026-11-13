import { useEffect } from 'react';
import { create } from 'zustand';
import { invoke } from '../bridge/tauri';
import { NOT_CONFIGURED } from '../tasks/model';
import { reviewNow } from '../ui/reviewClock';
import { useVisible } from '../ui/useVisible';
import { REFRESH_MS, type SecuritySummary } from './model';

/** The wall clock, or the frozen review time in a dev review still (`?hz=&at=`). */
const clock = reviewNow ?? (() => Date.now());

export interface SecurityState {
  status: 'loading' | 'ready' | 'unconfigured' | 'error';
  summary: SecuritySummary | null;
  now: number;
  /** Counts finished security attempts, good or failed. */
  attempts: number;
}

const initial = (): SecurityState => ({ status: 'loading', summary: null, now: clock(), attempts: 0 });

/**
 * The one shared security read. The rail's alarm dot, Home's network card, Work's and
 * Unwind's alarm chip and the For you page all read it, so there is one poll however many
 * of them are on screen.
 */
export const useSecurityFeed = create<SecurityState>(() => initial());

/** Users mounted, and users mounted while the page is visible (only those poll). */
let mounted = 0;
let watching = 0;
let poll: ReturnType<typeof setInterval> | null = null;
let tick: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
let lastRead: number | null = null;
/** Bumped when the last user leaves, so a read started before that cannot land after it. */
let epoch = 0;
/** A user that comes on screen reads again when the last read is this old or older. */
const SHOW_READ_MS = 60_000;

async function refresh(): Promise<void> {
  if (inFlight) return;
  const mine = epoch;
  inFlight = true;
  lastRead = Date.now();
  try {
    const next = await invoke<SecuritySummary>('wall2_home_security');
    if (mine !== epoch) return;
    useSecurityFeed.setState({ summary: next, status: 'ready' });
  } catch (e) {
    if (mine !== epoch) return;
    const text = e instanceof Error ? e.message : String(e);
    useSecurityFeed.setState({ status: text === NOT_CONFIGURED ? 'unconfigured' : 'error' });
  } finally {
    if (mine === epoch) {
      inFlight = false;
      useSecurityFeed.setState((s) => ({ now: clock(), attempts: s.attempts + 1 }));
    }
  }
}

function watch(): void {
  watching += 1;
  if (watching === 1) {
    poll = setInterval(() => void refresh(), REFRESH_MS);
    tick = setInterval(() => useSecurityFeed.setState({ now: clock() }), 30_000);
  }
  if (lastRead === null || Date.now() - lastRead >= SHOW_READ_MS) void refresh();
}

function unwatch(): void {
  watching = Math.max(0, watching - 1);
  if (watching > 0) return;
  if (poll !== null) clearInterval(poll);
  if (tick !== null) clearInterval(tick);
  poll = null;
  tick = null;
}

function join(): void {
  mounted += 1;
}

function leave(): void {
  mounted = Math.max(0, mounted - 1);
  if (mounted > 0) return;
  // Nobody shows it any more: forget it, so a later user starts from Loading, never from old data.
  epoch += 1;
  inFlight = false;
  lastRead = null;
  useSecurityFeed.setState(initial(), true);
}

/**
 * Firewall health and open alerts from the home app: one shared read on the first visible
 * user (and again on show when the last read is a minute old), then every 5 minutes while
 * any user is mounted and visible.
 */
export function useSecurity(): SecurityState {
  const visible = useVisible();
  const state = useSecurityFeed();
  useEffect(() => {
    join();
    return leave;
  }, []);
  useEffect(() => {
    if (!visible) return;
    watch();
    return unwatch;
  }, [visible]);
  return state;
}

/**
 * The number of open network alerts to raise outside Home, or 0. Only from a current good
 * read: nothing while loading, not set up, after a failed read, or when the home app says
 * its scan is stale or it cannot reach the firewall data.
 */
export function openAlarms(s: Pick<SecurityState, 'status' | 'summary'>): number {
  const sum = s.summary;
  if (s.status !== 'ready' || !sum || !sum.reachable || sum.stale) return 0;
  const n = sum.alerts;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** "1 network alert", "4 network alerts". */
export function alarmChipText(n: number): string {
  return n === 1 ? '1 network alert' : `${n} network alerts`;
}

/** Open alarms from the shared read, for the rail and the chips. */
export function useOpenAlarms(): number {
  const { status, summary } = useSecurity();
  return openAlarms({ status, summary });
}
