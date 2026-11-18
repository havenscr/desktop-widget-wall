import type { ModeInput, PageMode } from './modes';

/** How long before a scheduled broadcast it already counts as live. */
export const LIVE_SOON_MS = 15 * 60_000;

/**
 * Which modes the signals show, ignoring any hold. Kept apart from `modes.ts` and free of its reason words, so
 * code in the boot chunk (the On Air live report) can use it without pulling the On Air frame in.
 */
export function seenModes(i: ModeInput): PageMode[] {
  const fallback = i.live === null || i.live.state === 'not-set-up' || i.live.state === 'signed-out';
  const liveNow = fallback ? i.browserAv : i.live!.state === 'live' || (i.live!.state === 'scheduled' && i.live!.scheduledAt !== null && i.live!.scheduledAt - i.now <= LIVE_SOON_MS);
  const seen: PageMode[] = [];
  if (liveNow) seen.push('live');
  if (i.known && i.recording) seen.push('rec');
  if (i.call !== null) seen.push('meet');
  return seen;
}
