import { kindName, refKey } from './links';
import { cleanTag, type SavedItem } from './saved';

/** The sorts of the Watch list. `recent` is the stored order (a new item goes to the top), so it needs no stamp. */
export type ListSort = 'recent' | 'played' | 'plays' | 'name' | 'longest' | 'views';

export const SORTS: readonly { id: ListSort; label: string; short: string }[] = [
  { id: 'recent', label: 'Recent', short: 'Recent' },
  { id: 'played', label: 'Last played', short: 'Played' },
  { id: 'plays', label: 'Most played', short: 'Plays' },
  { id: 'name', label: 'Name, A to Z', short: 'Name' },
  { id: 'longest', label: 'Longest first', short: 'Length' },
  { id: 'views', label: 'Most viewed', short: 'Views' },
];
export const DEFAULT_SORT: ListSort = 'recent';

export function isSort(v: unknown): v is ListSort {
  return typeof v === 'string' && SORTS.some((s) => s.id === v);
}

/** A chip: everything, one kind, or one tag (`tag:` and the tag in lower case). */
export type ChipId = 'all' | 'live' | 'video' | 'playlist' | 'twitch' | `tag:${string}`;
export const ALL_CHIP: ChipId = 'all';

export function isChip(v: unknown): v is ChipId {
  if (typeof v !== 'string') return false;
  if (v === 'all' || v === 'live' || v === 'video' || v === 'playlist' || v === 'twitch') return true;
  return v.startsWith('tag:') && v.length > 4 && v.length <= 4 + 24 * 2 && v === `tag:${cleanTag(v.slice(4)).toLowerCase()}`;
}

export function tagChip(tag: string): ChipId {
  return `tag:${tag.toLowerCase()}`;
}

/** The kind chips are "Playlists" for both a YouTube playlist and a playlist of the owner's own. */
function kindChip(item: SavedItem): ChipId {
  switch (item.kind) {
    case 'live':
      return 'live';
    case 'twitch':
      return 'twitch';
    case 'playlist':
    case 'own':
      return 'playlist';
    default:
      return 'video';
  }
}

function hasTag(item: SavedItem, lower: string): boolean {
  return (item.tags ?? []).some((t) => t.toLowerCase() === lower);
}

function inChip(item: SavedItem, chip: ChipId): boolean {
  if (chip === 'all') return true;
  if (chip.startsWith('tag:')) return hasTag(item, chip.slice(4));
  return kindChip(item) === chip;
}

export interface ChipCounts {
  all: number;
  live: number;
  video: number;
  playlist: number;
  twitch: number;
  /** Each tag once (as first written), the most used first, then A to Z. */
  tags: { chip: ChipId; name: string; count: number }[];
}

export function chipCounts(items: readonly SavedItem[]): ChipCounts {
  const out: ChipCounts = { all: items.length, live: 0, video: 0, playlist: 0, twitch: 0, tags: [] };
  const tags = new Map<string, { name: string; count: number }>();
  for (const i of items) {
    const k = kindChip(i);
    if (k === 'live' || k === 'video' || k === 'playlist' || k === 'twitch') out[k] += 1;
    for (const t of i.tags ?? []) {
      const low = t.toLowerCase();
      const seen = tags.get(low);
      if (seen) seen.count += 1;
      else tags.set(low, { name: t, count: 1 });
    }
  }
  out.tags = [...tags.entries()].map(([low, v]) => ({ chip: tagChip(low), name: v.name, count: v.count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return out;
}

/** True when the chip still means something in this list (a tag that was removed from every item does not). */
export function chipExists(counts: ChipCounts, chip: ChipId): boolean {
  if (chip === 'all') return true;
  if (chip.startsWith('tag:')) return counts.tags.some((t) => t.chip === chip);
  // Twitch has a chip only while one is saved; the other kind chips are always there.
  return chip !== 'twitch' || counts.twitch > 0;
}

/** The words typed in the field: each one must be found in the label, a tag or the kind's name. */
function matches(item: SavedItem, words: readonly string[]): boolean {
  if (words.length === 0) return true;
  const hay = [item.label, kindName(item.kind), ...(item.tags ?? [])].join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function wordsOf(text: string): string[] {
  return text.toLowerCase().split(/\s+/).map((w) => w.replace(/^#+/, '')).filter(Boolean);
}

/**
 * The items under a chip that match the typed words, in stored order. `keep` is a key that stays in whatever the
 * filter says (the item whose name field is open must not vanish under the owner).
 */
export function filterItems(items: readonly SavedItem[], chip: ChipId, text: string, keep: string | null = null): SavedItem[] {
  const words = wordsOf(text);
  return items.filter((i) => (keep !== null && refKey(i) === keep) || (inChip(i, chip) && matches(i, words)));
}

const NUMBER: Partial<Record<ListSort, (i: SavedItem) => number | undefined>> = {
  played: (i) => i.lastPlayedAt,
  plays: (i) => i.plays,
  longest: (i) => i.seconds,
  views: (i) => i.views,
};

/** The items in the order asked. Ties and items without the value stay in stored order; those without it come last. */
export function sortItems(items: readonly SavedItem[], sort: ListSort): SavedItem[] {
  if (sort === 'recent') return [...items];
  const rows = items.map((item, at) => ({ item, at }));
  if (sort === 'name') {
    rows.sort((a, b) => a.item.label.localeCompare(b.item.label, undefined, { sensitivity: 'base', numeric: true }) || a.at - b.at);
  } else {
    const get = NUMBER[sort]!;
    rows.sort((a, b) => {
      const x = get(a.item);
      const y = get(b.item);
      if (x === undefined || y === undefined) return x === y ? a.at - b.at : x === undefined ? 1 : -1;
      return y - x || a.at - b.at;
    });
  }
  return rows.map((r) => r.item);
}

/** What the count line says: "62 saved", or "7 of 62" while a chip or words narrow the list. */
export function countLine(shown: number, total: number, narrowed: boolean): string {
  return narrowed ? `${shown} of ${total}` : `${total} saved`;
}
