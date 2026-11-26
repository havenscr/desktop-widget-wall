import { create } from 'zustand';
import { ALL_CHIP, DEFAULT_SORT, isChip, isSort, type ChipId, type ListSort } from './listView';

/** The chip and sort of the Watch list, kept for this viewer only. */
export const LISTVIEW_KEY = 'wall2-watch-listview';

interface Saved {
  chip: ChipId;
  sort: ListSort;
}

export function parseListView(raw: string | null): Saved {
  const out: Saved = { chip: ALL_CHIP, sort: DEFAULT_SORT };
  if (!raw) return out;
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    if (v && typeof v === 'object') {
      if (isChip(v.chip)) out.chip = v.chip;
      if (isSort(v.sort)) out.sort = v.sort;
    }
  } catch {
    /* the plain list */
  }
  return out;
}

function load(): Saved {
  try {
    return parseListView(localStorage.getItem(LISTVIEW_KEY));
  } catch {
    return parseListView(null);
  }
}

function save(s: Saved): void {
  try {
    localStorage.setItem(LISTVIEW_KEY, JSON.stringify({ chip: s.chip, sort: s.sort }));
  } catch {
    /* kept for this session */
  }
}

interface ListViewState extends Saved {
  setChip: (chip: ChipId) => void;
  setSort: (sort: ListSort) => void;
}

export const useListView = create<ListViewState>((set, get) => ({
  ...load(),
  setChip: (chip) => {
    set({ chip });
    save(get());
  },
  setSort: (sort) => {
    set({ sort });
    save(get());
  },
}));

/** Tests only. */
export function resetListView(): void {
  useListView.setState({ ...load() });
}
