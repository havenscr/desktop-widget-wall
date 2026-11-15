import type { UIEvent } from 'react';
import type { YoutubeStatus, YtPlayable, YtVideo } from '../../music/youtube';

/** Within this many pixels of the end of a scrolled list, the next page is read. */
export const MORE_AT_PX = 160;
/** At most this many pages of one list are read (50 videos each: the first 2000). */
export const MAX_PAGES = 40;
export const PAGE_SIZE = 50;
/** Under this many searches left, the search field says how many remain. */
export const LOW_SEARCHES = 20;

/** Close to the end of a scrolled list (the same three lines as the Spotify card's own). */
export const nearEnd = (e: UIEvent<HTMLElement>) => {
  const el = e.currentTarget;
  return el.scrollTop + el.clientHeight >= el.scrollHeight - MORE_AT_PX;
};

/** What a read can go wrong with, from the fixed words Rust answers with. */
export type YtProblem = 'notsetup' | 'needsSignIn' | 'broken' | 'busy' | 'quota' | 'quotaAll' | 'gone' | 'invalid' | 'down';

export function ytProblem(e: unknown): YtProblem {
  const text = (e instanceof Error ? e.message : typeof e === 'string' ? e : '').toLowerCase().trim();
  if (text === 'not set up' || text === 'setup missing') return 'notsetup';
  if (text === 'sign in again') return 'needsSignIn';
  if (text === 'setup broken' || text === 'setup unreadable') return 'broken';
  if (text === 'busy') return 'busy';
  if (text === 'quota') return 'quota';
  if (text === 'quota-all') return 'quotaAll';
  if (text === 'not found') return 'gone';
  if (text === 'invalid') return 'invalid';
  return 'down';
}

/** The line a list shows for a problem, and what to press about it. */
export function problemLine(p: YtProblem): string {
  switch (p) {
    case 'notsetup':
      return 'Set up YouTube in Tools to see your playlists here.';
    case 'needsSignIn':
      return 'YouTube needs a new sign-in.';
    case 'broken':
      return 'YouTube refused this setup. Tools says what to do.';
    case 'busy':
      return 'YouTube is busy. Try again in a minute.';
    case 'quota':
      return 'Searches are used up until midnight Pacific.';
    case 'quotaAll':
      return 'YouTube reads are used up until midnight Pacific.';
    case 'gone':
      return 'This playlist is gone.';
    case 'invalid':
      return 'YouTube refused that request.';
    default:
      return 'YouTube is not answering.';
  }
}

/** The one button a problem offers. */
export function problemAction(p: YtProblem): 'tools' | 'retry' | 'back' | null {
  if (p === 'notsetup' || p === 'needsSignIn' || p === 'broken') return 'tools';
  if (p === 'gone') return 'back';
  if (p === 'quota' || p === 'quotaAll') return null;
  return 'retry';
}

/** What the YouTube side shows for a status. */
export type SideMode = 'checking' | 'unreadable' | 'notsetup' | 'broken' | 'again' | 'nosignin' | 'library';

export function sideMode(status: YoutubeStatus | null, failed: boolean): SideMode {
  if (!status) return failed ? 'unreadable' : 'checking';
  if (!status.setup) return 'notsetup';
  if (status.reason === 'setup broken' || status.reason === 'setup unreadable' || status.reason === 'setup missing') return 'broken';
  if (!status.signedIn) return status.reason === 'sign in again' ? 'again' : 'nosignin';
  return 'library';
}

/** The line under the remote when the library cannot show, and the one button. */
export function hintFor(mode: SideMode): { text: string; action: 'tools' | 'retry' } | null {
  switch (mode) {
    case 'notsetup':
      return { text: 'Set up YouTube in Tools to see your playlists here. About ten minutes, once.', action: 'tools' };
    case 'nosignin':
      return { text: 'Sign in to YouTube in Tools to see your playlists here.', action: 'tools' };
    case 'again':
      return { text: 'YouTube needs a new sign-in.', action: 'tools' };
    case 'broken':
      return { text: 'YouTube refused this setup. Tools says what to do.', action: 'tools' };
    case 'unreadable':
      return { text: 'Could not check YouTube.', action: 'retry' };
    default:
      return null;
  }
}

