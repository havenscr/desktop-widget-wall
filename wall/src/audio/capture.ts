import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke, isTauri } from '../bridge/tauri';
import type { AudioLevelsPayload } from './model';
import { ingestLevels, resetAudio, tickAudio } from './store';

export const RETRY_WAIT = 30_000;
export const WATCHDOG_MS = 5_000;
export const TICK_MS = 33;

const now = () => performance.now();

/** Fake gentle levels for browser dev; only used with `?audio=demo`. */
export function demoPayload(ms: number): AudioLevelsPayload {
  const t = ms / 1000;
  const beat = Math.exp(-((t * 1.75) % 1) * 5);
  return {
    bass: 0.25 + 0.35 * beat,
    mid: 0.2 + 0.1 * Math.sin(t * 0.9),
    high: 0.12 + 0.06 * Math.sin(t * 2.3),
    bands: [1],
    waveform: [0],
  };
}

export function wantsDemo(search: string): boolean {
  return new URLSearchParams(search).get('audio') === 'demo';
}

/**
 * Starts audio for the whole app and returns a stop function. Inside Tauri: default
 * loopback device, push on while the page is visible, off while hidden, a 5 second
 * watchdog that restarts capture once, and one retry after 30 seconds if the start fails.
 * In a browser: silent, or gentle fake levels with `?audio=demo`.
 */
export function startAudio(): () => void {
  let stopped = false;
  const timers = new Set<ReturnType<typeof setInterval>>();
  const every = (fn: () => void, ms: number) => {
    const id = setInterval(fn, ms);
    timers.add(id);
  };
  let retry: ReturnType<typeof setTimeout> | undefined;
  let unlisten: UnlistenFn | null = null;
  let lastEventAt = now();
  let started = false;
  let pushState: boolean | null = null;
  let restartedForSilence = false;

  const onVisibility = () => {
    if (!document.hidden) tickAudio(now());
    void syncPush();
  };
  document.addEventListener('visibilitychange', onVisibility);
  every(() => {
    if (!document.hidden) tickAudio(now());
  }, TICK_MS);

  if (!isTauri()) {
    if (wantsDemo(window.location.search)) {
      every(() => {
        if (!document.hidden) ingestLevels(demoPayload(now()), now());
      }, TICK_MS);
    }
    return () => stop();
  }

  async function syncPush(): Promise<void> {
    if (!started) return;
    const enabled = !document.hidden;
    if (pushState === enabled) return;
    pushState = enabled;
    try {
      await invoke('set_audio_push', { enabled });
    } catch {
      pushState = null;
    }
  }

  async function begin(): Promise<boolean> {
    try {
      const deviceId = await invoke<string | null>('get_default_loopback_device');
      if (!deviceId || stopped) return false;
      await invoke('start_audio_capture', { deviceId });
      if (stopped) return false;
      unlisten?.();
      unlisten = await listen<AudioLevelsPayload>('audio-levels', (e) => {
        lastEventAt = now();
        if (!document.hidden) ingestLevels(e.payload, now());
      });
      if (stopped) {
        unlisten();
        unlisten = null;
        return false;
      }
      started = true;
      lastEventAt = now();
      pushState = null;
      await syncPush();
      return true;
    } catch {
      return false;
    }
  }

  void begin().then((ok) => {
    if (!ok && !stopped) {
      resetAudio();
      retry = setTimeout(() => void begin(), RETRY_WAIT);
    }
  });

  every(() => {
    // While the push is off nothing arrives by design.
    if (!started || document.hidden || restartedForSilence) return;
    if (now() - lastEventAt > WATCHDOG_MS) {
      restartedForSilence = true;
      void begin();
    }
  }, WATCHDOG_MS);

  function stop() {
    if (stopped) return;
    stopped = true;
    document.removeEventListener('visibilitychange', onVisibility);
    timers.forEach((id) => clearInterval(id));
    timers.clear();
    clearTimeout(retry);
    unlisten?.();
    unlisten = null;
  }
  return stop;
}
