import type { UIEvent } from 'react';
import { VIDEO_ID, type YoutubeStatus, type YtPlayable, type YtVideo } from '../../music/youtube';

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

/** What a row says it will do when it plays: the end of its hover card. */
export const PLAY_TIP = 'Click to play it on the wall';

/** The tip of a row: title, channel and length, then why when it is greyed (`why` overrides the reason: a video that failed this session), or what a click does when it plays. */
export function rowTip(v: YtVideo, why?: string | null): string[] {
  const second = [v.channel, lengthText(v.seconds)].filter(Boolean).join(' · ');
  const last = why ?? rowReason(v.playable) ?? (v.playable === 'yes' ? PLAY_TIP : '');
  return [v.title, second, last].filter(Boolean);
}

/** The tip of a video that failed to play this session, by why. */
export function failedReason(why: 'embed' | 'removed'): string {
  return why === 'embed' ? 'The owner of this video allows it to play only on YouTube.' : 'YouTube no longer has this video.';
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

/** The ways a search answer can be ordered. `best` is YouTube's own order and comes back with every new search. */
export type YtSort = 'best' | 'views' | 'longest' | 'shortest' | 'channel' | 'title';
export const DEFAULT_SORT: YtSort = 'best';
/** The sort menu's choices: the words in the menu, the short name the button shows once one is picked, and what the hover card says. */
export const SORT_CHOICES: readonly { id: YtSort; label: string; short: string }[] = [
  { id: 'best', label: 'Best match', short: 'Best match' },
  { id: 'views', label: 'Most viewed', short: 'Views' },
  { id: 'longest', label: 'Longest first', short: 'Longest' },
  { id: 'shortest', label: 'Shortest first', short: 'Shortest' },
  { id: 'channel', label: 'Channel, A to Z', short: 'Channel' },
  { id: 'title', label: 'Title, A to Z', short: 'Title' },
];
export const SORT_TIP = 'Sort the results already found. It never searches again.';

const countOf = (n: number | null | undefined): number | null => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null);
const same = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });

/**
 * The answer in the order picked, as a new list (the answer itself is never changed, and `best` returns it as it is).
 * Under the numeric sorts a row with no length or no views goes last; ties keep YouTube's order.
 */
export function sortVideos(items: readonly YtVideo[], sort: YtSort): YtVideo[] {
  if (sort === 'best') return items.slice();
  const rows = items.map((v, i) => ({ v, i }));
  // A row without the number the sort reads (a playlist, a live video) sorts after every row that has it.
  const by = (read: (v: YtVideo) => number | null, sign: 1 | -1) => (a: { v: YtVideo; i: number }, b: { v: YtVideo; i: number }) => {
    const x = read(a.v);
    const y = read(b.v);
    if (x === null && y === null) return a.i - b.i;
    if (x === null) return 1;
    if (y === null) return -1;
    return (x - y) * sign || a.i - b.i;
  };
  const text = (read: (v: YtVideo) => string) => (a: { v: YtVideo; i: number }, b: { v: YtVideo; i: number }) => {
    const x = read(a.v);
    const y = read(b.v);
    if (!x && !y) return a.i - b.i;
    if (!x) return 1;
    if (!y) return -1;
    return same(x, y) || a.i - b.i;
  };
  const length = (v: YtVideo) => (v.seconds > 0 ? v.seconds : null);
  switch (sort) {
    case 'views':
      rows.sort(by((v) => countOf(v.views), -1));
      break;
    case 'longest':
      rows.sort(by(length, -1));
      break;
    case 'shortest':
      rows.sort(by(length, 1));
      break;
    case 'channel':
      rows.sort(text((v) => v.channel));
      break;
    case 'title':
      rows.sort(text((v) => v.title));
      break;
  }
  return rows.map((r) => r.v);
}

/** "900", "87K", "2.4M": a count in at most four characters (cut, not rounded up, so 999,999 is 999K). Empty for no count. */
export function compactCount(n: number | null | undefined): string {
  const count = countOf(n);
  if (count === null) return '';
  if (count < 1000) return String(Math.floor(count));
  const units = ['K', 'M', 'B', 'T'];
  let value = count;
  let at = -1;
  while (value >= 1000 && at < units.length - 1) {
    value /= 1000;
    at += 1;
  }
  const shown = value < 10 ? String(Math.floor(value * 10) / 10) : String(Math.floor(value));
  return `${shown}${units[at]}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Mar 2023" from an upload day `2023-03-14`; empty for anything else. */
export function uploadMonth(day: string | null | undefined): string {
  const m = typeof day === 'string' ? /^(\d{4})-(\d{2})-\d{2}/.exec(day) : null;
  const month = m ? Number(m[2]) : 0;
  return m && month >= 1 && month <= 12 ? `${MONTHS[month - 1]} ${m[1]}` : '';
}

/** How long the pointer rests on a result row before its details card shows. */
export const DETAIL_CARD_MS = 500;
/** The most description characters the card holds (Rust sends 600 at most). */
const DESCRIPTION_SHOWN = 600;

/** The words of a row's details card, or null when the row has nothing beyond what its row shows. */
export interface DetailWords { views: string; likes: string; length: string; month: string; description: string }
export function detailWords(v: YtVideo): DetailWords | null {
  const words: DetailWords = {
    views: compactCount(v.views),
    likes: compactCount(v.likes),
    length: lengthText(v.seconds),
    month: uploadMonth(v.published),
    description: typeof v.description === 'string' ? Array.from(v.description).slice(0, DESCRIPTION_SHOWN).join('').trim() : '',
  };
  return words.views || words.likes || words.month || words.description ? words : null;
}

/** A result row's picture: the one Rust sent, from YouTube's picture host only, else the address built from a checked video id, else none. */
export function rowThumb(v: Pick<YtVideo, 'id' | 'thumb'>): string | null {
  return safeThumb(v.thumb) ?? (VIDEO_ID.test(v.id) ? `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg` : null);
}

/** Development builds only: `ytcard=<row>` (counting from 0) opens the details card of that search row once the results show (the review pages have no resting pointer). */
export function devCardKnob(): number | null {
  if (!import.meta.env.DEV) return null;
  const n = Number(new URLSearchParams(window.location.search).get('ytcard'));
  return Number.isInteger(n) && n >= 0 && new URLSearchParams(window.location.search).has('ytcard') ? n : null;
}
