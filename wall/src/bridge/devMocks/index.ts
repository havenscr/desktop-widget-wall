import { isTauri } from '../tauri';
import { registerHomeMocks } from './home';
import { registerMeetMocks } from './meet';
import { registerMediaMocks } from './media';
import { registerOmniMocks } from './omni';
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
  registerMeetMocks();
  registerOmniMocks();
}
