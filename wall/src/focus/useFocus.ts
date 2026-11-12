import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { useVisible } from '../ui/useVisible';
import { createFocusDnd } from './dnd';
import * as m from './model';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const nullStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

export function useFocus() {
  const visible = useVisible();
  const [state, setState] = useState<m.FocusState>(() => {
    try {
      return m.restore(storage()?.getItem(m.FOCUS_KEY) ?? null, Date.now());
    } catch {
      return m.initialFocus;
    }
  });
  const [now, setNow] = useState(() => Date.now());
  const dnd = useMemo(() => createFocusDnd({ invoke, storage: storage() ?? nullStorage }), []);

  // App start: undo a Do Not Disturb a previous run turned on, then take it again if still running.
  const first = useRef(true);
  useEffect(() => {
    if (!first.current) return;
    first.current = false;
    void dnd.release().then(() => {
      if (state.status === 'running') void dnd.enable();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save on every change; the end time, not a countdown, is what is stored.
  useEffect(() => {
    try {
      storage()?.setItem(m.FOCUS_KEY, m.serialize(state));
    } catch {
      /* storage unavailable: the timer still works until restart */
    }
  }, [state]);

  // Tick once a second while running and visible; recompute when the page returns.
  useEffect(() => {
    if (state.status !== 'running' || !visible) return;
    const update = () => {
      const t = Date.now();
      setNow(t);
      setState((s) => m.tick(s, t));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [state.status, visible]);

  const apply = useCallback(
    (fn: (s: m.FocusState, t: number) => m.FocusState) => {
      const t = Date.now();
      setNow(t);
      setState((s) => fn(s, t));
    },
    [],
  );

  // Do Not Disturb follows the status.
  const prev = useRef<m.FocusState['status'] | null>(null);
  useEffect(() => {
    const was = prev.current;
    prev.current = state.status;
    if (was === null) return; // app start handled above
    if (state.status === 'running' && was !== 'running') void dnd.enable();
    else if (state.status !== 'running' && was === 'running') void dnd.release();
  }, [state.status, dnd]);

  return {
    state,
    now,
    start: () => apply(m.start),
    pause: () => apply(m.pause),
    resume: () => apply(m.resume),
    reset: () => apply((s) => m.reset(s)),
    setMinutes: (minutes: number) =>
      setState((s) => (s.status === 'idle' || s.status === 'finished' ? { status: 'idle', minutes: m.clampMinutes(minutes) } : s)),
  };
}
