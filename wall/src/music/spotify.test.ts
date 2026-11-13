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
