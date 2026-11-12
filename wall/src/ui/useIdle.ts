import { useEffect, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke, isTauri } from '../bridge/tauri';

interface IdlePayload {
  idle: boolean;
  idleSecs?: number;
}
interface DisplayPayload {
  visible: boolean;
}

/**
 * True when the strip has had no input for 4 minutes (the `idle-state` event from the
 * helper), or while the display is off or Windows is locked (`display-state`). Video
 * pauses or unloads while this is true and resumes when it turns false (rule R2).
 * Outside Tauri it is always false.
 */
export function useIdle(): boolean {
  const [inputIdle, setInputIdle] = useState(false);
  const [dark, setDark] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    let stopped = false;
    const unlisten: UnlistenFn[] = [];
    const keep = (u: UnlistenFn) => (stopped ? u() : unlisten.push(u));
    void listen<IdlePayload>('idle-state', (e) => setInputIdle(e.payload.idle)).then(keep);
    void listen<DisplayPayload>('display-state', (e) => setDark(!e.payload.visible)).then(keep);
    invoke<IdlePayload>('wall2_idle_state')
      .then((s) => !stopped && setInputIdle((was) => was || s.idle))
      .catch(() => {});
    return () => {
      stopped = true;
      unlisten.forEach((u) => u());
    };
  }, []);
  return inputIdle || dark;
}
