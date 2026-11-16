import { invoke } from '../bridge/tauri';

export type SpotifyMode = 'playlist' | 'album' | 'track';
export interface SpotifyItem { id: string; name: string; kind: SpotifyMode; imageUrl: string | null; thumbUrl: string | null; subtitle: string | null; count: number | null; /** Only a song of a search answer has its length. */ durationMs?: number }
export interface SpotifyDevice { id: string; name: string; kind: string; active: boolean; restricted?: boolean; volume: number | null }
/** `canSave`: does the sign-in hold the permission to save songs? `no` for a sign-in made before that permission was asked for; `unknown` until the first token answer after a restart (and for good if no answer names the permissions). Only `no` is a reason to dim the heart. */
export type SpotifyCanSave = 'yes' | 'no' | 'unknown';
export interface SpotifyStatus { setup: boolean; signedIn: boolean; reason: string | null; canSave?: SpotifyCanSave }
export interface SpotifySearch { tracks: SpotifyItem[]; albums: SpotifyItem[]; playlists: SpotifyItem[] }
export interface SpotifyTrack { id: string | null; name: string; artists: string; album: string; durationMs: number; imageUrl: string | null; thumbUrl: string | null; playable: boolean }
export interface SpotifyTrackPage { items: SpotifyTrack[]; total: number; more: boolean }
export interface SpotifyQueue { current: SpotifyTrack | null; next: SpotifyTrack[] }
export interface SpotifyPlayback { playing: boolean; device: { name: string; kind: string } | null; track: SpotifyTrack | null; progressMs: number; shuffle: boolean; /** The playlist the song plays from, when Spotify names one in the plain `spotify:playlist:<id>` form. */ playlistId?: string | null }
/** A saved playlist's songs read from its public web page; `listed` is how many entries the page held (rows are cut at 200). */
export interface SpotifyPublicPage { items: SpotifyTrack[]; listed: number }
export interface SpotifyPlayOptions { deviceId?: string; context?: { kind: 'playlist' | 'album'; id: string }; offsetId?: string; shuffle?: boolean }
export interface SpotifyStartStatus { starting: boolean; result: string | null }

export const spotify = {
  status: () => invoke<SpotifyStatus>('wall2_spotify_status'),
  signIn: () => invoke<void>('wall2_spotify_sign_in'),
  cancelSignIn: () => invoke<void>('wall2_spotify_cancel_sign_in'),
  signOut: () => invoke<void>('wall2_spotify_sign_out'),
  playlists: (page = 0) => invoke<SpotifyItem[]>('wall2_spotify_playlists', { page }),
  albums: (page = 0) => invoke<SpotifyItem[]>('wall2_spotify_albums', { page }),
  liked: (page = 0) => invoke<SpotifyItem[]>('wall2_spotify_liked', { page }),
  recent: () => invoke<SpotifyItem[]>('wall2_spotify_recent'),
  search: (query: string) => invoke<SpotifySearch>('wall2_spotify_search', { query }),
  tracks: (kind: 'playlist' | 'album', id: string, page = 0) => invoke<SpotifyTrackPage>('wall2_spotify_tracks', { kind, id, page }),
  /** The songs of a playlist the owner saved but did not make, from its public web page (Tools can turn this off; the caller then never asks). */
  publicPage: (id: string) => invoke<SpotifyPublicPage>('wall2_spotify_public_page', { id }),
  /** The songs of Spotify's recently played list that were played from this playlist, newest first. */
  heard: (id: string) => invoke<SpotifyTrack[]>('wall2_spotify_heard', { id }),
  queue: () => invoke<SpotifyQueue>('wall2_spotify_queue'),
  playback: () => invoke<SpotifyPlayback | null>('wall2_spotify_playback'),
  devices: () => invoke<SpotifyDevice[]>('wall2_spotify_devices'),
  play: (kind: SpotifyMode, id: string, options: SpotifyPlayOptions = {}) => invoke<'played' | 'starting'>('wall2_spotify_play', { request: { kind, id, ...options } }),
  startStatus: () => invoke<SpotifyStartStatus>('wall2_spotify_start_status'),
  cancelStart: () => invoke<void>('wall2_spotify_cancel_start'),
  transfer: (deviceId: string) => invoke<void>('wall2_spotify_transfer', { deviceId }),
  seek: (positionMs: number) => invoke<void>('wall2_spotify_seek', { positionMs }),
  // Transport on the player Spotify reports as active, wherever it plays (no device is named).
  pause: () => invoke<void>('wall2_spotify_pause'),
  resume: () => invoke<void>('wall2_spotify_resume'),
  next: () => invoke<void>('wall2_spotify_next'),
  previous: () => invoke<void>('wall2_spotify_previous'),
  /** Whether the song (a 22 character Spotify id) is in Liked Songs. */
  saved: (id: string) => invoke<boolean>('wall2_spotify_saved', { id }),
  /** Saves (`on`) or removes the song in Liked Songs. Rejects with `needs sign in` when the sign-in lacks the permission. */
  save: (id: string, on: boolean) => invoke<void>('wall2_spotify_save', { id, on }),
  shuffle: (on: boolean) => invoke<void>('wall2_spotify_shuffle', { on }),
};
