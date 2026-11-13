import { validRef, type WatchRef } from './links';

/** The only two hosts a frame is ever pointed at (and the only `frame-src` in the CSP). */
export const YOUTUBE_EMBED_ORIGIN = 'https://www.youtube-nocookie.com';
export const TWITCH_EMBED_ORIGIN = 'https://player.twitch.tv';
export const PLAYER_ORIGINS: readonly string[] = [YOUTUBE_EMBED_ORIGIN, TWITCH_EMBED_ORIGIN];

/** The frame's fixed attributes. */
export const FRAME_ALLOW = 'autoplay; encrypted-media; picture-in-picture';
export const FRAME_REFERRER = 'strict-origin-when-cross-origin';
export const FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-presentation';

/** The page origin and host name the players are told about; http and https only. */
export interface PageWhere {
  origin: string;
  hostname: string;
}

/** Where this page is, or null when it is not served over http or https (a `file:` page). */
export function pageWhere(loc: Pick<Location, 'origin' | 'hostname' | 'protocol'> = window.location): PageWhere | null {
  if (loc.protocol !== 'https:' && loc.protocol !== 'http:') return null;
  if (!loc.hostname || !/^[A-Za-z0-9.-]+$/.test(loc.hostname)) return null;
  return { origin: loc.origin, hostname: loc.hostname };
}

/**
 * The frame address for a saved item, built only from a kind and an id that pass the id
 * checks again here: YouTube on its no-cookie embed host, Twitch on its player host. Every
 * value is escaped. Null for anything that does not pass, or a page with no web origin.
 */
export function embedUrl(ref: unknown, where: PageWhere | null): string | null {
  if (!validRef(ref) || !where) return null;
  const r: WatchRef = ref;
  const id = encodeURIComponent(r.id);
  if (r.kind === 'twitch') {
    return `${TWITCH_EMBED_ORIGIN}/?channel=${id}&parent=${encodeURIComponent(where.hostname)}`;
  }
  const tail = `autoplay=1&playsinline=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(where.origin)}`;
  if (r.kind === 'playlist') return `${YOUTUBE_EMBED_ORIGIN}/embed/videoseries?list=${id}&${tail}`;
  return `${YOUTUBE_EMBED_ORIGIN}/embed/${id}?${tail}`;
}

/** The origin a frame for this item may talk from, and the target for messages to it. */
export function playerOrigin(ref: WatchRef): string {
  return ref.kind === 'twitch' ? TWITCH_EMBED_ORIGIN : YOUTUBE_EMBED_ORIGIN;
}

/** True only for the two player origins, exactly. */
export function isPlayerOrigin(origin: unknown): boolean {
  return typeof origin === 'string' && PLAYER_ORIGINS.includes(origin);
}

export type YouTubeCommand = 'playVideo' | 'pauseVideo' | 'mute' | 'unMute';

/** The YouTube embed's command message (sent with the embed origin as the target). */
export function commandMessage(func: YouTubeCommand): string {
  return JSON.stringify({ event: 'command', func, args: [] });
}

/** Asks the YouTube embed to send its state changes. */
export const LISTENING_MESSAGE = JSON.stringify({ event: 'listening', id: 1, channel: 'widget' });

export type PlayState = 'playing' | 'paused' | 'ended' | 'buffering';

/**
 * The play state in a message from a player frame, or null. The message is trusted for
 * nothing else: only an exact player origin, a string under 20 kB of JSON, and a YouTube
 * `onStateChange` or `infoDelivery.playerState` number are read.
 */
export function readPlayState(origin: unknown, data: unknown): PlayState | null {
  // Twitch's player is never asked for its state, so only the YouTube embed is read.
  if (origin !== YOUTUBE_EMBED_ORIGIN) return null;
  if (typeof data !== 'string' || data.length > 20_000) return null;
  let msg: unknown;
  try {
    msg = JSON.parse(data);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object') return null;
  const m = msg as { event?: unknown; info?: unknown };
  let state: unknown = null;
  if (m.event === 'onStateChange') state = m.info;
  else if (m.event === 'infoDelivery' && m.info && typeof m.info === 'object') state = (m.info as { playerState?: unknown }).playerState;
  switch (state) {
    case 1:
      return 'playing';
    case 2:
      return 'paused';
    case 0:
      return 'ended';
    case 3:
      return 'buffering';
    default:
      return null;
  }
}
