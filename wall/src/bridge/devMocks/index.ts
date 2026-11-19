import { isTauri, mocks } from '../tauri';
import { registerAudioMocks } from './audio';
import { registerDaysMocks } from './days';
import { registerDeckMocks } from './deck';
import { registerGalleryMocks } from './gallery';
import { registerHomeMocks } from './home';
import { registerLinesMocks } from './lines';
import { registerMeetMocks } from './meet';
import { registerMeetBriefMocks } from './meetBrief';
import { registerMediaMocks } from './media';
import { registerOmniMocks } from './omni';
import { registerOnAirMocks } from './onair';
import { registerPowerMocks } from './power';
import { registerSonosMocks } from './sonos';
import { registerSignalMocks } from './signals';
import { registerSpotifyMocks } from './spotify';
import { registerStudioMocks } from './studio';
import { registerStudioKeysMocks } from './studioKeys';
import { registerTaskMocks } from './tasks';
import { registerToolsMocks } from './tools';
import { registerWatchMocks } from './watch';
import { registerWeatherMocks } from './weather';
import { registerYoutubeMocks } from './youtube';
import { registerYtLiveMocks } from './ytlive';

/**
 * Realistic answers for the commands the Work and Home tabs call, so `npm run dev` in a
 * plain browser shows content. Registered only in the dev server, never in a
 * production build, never inside Tauri. One file per feed in this folder.
 */
export function registerDevMocks(): void {
  if (isTauri()) return;
  registerMediaMocks();
  registerWeatherMocks();
  registerTaskMocks();
  registerHomeMocks();
  registerSonosMocks();
  registerMeetMocks();
  registerMeetBriefMocks();
  registerOmniMocks();
  registerPowerMocks();
  registerDeckMocks();
  registerAudioMocks();
  registerGalleryMocks();
  registerSignalMocks();
  registerSpotifyMocks();
  registerYoutubeMocks();
  registerWatchMocks();
  registerLinesMocks();
  registerDaysMocks();
  registerOnAirMocks();
  registerYtLiveMocks();
  registerStudioMocks();
  registerStudioKeysMocks();
  mocks.set('wall2_build_info', () => ({ commit: 'dev', builtAt: '2026-11-13T09:05Z' }));
  registerToolsMocks();
}
