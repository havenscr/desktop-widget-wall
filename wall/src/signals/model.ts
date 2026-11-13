import type { Meeting } from '../meet/model';
import { parseRealStart } from './leave';

export type CallKind = 'teams' | 'zoom' | 'browser';
export type DeviceUse = Record<'teams' | 'zoom' | 'browser' | 'recorder' | 'other', boolean>;
export interface SignalPayload {
  known: boolean;
  mic: DeviceUse;
  camera: DeviceUse;
  /** Plain-browser development fields. Rust never sends them. */
  mockCall?: CallKind;
  mockLeave?: LeaveSignal;
}
export interface CallSignal { kind: CallKind; since: number; camera: boolean }
export interface LeaveSignal { key: string; leaveAt: number; startsAt: number }
export interface DerivedSignals { known: boolean; call: CallSignal | null; recording: boolean; leave: LeaveSignal | null }

const MIN = 60_000;
export const EMPTY_USE: DeviceUse = { teams: false, zoom: false, browser: false, recorder: false, other: false };
export const UNKNOWN_PAYLOAD: SignalPayload = { known: false, mic: EMPTY_USE, camera: EMPTY_USE };

function browserMeeting(meetings: readonly Meeting[], now: number): boolean {
  return meetings.some((m) => m.canJoin && Date.parse(m.start) - 5 * MIN <= now && Date.parse(m.end) >= now);
}

export function deriveCall(
  payload: SignalPayload,
  meetings: readonly Meeting[],
  now: number,
  previous: CallSignal | null,
  micFreeSince: number | null,
): { call: CallSignal | null; micFreeSince: number | null } {
  if (!payload.known) return { call: null, micFreeSince: null };
  const kind: CallKind | null = payload.mic.teams ? 'teams' : payload.mic.zoom ? 'zoom' : payload.mic.browser && browserMeeting(meetings, now) ? 'browser' : null;
  if (kind) return { call: { kind, since: previous?.kind === kind ? previous.since : now, camera: payload.camera[kind] }, micFreeSince: null };
  if (!previous) return { call: null, micFreeSince: null };
  const free = micFreeSince ?? now;
  return now - free >= 20_000 ? { call: null, micFreeSince: null } : { call: previous, micFreeSince: free };
}

export function deriveRecording(payload: SignalPayload): boolean {
  return payload.known && (payload.mic.recorder || payload.camera.recorder);
}

export function deriveLeave(meetings: readonly Meeting[], now: number, timeZone: string): LeaveSignal | null {
  const found = meetings
    .map((m) => ({ m, startsAt: parseRealStart(m.title, m.start, m.end, timeZone, (m as Meeting & { isAllDay?: boolean }).isAllDay) }))
    .filter((x): x is { m: Meeting; startsAt: number } => x.startsAt !== null)
    .map(({ m, startsAt }) => ({ key: m.key, leaveAt: Date.parse(m.start), startsAt }))
    .filter((x) => x.leaveAt >= now && x.leaveAt <= now + 3 * 60 * MIN)
    .sort((a, b) => a.leaveAt - b.leaveAt)[0];
  return found ?? null;
}
