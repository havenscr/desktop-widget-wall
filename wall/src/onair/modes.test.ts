import { describe, expect, it } from 'vitest';
import type { CallSignal } from '../signals/model';
import { MODE_STORAGE_KEY, parseHeld, pickMode, type ModeInput, type PageMode } from './modes';

const NOW = Date.parse('2026-11-11T10:24:00-08:00');
const MIN = 60_000;
const teams: CallSignal = { kind: 'teams', since: NOW - 5 * MIN, camera: false };
const zoom: CallSignal = { kind: 'zoom', since: NOW - 5 * MIN, camera: true };
const browser: CallSignal = { kind: 'browser', since: NOW - 5 * MIN, camera: false };
const base: ModeInput = { known: true, recording: false, call: null, browserAv: false, live: null, held: null, now: NOW };
const pick = (o: Partial<ModeInput>) => pickMode({ ...base, ...o });
const live = (state: 'not-set-up' | 'signed-out' | 'none' | 'scheduled' | 'live', scheduledAt: number | null = null) => ({ state, scheduledAt });

describe('pickMode: one case on', () => {
  it.each([
    ['nothing', {}, 'none', 'nothing is on air', []],
    ['a recorder', { recording: true }, 'rec', 'a recorder is running', ['rec']],
    ['a Teams call', { call: teams }, 'meet', 'a Teams call is on', ['meet']],
    ['a Zoom call', { call: zoom }, 'meet', 'a Zoom call is on', ['meet']],
    ['a browser call', { call: browser }, 'meet', 'a browser call is on', ['meet']],
    ['the browser camera and mic', { browserAv: true }, 'live', 'mic or camera in use', ['live']],
    ['a live broadcast', { live: live('live') }, 'live', 'a broadcast is live', ['live']],
    ['a broadcast 10 minutes off', { live: live('scheduled', NOW + 10 * MIN) }, 'live', 'a broadcast starts soon', ['live']],
  ] as [string, Partial<ModeInput>, string, string, string[]][])('%s', (_n, o, mode, why, seen) => {
    expect(pick(o)).toEqual({ mode, why, seen });
  });
});

describe('pickMode: more than one case on', () => {
  it('a broadcast YouTube says is live wins over a recorder; recording wins over the other live cases and a call', () => {
    const rec = { recording: true };
    const liveOn = { live: live('live') };
    const call = { call: teams };
    expect(pick({ ...rec, ...liveOn }).mode).toBe('live');
    expect(pick({ ...rec, ...liveOn }).why).toBe('a broadcast is live');
    expect(pick({ ...rec, ...call }).mode).toBe('rec');
    expect(pick({ ...liveOn, ...call }).mode).toBe('live');
    expect(pick({ ...rec, ...liveOn, ...call }).mode).toBe('live');
    // A broadcast starting soon, or the browser camera and mic, is not proof: the recorder still wins.
    expect(pick({ ...rec, live: live('scheduled', NOW + 10 * MIN) }).mode).toBe('rec');
    expect(pick({ ...rec, browserAv: true }).mode).toBe('rec');
  });
  it('seen lists every case on now in the order live, rec, meet', () => {
    expect(pick({ recording: true, call: teams, live: live('live') }).seen).toEqual(['live', 'rec', 'meet']);
    expect(pick({ recording: true, call: teams }).seen).toEqual(['rec', 'meet']);
    expect(pick({ live: live('live'), call: zoom }).seen).toEqual(['live', 'meet']);
  });
  it('a hold wins in every case, says so, and still lists what is on', () => {
    const modes: PageMode[] = ['live', 'rec', 'meet'];
    for (const held of modes) {
      const r = pick({ held, recording: true, call: teams, live: live('live') });
      expect(r).toEqual({ mode: held, why: 'Held by hand', seen: ['live', 'rec', 'meet'] });
    }
    expect(pick({ held: 'rec' })).toEqual({ mode: 'rec', why: 'Held by hand', seen: [] });
  });
});

describe('pickMode: the live status and unknown signals', () => {
  it.each([null, live('not-set-up'), live('signed-out')])('with %j the browser camera and mic decide', (l) => {
    expect(pick({ live: l, browserAv: true }).mode).toBe('live');
    expect(pick({ live: l, browserAv: false }).mode).toBe('none');
  });
  it('with a live status the browser camera and mic alone are not live', () => {
    expect(pick({ live: live('none'), browserAv: true })).toEqual({ mode: 'none', why: 'nothing is on air', seen: [] });
    expect(pick({ live: live('scheduled', NOW + 60 * MIN), browserAv: true }).seen).toEqual([]);
  });
  it('a scheduled broadcast is on at 15 minutes and not at 15 minutes and 1 ms', () => {
    expect(pick({ live: live('scheduled', NOW + 15 * MIN) }).mode).toBe('live');
    expect(pick({ live: live('scheduled', NOW + 15 * MIN + 1) }).mode).toBe('none');
    expect(pick({ live: live('scheduled', null) }).mode).toBe('none');
  });
  it('unknown signals say the wall cannot read the camera and mic', () => {
    expect(pick({ known: false, recording: true })).toEqual({ mode: 'none', why: 'the wall cannot read the camera and mic', seen: [] });
  });
});

describe('the hold in storage', () => {
  it('is checked on read: anything but one of the three modes is no hold', () => {
    expect(MODE_STORAGE_KEY).toBe('wall2-onair-mode');
    expect(parseHeld(JSON.stringify({ held: 'rec' }))).toBe('rec');
    expect(parseHeld(JSON.stringify({ held: 'live' }))).toBe('live');
    expect(parseHeld(JSON.stringify({ held: 'meet' }))).toBe('meet');
    for (const bad of [null, '', 'rec', '{', '[]', 'null', '{"held":"none"}', '{"held":3}', '{"held":null}', '{"hold":"rec"}']) expect(parseHeld(bad)).toBeNull();
  });
});
