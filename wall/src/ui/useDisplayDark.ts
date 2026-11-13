import { useEffect, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke, isTauri } from '../bridge/tauri';

interface DisplayPayload {
  visible: boolean;
}

/**
 * True while the display is off or Windows is locked (the `display-state` half of `useIdle`),
 * never for input idle: a video being watched has no input, and that is normal. Read once at
 * start; a read that answers after a newer event is dropped. Outside Tauri it is always false.
 */
export function useDisplayDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    let stopped = false;
    let eventSeen = false;
    let unlisten: UnlistenFn | null = null;
    void listen<DisplayPayload>('display-state', (e) => {
      eventSeen = true;
      setDark(e.payload?.visible === false);
    }).then((u) => {
      if (stopped) u();
      else unlisten = u;
    });
    invoke<DisplayPayload>('wall2_display_state')
      .then((s) => {
        if (!stopped && !eventSeen) setDark(s?.visible === false);
      })
      .catch(() => {});
    return () => {
      stopped = true;
      unlisten?.();
    };
  }, []);
  return dark;
}
