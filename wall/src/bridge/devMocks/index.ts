import { isTauri } from '../tauri';
import { registerAudioMocks } from './audio';
import { registerDeckMocks } from './deck';
import { registerGalleryMocks } from './gallery';
import { registerHomeMocks } from './home';
import { registerMeetMocks } from './meet';
import { registerMediaMocks } from './media';
import { registerOmniMocks } from './omni';
import { registerPowerMocks } from './power';
import { registerSonosMocks } from './sonos';
import { registerTaskMocks } from './tasks';

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
}
