import { mocks } from '../tauri';
import { knob } from './long';

/**
 * Dev only: the `wall2_lightsync_*` commands, with the answers Rust gives (a paired flag, fixed words, no keys).
 *
 * Pairing (the Tools row):
 *   ?lightsync=unpaired (default)  Pair waits two polls, then pairs
 *   ?lightsync=paired              paired; Test answers `ok`
 *   ?lightsync=changed             paired on another bridge
 *   ?lightsync=down                status cannot be read
 *   ?lightsync=notpressed          Pair answers `link-not-pressed`
 *   ?lighttest=<word>              what Test answers (ok, dtls, stop-failed, panels-unavailable, busy, not-paired, no-area)
 *
 * Sync (the Music sync chip); any of these also counts as paired unless it says otherwise:
 *   ?lsync=on          sync is already running
 *   ?lsync=hue         the start says it stopped Hue Sync
 *   ?lsync=unpaired    start answers "not-paired"
 *   ?lsync=fail        start answers a failure word
 *   ?lsync=slow        start never answers (the spinner)
 */
export function registerLightSyncMocks(): void {
  const lsync = knob('lsync');
  const mode = knob('lightsync') ?? (lsync && lsync !== 'unpaired' ? 'paired' : 'unpaired');
  let paired = mode === 'paired' || mode === 'changed';
  let running = lsync === 'on';
  let starting = false;
  let hue = false;
  const status = () => ({ paired, bridgeChanged: mode === 'changed', running, starting, lastError: null, stoppedHueSync: running && hue });
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
  mocks.set('wall2_lightsync_start', async () => {
    if (!paired || lsync === 'unpaired') throw 'not-paired';
    if (lsync === 'fail') throw 'bridge-unreachable';
    if (lsync === 'slow') {
      starting = true;
      await new Promise<never>(() => undefined);
    }
    running = true;
    hue = lsync === 'hue';
    return 'started';
  });
  mocks.set('wall2_lightsync_tune', () => undefined);
  const stop = () => {
    running = false;
    starting = false;
    hue = false;
  };
  mocks.set('wall2_lightsync_stop', stop);
  mocks.set('wall2_lightsync_stop_all', stop);
}
