import { useEffect, useState } from 'react';
import { localDate, untilMidnight } from './model';
import { useOnAirStore } from './store';
import { useAwake } from './useNow';

/**
 * What every On Air frame does when its place is open: restore the timer and read the run of show,
 * stop the timer at 24 hours as the clock ticks, and read today's marks (again after local midnight,
 * and on coming back when the date moved on while the page was hidden).
 */
export function useOnAirLoad(now: number): void {
  const awake = useAwake();
  const [day, setDay] = useState(() => localDate(Date.now()));
  useEffect(() => {
    const s = useOnAirStore.getState();
    s.hydrate();
    void s.loadShow();
    // Closing the place drops a read of the run of show that Open file was waiting to make.
    return () => useOnAirStore.getState().cancelPending();
  }, []);
  // The timer stops itself at 24 hours.
  useEffect(() => {
    useOnAirStore.getState().settle();
  }, [now]);
  // Today's marks: read when the place opens, and again after local midnight (one timer to the next
  // midnight; nothing while the page is hidden, and a read on coming back if the date moved on).
  useEffect(() => {
    if (!awake) return;
    const s = useOnAirStore.getState();
    if (s.marksDate !== localDate(Date.now())) void s.loadMarks();
    // The timer only moves the day on: this effect runs again for the new day and reads once, as it does on opening.
    const id = setTimeout(() => setDay(localDate(Date.now())), untilMidnight(Date.now()) + 50);
    return () => clearTimeout(id);
  }, [awake, day]);
}
