import { mocks } from '../tauri';
import type { SpotifyDevice, SpotifyItem, SpotifyMode, SpotifyTrack } from '../../music/spotify';
import { PUBLIC_PAGE_KEY, usePublicPage } from '../../unwind/spotify/model';

const id = (n: number) => n.toString().padStart(22, '0');
const deviceId = (n: number) => n.toString(16).padStart(40, '0');
export const cover = (seed: number) => {
  const colours = ['#7dd3c7', '#f2b8c6', '#f5cf77', '#92a8d1'];
  const a = colours[seed % colours.length];
  const b = colours[(seed + 2) % colours.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="#18222b"/><circle cx="${24 + seed % 30}" cy="32" r="24" fill="${a}"/><path d="M0 82 L${38 + seed % 24} 30 L96 78 V96 H0Z" fill="${b}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};
// `spotify=long`: the longest names the bridge passes (it trims names to 160 and subtitles to 80 characters) and a 240 song list.
// `spotifypage=` ok | first | odd | private | changed | toobig | busy | down | slow: what a saved playlist's public page gives (with `spotify=notyours`; none means private). `ok` lists 40 songs of 40;
// `first` lists the first 100 of 520; `big` lists 200 rows of 500; `odd` has a few songs that cannot be played; `slow` answers after 1.5 s. `spotifypageoff=1` starts with the Tools switch off.
// `spotifyload=heavy` gives the player a 20 song queue and the heard list 50 songs (with long titles under `spotify=long`).
// `spotifyctx=this` makes the player report the opened playlist as its context (and gives `wall2_spotify_heard` six songs); `spotifyctx=other` reports another playlist.
const query = (key: string) => new URLSearchParams(window.location.search).get(key);
const PAGE_TOTAL: Record<string, number> = { ok: 40, slow: 40, odd: 40, first: 520, big: 500 };
const pageTotal = () => PAGE_TOTAL[query('spotifypage') ?? ''] ?? null;
const isLong = () => new URLSearchParams(window.location.search).get('spotify') === 'long';
const LONG_ARTIST = 'The Quiet Geometry Orchestra and the Lantern Choir featuring Mira Vale';
const longName = (stem: string) => `${stem}, an extremely long name for late evenings when the lights are low and the rain keeps going`;
const item = (n: number, kind: SpotifyMode, name: string): SpotifyItem => ({ id: id(n), kind, name: isLong() ? longName(name) : name, imageUrl: cover(n), thumbUrl: cover(n), subtitle: isLong() ? (kind === 'playlist' ? 'Playlist, a very long owner name for testing' : LONG_ARTIST) : kind === 'playlist' ? 'Playlist' : kind === 'album' ? 'Aurora Set' : 'Mira Vale', count: kind === 'track' ? null : isLong() ? 240 : kind === 'playlist' ? pageTotal() ?? 58 : 12 });
const track = (n: number, playable = true): SpotifyTrack => ({ id: playable ? id(1000 + n) : null, name: isLong() ? longName(`Lantern Song ${n}`) : `Lantern Song ${n}`, artists: isLong() ? LONG_ARTIST : n % 2 ? 'Mira Vale' : 'Aurora Set', album: isLong() ? 'Quiet Geometry, the complete late night sessions in their extended form' : 'Quiet Geometry', durationMs: 180_000 + n * 1_000, imageUrl: cover(1000 + n), thumbUrl: cover(1000 + n), playable });

export function registerSpotifyMocks(): void {
  if (query('spotifypageoff') === '1') {
    try {
      window.localStorage.setItem(PUBLIC_PAGE_KEY, 'off');
    } catch {
      // Storage is blocked: the store below still starts off.
    }
    usePublicPage.setState({ on: false });
  }
  // The playlist page last opened, so `spotifyctx=this` can name it as the playing context.
  let openedPlaylist = id(1);
  const mode = () => new URLSearchParams(window.location.search).get('spotify') ?? 'typical';
  const playMode = () => new URLSearchParams(window.location.search).get('spotifyplay') ?? 'pc';
  let signedIn = mode() !== 'signedout';
  // The heart on the player row. `spotifyheart=` saved | readfail | savefail | nopermission | unknown | unknownlacks | episode; none: the song is not saved and saving works.
  // `nopermission` is a sign-in made before the permission to save existed: until a new sign-in the status says `canSave: 'no'` and a save is refused.
  // `unknown` is the status just after a restart (`canSave: 'unknown'`), saving works; `unknownlacks` is the same status with a sign-in that lacks the permission:
  // the first save is refused with `needs sign in`, after which the status says `no`. `spotifyheartid=1` keeps a track id on an `episode` (a review break).
  const heartMode = () => new URLSearchParams(window.location.search).get('spotifyheart') ?? 'unsaved';
  let canSave: 'yes' | 'no' | 'unknown' = heartMode() === 'nopermission' ? 'no' : heartMode() === 'unknown' || heartMode() === 'unknownlacks' ? 'unknown' : 'yes';
  let held = heartMode() !== 'nopermission' && heartMode() !== 'unknownlacks';
  const lacks = () => !held;
  const savedTracks = new Map<string, boolean>();
  const isSaved = (trackId: string) => savedTracks.get(trackId) ?? heartMode() === 'saved';
  let seekedMs: number | null = null;
  // Transport state, so the player row shows what a press did: paused, and how many songs were skipped.
  let paused = false;
  let shift = 0;
  // `spotify=picture` gives the content of the chosen pictures: ten covers, and a search of six songs, three albums and three playlists.
  const count = () => mode() === 'heavy' ? 50 : mode() === 'search10' || mode() === 'picture' ? 10 : mode() === 'empty' ? 0 : 8;
  const few = <T,>(items: T[], n: number) => (mode() === 'picture' ? items.slice(0, n) : items);
  const fail = () => { if (mode() === 'down') throw new Error('down'); };
  const list = (kind: SpotifyMode, stem: string) => Array.from({ length: count() }, (_, n) => item(n + 1, kind, `${stem} ${n + 1}`));
  const available = () => { fail(); if (mode() === 'off') throw new Error('not set up'); if (!signedIn) throw new Error('sign in again'); };
  mocks.set('wall2_spotify_status', () => ({ setup: mode() !== 'off', signedIn: mode() !== 'off' && signedIn && mode() !== 'statusfail', canSave: signedIn ? canSave : 'unknown', reason: mode() === 'off' ? 'not set up' : mode() === 'down' ? 'down' : mode() === 'statusfail' ? 'failed' : null }));
  mocks.set('wall2_spotify_sign_in', () => { signedIn = true; canSave = 'yes'; held = true; });
  mocks.set('wall2_spotify_cancel_sign_in', () => undefined);
  mocks.set('wall2_spotify_sign_out', () => { signedIn = false; });
  mocks.set('wall2_spotify_playlists', () => { available(); return list('playlist', 'Road Trip'); });
  mocks.set('wall2_spotify_albums', () => { available(); return list('album', 'Night Signals'); });
  mocks.set('wall2_spotify_liked', () => { available(); return list('track', 'Saved Track'); });
  mocks.set('wall2_spotify_recent', () => { available(); return list('track', 'Recently Played'); });
  mocks.set('wall2_spotify_search', () => { available(); return { tracks: few(list('track', 'Track'), 6).map((t, n) => ({ ...t, durationMs: 180_000 + n * 7_000 })), albums: few(list('album', 'Album'), 3), playlists: few(list('playlist', 'Playlist'), 3) }; });
  mocks.set('wall2_spotify_tracks', (args) => { available(); if (args?.kind === 'playlist') openedPlaylist = String(args?.id ?? openedPlaylist); if (mode() === 'notyours') throw new Error('not yours'); const kind = args?.kind; const page = Number(args?.page ?? 0); const total = mode() === 'heavy' ? 2000 : mode() === 'long' ? 240 : kind === 'album' ? 12 : 58; const start = page * 50; const items = Array.from({ length: Math.max(0, Math.min(50, total - start)) }, (_, n) => track(start + n + 1, !(kind === 'playlist' && start + n === 8))); return { items, total, more: start + items.length < total }; });
  mocks.set('wall2_spotify_queue', () => { available(); return mode() === 'empty' ? { current: null, next: [] } : { current: track(1), next: Array.from({ length: query('spotifyload') === 'heavy' ? 20 : 10 }, (_, n) => track(n + 2)) }; });
  // `spotifymatch=webapp`: Spotify plays the song a browser web app session also reports (the gallery's "web app" media mode), so the source is named Spotify.
  mocks.set('wall2_spotify_playback', () => { available(); if (playMode() === 'none' || mode() === 'empty') return null; if (query('spotifymatch') === 'webapp') return { playing: true, device: { name: 'Desk speakers', kind: 'Computer' }, track: { ...track(1), name: 'Harbor Radio', artists: 'Example Host' }, progressMs: 65_000, shuffle: false, playlistId: null }; const device = playMode() === 'speaker' ? { name: 'Living room', kind: 'Speaker' } : { name: 'Desk speakers', kind: 'Computer' }; return { playing: !paused, device, track: heartMode() === 'episode' && new URLSearchParams(window.location.search).get('spotifyheartid') !== '1' ? { ...track(1 + shift), id: null } : track(1 + shift), progressMs: seekedMs ?? 65_000, shuffle: false, playlistId: query('spotifyctx') === 'this' ? openedPlaylist : query('spotifyctx') === 'other' ? id(9999) : null }; });
  const knob = () => query('spotifypage') ?? 'private';
  const pageRows = (n: number, dim: number[] = []) => Array.from({ length: n }, (_, i) => track(i + 1, !dim.includes(i)));
  mocks.set('wall2_spotify_public_page', async () => {
    available();
    const k = knob();
    if (k === 'private') throw new Error('not public');
    if (k === 'changed') throw new Error('page changed');
    if (k === 'toobig') throw new Error('page too big');
    if (k === 'busy') throw new Error('busy');
    if (k === 'down') throw new Error('no connection');
    if (k === 'slow') await new Promise((resolve) => setTimeout(resolve, 1500));
    if (k === 'first') return { items: pageRows(100), listed: 100 };
    if (k === 'big') return { items: pageRows(200), listed: 500 };
    return { items: k === 'odd' ? pageRows(40, [2, 6, 11]) : pageRows(40), listed: 40 };
  });
  mocks.set('wall2_spotify_heard', () => { available(); return Array.from({ length: query('spotifyload') === 'heavy' ? 50 : 6 }, (_, n) => ({ ...track(n + 1), id: id(2000 + n + 1), name: `Heard Song ${n + 1}` })); });
  // Players that are awake: this PC (unless Spotify has to be started), a phone and a speaker. `spotifyplay=speaker` makes the speaker the active one; `spotify=nodevices` lists none.
  mocks.set('wall2_spotify_devices', () => {
    available();
    if (mode() === 'nodevices') return [] satisfies SpotifyDevice[];
    const onSpeaker = playMode() === 'speaker';
    const pc: SpotifyDevice = { id: deviceId(91), name: 'Desk speakers', kind: 'Computer', active: !onSpeaker && playMode() !== 'none', restricted: false, volume: 28 };
    const phone: SpotifyDevice = { id: deviceId(93), name: 'Phone', kind: 'Smartphone', active: false, restricted: false, volume: 60 };
    const speaker: SpotifyDevice = { id: deviceId(92), name: 'Kitchen speaker', kind: 'Speaker', active: onSpeaker, restricted: false, volume: 34 };
    return cold() ? [phone, speaker] : [pc, phone, speaker];
  });
  // `spotify=starting` is a slow cold start: the start line shows for about 8 s, then Spotify is ready. `spotify=notinstalled` is the same start that ends after
  // about 1 s with "not installed". A cancel ends either one with `cancelled`.
  const cold = () => mode() === 'starting' || mode() === 'notinstalled';
  let startedAt = 0;
  let cancelled = false;
  const COLD_MS = () => (mode() === 'starting' ? 8_000 : 1_000);
  mocks.set('wall2_spotify_play', () => { available(); if (mode() === 'nodevice') throw new Error('no device'); if (mode() === 'choose') throw new Error('choose'); if (mode() === 'alreadystarting') throw new Error('starting'); if (cold()) { startedAt = Date.now(); cancelled = false; return 'starting'; } return 'played'; });
  mocks.set('wall2_spotify_start_status', () => {
    if (!cold()) return { starting: false, result: 'played' };
    if (cancelled) return { starting: false, result: 'cancelled' };
    if (Date.now() - startedAt < COLD_MS()) return { starting: true, result: null };
    return { starting: false, result: mode() === 'notinstalled' ? 'not installed' : 'played' };
  });
  mocks.set('wall2_spotify_cancel_start', () => { cancelled = true; });
  mocks.set('wall2_spotify_transfer', () => { available(); });
  // A seek is remembered, so the next read of playback shows where the bar was left.
  mocks.set('wall2_spotify_seek', (args) => { available(); seekedMs = Number(args?.positionMs ?? 0); });
  mocks.set('wall2_spotify_pause', () => { available(); paused = true; });
  mocks.set('wall2_spotify_resume', () => { available(); paused = false; });
  mocks.set('wall2_spotify_next', () => { available(); shift += 1; seekedMs = 0; });
  mocks.set('wall2_spotify_previous', () => { available(); shift = Math.max(0, shift - 1); seekedMs = 0; });
  mocks.set('wall2_spotify_saved', (args) => { available(); if (heartMode() === 'readfail') throw new Error('down'); return isSaved(String(args?.id ?? '')); });
  mocks.set('wall2_spotify_save', (args) => { available(); if (lacks()) { canSave = 'no'; throw new Error('needs sign in'); } if (heartMode() === 'savefail') throw new Error('server-503'); savedTracks.set(String(args?.id ?? ''), args?.on === true); });
  mocks.set('wall2_spotify_shuffle', () => { available(); });
}
