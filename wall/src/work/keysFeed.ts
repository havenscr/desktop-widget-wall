import { create } from 'zustand';
import { invoke } from '../bridge/tauri';
import { errorText, isAbsent } from './deckModel';
import type { KeysSummary } from './keysModel';

/** How often the rows ask which app is in front. */
export const KEYS_POLL_MS = 2_000;

export type Read = { status: 'loading' } | { status: 'absent' } | { status: 'ready'; summary: KeysSummary } | { status: 'problem'; text: string };

/** The one shared read of `wall2_keys_summary` every row uses. */
export const useKeysFeedStore = create<{ read: Read }>(() => ({ read: { status: 'loading' } }));

let users = 0;
let timer: ReturnType<typeof setInterval> | null = null;
/** Bumped when the last user leaves, so a read started before that cannot land after it. */
let epoch = 0;

export function loadKeys(): void {
  const mine = epoch;
  invoke<KeysSummary>('wall2_keys_summary').then(
    (summary) => mine === epoch && useKeysFeedStore.setState({ read: { status: 'ready', summary } }),
    (e) => mine === epoch && useKeysFeedStore.setState({ read: isAbsent(e) ? { status: 'absent' } : { status: 'problem', text: errorText(e) } }),
  );
}

/** Start reading while a row is mounted and visible; the last one to leave stops it. */
export function joinKeys(): () => void {
  users += 1;
  if (users === 1) {
    loadKeys();
    timer = setInterval(loadKeys, KEYS_POLL_MS);
  }
  return () => {
    users -= 1;
    if (users === 0) {
      epoch += 1;
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}

/** Test helper: forget everything. */
export function resetKeysFeed(): void {
  users = 0;
  epoch += 1;
  if (timer) clearInterval(timer);
  timer = null;
  useKeysFeedStore.setState({ read: { status: 'loading' } });
}

/** The Tools drawer's Reload: forget the shared read and ask `wall2_keys_summary` again at once. */
export function reloadKeys(): void {
  useKeysFeedStore.setState({ read: { status: 'loading' } });
  loadKeys();
}
