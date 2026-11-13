import { expect, it } from 'vitest';
import { usePacificTime } from '../ribbon/testZone';
import {
  clampVolume,
  dateLine,
  firstTomorrow,
  freshReading,
  playingSession,
  readLastPlayed,
  statusLine,
  tomorrowTime,
  volumeLevel,
  writeLastPlayed,
  LAST_PLAYED_KEY,
} from './model';

usePacificTime();

const look = { label: 'Clear', icon: 'moon' as const };

it('writes the concept date line with the day part and the weather', () => {
  const d = new Date('2026-11-11T21:42:00-08:00');
  expect(dateLine(d, { temp: 48.6, look })).toBe('Wednesday night, 49° and clear');
  expect(dateLine(d, null)).toBe('Wednesday night');
  expect(dateLine(new Date('2026-11-11T09:00:00-08:00'), null)).toBe('Wednesday morning');
  expect(dateLine(new Date('2026-11-11T14:00:00-08:00'), null)).toBe('Wednesday afternoon');
  expect(dateLine(new Date('2026-11-11T18:30:00-08:00'), { temp: 51, look: { label: 'Partly cloudy', icon: 'cloud-moon' } })).toBe(
    'Wednesday evening, 51° and partly cloudy',
  );
  // Past midnight the night still belongs to the day before.
  expect(dateLine(new Date('2026-11-12T01:15:00-08:00'), null)).toBe('Wednesday night');
});

const ev = (key: string, start: string, title = key) => ({ key, title, start, end: start });

it('finds the first event after the coming midnight, or none', () => {
  const now = Date.parse('2026-11-11T21:42:00-08:00');
  const events = [
    ev('today', '2026-11-11T17:00:00Z'),
    ev('later', '2026-11-12T18:30:00Z'),
    ev('first', '2026-11-12T17:00:00Z', 'AE sync'),
  ];
  expect(firstTomorrow(events, now)?.title).toBe('AE sync');
  expect(firstTomorrow([ev('today', '2026-11-11T17:00:00Z')], now)).toBeNull();
  expect(firstTomorrow([ev('bad', 'not a date')], now)).toBeNull();
  // An event the day after tomorrow is not "tomorrow".
  expect(firstTomorrow([ev('far', '2026-11-13T17:00:00Z')], now)).toBeNull();
  // Tomorrow's first event after noon (the day feed now runs to the end of tomorrow).
  expect(firstTomorrow([ev('pm', '2026-11-12T21:00:00Z', 'Review')], now)?.title).toBe('Review');
  expect(tomorrowTime(Date.parse('2026-11-12T17:00:00Z'))).toBe('9:00');
  expect(tomorrowTime(Date.parse('2026-11-12T21:30:00Z'))).toBe('1:30 PM');
});

it('builds the status line from focus and the helper summary', () => {
  const lanes = [{ state: 'working' }, { state: 'blocked' }, { state: 'working' }];
  expect(statusLine('off', { lanes, yourMove: { total: 0 } })).toBe('Work is put away. 2 agents still running. No agent needs you.');
  expect(statusLine('off', { lanes: [{ state: 'working' }], yourMove: { total: 1 } })).toBe('Work is put away. 1 agent still running. One thing needs you.');
  expect(statusLine('on', { lanes: [], yourMove: { total: 3 } })).toBe('Focus is still on. 3 things need you.');
  expect(statusLine('off', null)).toBe('Work is put away.');
});

it('leaves out stale helper data, a count that is not a number, and focus before it loads', () => {
  const lanes = [{ state: 'working' }];
  expect(statusLine('off', { stale: true, lanes, yourMove: { total: 0 } })).toBe('Work is put away.');
  expect(statusLine('off', { lanes, yourMove: { total: Number.NaN } })).toBe('Work is put away. 1 agent still running.');
  expect(statusLine('off', { lanes: [], yourMove: { total: Infinity } })).toBe('Work is put away.');
  expect(statusLine('unknown', { lanes, yourMove: { total: 0 } })).toBe('1 agent still running. No agent needs you.');
  expect(statusLine('unknown', null)).toBe('');
});

