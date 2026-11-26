import { useEffect } from 'react';
import { useVisible } from '../ui/useVisible';
import { useFocusStore } from './store';

/** Display view of the app-level focus store. The store, not this hook, owns the timer. */
export function useFocus() {
  const visible = useVisible();
  const state = useFocusStore((s) => s.state);
  const now = useFocusStore((s) => s.now);
  const undo = useFocusStore((s) => s.undo);
  const actions = useFocusStore;

  useEffect(() => {
    actions.getState().init();
  }, [actions]);

  // The on-screen ticker may rest while hidden; the store's own timer does not.
  useEffect(() => {
    if (state.status !== 'running' || !visible) return;
    actions.getState().touch();
    const id = setInterval(() => actions.getState().touch(), 1000);
    return () => clearInterval(id);
  }, [state.status, visible, actions]);

  const a = actions.getState();
  return {
    state,
    now,
    undo,
    start: a.start,
    startLabeled: a.startLabeled,
    pause: a.pause,
    resume: a.resume,
    reset: a.reset,
    setMinutes: a.setMinutes,
    adjustLeft: a.adjustLeft,
    stop: a.stop,
    restart: a.restart,
    undoLast: a.undoLast,
  };
}