export const HINT_TIP = 'Your playlists, your liked videos and a music search, after one Google sign-in';
export const SEARCH_TIP = 'YouTube allows about 100 searches a day. A repeated search is free.';
export const SPENT_LINE = 'Searches are used up until midnight Pacific';

/** "41 videos". */
export function videosLine(n: number): string {
  const count = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'video' : 'videos'}`;
}

/** "12 searches left today" while under the low mark; nothing otherwise (or when the count is unknown). */
export function searchesLine(left: number | null | undefined): string | null {
  if (typeof left !== 'number' || !Number.isFinite(left) || left >= LOW_SEARCHES || left <= 0) return null;
  const n = Math.floor(left);
  return `${n} ${n === 1 ? 'search' : 'searches'} left today`;
}

/** A search is spent at 0 left, or after Google said so. */
export function searchSpent(left: number | null | undefined, quotaSaid: boolean): boolean {
  return quotaSaid || (typeof left === 'number' && left <= 0);
}

/** "3:34", "1:02:10"; empty when YouTube gave no length. */
export function lengthText(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** What the length column says for a row that will not play outside YouTube; null for one that will. */
export function rowWords(playable: YtPlayable): string | null {
  switch (playable) {
    case 'embed':
    case 'region':
      return 'Only on YouTube';
    case 'private':
      return 'Private';
    case 'removed':
      return 'Removed';
    default:
      return null;
  }
}

/** Why a greyed row will not play outside YouTube (its hover tip). */
export function rowReason(playable: YtPlayable): string | null {
  switch (playable) {
    case 'embed':
      return 'The owner of this video allows it to play only on YouTube.';
    case 'region':
      return 'YouTube blocks this video in this region, so it plays only on YouTube.';
    case 'private':
      return 'This video is private.';
    case 'removed':
      return 'YouTube no longer has this video.';
    default:
      return null;
  }
}

/** The tip of a row: title, channel and length, and why when it is greyed. */
export function rowTip(v: YtVideo): string[] {
  const second = [v.channel, lengthText(v.seconds)].filter(Boolean).join(' · ');
  return [v.title, second, rowReason(v.playable) ?? ''].filter(Boolean);
}

/** Add a page to a list without repeating a video that is already there. */
export function mergePage<T extends { id: string }>(have: T[], page: T[]): T[] {
  const seen = new Set(have.map((x) => x.id));
  const out = have.slice();
  for (const x of page) {
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    out.push(x);
  }
  return out;
}

/** "10:24 PM": when a list was last read from YouTube. */
export function readTime(at: number): string {
  return new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** A picture is drawn only from YouTube's picture host. A development build also draws the mocks' own motifs. */
export function safeThumb(src: string | null | undefined): string | null {
  if (typeof src !== 'string') return null;
  if (src.startsWith('https://i.ytimg.com/vi/')) return src;
  if (import.meta.env.DEV && src.startsWith('data:image/svg+xml')) return src;
  return null;
}

/** The search words as Rust would accept them: trimmed, 1 to 100 characters, no control or bidirectional character. */
export function searchWords(text: string): string | null {
  const q = text.trim();
  // eslint-disable-next-line no-control-regex
  if (q.length === 0 || [...q].length > 100 || /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯]/.test(q)) return null;
  return q;
}

/** Development builds only: `ytsearch=<words>` in the address runs that search when the library opens (the review pages have no Enter key). */
export function devSearchKnob(): string | null {
  return import.meta.env.DEV ? new URLSearchParams(window.location.search).get('ytsearch') : null;
}
