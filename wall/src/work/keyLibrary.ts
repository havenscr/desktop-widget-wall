import { useEffect, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { libIndex, type LibIndex } from './keyKind';
import type { LibGroup } from './libraryModel';

let cache: Promise<LibIndex | null> | null = null;

function load(): Promise<LibIndex | null> {
  if (!cache) {
    cache = invoke<LibGroup[]>('wall2_keys_library').then(
      (g) => (Array.isArray(g) ? libIndex(g) : null),
      () => null,
    );
    // A read that failed is tried again by the next row that mounts.
    void cache.then((r) => {
      if (r === null) cache = null;
    });
  }
  return cache;
}

/** The key library as a chord and label index, read once and shared; null while it loads or when it cannot be read. */
export function useLibIndex(): LibIndex | null {
  const [index, setIndex] = useState<LibIndex | null>(null);
  useEffect(() => {
    let live = true;
    void load().then((i) => live && setIndex(i));
    return () => {
      live = false;
    };
  }, []);
  return index;
}

/** Tests: forget the shared read. */
export function resetLibIndex(): void {
  cache = null;
}
