import { useEffect, useState } from 'react';
import { useDisplayDark } from '../ui/useDisplayDark';
import { useVisible } from '../ui/useVisible';

/** True while the page is visible and the display is on: the only time the place has any work to do. */
export function useAwake(): boolean {
  const visible = useVisible();
  const dark = useDisplayDark();
  return visible && !dark;
}

/**
 * The clock for the show timer: `Date.now()`, refreshed on each whole second while mounted. Nothing
 * ticks while the page is hidden or the display is off; the clock catches up as soon as it comes back.
 */
export function useNow(): number {
  const awake = useAwake();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!awake) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      timer = setTimeout(tick, 1000 - (t % 1000) + 5);
    };
    setNow(Date.now());
    timer = setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    return () => clearTimeout(timer);
  }, [awake]);
  return now;
}
