import { useEffect, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { useVisible } from '../ui/useVisible';
import { joinKeys, useKeysFeedStore } from './keysFeed';
import { FALLBACK_PINS, MAX_PINS, parsePins, PINS_CHANGED_EVENT, readPinsRaw, resolvePin, type LibGroup, type PinView } from './libraryModel';

/** The library, read once; null while it loads or when it cannot be read. */
export function useLibrary(): { lib: LibGroup[] | null; failed: boolean; retry: () => void } {
  const [lib, setLib] = useState<LibGroup[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let live = true;
    invoke<LibGroup[]>('wall2_keys_library').then(
      (g) => {
        if (!live) return;
        setLib(Array.isArray(g) ? g : null);
        setFailed(!Array.isArray(g));
      },
      () => live && (setLib(null), setFailed(true)),
    );
    return () => {
      live = false;
    };
  }, [tries]);
  return { lib, failed, retry: () => (setFailed(false), setTries((n) => n + 1)) };
}

/**
 * The "Always here" pins as the row shows them: the owner's pins on this display (local storage, checked against
 * the library on read), else the keys named in keys.json, else the defaults. Shared by the Work row and Unwind's
 * keys row. `raw` and `setRaw` are the stored text, kept current when another place changes it.
 */
export function usePins() {
  const visible = useVisible();
  useEffect(() => (visible ? joinKeys() : undefined), [visible]);
  const read = useKeysFeedStore((s) => s.read);
  const { lib, failed: libFailed, retry: retryLib } = useLibrary();
  const [raw, setRaw] = useState<string | null>(readPinsRaw);
  useEffect(() => {
    const changed = () => setRaw(readPinsRaw());
    window.addEventListener(PINS_CHANGED_EVENT, changed);
    return () => window.removeEventListener(PINS_CHANGED_EVENT, changed);
  }, []);
  const summary = read.status === 'ready' ? read.summary : null;
  const filePins = summary?.filePins ?? [];
  const defaults = summary?.defaultPins ?? FALLBACK_PINS;
  const kept = lib ? parsePins(raw, lib, filePins) : null;
  const refs = kept ?? defaults;
  const pins: PinView[] = lib ? refs.map((r) => resolvePin(r, lib, filePins)).filter((p): p is PinView => p !== null).slice(0, MAX_PINS) : [];
  return { read, lib, libFailed, retryLib, raw, setRaw, filePins, kept, pins };
}
