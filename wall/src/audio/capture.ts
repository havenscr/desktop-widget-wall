import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke, isTauri } from '../bridge/tauri';
import type { AudioLevelsPayload } from './model';
import { ingestLevels, resetAudio, tickAudio } from './store';
import { createSourceClock } from './sourceTime';

export const RETRY_WAIT = 30_000;
export const WATCHDOG_MS = 5_000;
export const TICK_MS = 33;

const now = () => performance.now();

/** Kicks per second in the demo levels (105 BPM). */
export const DEMO_KICK_HZ = 1.75;

/**
 * Fake gentle levels for browser dev; only used with `?audio=demo`. The 32 bands are bytes
 * (0 to 255) as Rust sends them, shaped like the concept demo's made-up spectrum so the Unwind
 * echo looks as it does there: a low bed, a kick in the low bands (0 to 11) at `DEMO_KICK_HZ`
 * so the beat detector and the grid pulse have something to find, three slow melody bumps that
 * wander across the middle bands (12 and up), and a hat high up on the off-beat (once per kick, never
 * faster).
 */
export function demoPayload(ms: number): AudioLevelsPayload {
  const t = ms / 1000;
  const beat = Math.exp(-((t * DEMO_KICK_HZ) % 1) * 5);
  // The kick in the bands holds a little longer than the bass level, as a real kick's body does.
  const body = Math.exp(-((t * DEMO_KICK_HZ) % 1) * 3.5);
  const hat = Math.exp(-((t * DEMO_KICK_HZ + 0.5) % 1) * 8);
  const bands: number[] = [];
  for (let i = 0; i < 32; i++) {
    let v = 96 - i * 1.2 + 5 * Math.sin(t * (0.7 + i * 0.13) + i);
    if (i < 12) v += 112 * body * (1 - i / 16);
    // The melody keeps out of the kick's bands, so the beat detector hears only the kick there.
    for (let j = 0; i >= 12 && j < 3; j++) {
      const centre = 31 * (0.55 + 0.17 * Math.sin(t * 0.42 * (j + 1) + j * 2.1));
      v += 80 * (0.5 + 0.34 * Math.sin(t * 0.9 + j * 1.7)) * Math.exp(-((i - centre) ** 2) / 4.5);
    }
    v += 60 * hat * Math.exp(-((i - 26) ** 2) / 6);
    bands.push(Math.round(Math.min(255, Math.max(0, v))));
  }
  return {
    bass: 0.25 + 0.35 * beat,
    mid: 0.2 + 0.1 * Math.sin(t * 0.9),
    high: 0.12 + 0.06 * Math.sin(t * 2.3),
    bands,
    waveform: [0],
  };
}

/** True for `?audio=demo` in a development build only; a production bundle ignores the query. */
export function wantsDemo(search: string): boolean {
  return import.meta.env.DEV && new URLSearchParams(search).get('audio') === 'demo';
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
    if (!document.hidden) {
      // The push was off while hidden; give the watchdog a fresh 5 seconds before it judges silence.
      lastEventAt = now();
      tickAudio(now());
    }
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
      // A fresh source clock per capture start: frames that arrive in a burst get their own times.
      const clock = createSourceClock();
      unlisten = await listen<AudioLevelsPayload>('audio-levels', (e) => {
        const at = now();
        lastEventAt = at;
        if (document.hidden) return;
        const source = clock.stamp(at);
        if (source !== null) ingestLevels(e.payload, at, source);
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
