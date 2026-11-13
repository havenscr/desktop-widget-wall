import { describe, expect, it } from 'vitest';
import { accountWords, calendarNotAvailable, countdownText, isSoon, laterMeetings, nextMeeting, reasonLine, reasonText, signInMessage, statusWord, type Meeting } from './model';

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
  expect(statusWord('needs-sign-in')).toBe('Sign-in expired');
  expect(statusWord('signed-out')).toBe('Signed out');
  expect(statusWord('unavailable')).toBe('Unavailable');
  expect(signInMessage('cancelled')).toBeNull();
  expect(signInMessage('denied')).toBe('Sign-in was declined');
  expect(signInMessage('whatever')).toBe('Sign-in did not work');
});

describe('reasonText', () => {
  it('maps each family to plain words', () => {
    const table: [string, string][] = [
      ['graph-403', 'Calendar refused the request'],
      ['graph-403-ErrorAccessDenied', 'Calendar refused the request'],
      ['graph-400', 'Calendar did not understand the request'],
      ['graph-429', 'Microsoft is busy'],
      ['graph-500', 'Microsoft is busy'],
      ['graph-503-ServiceUnavailable', 'Microsoft is busy'],
      ['graph-network', 'No connection to Microsoft'],
      ['token-network', 'No connection to Microsoft'],
      ['token-400', 'Sign-in was not accepted'],
      ['token-400-9002327', 'Sign-in was not accepted'],
      ['store-write', 'Could not save the sign-in on this PC'],
      ['store-read', 'Could not save the sign-in on this PC'],
      ['graph-body', 'Calendar sent a reply that could not be read'],
      ['graph-401', 'Calendar did not accept the sign-in'],
      ['graph-404', 'Calendar could not be read'],
    ];
    for (const [code, words] of table) expect(reasonText(code), code).toBe(words);
  });

  it('puts the code in brackets', () => {
    expect(reasonLine('graph-403-ErrorAccessDenied')).toBe('Calendar refused the request (graph-403-ErrorAccessDenied)');
  });

  it('shows nothing for a code that is not a known shape', () => {
    for (const bad of ['', 'other', 'graph-4031', 'graph-403-a b', 'graph-403-https://example.test', 'token-400-ab', 'user@example.test']) {
      expect(reasonText(bad), bad).toBeNull();
    }
    expect(reasonText(undefined)).toBeNull();
  });

  it('a sign-in that failed reads with its reason', () => {
    expect(signInMessage('token-400-65001')).toBe('Sign-in was not accepted (token-400-65001)');
    expect(signInMessage('store-write')).toBe('Could not save the sign-in on this PC (store-write)');
    expect(signInMessage('failed')).toBe('Sign-in did not work');
  });
});

it('puts a failed account in plain words', () => {
  expect(accountWords('unavailable', 'graph-network')).toBe('Network problem');
  expect(accountWords('unavailable', 'token-network')).toBe('Network problem');
  expect(accountWords('unavailable', 'graph-503-UnknownError')).toBe('Microsoft is not answering');
  expect(accountWords('unavailable', 'graph-429')).toBe('Microsoft is not answering');
  expect(accountWords('unavailable', 'graph-timeout')).toBe('Microsoft is not answering');
  expect(accountWords('unavailable', 'graph-403')).toBe('Calendar could not be read');
  expect(accountWords('unavailable', undefined)).toBe('Calendar could not be read');
  expect(accountWords('needs-sign-in', 'token-400')).toBe('Sign-in expired');
  expect(accountWords('checking', undefined)).toBe('Checking');
  expect(reasonLine('graph-timeout')).toBe('Microsoft did not answer in time (graph-timeout)');
});

it('knows when no calendar can be read', () => {
  expect(calendarNotAvailable([])).toBe(false);
  expect(calendarNotAvailable([{ state: 'signed-out' }, { state: 'unavailable' }])).toBe(true);
  expect(calendarNotAvailable([{ state: 'signed-out' }, { state: 'ok' }])).toBe(false);
  expect(calendarNotAvailable([{ state: 'checking' }])).toBe(false);
});

import { checkAgainText, joinIsUrgent, laterEmpty, notFresh, notReadLine, relativeIn } from './model';

it('joinIsUrgent: live or within 15 minutes only', () => {
  const now = Date.parse('2026-11-12T17:00:00Z');
  const m = (s: number, e: number) => ({ start: new Date(now + s * 60_000).toISOString(), end: new Date(now + e * 60_000).toISOString() });
  expect(joinIsUrgent(m(-5, 25), now)).toBe(true);
  expect(joinIsUrgent(m(15, 45), now)).toBe(true);
  expect(joinIsUrgent(m(16, 45), now)).toBe(false);
  expect(joinIsUrgent(m(-40, -10), now)).toBe(false);
});

it('relativeIn and checkAgainText give relative times, never a clock', () => {
  const now = 1_000_000;
  expect(relativeIn(now + 100_000, now)).toBe('in 2 min');
  expect(relativeIn(now + 10_000, now)).toBe('in 1 min');
  expect(relativeIn(now - 1, now)).toBe('in under a minute');
  expect(relativeIn(now + 65 * 60_000, now)).toBe('in 1 h 5 min');
  expect(checkAgainText(now + 120_000, undefined, now)).toBe('checking again in 2 min');
  expect(checkAgainText(null, now - 60_000, now)).toBe('checking again in 4 min');
  expect(checkAgainText(null, undefined, now)).toBeNull();
});

it('laterEmpty names the account that was read and the one that was not', () => {
  const ok = { id: 'w', label: 'Work', state: 'ok' as const };
  const bad = { id: 's', label: 'Second', state: 'unavailable' as const };
  const out = { id: 's', label: 'Second', state: 'signed-out' as const };
  const lastOk = new Date(2026, 10, 12, 9, 40).getTime();
  expect(laterEmpty([ok], null)).toEqual({ headline: 'Nothing else', notes: [] });
  expect(laterEmpty([ok, bad], lastOk)).toEqual({ headline: 'Nothing else on Work', notes: ['Second not read since 9:40 AM'] });
  expect(laterEmpty([ok, out], lastOk).notes).toEqual(['Second is signed out']);
  expect(laterEmpty([bad, out], lastOk).headline).toBe('Nothing else');
  expect(notReadLine({ label: 'Second', state: 'unavailable' }, null)).toBe('Second has not been read');
  expect(notFresh('checking')).toBe(false);
  expect(notFresh('ok')).toBe(false);
});
