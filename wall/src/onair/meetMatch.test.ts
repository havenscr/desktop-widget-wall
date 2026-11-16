import { describe, expect, it } from 'vitest';
import type { Meeting } from '../meet/model';
import { matchMeeting, minutesLeft, talkStart } from './meetMatch';

const MIN = 60_000;
const T10 = Date.parse('2026-11-11T10:00:00-08:00');
const meeting = (title: string, start: number, end: number): Meeting => ({ key: title, accountId: 'work', title, start: new Date(start).toISOString(), end: new Date(end).toISOString(), canJoin: true });
const talk = meeting('Talk', T10, T10 + 60 * MIN);

describe('matchMeeting', () => {
  it('matches a call that began inside the meeting', () => {
    expect(matchMeeting([talk], T10 + 12 * MIN)?.title).toBe('Talk');
  });
  it('matches a call that began 10 minutes early and not 11', () => {
    expect(matchMeeting([talk], T10 - 10 * MIN)?.title).toBe('Talk');
    expect(matchMeeting([talk], T10 - 11 * MIN)).toBeNull();
  });
  it('does not match a call that began after the end', () => {
    expect(matchMeeting([talk], T10 + 60 * MIN)?.title).toBe('Talk');
    expect(matchMeeting([talk], T10 + 60 * MIN + 1)).toBeNull();
  });
  it('takes the later start when two meetings hold the call', () => {
    const later = meeting('Later', T10 + 5 * MIN, T10 + 45 * MIN);
    expect(matchMeeting([talk, later], T10 + 10 * MIN)?.title).toBe('Later');
    expect(matchMeeting([later, talk], T10 + 10 * MIN)?.title).toBe('Later');
  });
  it('a stale or failed feed matches nothing', () => {
    expect(matchMeeting([talk], T10 + MIN, false)).toBeNull();
    expect(matchMeeting([], T10 + MIN)).toBeNull();
  });
  it('skips a meeting whose times cannot be read', () => {
    expect(matchMeeting([{ ...talk, start: 'soon' }], T10 + MIN)).toBeNull();
  });
});

describe('talk timer arithmetic', () => {
  it('starts at the later of the meeting start and the call start', () => {
    expect(talkStart(talk, T10 - 4 * MIN)).toBe(T10);
    expect(talkStart(talk, T10 + 5 * MIN)).toBe(T10 + 5 * MIN);
    expect(talkStart(null, T10 - 12 * MIN)).toBe(T10 - 12 * MIN);
  });
  it('rounds the minutes left up, and is 0 at and past the end', () => {
    expect(minutesLeft(talk, T10 + 24 * MIN)).toBe(36);
    expect(minutesLeft(talk, T10 + 24 * MIN + 1)).toBe(36);
    expect(minutesLeft(talk, T10 + 59 * MIN + 1000)).toBe(1);
    expect(minutesLeft(talk, T10 + 60 * MIN)).toBe(0);
    expect(minutesLeft(talk, T10 + 90 * MIN)).toBe(0);
    expect(minutesLeft(null, T10)).toBeNull();
  });
});

describe('matchMeeting: only a meeting a call can belong to', () => {
  it('skips an item that cannot be joined', () => {
    expect(matchMeeting([{ ...talk, canJoin: false }], T10 + 12 * MIN)).toBeNull();
    // The joinable one wins even when the other one starts later.
    const later = { ...meeting('Reminder', T10 + 5 * MIN, T10 + 45 * MIN), canJoin: false };
    expect(matchMeeting([talk, later], T10 + 10 * MIN)?.title).toBe('Talk');
  });
  it('skips an entry of 24 hours or more, and keeps one just under', () => {
    const allDay = meeting('Offsite', T10 - 2 * 60 * MIN, T10 - 2 * 60 * MIN + 24 * 60 * MIN);
    expect(matchMeeting([allDay], T10)).toBeNull();
    const nearly = meeting('Long day', T10 - 2 * 60 * MIN, T10 - 2 * 60 * MIN + 24 * 60 * MIN - 1);
    expect(matchMeeting([nearly], T10)?.title).toBe('Long day');
  });
  it('with several left, the later start still wins', () => {
    const allDay = meeting('Offsite', T10 - 60 * MIN, T10 + 23 * 60 * MIN);
    const later = meeting('Later', T10 + 5 * MIN, T10 + 45 * MIN);
    expect(matchMeeting([allDay, talk, later], T10 + 10 * MIN)?.title).toBe('Later');
  });
});
