import { useSyncExternalStore } from 'react';
import { getCurrentWindow, type PhysicalPosition, type PhysicalSize } from '@tauri-apps/api/window';
import { isTauri } from '../bridge/tauri';

/**
 * Fullscreen for Wall 2. The window's outer position and size are saved just
 * before entering fullscreen and restored exactly after leaving, so the window
 * lands back wherever the strip placement had put it. Only one change runs at
 * a time; a toggle that arrives while one is in flight is ignored, but an Esc
 * is queued and applied once it finishes (it leaves fullscreen if that is where
 * the window ended up).
 */

type Placement = { position: PhysicalPosition; size: PhysicalSize };

let saved: Placement | null = null;
let busy = false;
let pendingExit = false;
let full = false;
const listeners = new Set<() => void>();

function setFull(v: boolean): void {
  if (full === v) return;
  full = v;
  listeners.forEach((l) => l());
}

function report(error: unknown): void {
  console.warn('[Wall2] fullscreen change failed', error);
}

/** Bring the shared state in line with the real window. */
export async function reconcileFullscreen(): Promise<void> {
  if (!isTauri() || busy) return;
  try {
    const v = await getCurrentWindow().isFullscreen();
    if (!busy) setFull(v);
  } catch (error) {
    report(error);
  }
}

async function change(mode: 'toggle' | 'exit'): Promise<void> {
  if (busy) {
    if (mode === 'exit') pendingExit = true;
    return;
  }
  pendingExit = false;
  busy = true;
  try {
    const win = getCurrentWindow();
    const now = await win.isFullscreen();
    if (!now && mode === 'toggle') {
      saved = { position: await win.outerPosition(), size: await win.outerSize() };
      await win.setFullscreen(true);
      setFull(true);
    } else if (now) {
      await win.setFullscreen(false);
      const still = await win.isFullscreen();
      if (!still && saved) {
        await win.setPosition(saved.position);
        await win.setSize(saved.size);
      }
      if (!still) saved = null;
      setFull(still);
    } else {
      setFull(false);
    }
  } finally {
    busy = false;
  }
  if (pendingExit) {
    pendingExit = false;
    if (full) await change('exit');
  }
}

export function toggleFullscreen(): Promise<void> {
  return change('toggle');
}

/** F11 or Ctrl+F11 toggles fullscreen; Esc leaves it. Returns a remover. */
export function installFullscreenKeys(): () => void {
  if (!isTauri()) return () => {};
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.key === 'F11') {
      e.preventDefault();
      change('toggle').catch(report);
    } else if (e.key === 'Escape' && (full || busy)) {
      e.preventDefault();
      change('exit').catch(report);
    }
  };
  const onFocus = () => void reconcileFullscreen();
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('focus', onFocus);
  const off = getCurrentWindow().onResized(onFocus);
  void reconcileFullscreen();
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('focus', onFocus);
    off.then((f) => f()).catch(() => {});
  };
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Current fullscreen state, shared by the keys and the rail button. */
export function useFullscreen(): boolean {
  return useSyncExternalStore(subscribe, () => full);
}

/** Test hook: forget saved state. */
export function resetFullscreenForTests(): void {
  saved = null;
  busy = false;
  pendingExit = false;
  full = false;
}
