import { invoke } from '../bridge/tauri';

export type SpotifyMode = 'playlist' | 'album' | 'track';
export interface SpotifyItem { id: string; name: string; kind: SpotifyMode; imageUrl: string | null; thumbUrl: string | null; subtitle: string | null; count: number | null }
export interface SpotifyDevice { id: string; name: string; kind: string; active: boolean; volume: number | null }
export interface SpotifyStatus { setup: boolean; signedIn: boolean; reason: string | null }
export interface SpotifySearch { tracks: SpotifyItem[]; albums: SpotifyItem[]; playlists: SpotifyItem[] }
export interface SpotifyTrack { id: string | null; name: string; artists: string; album: string; durationMs: number; imageUrl: string | null; thumbUrl: string | null; playable: boolean }
export interface SpotifyTrackPage { items: SpotifyTrack[]; total: number; more: boolean }
export interface SpotifyQueue { current: SpotifyTrack | null; next: SpotifyTrack[] }
export interface SpotifyPlayback { playing: boolean; device: { name: string; kind: string } | null; track: SpotifyTrack | null; progressMs: number; shuffle: boolean }
export interface SpotifyPlayOptions { deviceId?: string; context?: { kind: 'playlist' | 'album'; id: string }; offsetId?: string }

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
  queue: () => invoke<SpotifyQueue>('wall2_spotify_queue'),
  playback: () => invoke<SpotifyPlayback | null>('wall2_spotify_playback'),
  devices: () => invoke<SpotifyDevice[]>('wall2_spotify_devices'),
  play: (kind: SpotifyMode, id: string, options: SpotifyPlayOptions = {}) => invoke<void>('wall2_spotify_play', { request: { kind, id, ...options } }),
  transfer: (deviceId: string) => invoke<void>('wall2_spotify_transfer', { deviceId }),
  shuffle: (on: boolean) => invoke<void>('wall2_spotify_shuffle', { on }),
};
