import { expect, it } from 'vitest';
import { playingSession, type AudioSession } from '../unwind/model';
import { cleanAppName, playerName, playerProcesses, sourceKey } from './players';

// The id forms the Rust side sends in `source_app_id`: a packaged app's AppUserModelId
// (`Publisher.Name_hash!Entry`), a desktop app's own id, or a process name.
const IDS: [string, string][] = [
  ['SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify', 'Spotify'],
  ['Spotify.exe', 'Spotify'],
  ['MSEdge', 'Edge'],
  ['Microsoft.MicrosoftEdge.Stable_8wekyb3d8bbwe!App', 'Edge'],
  ['Chrome', 'Chrome'],
  ['308046B0AF4A39CB', 'Firefox'],
  ['firefox.exe', 'Firefox'],
  ['AppleInc.AppleMusicWin_nzyj5cx40ttypa!App', 'Apple Music'],
  ['Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic', 'Media Player'],
  ['AmazonMobileLLC.AmazonMusic_kc6t79cpj4tp0!App', 'Amazon Music'],
  ['com.github.th-ch.youtube-music', 'YouTube Music'],
  [String.raw`C:\Program Files\VideoLAN\VLC\vlc.exe`, 'VLC'],
];

it('names the player from the id the media session gives', () => {
  for (const [id, name] of IDS) expect(playerName(id), id).toBe(name);
});

it('names an unknown player by its cleaned app name, never the word "App"', () => {
  expect(playerName('ExampleVendor.NightPlayer_abc123xyz!App')).toBe('Night Player');
  expect(playerName('ExampleVendor.NightPlayer_abc123xyz!Radio')).toBe('Radio');
  expect(playerName(String.raw`D:\Tools\tunebox.exe`)).toBe('tunebox');
  expect(cleanAppName('App')).toBe('Media player');
  expect(cleanAppName('x_y!App')).toBe('x');
  for (const id of ['App', 'app.exe', 'Vendor.App_hash!App', '!App']) expect(playerName(id)).not.toMatch(/^app$/i);
  expect(playerName(null)).toBeNull();
  expect(playerName('  ')).toBeNull();
});