it('uses a weather reading only while it is under an hour old', () => {
  const now = Date.parse('2026-11-11T21:42:00-08:00');
  const r = (minsAgo: number) => ({ fetchedAt: now - minsAgo * 60_000 });
  expect(freshReading(r(59), now)).not.toBeNull();
  expect(freshReading(r(60), now)).toBeNull();
  expect(freshReading(r(-5), now)).toBeNull();
  expect(freshReading(null, now)).toBeNull();
});

it('ends tomorrow at the next local midnight by calendar date across clock changes', () => {
  // Spring forward: Sunday 2026-03-08 has 23 hours. At 9 PM Saturday, 00:30 on Monday is
  // inside 24 elapsed hours of Sunday's midnight but is not tomorrow; 23:30 Sunday is.
  const sat = Date.parse('2026-03-07T21:00:00-08:00');
  expect(firstTomorrow([ev('mon', '2026-03-09T00:30:00-07:00')], sat)).toBeNull();
  expect(firstTomorrow([ev('sun', '2026-03-08T23:30:00-07:00')], sat)?.key).toBe('sun');
  // Fall back: Sunday 2026-11-01 has 25 hours. 23:30 Sunday is 24.5 hours after its midnight.
  const fri = Date.parse('2026-10-31T21:00:00-07:00');
  expect(firstTomorrow([ev('late', '2026-11-01T23:30:00-08:00')], fri)?.key).toBe('late');
  expect(firstTomorrow([ev('mon', '2026-11-02T00:30:00-08:00')], fri)).toBeNull();
});

it('takes "tomorrow" as the day just begun between midnight and 5 AM', () => {
  const late = Date.parse('2026-11-12T01:15:00-08:00');
  const events = [ev('past', '2026-11-12T00:30:00-08:00'), ev('nine', '2026-11-12T09:00:00-08:00', 'AE sync'), ev('fri', '2026-11-13T08:00:00-08:00')];
  expect(firstTomorrow(events, late)?.title).toBe('AE sync');
  // From 5 AM it is the next day again.
  expect(firstTomorrow(events, Date.parse('2026-11-12T05:00:00-08:00'))?.key).toBe('fri');
});

it("matches the playing app's audio session by name", () => {
  const s = (name: string) => ({ id: `1:${name}`, name, volume: 50, muted: false });
  const sessions = [s('chrome.exe'), s('Spotify.exe'), s('msedge.exe')];
  expect(playingSession(sessions, 'Spotify')?.name).toBe('Spotify.exe');
  expect(playingSession(sessions, 'Edge')?.name).toBe('msedge.exe');
  expect(playingSession(sessions, 'Chrome')?.name).toBe('chrome.exe');
  expect(playingSession(sessions, 'VLC')).toBeNull();
  // Never a partial match: "Music" is not "AppleMusic.exe" and "Spot" is not Spotify.
  const more = [s('AppleMusic.exe'), s('Music.UI.exe'), s('Spotify.exe')];
  expect(playingSession(more, 'Music')).toBeNull();
  expect(playingSession(more, 'Spot')).toBeNull();
  expect(playingSession(more, 'Groove Music')?.name).toBe('Music.UI.exe');
  expect(playingSession(more, 'Apple Music')?.name).toBe('AppleMusic.exe');
  expect(playingSession(sessions, null)).toBeNull();
  expect(playingSession(sessions, '')).toBeNull();
});

it('clamps the volume to 0..1 and sends whole levels', () => {
  expect(clampVolume(-0.2)).toBe(0);
  expect(clampVolume(1.4)).toBe(1);
  expect(clampVolume(Number.NaN)).toBe(0);
  expect(volumeLevel(0.555)).toBe(56);
  expect(volumeLevel(2)).toBe(100);
});

it('keeps the last played track in storage and ignores junk', () => {
  const map = new Map<string, string>();
  const st = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
  expect(readLastPlayed(st)).toBeNull();
  writeLastPlayed(st, { title: 'Tokyo Burnout', artist: 'Tokyo Rose', source: 'Spotify' });
  expect(readLastPlayed(st)).toEqual({ title: 'Tokyo Burnout', artist: 'Tokyo Rose', source: 'Spotify' });
  map.set(LAST_PLAYED_KEY, '{bad json');
  expect(readLastPlayed(st)).toBeNull();
  map.set(LAST_PLAYED_KEY, JSON.stringify({ title: 5 }));
  expect(readLastPlayed(st)).toBeNull();
});
