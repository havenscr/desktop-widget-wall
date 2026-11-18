import { defaultLabel } from './watch/links';
import type { SavedItem } from './watch/saved';

/** A title as Watch compares it: trimmed, with the " - YouTube" a browser tab adds dropped. */
export const watchTitle = (value: string | null | undefined) => value?.trim().replace(/ - YouTube$/i, '').trim();

/**
 * Players that play YouTube: the browsers and the YouTube Music app. A saved Watch video can only be "this track" when
 * one of these has it. Spotify and the other audio apps never match by title: a song and a video can share a name.
 */
const YOUTUBE_PLAYERS: readonly string[] = ['YouTube Music', 'Edge', 'Chrome', 'Firefox', 'Brave', 'Opera'];

/**
 * Whether a saved Watch item is known to be this exact track: a saved video or live stream with a name of the owner's
 * (not the default label), equal to the track's title, while a YouTube player has it. Anything else is no match.
 */
export function savedVideoMatch(title: string | null | undefined, player: string | null | undefined, saved: readonly SavedItem[]): boolean {
  const t = watchTitle(title);
  if (!t || !player || !YOUTUBE_PLAYERS.includes(player)) return false;
  return saved.some((item) => (item.kind === 'video' || item.kind === 'live') && item.label !== defaultLabel(item) && watchTitle(item.label) === t);
}
