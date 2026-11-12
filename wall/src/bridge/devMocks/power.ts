import { mocks } from '../tauri';

/** The idle read and the Screens off command, for `npm run dev` in a plain browser. */
export function registerPowerMocks(): void {
  mocks.set('wall2_idle_state', () => ({ idle: false, idleSecs: 12 }));
  mocks.set('wall2_display_state', () => ({ visible: true, reason: null }));
  mocks.set('wall2_monitors_mode', () => ({ active: false }));
  mocks.set('wall2_monitors_off', () => undefined);
}
