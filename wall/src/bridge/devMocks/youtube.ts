import { mocks } from '../tauri';

/**
 * `youtube=` picks what the YouTube row in Tools shows (a development knob only):
 * `off` (default, not set up), `out` (signed out), `waiting` (signed out, and Sign in never
 * finishes), `in` (signed in), `again` (the saved sign-in died), `broken` (signed in, Google
 * refused the client), `brokenout` (signed out, Google refused the client), `down` (the status
 * cannot be read), `refuse` (signed out, and Sign in is refused), `rejectsave` (not set up, and
 * Save is refused).
 */
export function registerYoutubeMocks(): void {
  const mode = () => new URLSearchParams(window.location.search).get('youtube') ?? 'off';
  let setup = !['off', 'rejectsave'].includes(mode());
  let signedIn = ['in', 'broken'].includes(mode());
  mocks.set('wall2_youtube_status', () => {
    if (mode() === 'down') throw new Error('failed');
    const reason = !setup ? 'not set up' : mode() === 'again' && !signedIn ? 'sign in again' : mode().startsWith('broken') ? 'setup broken' : null;
    return { setup, signedIn, reason, searchesLeft: null };
  });
  mocks.set('wall2_youtube_set_client', () => {
    if (mode() === 'rejectsave') throw new Error('invalid');
    setup = true;
  });
  mocks.set('wall2_youtube_forget_client', () => { setup = false; });
  mocks.set('wall2_youtube_sign_in', () => {
    if (mode() === 'waiting') return new Promise<void>(() => undefined);
    if (mode() === 'refuse') throw new Error('denied');
    signedIn = true;
  });
  mocks.set('wall2_youtube_cancel_sign_in', () => undefined);
  mocks.set('wall2_youtube_sign_out', () => { signedIn = false; });
}
