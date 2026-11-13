import { isTauri, mocks } from '../tauri';
import { registerAudioMocks } from './audio';
import { registerDaysMocks } from './days';
import { registerDeckMocks } from './deck';
import { registerGalleryMocks } from './gallery';
import { registerHomeMocks } from './home';
import { registerMeetMocks } from './meet';
import { registerMediaMocks } from './media';
import { registerOmniMocks } from './omni';
import { registerPowerMocks } from './power';
import { registerSonosMocks } from './sonos';
import { registerSignalMocks } from './signals';
import { registerSpotifyMocks } from './spotify';
import { registerTaskMocks } from './tasks';
import { registerWatchMocks } from './watch';

/**
 * Realistic answers for the commands the Work and Home tabs call, so `npm run dev` in a
 * plain browser shows content. Registered only in the dev server, never in a
 * production build, never inside Tauri. One file per feed in this folder.
 */
export function registerDevMocks(): void {
  if (isTauri()) return;
  registerMediaMocks();
  registerTaskMocks();
  registerHomeMocks();
  registerSonosMocks();
  registerMeetMocks();
  registerOmniMocks();
  registerPowerMocks();
  registerDeckMocks();
  registerAudioMocks();
  registerGalleryMocks();
  registerSignalMocks();
  registerSpotifyMocks();
  registerWatchMocks();
  registerDaysMocks();
  mocks.set('wall2_build_info', () => ({ commit: 'dev', builtAt: '2026-11-13T09:05Z' }));
}
