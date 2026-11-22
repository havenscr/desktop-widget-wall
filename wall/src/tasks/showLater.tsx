import { useSyncExternalStore } from 'react';
import { tip } from '../ui/HoverTip';

/** The one "Later today" setting, shared by Work, Home and the Shelf: off unless stored as on. */
export const LATER_KEY = 'wall.tasks.showLater';

const listeners = new Set<() => void>();

// Storage can be blocked, or accept reads but refuse writes: after a failed write this in-memory value
// is the truth until the page closes.
let override: boolean | null = null;
function snapshot(): boolean {
  if (override !== null) return override;
  try {
    return localStorage.getItem(LATER_KEY) === '1';
  } catch {
    return false;
  }
}

function write(on: boolean): void {
  try {
    localStorage.setItem(LATER_KEY, on ? '1' : '0');
    override = null;
  } catch {
    override = on;
  }
  listeners.forEach((l) => l());
}

/** Test hook: forget a remembered in-memory choice. */
export function resetShowLaterOverride(): void {
  override = null;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  window.addEventListener('storage', l);
  return () => {
    listeners.delete(l);
    window.removeEventListener('storage', l);
  };
}

/** Whether tasks due later today show; every list reads the same value, so a flip on one tab updates the others. */
export function useShowLater(): [boolean, (on: boolean) => void] {
  return [useSyncExternalStore(subscribe, snapshot, () => false), write];
}

/** The "Later today" switch in a list's heading. */
export function LaterSwitch() {
  const [showLater, setShowLater] = useShowLater();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={showLater}
      className={`od-sw${showLater ? ' on' : ''}`}
      onClick={() => setShowLater(!showLater)}
      {...tip(showLater ? 'Showing tasks due later today. Click to hide them.' : 'Hiding tasks due later today. Click to show them.')}
    >
      Later today
      <span className="od-sw-t" aria-hidden="true">
        <i />
      </span>
    </button>
  );
}
