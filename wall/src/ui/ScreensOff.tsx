import { useEffect, useState } from 'react';
import { IconDeviceDesktopOff } from '@tabler/icons-react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke, isTauri } from '../bridge/tauri';

/**
 * "Screens off": 500 ms after the tap the monitors go off. While the helper watches for
 * a phantom mouse nudge it sends them off again; a key, click, touch or real movement
 * ends that watch (rule R3).
 */
export function ScreensOff({ className = '' }: { className?: string }) {
  const [watching, setWatching] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    let stopped = false;
    let unlisten: UnlistenFn | null = null;
    void listen<{ active: boolean }>('monitors-off-mode', (e) => setWatching(e.payload.active)).then((u) => {
      if (stopped) u();
      else unlisten = u;
    });
    return () => {
      stopped = true;
      unlisten?.();
    };
  }, []);
  return (
    <button
      type="button"
      className={`screens-off ${className}`.trim()}
      aria-pressed={watching}
      onClick={() => void invoke('wall2_monitors_off').catch(() => {})}
    >
      <IconDeviceDesktopOff size={26} aria-hidden="true" />
      <span>Screens off</span>
    </button>
  );
}
