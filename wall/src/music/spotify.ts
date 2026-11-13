import { invoke } from '../bridge/tauri';

export type SpotifyMode = 'playlist' | 'album' | 'track';
export interface SpotifyItem { id: string; name: string; kind: SpotifyMode; imageUrl?: string }
export interface SpotifyDevice { id: string; name: string; kind: string; active: boolean; volume?: number }
export interface SpotifyStatus { setup: boolean; signedIn: boolean; reason?: string }
export interface SpotifySearch { tracks: SpotifyItem[]; albums: SpotifyItem[]; playlists: SpotifyItem[] }

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
  devices: () => invoke<SpotifyDevice[]>('wall2_spotify_devices'),
  play: (kind: SpotifyMode, id: string, deviceId?: string) => invoke<void>('wall2_spotify_play', { request: { kind, id, deviceId } }),
  transfer: (deviceId: string) => invoke<void>('wall2_spotify_transfer', { deviceId }),
  shuffle: (on: boolean) => invoke<void>('wall2_spotify_shuffle', { on }),
};
