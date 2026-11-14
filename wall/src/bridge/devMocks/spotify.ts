import { mocks } from '../tauri';
import type { SpotifyDevice, SpotifyItem, SpotifyMode, SpotifyTrack } from '../../music/spotify';

const id = (n: number) => n.toString().padStart(22, '0');
const deviceId = (n: number) => n.toString(16).padStart(40, '0');
const cover = (seed: number) => {
  const colours = ['#7dd3c7', '#f2b8c6', '#f5cf77', '#92a8d1'];
  const a = colours[seed % colours.length];
  const b = colours[(seed + 2) % colours.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="#18222b"/><circle cx="${24 + seed % 30}" cy="32" r="24" fill="${a}"/><path d="M0 82 L${38 + seed % 24} 30 L96 78 V96 H0Z" fill="${b}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};
// `spotify=long`: the longest names the bridge passes (it trims names to 160 and subtitles to 80 characters) and a 240 song list.
const isLong = () => new URLSearchParams(window.location.search).get('spotify') === 'long';
const LONG_ARTIST = 'The Quiet Geometry Orchestra and the Lantern Choir featuring Mira Vale';
const longName = (stem: string) => `${stem}, an extremely long name for late evenings when the lights are low and the rain keeps going`;
const item = (n: number, kind: SpotifyMode, name: string): SpotifyItem => ({ id: id(n), kind, name: isLong() ? longName(name) : name, imageUrl: cover(n), thumbUrl: cover(n), subtitle: isLong() ? (kind === 'playlist' ? 'Playlist, a very long owner name for testing' : LONG_ARTIST) : kind === 'playlist' ? 'Playlist' : kind === 'album' ? 'Aurora Set' : 'Mira Vale', count: kind === 'track' ? null : isLong() ? 240 : kind === 'playlist' ? 58 : 12 });
const track = (n: number, playable = true): SpotifyTrack => ({ id: playable ? id(1000 + n) : null, name: isLong() ? longName(`Lantern Song ${n}`) : `Lantern Song ${n}`, artists: isLong() ? LONG_ARTIST : n % 2 ? 'Mira Vale' : 'Aurora Set', album: isLong() ? 'Quiet Geometry, the complete late night sessions in their extended form' : 'Quiet Geometry', durationMs: 180_000 + n * 1_000, imageUrl: cover(1000 + n), thumbUrl: cover(1000 + n), playable });

export function registerSpotifyMocks(): void {
  const mode = () => new URLSearchParams(window.location.search).get('spotify') ?? 'typical';
  const playMode = () => new URLSearchParams(window.location.search).get('spotifyplay') ?? 'pc';
  let signedIn = mode() !== 'signedout';
  const count = () => mode() === 'heavy' ? 50 : mode() === 'search10' ? 10 : mode() === 'empty' ? 0 : 8;
  const fail = () => { if (mode() === 'down') throw new Error('down'); };
  const list = (kind: SpotifyMode, stem: string) => Array.from({ length: count() }, (_, n) => item(n + 1, kind, `${stem} ${n + 1}`));
  const available = () => { fail(); if (mode() === 'off') throw new Error('not set up'); if (!signedIn) throw new Error('sign in again'); };
  mocks.set('wall2_spotify_status', () => ({ setup: mode() !== 'off', signedIn: mode() !== 'off' && signedIn && mode() !== 'statusfail', reason: mode() === 'off' ? 'not set up' : mode() === 'down' ? 'down' : mode() === 'statusfail' ? 'failed' : null }));
  mocks.set('wall2_spotify_sign_in', () => { signedIn = true; });
  mocks.set('wall2_spotify_cancel_sign_in', () => undefined);
  mocks.set('wall2_spotify_sign_out', () => { signedIn = false; });
  mocks.set('wall2_spotify_playlists', () => { available(); return list('playlist', 'Road Trip'); });
  mocks.set('wall2_spotify_albums', () => { available(); return list('album', 'Night Signals'); });
  mocks.set('wall2_spotify_liked', () => { available(); return list('track', 'Saved Track'); });
  mocks.set('wall2_spotify_recent', () => { available(); return list('track', 'Recently Played'); });
  mocks.set('wall2_spotify_search', () => { available(); return { tracks: list('track', 'Track'), albums: list('album', 'Album'), playlists: list('playlist', 'Playlist') }; });
  mocks.set('wall2_spotify_tracks', (args) => { available(); if (mode() === 'notyours') throw new Error('not yours'); const kind = args?.kind; const page = Number(args?.page ?? 0); const total = mode() === 'heavy' ? 2000 : mode() === 'long' ? 240 : kind === 'album' ? 12 : 58; const start = page * 50; const items = Array.from({ length: Math.max(0, Math.min(50, total - start)) }, (_, n) => track(start + n + 1, !(kind === 'playlist' && start + n === 8))); return { items, total, more: start + items.length < total }; });
  mocks.set('wall2_spotify_queue', () => { available(); return mode() === 'empty' ? { current: null, next: [] } : { current: track(1), next: Array.from({ length: 10 }, (_, n) => track(n + 2)) }; });
  mocks.set('wall2_spotify_playback', () => { available(); if (playMode() === 'none' || mode() === 'empty') return null; const device = playMode() === 'speaker' ? { name: 'Living room', kind: 'Speaker' } : { name: 'Desk speakers', kind: 'Computer' }; return { playing: true, device, track: track(1), progressMs: 65_000, shuffle: false }; });
  mocks.set('wall2_spotify_devices', () => { available(); return [{ id: deviceId(91), name: 'Desk speakers', kind: 'Computer', active: true, volume: 28 }, { id: deviceId(92), name: 'Kitchen speaker', kind: 'Speaker', active: false, volume: 34 }] satisfies SpotifyDevice[]; });
  mocks.set('wall2_spotify_play', () => { available(); if (mode() === 'nodevice') throw new Error('no device'); if (mode() === 'starting') return new Promise(() => undefined); });
  mocks.set('wall2_spotify_transfer', () => { available(); });
  mocks.set('wall2_spotify_shuffle', () => { available(); });
}
