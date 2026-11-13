import { useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { useVisible } from '../ui/useVisible';
import { registerRetry, reportRead } from '../tools/reports';
import { CALL_TIMEOUT_MS, holdReadings, nextOverSince, POLL_MS, type Machines, type OverSince } from './model';

/** Readings further apart than this do not carry a hold across. */
const GAP_MS = 3 * POLL_MS;

export interface MachinesState {
  /** The last good answer, or null before one (or after the command failed). */
  data: Machines | null;
  /** When each number went over its limit and stayed there. */
  over: OverSince;
  /** Time of the last read, for the hold. */
  now: number;
}

/** `p`, or a rejection after `ms`. The timer is cleared either way. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let id: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    id = setTimeout(() => reject(new Error('timed out')), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(id));
}

/**
 * The PC and box numbers from `wall2_machines`, every 2 seconds while the page is visible
 * and the readout is mounted (Work only). Nothing while hidden. A failed read, or one that
 * takes longer than 5 seconds, hides the readout. One read at a time: a tick that finds
 * one running is skipped, and only the read that took the busy flag clears it, so hiding
 * and showing never stacks reads. An answer from a read that was superseded is ignored.
 */
export function useMachines(): MachinesState {
  const visible = useVisible();
  const [state, setState] = useState<MachinesState>({ data: null, over: {}, now: Date.now() });

  /** Token of the read in flight, or null. */
  const busy = useRef<number | null>(null);
  const token = useRef(0);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    const read = (): Promise<void> => {
      if (busy.current !== null) return Promise.resolve();
      const mine = ++token.current;
      busy.current = mine;
      const current = () => live && mine === token.current;
      return withTimeout(invoke<Machines>('wall2_machines'), CALL_TIMEOUT_MS)
        .then((m) => {
          if (!current()) return;
          const now = Date.now();
          const ok = m && m.pc ? m : null;
          if (!ok) reportRead('box', 'failed', 'The machine numbers did not come back');
          else if (ok.boxStale) reportRead('box', 'stale', 'The box reading is out of date');
          else if (!ok.box) reportRead('box', 'stale', 'The box sent no numbers');
          else reportRead('box', 'ok');
          // After a gap (hidden, or a slow read) the hold starts again: nobody saw those seconds.
          setState((s) => {
            const prev = now - s.now > GAP_MS ? {} : s.over;
            return { data: ok, over: ok ? nextOverSince(prev, holdReadings(ok), now) : {}, now };
          });
        })
        .catch(() => {
          if (current()) setState({ data: null, over: {}, now: Date.now() });
          if (current()) reportRead('box', 'failed', 'The machine numbers did not answer');
        })
        .finally(() => {
          if (busy.current === mine) busy.current = null;
        });
    };
    read();
    const id = setInterval(read, POLL_MS);
    const unregister = registerRetry('box', read);
    return () => {
      live = false;
      clearInterval(id);
      unregister();
    };
  }, [visible]);

  return state;
}
