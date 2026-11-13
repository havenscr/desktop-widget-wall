/**
 * What can be watched, and the strict link parser that turns a pasted link into one.
 *
 * A saved item is a kind and an id, nothing else from the link: a YouTube video, live stream
 * or playlist id, or a Twitch login. Every id is checked against its kind's exact shape
 * (`validId`) wherever it comes from (a paste, local storage, a URL builder), so a stored or
 * pasted value can never carry a host, a path or a script into a frame address.
 */

export const KINDS = ['video', 'live', 'playlist', 'twitch'] as const;
export type WatchKind = (typeof KINDS)[number];

export interface WatchRef {
  kind: WatchKind;
  id: string;
}

/** YouTube video (and live stream) ids: exactly 11 of `[A-Za-z0-9_-]`. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
/** YouTube playlist ids: 13 to 64 of the same. */
const PLAYLIST_ID = /^[A-Za-z0-9_-]{13,64}$/;
/** Twitch logins: 3 to 25 of `[a-z0-9_]`, lower case. */
const LOGIN = /^[a-z0-9_]{3,25}$/;

/** A pasted link longer than this is refused before it is read. */
export const MAX_LINK_LENGTH = 2048;

export function isKind(v: unknown): v is WatchKind {
  return typeof v === 'string' && (KINDS as readonly string[]).includes(v);
}

/** True when `id` has the exact shape its kind allows. */
export function validId(kind: WatchKind, id: unknown): id is string {
  if (typeof id !== 'string') return false;
  switch (kind) {
    case 'video':
    case 'live':
      return VIDEO_ID.test(id);
    case 'playlist':
      return PLAYLIST_ID.test(id);
    case 'twitch':
      return LOGIN.test(id);
  }
}

/** True for a well formed kind and id pair. */
export function validRef(v: unknown): v is WatchRef {
  if (!v || typeof v !== 'object') return false;
  const r = v as Partial<WatchRef>;
  return isKind(r.kind) && validId(r.kind, r.id);
}

export type ParseResult = { ok: true; ref: WatchRef } | { ok: false; error: string };

export const LINK_ERRORS = {
  empty: 'Paste a YouTube or Twitch link first.',
  long: 'That link is too long to be a YouTube or Twitch link.',
  other: 'That is not a YouTube or Twitch link.',
  youtube: 'That YouTube link has no video, live stream or playlist in it.',
  twitch: 'That Twitch link has no channel in it.',
} as const;

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const TWITCH_HOSTS = new Set(['twitch.tv', 'www.twitch.tv', 'm.twitch.tv']);
/** Twitch paths that are pages of the site, not channels. */
const TWITCH_PAGES = new Set([
  'directory',
  'downloads',
  'drops',
  'friends',
  'inventory',
  'jobs',
  'login',
  'messages',
  'p',
  'prime',
  'search',
  'settings',
  'signup',
  'subscriptions',
  'turbo',
  'videos',
  'wallet',
]);

const fail = (error: string): ParseResult => ({ ok: false, error });
const ok = (kind: WatchKind, id: string): ParseResult => ({ ok: true, ref: { kind, id } });

/** The path split into its parts, with an empty last part (a trailing slash) dropped. */
function parts(pathname: string): string[] {
  const p = pathname.split('/').slice(1);
  if (p.length > 1 && p[p.length - 1] === '') p.pop();
  return p;
}

/**
 * Read a pasted link. Accepted: `youtu.be/<id>`, `youtube.com/watch?v=<id>` (with a valid
 * `list=` it is that playlist), `youtube.com/live/<id>`, `youtube.com/playlist?list=<id>` and
 * `twitch.tv/<login>`, with or without `https://` (or `http://`), `www.` or `m.`, in any case
 * for the host and the path words. Other parameters and a fragment are ignored. Anything else,
 * including user names, ports, other schemes and look-alike hosts, is refused with one plain line.
 */
export function parseLink(input: unknown): ParseResult {
  if (typeof input !== 'string') return fail(LINK_ERRORS.empty);
  const text = input.trim();
  if (!text) return fail(LINK_ERRORS.empty);
  if (text.length > MAX_LINK_LENGTH) return fail(LINK_ERRORS.long);
  // Whitespace or control characters inside a link: not one link.
  if (/[\s\u0000-\u001f\u007f]/.test(text)) return fail(LINK_ERRORS.other);
  // A scheme must be http or https; without one, https is assumed.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text);
  let withScheme = text;
  if (scheme) {
    const s = scheme[1].toLowerCase();
    if (s !== 'http' && s !== 'https') return fail(LINK_ERRORS.other);
    if (!/^https?:\/\//i.test(text)) return fail(LINK_ERRORS.other);
  } else {
    if (text.startsWith('/')) return fail(LINK_ERRORS.other);
    withScheme = `https://${text}`;
  }
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return fail(LINK_ERRORS.other);
  }
  if (url.username || url.password || url.port) return fail(LINK_ERRORS.other);
  const host = url.hostname.toLowerCase();
  const path = parts(url.pathname);
  const word = (i: number) => (path[i] ?? '').toLowerCase();

  if (host === 'youtu.be') {
    if (path.length === 1 && validId('video', path[0])) return ok('video', path[0]);
    return fail(LINK_ERRORS.youtube);
  }
  if (YOUTUBE_HOSTS.has(host)) {
    const list = url.searchParams.get('list');
    if (path.length === 1 && word(0) === 'watch') {
      if (list !== null && validId('playlist', list)) return ok('playlist', list);
      const v = url.searchParams.get('v');
      if (validId('video', v)) return ok('video', v);
      return fail(LINK_ERRORS.youtube);
    }
    if (path.length === 2 && word(0) === 'live' && validId('live', path[1])) return ok('live', path[1]);
    if (path.length === 1 && word(0) === 'playlist' && validId('playlist', list)) return ok('playlist', list);
    return fail(LINK_ERRORS.youtube);
  }
  if (TWITCH_HOSTS.has(host)) {
    const login = word(0);
    if (path.length === 1 && validId('twitch', login) && !TWITCH_PAGES.has(login)) return ok('twitch', login);
    return fail(LINK_ERRORS.twitch);
  }
  return fail(LINK_ERRORS.other);
}

/** The kind's name for people: in the list, the tooltips and the player. */
export function kindName(kind: WatchKind): string {
  switch (kind) {
    case 'video':
      return 'YouTube video';
    case 'live':
      return 'YouTube live stream';
    case 'playlist':
      return 'YouTube playlist';
    case 'twitch':
      return 'Twitch channel';
  }
}

/** The label a new item starts with, until the owner names it. */
export function defaultLabel(ref: WatchRef): string {
  return ref.kind === 'twitch' ? `${ref.id} on Twitch` : kindName(ref.kind);
}

/** One key per item, for lists and the playing marker. */
export function refKey(ref: WatchRef): string {
  return `${ref.kind}:${ref.id}`;
}
