import { mocks } from '../tauri';
import type { SpotifyDevice, SpotifyItem, SpotifyMode } from '../../music/spotify';

const id = (n: number) => n.toString().padStart(22, '0');
const item = (n: number, kind: SpotifyMode, name: string): SpotifyItem => ({ id: id(n), kind, name });

export function registerSpotifyMocks(): void {
  const mode = () => new URLSearchParams(window.location.search).get('spotify') ?? 'typical';
  let signedIn = mode() !== 'signedout';
  const count = () => mode() === 'heavy' ? 50 : mode() === 'empty' ? 0 : 8;
  const fail = () => { if (mode() === 'down') throw new Error('down'); };
  const list = (kind: SpotifyMode, stem: string) => Array.from({ length: count() }, (_, n) => item(n + 1, kind, `${stem} ${n + 1}`));
  const available = () => { fail(); if (mode() === 'off') throw new Error('not set up'); if (!signedIn) throw new Error('sign in again'); };
  mocks.set('wall2_spotify_status', () => ({ setup: mode() !== 'off', signedIn: mode() !== 'off' && signedIn, reason: mode() === 'off' ? 'not set up' : mode() === 'down' ? 'down' : undefined }));
  mocks.set('wall2_spotify_sign_in', () => { signedIn = true; });
  mocks.set('wall2_spotify_sign_out', () => { signedIn = false; });
  mocks.set('wall2_spotify_playlists', () => { available(); return list('playlist', 'Road Trip'); });
  mocks.set('wall2_spotify_albums', () => { available(); return list('album', 'Night Signals'); });
  mocks.set('wall2_spotify_liked', () => { available(); return list('track', 'Saved Track'); });
  mocks.set('wall2_spotify_recent', () => { available(); return list('track', 'Recently Played'); });
  mocks.set('wall2_spotify_search', () => { available(); return { tracks: list('track', 'Track'), albums: list('album', 'Album'), playlists: list('playlist', 'Playlist') }; });
  mocks.set('wall2_spotify_devices', () => { available(); return [{ id: id(91), name: 'Desk speakers', kind: 'Computer', active: true, volume: 28 }, { id: id(92), name: 'Kitchen speaker', kind: 'Speaker', active: false, volume: 34 }] satisfies SpotifyDevice[]; });
  mocks.set('wall2_spotify_play', () => { available(); });
  mocks.set('wall2_spotify_transfer', () => { available(); });
  mocks.set('wall2_spotify_shuffle', () => { available(); });
}
