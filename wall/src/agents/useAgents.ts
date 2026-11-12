import { useEffect } from 'react';
import { create } from 'zustand';
import { invoke } from '../bridge/tauri';
import { useVisible } from '../ui/useVisible';
import { CALL_TIMEOUT_MS, KEEP_STALE_MS, POLL_MS, needsYouCount, statusLine, type OmniSummary } from './model';

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
}

const initial = (): AgentsState => ({ status: 'loading', summary: null, readFailed: false, freshAt: null, okAt: null, checkedAt: Date.now() });

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

/** A summary as the Rust command returns it. Anything else is a failed read. */
function isSummary(v: unknown): v is OmniSummary {
  const s = v as OmniSummary | null;
  return !!s && typeof s === 'object' && Array.isArray(s.lanes) && !!s.slots && !!s.yourMove && Array.isArray(s.day);
}

async function read(): Promise<void> {
  if (busy) return;
  busy = true;
  const mine = epoch;
  try {
    const s = await withTimeout(invoke<unknown>('wall2_omni_summary'), CALL_TIMEOUT_MS);
    if (mine !== epoch) return;
    if (!isSummary(s)) throw new Error('failed');
    const now = Date.now();
    useAgentsStore.setState((st) => ({
      status: 'ready',
      summary: s,
      readFailed: false,
      freshAt: s.stale ? st.freshAt : now,
      okAt: now,
      checkedAt: now,
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
        ? { readFailed: true, checkedAt: now }
        : { status: 'unreachable', summary: null, readFailed: true, freshAt: null, okAt: null, checkedAt: now };
    });
  } finally {
    if (mine === epoch) busy = false;
  }
}

function join(): void {
  users += 1;
  if (users === 1) {
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
 * up to 30 minutes.
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
 * One line for Unwind and Dream ("2 agents still working, nothing needs you"), or null when
 * the helper is not set up or has not answered.
 */
export function useAgentStatusLine(): string | null {
  const { summary } = useAgents();
  return summary ? statusLine(summary) : null;
}

/** True while something waits for an answer (for the amber dot over Watt). */
export function useAgentsWaiting(): boolean {
  const { summary } = useAgents();
  return summary !== null && needsYouCount(summary) > 0;
}
