import { invoke } from '../bridge/tauri';

/**
 * What the wall may know about the YouTube sign-in: whether a Google client is set up, whether a
 * sign-in is stored, and one fixed word. The client id, the client secret and the tokens never
 * come back from Rust. `searchesLeft` is the search budget of the day (about 100, counted from midnight
 * Pacific), only while signed in.
 */
export interface YoutubeStatus { setup: boolean; signedIn: boolean; reason: string | null; searchesLeft: number | null }
/** One of the owner's playlists. `thumb` is an address Rust built (`https://i.ytimg.com/vi/<id>/...`) or null. */
export interface YtPlaylist { id: string; title: string; count: number; thumb: string | null }
/** Whether a video can play outside YouTube: `embed` and `region` only on YouTube, `private`, or `removed`. */
export type YtPlayable = 'yes' | 'embed' | 'private' | 'removed' | 'region';
/** One video. `seconds` is 0 when YouTube gives no length. */
export interface YtVideo { id: string; title: string; channel: string; seconds: number; thumb: string | null; playable: YtPlayable }
/** What YouTube says about one video of an own playlist. `seconds` is null for a live video or when no length came back. */
export interface YtDetail { id: string; title: string | null; channel: string | null; seconds: number | null }
/** A page of answers and the token of the next page (null at the end). */
export interface YtPage<T> { items: T[]; next: string | null }

/** The same patterns Rust checks, so a bad id or token is refused before any call (attack rule 11). */
export const PLAYLIST_ID = /^[A-Za-z0-9_-]{2,64}$/;
export const PAGE_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const refuse = <T,>(): Promise<T> => Promise.reject(new Error('invalid'));
const tokenOk = (t?: string | null) => t == null || PAGE_TOKEN.test(t);

/** The two links YouTube API Services asks every app that uses them to show; Rust owns the addresses. */
export type YoutubeLink = 'youtube-terms' | 'google-privacy';

export const youtube = {
  status: () => invoke<YoutubeStatus>('wall2_youtube_status'),
  /** Rust checks both values and refuses while signed in. Nothing is returned, and nothing reads them back. */
  setClient: (clientId: string, clientSecret: string) => invoke<void>('wall2_youtube_set_client', { clientId, clientSecret }),
  forgetClient: () => invoke<void>('wall2_youtube_forget_client'),
  signIn: () => invoke<void>('wall2_youtube_sign_in'),
  cancelSignIn: () => invoke<void>('wall2_youtube_cancel_sign_in'),
  signOut: () => invoke<void>('wall2_youtube_sign_out'),
  /** Only the kind word goes over; the address is fixed in Rust. */
  /** The owner's playlists, a page at a time. `fresh` reads this one list from YouTube again. */
  playlists: (pageToken?: string | null, fresh?: boolean): Promise<YtPage<YtPlaylist>> =>
    tokenOk(pageToken) ? invoke<YtPage<YtPlaylist>>('wall2_youtube_playlists', { pageToken: pageToken ?? null, fresh: fresh === true }) : refuse(),
  /** One page of a playlist's videos. */
  items: (playlistId: string, pageToken?: string | null, fresh?: boolean): Promise<YtPage<YtVideo>> =>
    PLAYLIST_ID.test(playlistId) && tokenOk(pageToken) ? invoke<YtPage<YtVideo>>('wall2_youtube_items', { playlistId, pageToken: pageToken ?? null, fresh: fresh === true }) : refuse(),
  /** One page of the owner's liked videos. */
  liked: (pageToken?: string | null, fresh?: boolean): Promise<YtPage<YtVideo>> =>
    tokenOk(pageToken) ? invoke<YtPage<YtVideo>>('wall2_youtube_liked', { pageToken: pageToken ?? null, fresh: fresh === true }) : refuse(),
  /** A music search (Rust counts it against the day's budget; the same words again are free). */
  search: (query: string): Promise<YtPage<YtVideo>> => invoke<YtPage<YtVideo>>('wall2_youtube_search', { query }),
  /** Title, channel and length for 1 to 50 video ids from an own playlist. */
  videos: (ids: readonly string[]): Promise<YtDetail[]> =>
    ids.length >= 1 && ids.length <= 50 && ids.every((id) => VIDEO_ID.test(id)) ? invoke<YtDetail[]>('wall2_youtube_videos', { ids: [...ids] }) : refuse(),
  openLink: (kind: YoutubeLink) => invoke<void>('wall2_open_link', { kind }),
};
