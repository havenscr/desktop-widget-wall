import { mocks } from '../tauri';
import { knob } from './long';

/**
 * Dev only: the four light link commands, with the answers Rust gives (a paired flag, fixed words, no keys).
 *
 *   ?lightsync=unpaired (default)  Pair waits two polls, then pairs
 *   ?lightsync=paired              paired; Test answers `ok`
 *   ?lightsync=changed             paired on another bridge
 *   ?lightsync=down                status cannot be read
 *   ?lightsync=notpressed          Pair answers `link-not-pressed`
 *   ?lighttest=<word>              what Test answers (ok, dtls, stop-failed, panels-unavailable, busy, not-paired, no-area)
 */
export function registerLightSyncMocks(): void {
  const mode = knob('lightsync') ?? 'unpaired';
  let paired = mode === 'paired' || mode === 'changed';
  const status = () => ({ paired, bridgeChanged: mode === 'changed', running: false, starting: false, lastError: null, stoppedHueSync: false });
  mocks.set('wall2_lightsync_status', () => (mode === 'down' ? Promise.reject('failed') : status()));
  mocks.set('wall2_lightsync_pair', () =>
    new Promise<string>((done, fail) => {
      setTimeout(() => {
        if (mode === 'notpressed') return fail('link-not-pressed');
        paired = true;
        done('paired');
      }, 5000);
    }));
  mocks.set('wall2_lightsync_forget', () => {
    paired = false;
  });
  mocks.set('wall2_lightsync_test', () =>
    new Promise<string>((done, fail) => {
      const w = knob('lighttest') ?? 'ok';
      setTimeout(() => (w === 'ok' ? done('ok') : fail(w)), 3000);
    }));
}
