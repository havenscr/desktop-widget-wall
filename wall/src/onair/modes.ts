/**
 * The new On Air frame's mode: which of Live, Recording and Presenting the page shows. Pure, no clock
 * (`now` comes in), so every rule is a table row in `modes.test.ts`.
 */
import type { CallSignal } from '../signals/model';

export type Mode = 'live' | 'rec' | 'meet' | 'none';
export type PageMode = Exclude<Mode, 'none'>;

export interface ModeInput {
  /** False when the wall cannot read the camera and microphone. */
  known: boolean;
  recording: boolean;
  call: CallSignal | null;
  /** A browser holds the camera and microphone with no joinable meeting (a broadcast from the browser). */
  browserAv: boolean;
  /** The YouTube status, wired in by a later change; null until then. */
  live: null | { state: 'not-set-up' | 'signed-out' | 'none' | 'scheduled' | 'live'; scheduledAt: number | null };
  held: PageMode | null;
  now: number;
}

export interface ModePick {
  mode: Mode;
  why: string;
  /** Every case on now, in the order live, recording, meeting. */
  seen: PageMode[];
}

/** A scheduled broadcast counts as on air from this long before it starts. */
export const LIVE_SOON_MS = 15 * 60_000;

export const HELD_WHY = 'Held by hand';

function callWhy(call: CallSignal): string {
  return call.kind === 'teams' ? 'a Teams call is on' : call.kind === 'zoom' ? 'a Zoom call is on' : 'a browser call is on';
}

export function pickMode(i: ModeInput): ModePick {
  const fallback = i.live === null || i.live.state === 'not-set-up' || i.live.state === 'signed-out';
  const liveNow = fallback ? i.browserAv : i.live!.state === 'live' || (i.live!.state === 'scheduled' && i.live!.scheduledAt !== null && i.live!.scheduledAt - i.now <= LIVE_SOON_MS);
  const rec = i.known && i.recording;
  const meet = i.call !== null;
  const seen: PageMode[] = [];
  if (liveNow) seen.push('live');
  if (rec) seen.push('rec');
  if (meet) seen.push('meet');
  if (i.held) return { mode: i.held, why: HELD_WHY, seen };
  if (rec) return { mode: 'rec', why: 'a recorder is running', seen };
  if (liveNow) {
    const why = fallback ? 'mic or camera in use' : i.live!.state === 'live' ? 'a broadcast is live' : 'a broadcast starts soon';
    return { mode: 'live', why, seen };
  }
  if (i.call) return { mode: 'meet', why: callWhy(i.call), seen };
  return { mode: 'none', why: i.known ? 'nothing is on air' : 'the wall cannot read the camera and mic', seen };
}

/** Where the hold is kept. */
export const MODE_STORAGE_KEY = 'wall2-onair-mode';

const PAGE_MODES: readonly string[] = ['live', 'rec', 'meet'];

/** The hold in storage, checked on read: anything but one of the three modes is no hold. */
export function parseHeld(raw: string | null): PageMode | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    const held = v && typeof v === 'object' ? (v as { held?: unknown }).held : null;
    return typeof held === 'string' && PAGE_MODES.includes(held) ? (held as PageMode) : null;
  } catch {
    return null;
  }
}

export const MODE_LABEL: Record<PageMode, string> = { live: 'Live', rec: 'Recording', meet: 'Presenting' };
