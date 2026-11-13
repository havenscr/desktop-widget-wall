import { useEffect } from 'react';
import { create } from 'zustand';
import { invoke } from '../bridge/tauri';
import { useVisible } from '../ui/useVisible';
import { CALL_TIMEOUT_MS, KEEP_STALE_MS, needsYouCount, normalizeSummary, POLL_MS, statusLine, type OmniSummary } from './model';

/**
 * `loading` before the first answer; `unconfigured` when `feeds.json` has no helper address
 * (or a bad one); `unreachable` when reads fail and there is no earlier answer to show;
 * `ready` while there is an answer, fresh or stale.
 */
export type AgentsStatus = 'loading' | 'unconfigured' | 'unreachable' | 'ready';

export interface AgentsState {
  status: AgentsStatus;
  summary: OmniSummary | null;
  /** The last read failed, so `summary` is the last good answer. */
  readFailed: boolean;
  /** Time of the last answer the helper did not mark stale, or null. */
  freshAt: number | null;
  /** Time of the last good answer (stale or not), or null. */
  okAt: number | null;
  /** Time of the last read attempt, so the age text moves with each poll. */
  checkedAt: number;
  /** The page came back after a while: `summary` is kept but old until the next read returns. */
  awaiting: boolean;
  /** The helper's own `now` in its last answer (its clock, never compared with this PC's). */
  helperNow: number | null;
  /** This PC's time when the helper's `now` last changed. */
  helperMovedAt: number | null;
  /**
   * The helper's clock minus this PC's, worked out when the last answer arrived. Helper times
   * minus this are on the PC's clock, so a skewed clock cannot shift the ribbon.
   */
  skewMs: number;
}

const initial = (): AgentsState => ({
  status: 'loading',
  summary: null,
  readFailed: false,
  freshAt: null,
  okAt: null,
  checkedAt: Date.now(),
  awaiting: false,
  helperNow: null,
  helperMovedAt: null,
  skewMs: 0,
});

/**
 * The answer may be out of date: the helper said so, the last read failed, or the page has
 * just come back and the first new read has not returned. Stale data is never drawn as live.
 */
export function agentsStale(st: AgentsState): boolean {
  return st.summary !== null && (st.summary.stale || st.readFailed || st.awaiting);
}

/** For a stale answer, the time the data was last known good (open runs end there); else null. */
export function agentsUntil(st: AgentsState): number | null {
  return agentsStale(st) ? (st.freshAt ?? st.okAt) : null;
}

export const useAgentsStore = create<AgentsState>(() => initial());

/** `p`, or a rejection after `ms`. The timer is cleared either way. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let id: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    id = setTimeout(() => reject(new Error('timed out')), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(id));
}

let users = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let busy = false;
/** Bumped by `resetAgents`, so a read started before a reset cannot land after it. */
let epoch = 0;

async function read(): Promise<void> {
  if (busy) return;
  busy = true;
  const mine = epoch;
  try {
    const raw = await withTimeout(invoke<unknown>('wall2_omni_summary'), CALL_TIMEOUT_MS);
    if (mine !== epoch) return;
    // Anything that is not a summary is a failed read; a malformed lane is dropped.
    const s = normalizeSummary(raw);
    if (!s) throw new Error('failed');
    const now = Date.now();
    const helperNow = Date.parse(s.now);
    if (!Number.isFinite(helperNow)) throw new Error('failed');
    // A helper whose own clock has not changed for 30 minutes of this PC's time is frozen: no
    // better than no answer. Any change counts as movement, so a helper clock stepping back
    // (a correction) never reads as frozen. The two clocks are never compared, so a skew of
    // any size is fine; the first answer is always accepted.
    const prev = useAgentsStore.getState();
    const moved = prev.helperNow === null || prev.helperMovedAt === null || helperNow !== prev.helperNow;
    const helperMovedAt = moved ? now : (prev.helperMovedAt as number);
    const clock = { helperNow: moved ? helperNow : prev.helperNow, helperMovedAt, skewMs: helperNow - now };
    if (now - helperMovedAt > KEEP_STALE_MS) {
      useAgentsStore.setState({ ...initial(), ...clock, status: 'unreachable', readFailed: true, checkedAt: now });
      return;
    }
    useAgentsStore.setState((st) => ({
      ...clock,
      status: 'ready',
      summary: s,
      readFailed: false,
      freshAt: s.stale ? st.freshAt : now,
      okAt: now,
      checkedAt: now,
      awaiting: false,
    }));
  } catch (e) {
    if (mine !== epoch) return;
    const text = e instanceof Error ? e.message : String(e);
    const now = Date.now();
    if (text === 'not-configured' || text === 'invalid-config') {
      useAgentsStore.setState({ ...initial(), status: 'unconfigured', checkedAt: now });
      return;
    }
    useAgentsStore.setState((st) => {
      const keep = st.summary !== null && st.okAt !== null && now - st.okAt <= KEEP_STALE_MS;
      return keep
        ? { readFailed: true, checkedAt: now, awaiting: false }
        : { status: 'unreachable', summary: null, readFailed: true, freshAt: null, okAt: null, checkedAt: now, awaiting: false };
    });
  } finally {
    if (mine === epoch) busy = false;
  }
}

function join(): void {
  users += 1;
  if (users === 1) {
    // Back after a while (hidden, or no reader mounted): show the kept answer as old until
    // the first new read returns.
    const st = useAgentsStore.getState();
    if (st.summary && Date.now() - st.checkedAt > POLL_MS) useAgentsStore.setState({ awaiting: true, checkedAt: Date.now() });
    void read();
    timer = setInterval(() => void read(), POLL_MS);
  }
}

function leave(): void {
  users = Math.max(0, users - 1);
  if (users === 0 && timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

/** "Try again": one read now, outside the 15 second poll (skipped while a read is running). */
export function retryAgents(): void {
  void read();
}

/** Tests only: forget every answer and stop polling. */
export function resetAgents(): void {
  epoch += 1;
  busy = false;
  users = 0;
  if (timer !== null) clearInterval(timer);
  timer = null;
  useAgentsStore.setState(initial(), true);
}

/**
 * The agent lanes helper's summary, from `wall2_omni_summary`. One poll is shared by every
 * component that uses this (the Work centre, the ribbon's agent row, the status hooks): a
 * read when the first one mounts, then every 15 seconds while the page is visible and at
 * least one is mounted. Nothing is read while hidden. One read at a time; a read that takes
 * over 10 seconds counts as failed. A failed read keeps the last answer, marked stale, for
 * up to 30 minutes; a helper whose own `now` has not moved for 30 minutes of this PC's
 * time counts as not reachable (the two machines' clocks are never compared).
 * Coming back after a while marks the kept answer stale until the first new read returns.
 */
export function useAgents(): AgentsState {
  const visible = useVisible();
  useEffect(() => {
    if (!visible) return;
    join();
    return leave;
  }, [visible]);
  return useAgentsStore();
}

/**
 * One line for Unwind and Dream ("Two agents still working, nothing needs you"), or null
 * when the helper is not set up, has not answered, or the answer is stale.
 */
export function useAgentStatusLine(): string | null {
  const st = useAgents();
  return st.summary && !agentsStale(st) ? statusLine(st.summary) : null;
}

/** True while something waits for an answer (for the amber dot over Watt); false when stale. */
export function useAgentsWaiting(): boolean {
  const st = useAgents();
  return st.summary !== null && !agentsStale(st) && needsYouCount(st.summary) > 0;
}
