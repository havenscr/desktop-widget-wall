import { beforeEach, describe, expect, it } from 'vitest';
import { mocks } from '../bridge/tauri';
import { registerSpotifyMocks } from '../bridge/devMocks/spotify';
import { spotify } from './spotify';

describe('spotify bridge', () => {
  beforeEach(() => { mocks.clear(); window.history.replaceState({}, '', '/?spotify=typical'); registerSpotifyMocks(); });
  it('returns typed library and devices', async () => {
    expect((await spotify.playlists())[0]).toMatchObject({ kind: 'playlist', name: 'Road Trip 1' });
    expect((await spotify.devices())[0]).toMatchObject({ active: true, name: 'Desk speakers' });
  });
  it('signs out without drawing a component', async () => { await spotify.signOut(); expect((await spotify.status()).signedIn).toBe(false); });
  it('passes track and contextual play arguments by bridge name', async () => {
    let tracksArgs: unknown;
    let playArgs: unknown;
    mocks.set('wall2_spotify_tracks', (args) => { tracksArgs = args; return { items: [], total: 0, more: false }; });
    mocks.set('wall2_spotify_play', (args) => { playArgs = args; });
    await spotify.tracks('playlist', '0123456789012345678901', 3);
    await spotify.play('track', '1234567890123456789012', { context: { kind: 'playlist', id: '0123456789012345678901' }, offsetId: '1234567890123456789012' });
    expect(tracksArgs).toEqual({ kind: 'playlist', id: '0123456789012345678901', page: 3 });
    expect(playArgs).toEqual({ request: { kind: 'track', id: '1234567890123456789012', context: { kind: 'playlist', id: '0123456789012345678901' }, offsetId: '1234567890123456789012' } });
  });
  it('returns bounded track, queue and playback mocks', async () => {
    expect(await spotify.tracks('playlist', '0123456789012345678901')).toMatchObject({ total: 58, more: true });
    expect((await spotify.queue()).next).toHaveLength(10);
    expect(await spotify.playback()).toMatchObject({ playing: true, progressMs: 65_000, device: { name: 'Desk speakers' } });
  });
  it('passes null playback through unchanged', async () => {
    mocks.set('wall2_spotify_playback', () => null);
    expect(await spotify.playback()).toBeNull();
  });
  it.each([
    ['typical', true, true],
    ['heavy', true, true],
    ['empty', true, true],
    ['signedout', true, false],
    ['down', true, true],
    ['off', false, false],
  ] as const)('covers the %s mock mode', async (mode, setup, signedIn) => {
    mocks.clear(); window.history.replaceState({}, '', `/?spotify=${mode}`); registerSpotifyMocks();
    expect(await spotify.status()).toMatchObject({ setup, signedIn });
    if (mode === 'heavy') expect(await spotify.playlists()).toHaveLength(50);
    if (mode === 'empty') expect(await spotify.playlists()).toHaveLength(0);
    if (mode === 'down' || mode === 'off' || mode === 'signedout') await expect(spotify.playlists()).rejects.toThrow();
  });
});
