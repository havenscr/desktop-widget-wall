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
 * "Hide screen", a toggle in the lower right corner of Unwind: at rest the icon alone; under
 * the pointer (or keyboard focus) it grows to the left and shows its name, which stands in for
 * a tooltip. It reads "Hiding" while pending and "Cancel hide" while active. 500 ms after
 * the tap the monitors go off and the helper watches for a phantom mouse nudge, sending them off again; a second tap cancels and leaves the
 * screens as they are. A key, click, touch or real movement also ends the watch (rule R3).
 * If the helper cannot watch input it does not turn the screens off and says so briefly.
 */
export function ScreensOff({ className = '' }: { className?: string }) {
  const [active, setActive] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const pendingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const failTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** What the helper reports (the `monitors-off-mode` event). */
  const onMode = useRef((p: ModePayload) => {
    clearTimeout(pendingTimer.current);
    setPending(false);
    setActive(p.active);
    if (!p.active && p.reason === 'input-unavailable') {
      setFailed(true);
      clearTimeout(failTimer.current);
      failTimer.current = setTimeout(() => setFailed(false), FAILURE_MS);
    }
  });

  useEffect(() => {
    if (!isTauri()) return;
    let stopped = false;
    let eventSeen = false;
    let unlisten: UnlistenFn | null = null;
    void listen<ModePayload>('monitors-off-mode', (e) => {
      eventSeen = true;
      onMode.current(e.payload);
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

  const tap = (e: { detail: number }) => {
    // The second click of a double click sends nothing: one double click turns them off once.
    if (e.detail > 1) return;
    if (!active) {
      setFailed(false);
      setPending(true);
      clearTimeout(pendingTimer.current);
      pendingTimer.current = setTimeout(() => setPending(false), PENDING_MS);
    }
    void invoke<ModePayload | undefined>('wall2_monitors_off').then(
      (r) => {
        // Outside Tauri (dev mocks and the gallery) there is no event: a mock may answer with the report instead.
        if (!isTauri() && r && typeof r === 'object' && typeof r.active === 'boolean') onMode.current(r);
      },
      () => setPending(false),
    );
  };

  // The words show only while the button is grown (hover or focus); they are also its accessible name.
  const label = pending ? 'Hiding' : active ? 'Cancel hide' : 'Hide screen';
  return (
    <div className="screens-off-wrap">
      <button
        type="button"
        className={`screens-off ${className}`.trim()}
        aria-pressed={active}
        aria-label={label}
        data-pending={pending ? 'true' : undefined}
        onClick={tap}
      >
        <span className="screens-off-lbl" aria-hidden="true">
          {label}
        </span>
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
