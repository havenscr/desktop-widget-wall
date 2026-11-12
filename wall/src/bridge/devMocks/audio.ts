import { mocks } from '../tauri';

/** The audio mixer sessions, so Unwind's volume slider shows for the playing app in the dev server. */
export function registerAudioMocks(): void {
  const sessions = [
    { id: '4120:Spotify.exe', name: 'Spotify.exe', volume: 70, muted: false },
    { id: '5310:chrome.exe', name: 'chrome.exe', volume: 100, muted: false },
  ];
  mocks.set('get_audio_sessions', () => ({ master: { volume: 60, muted: false }, sessions: sessions.map((s) => ({ ...s })) }));
  mocks.set('set_audio_session_volume', (args) => {
    const name = String(args?.sessionName ?? '').toLowerCase();
    const level = Math.max(0, Math.min(100, Math.round(Number(args?.level ?? 0))));
    for (const s of sessions) if (s.name.toLowerCase() === name) s.volume = level;
  });
}
