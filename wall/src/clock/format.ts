const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

export interface ClockParts {
  time: string; // h:mm
  meridiem: 'AM' | 'PM';
  date: string; // Wednesday, November 11
}

export function formatClock(d: Date): ClockParts {
  const h = d.getHours();
  const m = d.getMinutes();
  return {
    time: `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}`,
    meridiem: h < 12 ? 'AM' : 'PM',
    date: DATE_FORMAT.format(d),
  };
}
