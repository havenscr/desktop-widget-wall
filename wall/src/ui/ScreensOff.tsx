import { useEffect, useRef, useState } from 'react';
import { IconDeviceDesktopOff } from '@tabler/icons-react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke, isTauri } from '../bridge/tauri';

interface ModePayload {
  active: boolean;
  reason?: string;
}

/** How long the pending look lasts at most (the helper waits 500 ms, then reports). */
export const PENDING_MS = 1500;
/** How long the failure line stays. */
export const FAILURE_MS = 5000;

/**
 * "Screens off", an icon-only toggle (the words are its tooltip and accessible name; it
 * reads "Turning off" while pending and "Cancel screens off" while active), in the lower
 * right corner of Unwind: 500 ms after the tap the monitors go off and the helper watches
 * for a phantom mouse nudge, sending them off again; a second tap cancels and leaves the
 * screens as they are. A key, click, touch or real movement also ends the watch (rule R3).
 * If the helper cannot watch input it does not turn the screens off and says so briefly.
 */
export function ScreensOff({ className = '' }: { className?: string }) {
  const [active, setActive] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const pendingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const failTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!isTauri()) return;
    let stopped = false;
    let eventSeen = false;
    let unlisten: UnlistenFn | null = null;
    void listen<ModePayload>('monitors-off-mode', (e) => {
      eventSeen = true;
      clearTimeout(pendingTimer.current);
      setPending(false);
      setActive(e.payload.active);
      if (!e.payload.active && e.payload.reason === 'input-unavailable') {
        setFailed(true);
        clearTimeout(failTimer.current);
        failTimer.current = setTimeout(() => setFailed(false), FAILURE_MS);
      }
    }).then((u) => {
      if (stopped) u();
      else unlisten = u;
    });
    invoke<{ active: boolean }>('wall2_monitors_mode')
      .then((s) => {
        if (!stopped && !eventSeen) setActive(s.active);
      })
      .catch(() => {});
    return () => {
      stopped = true;
      unlisten?.();
      clearTimeout(pendingTimer.current);
      clearTimeout(failTimer.current);
    };
  }, []);

  const tap = () => {
    if (!active) {
      setFailed(false);
      setPending(true);
      clearTimeout(pendingTimer.current);
      pendingTimer.current = setTimeout(() => setPending(false), PENDING_MS);
    }
    void invoke('wall2_monitors_off').catch(() => setPending(false));
  };

  // Icon only: the words are its tooltip and its accessible name.
  const label = pending ? 'Turning off' : active ? 'Cancel screens off' : 'Screens off';
  return (
    <div className="screens-off-wrap">
      <button
        type="button"
        className={`screens-off ${className}`.trim()}
        aria-pressed={active}
        aria-label={label}
        title={label}
        data-pending={pending ? 'true' : undefined}
        onClick={tap}
      >
        <IconDeviceDesktopOff size={22} aria-hidden="true" />
      </button>
      {failed ? (
        <div className="screens-off-note" role="status">
          Could not watch input
        </div>
      ) : null}
    </div>
  );
}
