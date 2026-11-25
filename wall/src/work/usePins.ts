import { useEffect, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { useVisible } from '../ui/useVisible';
import { libIndex, pinKind, type KeyKind } from './keyKind';
import { joinKeys, useKeysFeedStore } from './keysFeed';
import { allKeys, FALLBACK_PINS, MAX_PINS, parsePins, PINS_CHANGED_EVENT, readPinsRaw, resolvePin, type LibGroup, type PinView } from './libraryModel';

/** The library, read once; null while it loads or when it cannot be read. */
export function useLibrary(on = true): { lib: LibGroup[] | null; failed: boolean; retry: () => void } {
  const [lib, setLib] = useState<LibGroup[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!on) return;
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
  }, [tries, on]);
  return { lib, failed, retry: () => (setFailed(false), setTries((n) => n + 1)) };
}

/**
 * The "Always here" pins as the row shows them: the owner's pins on this display (local storage, checked against
 * the library on read), else the keys named in keys.json, else the defaults. Shared by the Work row and Unwind's
 * keys row. `active` false stops the reads (the keys row asks only while it shows). `raw` and `setRaw` are the stored text, kept current when another place changes it.
 */
export function usePins(active = true) {
  const visible = useVisible() && active;
  useEffect(() => (visible ? joinKeys() : undefined), [visible]);
  const read = useKeysFeedStore((s) => s.read);
  const { lib, failed: libFailed, retry: retryLib } = useLibrary(active);
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

/** The kind (and so the colour) of a pinned key, the one answer for the Work row and the Unwind keys: built from the library and the key's own action and label. */
export function makeKindOf(lib: readonly LibGroup[] | null): (p: PinView) => KeyKind {
  const byId = lib ? allKeys(lib) : null;
  const index = lib ? libIndex(lib) : null;
  return (p) => {
    const hit = p.ref.startsWith('lib:') ? byId?.get(p.ref.slice(4)) : undefined;
    return pinKind(p.ref, hit ? { group: hit.group.id, action: hit.key.action } : null, { action: p.action, label: p.label }, index);
  };
}
