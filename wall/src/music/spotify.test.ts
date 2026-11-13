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
});
