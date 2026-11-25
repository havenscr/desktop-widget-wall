import { defaultLabel, parseLink, refKey, type WatchRef } from './links';
import { ADD_ERRORS, type SavedItem } from './saved';

/** The address of a saved item's own page, as a person would paste it back: the text "Edit link" starts from. */
export function linkText(ref: WatchRef): string {
  switch (ref.kind) {
    case 'video':
      return `https://www.youtube.com/watch?v=${ref.id}`;
    case 'live':
      return `https://www.youtube.com/live/${ref.id}`;
    case 'playlist':
      return `https://www.youtube.com/playlist?list=${ref.id}`;
    case 'twitch':
      return `https://www.twitch.tv/${ref.id}`;
    case 'own':
      return '';
  }
}

export type RelinkResult = { ok: true; items: SavedItem[]; key: string } | { ok: false; error: string };

/**
 * Replace the link of one saved item with a pasted one, checked as the paste box checks it. The item keeps its place
 * and the name the owner gave it; one that still had its kind's default name takes the new kind's default. A link
 * that is not valid, or that is already another item of the list, is refused and the old one stays.
 */
export function relinkSaved(items: readonly SavedItem[], key: string, text: string): RelinkResult {
  const old = items.find((i) => refKey(i) === key);
  if (!old) return { ok: false, error: 'That item is no longer in the list.' };
  const parsed = parseLink(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const next = refKey(parsed.ref);
  if (next !== key && items.some((i) => refKey(i) === next)) return { ok: false, error: ADD_ERRORS.dup };
  const label = old.label === defaultLabel(old) ? defaultLabel(parsed.ref) : old.label;
  return { ok: true, key: next, items: items.map((i) => (refKey(i) === key ? { kind: parsed.ref.kind, id: parsed.ref.id, label } : i)) };
}