it('prefers the session id over the older label', () => {
  expect(sourceKey({ source_app_id: 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify', source_app: 'App' })).toBe('SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify');
  expect(sourceKey({ source_app: 'Spotify' })).toBe('Spotify');
  expect(sourceKey({ source_app_id: '', source_app: '' })).toBeNull();
  expect(sourceKey(null)).toBeNull();
});

const session = (name: string): AudioSession => ({ id: name, name, volume: 40, muted: false });
const SESSIONS = ['Spotify.exe', 'msedge.exe', 'chrome.exe', 'firefox.exe', 'AppleMusic.exe', 'Microsoft.Media.Player.exe', 'NightPlayer.exe', 'SpotifyHelper.exe'].map(session);

it('finds the audio session from the id through the alias table, by exact process name only', () => {
  expect(playingSession(SESSIONS, 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify')?.name).toBe('Spotify.exe');
  expect(playingSession(SESSIONS, 'Spotify.exe')?.name).toBe('Spotify.exe');
  expect(playingSession(SESSIONS, 'MSEdge')?.name).toBe('msedge.exe');
  expect(playingSession(SESSIONS, 'Microsoft.MicrosoftEdge.Stable_8wekyb3d8bbwe!App')?.name).toBe('msedge.exe');
  expect(playingSession(SESSIONS, '308046B0AF4A39CB')?.name).toBe('firefox.exe');
  expect(playingSession(SESSIONS, 'AppleInc.AppleMusicWin_nzyj5cx40ttypa!App')?.name).toBe('AppleMusic.exe');
  expect(playingSession(SESSIONS, 'Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic')?.name).toBe('Microsoft.Media.Player.exe');
  // An unknown packaged app has no file name to match, so no session (never a guessed one).
  expect(playingSession(SESSIONS, 'ExampleVendor.NightPlayer_abc123xyz!App')).toBeNull();
  // No part matches: an unrelated app with a similar name is never taken.
  expect(playingSession([session('SpotifyHelper.exe')], 'Spotify.exe')).toBeNull();
  expect(playingSession(SESSIONS, 'AmazonMobileLLC.AmazonMusic_kc6t79cpj4tp0!App')).toBeNull();
  expect(playingSession(SESSIONS, 'App')).toBeNull();
  expect(playerProcesses('')).toEqual([]);
});

it('matches whole tokens only: a look-alike app is never named or controlled as a known player', () => {
  expect(playerName('NotSpotify.exe')).toBe('Not Spotify');
  expect(playerName('ChromeHelper.exe')).toBe('Chrome Helper');
  expect(playerName('SpotifyFan.Thing_abc123!App')).toBe('Thing');
  expect(playerName('Spotifyish')).toBe('Spotifyish');
  const spotify = [session('Spotify.exe'), session('chrome.exe')];
  expect(playingSession(spotify, 'NotSpotify.exe')).toBeNull();
  expect(playingSession(spotify, 'ChromeHelper.exe')).toBeNull();
  expect(playingSession(spotify, 'SpotifyFan.Thing_abc123!App')).toBeNull();
  // The older labels still name and match their player.
  expect(playerName('Groove Music')).toBe('Groove Music');
  expect(playingSession([session('AppleMusic.exe')], 'Apple Music')?.name).toBe('AppleMusic.exe');
});

it('gives an unknown dotted process id its cleaned name and the session with exactly that process name', () => {
  expect(playerName('Foo.Bar.Baz.exe')).toBe('Foo.Bar.Baz');
  expect(playingSession([session('Baz.exe'), session('Foo.Bar.Baz.exe')], 'Foo.Bar.Baz.exe')?.name).toBe('Foo.Bar.Baz.exe');
  expect(playingSession([session('Baz.exe')], 'Foo.Bar.Baz.exe')).toBeNull();
});

it('never takes a look-alike id for a known player: exact package families and exact process names only', () => {
  const real = [session('Spotify.exe'), session('chrome.exe'), session('Spot.ify.exe'), session('Spot-ify.exe')];
  const LOOKALIKES: [string, string][] = [
    ['Evil.Spotify_x!App', 'Evil.Spotify'],
    ['Vendor.Foo_x!Spotify', 'Vendor.Foo'],
    ['Spot.ify.exe', 'Spot.ify.exe'],
    ['Spot.ify.exe', 'Spot.ify.exe'],
    ['Evil.Chrome_x!App', 'Evil.Chrome'],
  ];
  for (const [id, name] of LOOKALIKES) {
    expect(playerName(id), id).toBe(name);
    expect(playerProcesses(id), id).not.toContain('spotify');
    expect(playerProcesses(id), id).not.toContain('chrome');
    const s = playingSession(real, id);
    expect(s?.name === 'Spotify.exe' || s?.name === 'chrome.exe', id).toBe(false);
  }
  // A process id gets only the session with exactly its own file name.
  expect(playingSession(real, 'Spot.ify.exe')?.name).toBe('Spot.ify.exe');
  expect(playingSession(real, 'Spot-ify.exe')?.name).toBe('Spot-ify.exe');
  expect(playingSession(real, 'Evil.Spotify_x!App')).toBeNull();
  expect(playingSession(real, 'Vendor.Foo_x!Spotify')).toBeNull();
});

it('keeps the real forms: desktop and store Spotify, Edge, Chrome, Firefox', () => {
  const real = [session('Spotify.exe'), session('msedge.exe'), session('chrome.exe'), session('firefox.exe')];
  const FORMS: [string, string, string][] = [
    ['Spotify.exe', 'Spotify', 'Spotify.exe'],
    ['SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify', 'Spotify', 'Spotify.exe'],
    ['MSEdge', 'Edge', 'msedge.exe'],
    ['Microsoft.MicrosoftEdge.Stable_8wekyb3d8bbwe!App', 'Edge', 'msedge.exe'],
    ['Chrome', 'Chrome', 'chrome.exe'],
    ['chrome.exe', 'Chrome', 'chrome.exe'],
    ['308046B0AF4A39CB', 'Firefox', 'firefox.exe'],
    [String.raw`C:\Program Files\Mozilla Firefox\firefox.exe`, 'Firefox', 'firefox.exe'],
  ];
  for (const [id, name, proc] of FORMS) {
    expect(playerName(id), id).toBe(name);
    expect(playingSession(real, id)?.name, id).toBe(proc);
  }
});

it('takes Music.UI.exe as Groove Music on purpose, and the ZuneMusic package as Media Player', () => {
  expect(playerName('Music.UI.exe')).toBe('Groove Music');
  expect(playerName('Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic')).toBe('Media Player');
  // No punctuation is stripped: "MusicUI.exe" is its own app.
  expect(playerName('MusicUI.exe')).toBe('Music UI');
  expect(playingSession([session('Music.UI.exe')], 'MusicUI.exe')).toBeNull();
});
