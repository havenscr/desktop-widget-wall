/** "10:20 AM" in the wall's local time. */
export function clockText(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** "10:00 to 11:00 AM today": one meridiem when both ends share it. `today` becomes the weekday for another day. */
export function windowText(start: number, end: number, now: number): string {
  const a = clockText(start);
  const b = clockText(end);
  const same = a.slice(-2) === b.slice(-2);
  const sameDay = new Date(start).toDateString() === new Date(now).toDateString();
  const day = sameDay ? 'today' : new Date(start).toLocaleDateString('en-US', { weekday: 'long' });
  return `${same ? a.slice(0, -3) : a} to ${b} ${day}`;
}
