import type { LightPalette, LightSyncStatus } from '../studio/lightsync/model';
import { invoke } from './tauri';

/** Typed wrappers for the light sync commands (`wall2_lightsync/mod.rs`). Native errors are fixed words. */
const palette = (p: LightPalette) => ({ colors: p.colors, kick: p.kick, rest: p.rest });

export const lightSyncStatus = () => invoke<LightSyncStatus>('wall2_lightsync_status');
export const lightSyncStart = (p: LightPalette, settings: Record<string, unknown>) => invoke<string>('wall2_lightsync_start', { palette: palette(p), settings });
export const lightSyncTune = (p: LightPalette, settings: Record<string, unknown>) => invoke<void>('wall2_lightsync_tune', { palette: palette(p), settings });
export const lightSyncStop = (restorePanels = true) => invoke<void>('wall2_lightsync_stop', { restorePanels });
export const lightSyncStopAll = () => invoke<void>('wall2_lightsync_stop_all');
