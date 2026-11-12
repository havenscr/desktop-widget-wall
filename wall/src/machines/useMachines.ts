import { useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { useVisible } from '../ui/useVisible';
import { nextOverSince, POLL_MS, readings, type Machines, type OverSince } from './model';

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

/**
 * The PC and box numbers from `wall2_machines`, every 2 seconds while the page is visible
 * and the readout is mounted (Work only). Nothing while hidden. A failed read hides the
 * readout. One read at a time: a tick that finds one running is skipped.
 */
export function useMachines(): MachinesState {
  const visible = useVisible();
  const [state, setState] = useState<MachinesState>({ data: null, over: {}, now: Date.now() });

  const busy = useRef(false);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    const read = () => {
      if (busy.current) return;
      busy.current = true;
      invoke<Machines>('wall2_machines')
        .then((m) => {
          if (!live) return;
          const now = Date.now();
          const ok = m && m.pc ? m : null;
          // After a gap (hidden, or a slow read) the hold starts again: nobody saw those seconds.
          setState((s) => {
            const prev = now - s.now > GAP_MS ? {} : s.over;
            return { data: ok, over: ok ? nextOverSince(prev, readings(ok), now) : {}, now };
          });
        })
        .catch(() => {
          if (live) setState({ data: null, over: {}, now: Date.now() });
        })
        .finally(() => {
          busy.current = false;
        });
    };
    read();
    const id = setInterval(read, POLL_MS);
    return () => {
      live = false;
      busy.current = false;
      clearInterval(id);
    };
  }, [visible]);

  return state;
}
