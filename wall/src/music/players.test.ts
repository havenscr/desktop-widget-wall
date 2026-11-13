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
  expect(playingSession(SESSIONS, 'ExampleVendor.NightPlayer_abc123xyz!App')?.name).toBe('NightPlayer.exe');
  // No part matches: an unrelated app with a similar name is never taken.
  expect(playingSession([session('SpotifyHelper.exe')], 'Spotify.exe')).toBeNull();
  expect(playingSession(SESSIONS, 'AmazonMobileLLC.AmazonMusic_kc6t79cpj4tp0!App')).toBeNull();
  expect(playingSession(SESSIONS, 'App')).toBeNull();
  expect(playerProcesses('')).toEqual([]);
});
