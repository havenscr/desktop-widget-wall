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

export interface BuildInfo {
  commit: string;
  builtAt: string; // UTC, to the minute: 2026-11-13T09:05Z
}

/** The tooltip's last line: `Build 7c9f442, Nov 13, 3:05 AM` (local time). A missing or odd stamp gives null. */
export function formatBuild(info: BuildInfo | null | undefined): string | null {
  if (!info || !/^[0-9a-f]{7}$|^dev$/.test(info.commit)) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})Z$/.exec(info.builtAt);
  if (!m) return `Build ${info.commit}`;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
  const c = formatClock(d);
  return `Build ${info.commit}, ${date}, ${c.time} ${c.meridiem}`;
}
