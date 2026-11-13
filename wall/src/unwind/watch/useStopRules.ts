import { useEffect, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke, isTauri } from '../../bridge/tauri';
import { useSignalStore } from '../../signals/store';
import { usePlaceStore } from '../../state/places';
import { useDisplayDark } from '../../ui/useDisplayDark';
import { useVisible } from '../../ui/useVisible';
import { useWatchStore } from './store';
import { stopReason } from './stops';

/**
 * True while the wall's own Screens off mode is on: the same `monitors-off-mode` event and
 * `wall2_monitors_mode` read the Screens off button uses. Outside Tauri it is always false.
 */
export function useScreensOffMode(): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    let stopped = false;
    let eventSeen = false;
    let unlisten: UnlistenFn | null = null;
    void listen<{ active: boolean }>('monitors-off-mode', (e) => {
      eventSeen = true;
      setActive(e.payload.active === true);
    }).then((u) => {
      if (stopped) u();
      else unlisten = u;
    });
    invoke<{ active: boolean }>('wall2_monitors_mode')
      .then((s) => {
        if (!stopped && !eventSeen) setActive(s?.active === true);
      })
      .catch(() => {});
    return () => {
      stopped = true;
      unlisten?.();
    };
  }, []);
  return active;
}

/**
 * Removes the frame when any stop rule holds: the page hidden, the display off or Windows
 * locked (`useDisplayDark`; never input idle, since nobody touches the mouse while watching),
 * Screens off mode, or a call. Leaving the tab or Unwind is handled by the store. Mounted with
 * the Watch panel; it only ever stops, never starts.
 */
export function useStopRules(): void {
  const visible = useVisible();
  const displayDark = useDisplayDark();
  const screensOff = useScreensOffMode();
  const inCall = useSignalStore((s) => s.call !== null);
  const place = usePlaceStore((s) => s.active);
  const tab = useWatchStore((s) => s.tab);
  const playing = useWatchStore((s) => s.playing !== null);
  useEffect(() => {
    if (!playing) return;
    const why = stopReason({ place, tab, visible, displayDark, screensOff, inCall });
    if (why) useWatchStore.getState().stop(why);
  }, [playing, place, tab, visible, displayDark, screensOff, inCall]);
}
