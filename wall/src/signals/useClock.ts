import { useEffect, useRef, useState } from 'react';
import { useVisible } from '../ui/useVisible';

/**
 * The current time, refreshed every `ms` milliseconds while the caller is mounted, the page is visible
 * and `active` is true. Nothing ticks otherwise; the clock refreshes once as soon as it may tick again.
 */
export function useClock(ms: number, active = true): number {
  const visible = useVisible();
  const run = active && visible;
  const [now, setNow] = useState(() => Date.now());
  // True while the interval below is running; a render before that (a clock that was paused) reads the real time.
  const live = useRef(false);
  useEffect(() => {
    if (!run) return;
    setNow(Date.now());
    live.current = true;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => {
      live.current = false;
      clearInterval(id);
    };
  }, [ms, run]);
  return live.current ? now : Date.now();
}
