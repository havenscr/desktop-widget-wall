import { validRef, type WatchRef } from './links';

/** The only two hosts a frame is ever pointed at (and the only `frame-src` in the CSP). */
export const YOUTUBE_EMBED_ORIGIN = 'https://www.youtube-nocookie.com';
export const TWITCH_EMBED_ORIGIN = 'https://player.twitch.tv';
export const PLAYER_ORIGINS: readonly string[] = [YOUTUBE_EMBED_ORIGIN, TWITCH_EMBED_ORIGIN];

/** The frame's fixed attributes. */
export const FRAME_ALLOW = 'autoplay; encrypted-media; picture-in-picture';
export const FRAME_REFERRER = 'strict-origin-when-cross-origin';
export const FRAME_SANDBOX = 'allow-scripts allow-same-origin';

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
  // The player's own controls, keyboard, fullscreen button and annotations are off by the
  // documented embed parameters (`modestbranding` is deprecated and left out); the wall's own
  // buttons drive it through the frame messages that `enablejsapi` and `origin` allow.
  const tail = `autoplay=1&controls=0&disablekb=1&fs=0&iv_load_policy=3&playsinline=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(where.origin)}`;
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

export type YouTubeCommand = 'playVideo' | 'pauseVideo' | 'mute' | 'unMute' | 'setVolume' | 'nextVideo' | 'previousVideo' | 'seekTo';

/** The volume inside the player: always full; the owner sets the level with the system volume. */
export const PLAYER_VOLUME = 100;

/**
 * The YouTube embed's command message (sent with the embed origin as the target). Arguments
 * are finite numbers or booleans only; anything else is dropped.
 */
export function commandMessage(func: YouTubeCommand, args: readonly (number | boolean)[] = []): string {
  const clean = args.filter((a) => typeof a === 'boolean' || (typeof a === 'number' && Number.isFinite(a)));
  return JSON.stringify({ event: 'command', func, args: clean });
}

/** Asks the YouTube embed to send its state changes. */
export const LISTENING_MESSAGE = JSON.stringify({ event: 'listening', id: 1, channel: 'widget' });

export type PlayState = 'playing' | 'paused' | 'ended' | 'buffering';

/** What a player frame may tell the wall; every field optional, every number finite and clamped. */
export interface PlayerInfo {
  state?: PlayState;
  /** Seconds played, 0 to `MAX_SECONDS`. */
  time?: number;
  /** Length in seconds, 0 to `MAX_SECONDS` (0 for a live stream). */
  duration?: number;
  /** Items in the playlist the player is on (0 for a single video). */
  count?: number;
  /** The item playing in that playlist, 0 based. */
  index?: number;
  /** True for the frame's ready message (`onReady` or `initialDelivery`). */
  ready?: boolean;
}

/** The largest message read, in characters. */
export const MAX_MESSAGE = 20_000;
/** Longer than any real video or stream position (a week). */
export const MAX_SECONDS = 7 * 24 * 3600;
/** The most playlist items counted. */
export const MAX_ITEMS = 5000;

function num(v: unknown, max: number): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return Math.min(max, Math.max(0, v));
}

function stateOf(v: unknown): PlayState | undefined {
  switch (v) {
    case 1:
      return 'playing';
    case 2:
      return 'paused';
    case 0:
      return 'ended';
    case 3:
      return 'buffering';
    default:
      return undefined;
  }
}

/**
 * The gate for every message from a player frame (outside input). Accepted only when the
 * sender is exactly the YouTube embed origin AND the message came from this frame's own
 * window; the data must be a JSON string under `MAX_MESSAGE` characters with one of the
 * player's four known events. Only the fields above are read, each by its expected type
 * (numbers finite and clamped, the playlist only counted); nothing is evaluated or turned
 * into markup. Null for anything else.
 */
export function readPlayerMessage(origin: unknown, source: unknown, frame: unknown, data: unknown): PlayerInfo | null {
  if (origin !== YOUTUBE_EMBED_ORIGIN) return null;
  if (!frame || source !== frame) return null;
  if (typeof data !== 'string' || data.length > MAX_MESSAGE) return null;
  let msg: unknown;
  try {
    msg = JSON.parse(data);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
  const m = msg as { event?: unknown; info?: unknown };
  if (m.event === 'onReady') return { ready: true };
  if (m.event === 'onStateChange') {
    const state = stateOf(m.info);
    return state ? { state } : null;
  }
  if (m.event !== 'infoDelivery' && m.event !== 'initialDelivery') return null;
  if (!m.info || typeof m.info !== 'object' || Array.isArray(m.info)) return null;
  const i = m.info as Record<string, unknown>;
  const out: PlayerInfo = {};
  if (m.event === 'initialDelivery') out.ready = true;
  const state = stateOf(i.playerState);
  if (state) out.state = state;
  const time = num(i.currentTime, MAX_SECONDS);
  if (time !== undefined) out.time = time;
  const duration = num(i.duration, MAX_SECONDS);
  if (duration !== undefined) out.duration = duration;
  if (Array.isArray(i.playlist)) out.count = Math.min(MAX_ITEMS, i.playlist.length);
  else if (i.playlist === null) out.count = 0;
  const index = num(i.playlistIndex, MAX_ITEMS);
  if (index !== undefined) out.index = Math.floor(index);
  return Object.keys(out).length ? out : null;
}
