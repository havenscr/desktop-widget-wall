import { useEffect, useMemo, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { libIndex, type LibIndex } from './keyKind';
import type { LibGroup } from './libraryModel';

let cache: Promise<LibGroup[] | null> | null = null;

function load(): Promise<LibGroup[] | null> {
  if (!cache) {
    cache = invoke<LibGroup[]>('wall2_keys_library').then(
      (g) => (Array.isArray(g) ? g : null),
      () => null,
    );
    // A read that failed is tried again by the next row that mounts.
    void cache.then((r) => {
      if (r === null) cache = null;
    });
  }
  return cache;
}

/** The key library's groups, read once and shared; `groups` is null while it loads, and `failed` is true when it cannot be read. */
export function useLibGroups(): { groups: LibGroup[] | null; failed: boolean } {
  const [state, setState] = useState<{ groups: LibGroup[] | null; failed: boolean }>({ groups: null, failed: false });
  useEffect(() => {
    let live = true;
    void load().then((g) => live && setState({ groups: g, failed: g === null }));
    return () => {
      live = false;
    };
  }, []);
  return state;
}

/** The key library as a chord and label index, read once and shared; null while it loads or when it cannot be read. */
export function useLibIndex(): LibIndex | null {
  const { groups } = useLibGroups();
  return useMemo(() => (groups ? libIndex(groups) : null), [groups]);
}

/** Tests: forget the shared read. */
export function resetLibIndex(): void {
  cache = null;
}
