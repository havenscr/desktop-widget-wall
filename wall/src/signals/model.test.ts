import { describe, expect, it } from 'vitest';
import type { Meeting } from '../meet/model';
import { deriveCall, deriveLeave, deriveRecording, EMPTY_USE, type SignalPayload } from './model';

const NOW = Date.parse('2026-11-12T18:00:00Z');
const payload = (known = true): SignalPayload => ({ known, mic: { ...EMPTY_USE }, camera: { ...EMPTY_USE } });
const meeting = (over: Partial<Meeting> = {}): Meeting => ({
  key: 'opaque', accountId: 'work', title: 'Appointment (11:00 start)', start: '2026-11-12T18:30:00Z', end: '2026-11-12T20:00:00Z', canJoin: true, ...over,
});

describe('signal rules', () => {
  it.each(['teams', 'zoom'] as const)('recognizes a %s call and its camera', (kind) => {
    const p = payload(); p.mic[kind] = true; p.camera[kind] = true;
    expect(deriveCall(p, [], NOW, null, null).call).toEqual({ kind, since: NOW, camera: true });
  });
  it('requires an in-progress joinable meeting for a browser call', () => {
    const p = payload(); p.mic.browser = true;
    expect(deriveCall(p, [], NOW, null, null).call).toBeNull();
    expect(deriveCall(p, [meeting({ start: new Date(NOW + 4 * 60_000).toISOString() })], NOW, null, null).call?.kind).toBe('browser');
    expect(deriveCall(p, [meeting({ canJoin: false })], NOW, null, null).call).toBeNull();
    expect(deriveCall(p, [meeting({ start: new Date(NOW - 60 * 60_000).toISOString(), end: new Date(NOW - 1).toISOString() })], NOW, null, null).call).toBeNull();
  });
  it('debounces a free microphone for 20 seconds', () => {
    const live = { kind: 'teams' as const, since: NOW - 1000, camera: false };
    expect(deriveCall(payload(), [], NOW, live, null)).toEqual({ call: live, micFreeSince: NOW });
    expect(deriveCall(payload(), [], NOW + 19_999, live, NOW).call).toBe(live);
    expect(deriveCall(payload(), [], NOW + 20_000, live, NOW).call).toBeNull();
  });
  it('reports recording from either device', () => {
    const mic = payload(); mic.mic.recorder = true;
    const camera = payload(); camera.camera.recorder = true;
    expect(deriveRecording(mic)).toBe(true);
    expect(deriveRecording(camera)).toBe(true);
  });
  it('finds only the next leave block inside three hours', () => {
    const later = meeting({ key: 'later', title: 'Later (12:00 start)', start: '2026-11-12T19:30:00Z', end: '2026-11-12T21:00:00Z' });
    expect(deriveLeave([later, meeting()], NOW, 'America/Los_Angeles')).toEqual({ key: 'opaque', leaveAt: Date.parse('2026-11-12T18:30:00Z'), startsAt: Date.parse('2026-11-12T19:00:00Z') });
    expect(deriveLeave([meeting({ start: new Date(NOW + 4 * 60 * 60_000).toISOString(), end: new Date(NOW + 6 * 60 * 60_000).toISOString() })], NOW, 'America/Los_Angeles')).toBeNull();
  });
  it('fails every derived value closed when native state is unknown', () => {
    const p = payload(false); p.mic.teams = true; p.camera.recorder = true;
    expect(deriveCall(p, [meeting()], NOW, { kind: 'teams', since: 1, camera: true }, null).call).toBeNull();
    expect(deriveRecording(p)).toBe(false);
  });
});
