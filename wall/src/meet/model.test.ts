import { describe, expect, it } from 'vitest';
import { countdownText, isSoon, laterMeetings, nextMeeting, signInMessage, statusWord, type Meeting } from './model';

const NOW = Date.parse('2026-11-12T17:00:00Z');
const at = (mins: number) => new Date(NOW + mins * 60_000).toISOString().replace('.000Z', 'Z');
const meeting = (key: string, startMin: number, endMin: number): Meeting => ({
  key,
  accountId: 'work',
  title: key,
  start: at(startMin),
  end: at(endMin),
  canJoin: false,
});

describe('countdownText', () => {
  it('reads Now with minutes left while in progress', () => {
    expect(countdownText(meeting('a', -10, 22), NOW)).toBe('Now, 22 min left');
    expect(countdownText(meeting('a', 0, 30), NOW)).toBe('Now, 30 min left');
    expect(countdownText(meeting('a', -29, 0.5), NOW)).toBe('Now, 1 min left');
  });
  it('reads minutes under an hour', () => {
    expect(countdownText(meeting('a', 3, 33), NOW)).toBe('In 3 min');
    expect(countdownText(meeting('a', 42, 70), NOW)).toBe('In 42 min');
    expect(countdownText(meeting('a', 59, 80), NOW)).toBe('In 59 min');
    expect(countdownText(meeting('a', 0.2, 30), NOW)).toBe('In 1 min');
  });
  it('reads hours and minutes up to three hours', () => {
    expect(countdownText(meeting('a', 60, 90), NOW)).toBe('In 1 h 00 min');
    expect(countdownText(meeting('a', 65, 90), NOW)).toBe('In 1 h 05 min');
    expect(countdownText(meeting('a', 180, 200), NOW)).toBe('In 3 h 00 min');
  });
  it('reads a clock time past three hours', () => {
    const m = meeting('a', 181, 240);
    expect(countdownText(m, NOW)).toMatch(/^At \d{1,2}(:\d{2})? (AM|PM)$/);
    const local = new Date(Date.parse(m.start));
    const h = local.getHours() % 12 === 0 ? 12 : local.getHours() % 12;
    expect(countdownText(m, NOW)).toContain(`At ${h}`);
  });
  it('says so when nothing is coming', () => {
    expect(countdownText(undefined, NOW)).toBe('Nothing in the next 24 hours');
  });
});

describe('nextMeeting', () => {
  it('skips ended meetings', () => {
    const list = [meeting('old', -60, -30), meeting('soon', 10, 40), meeting('later', 90, 120)];
    expect(nextMeeting(list, NOW)?.key).toBe('soon');
    expect(laterMeetings(list, NOW).map((m) => m.key)).toEqual(['later']);
  });
  it('picks one in progress', () => {
    const list = [meeting('now', -5, 25), meeting('later', 40, 60)];
    expect(nextMeeting(list, NOW)?.key).toBe('now');
  });
  it('is undefined when everything ended', () => {
    expect(nextMeeting([meeting('old', -60, -30)], NOW)).toBeUndefined();
    expect(nextMeeting([], NOW)).toBeUndefined();
  });
});

it('isSoon is true only within five minutes before the start', () => {
  expect(isSoon(meeting('a', 4, 30), NOW)).toBe(true);
  expect(isSoon(meeting('a', 5, 30), NOW)).toBe(true);
  expect(isSoon(meeting('a', 6, 30), NOW)).toBe(false);
  expect(isSoon(meeting('a', -1, 30), NOW)).toBe(false);
  expect(isSoon(undefined, NOW)).toBe(false);
});

it('status words and sign-in messages', () => {
  expect(statusWord('ok')).toBe('Connected');
  expect(statusWord('needs-sign-in')).toBe('Sign in needed');
  expect(statusWord('signed-out')).toBe('Sign in needed');
  expect(statusWord('unavailable')).toBe('Unavailable');
  expect(signInMessage('cancelled')).toBeNull();
  expect(signInMessage('denied')).toBe('Sign-in was declined');
  expect(signInMessage('whatever')).toBe('Sign-in did not work');
});
