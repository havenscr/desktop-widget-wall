import { isKind, validId, type WatchRef } from './watch/links';
import { cleanLabel, cleanText, MAX_LABEL } from './watch/saved';
import { useWatchStore } from './watch/store';

/**
 * The last item the wall's own player played, kept across a restart so the top player's Play can start it
 * again from the top. Only what Watch already saves for an item: its kind, its id and its label, plus which
 * path started it (`from`). Position is not kept.
 */
export interface LastOwn extends WatchRef {
  label: string;
  from: 'watch' | 'music' | 'own';
}

export const LAST_OWN_KEY = 'wall2-last-own-item';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The stored item, checked whole: a known kind with an id of that kind's shape, a clean label, a known path; else null. */
export function readLastOwn(raw: string | null | undefined): LastOwn | null {
  if (!raw || raw.length > 2000) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    if (!v || typeof v !== 'object') return null;
    const { kind, id, label, from } = v;
    if (!isKind(kind) || kind === 'own' || !validId(kind, id)) return null;
    if (from !== 'watch' && from !== 'music' && from !== 'own') return null;
    const ref = { kind, id } as WatchRef;
    return { ...ref, label: cleanLabel(cleanText(label, MAX_LABEL), ref), from };
  } catch {
    return null;
  }
}

export function loadLastOwn(): LastOwn | null {
  try {
    return readLastOwn(storage()?.getItem(LAST_OWN_KEY));
  } catch {
    return null;
  }
}

export function saveLastOwn(item: LastOwn): void {
  try {
    storage()?.setItem(LAST_OWN_KEY, JSON.stringify({ kind: item.kind, id: item.id, label: item.label, from: item.from }));
  } catch {
    /* the item stays for this session */
  }
}

/** Whether the remembered item can be started again: a Watch item must still be in the saved list; a library pick only needs its video id. */
export function canPlayLastOwn(item: LastOwn | null, saved: readonly WatchRef[]): boolean {
  if (!item) return false;
  if (item.from === 'watch') return saved.some((i) => i.kind === item.kind && i.id === item.id);
  return item.kind === 'video';
}

/** Start the remembered item again, from the top, through the existing play path; false when nothing can be started. */
export function playLastOwn(item: LastOwn | null): boolean {
  const st = useWatchStore.getState();
  if (!item || !canPlayLastOwn(item, st.saved)) return false;
  if (item.from === 'watch') {
    st.play({ kind: item.kind, id: item.id } as WatchRef);
    return true;
  }
  return st.playMusic(item.id, item.label);
}
