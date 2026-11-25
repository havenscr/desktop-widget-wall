import { create } from 'zustand';
import { youtube, type YtVideo } from '../../music/youtube';
import { DEFAULT_SORT, SORT_CHOICES, searchWords, ytProblem, type YtProblem, type YtSort } from '../ytmusic/model';
import { readYoutubeStatus } from '../ytmusic/status';
import { parseLink } from './links';

/**
 * Search for YouTube videos from the Watch card. The words go through the same Rust search as Listen's (the same day's
 * allowance, the same memory for repeated words) with no category filter, so a search finds any kind of video. Sorting only
 * reorders what was found. The view (grid or list) and the sort are kept for the next search.
 */
export type SearchView = 'grid' | 'list';
export const SEARCH_VIEW_KEY = 'wall2-watch-search-view';
export const SEARCH_SORT_KEY = 'wall2-watch-search-sort';
export const DEFAULT_VIEW: SearchView = 'grid';

export function loadView(): SearchView {
  try {
    const raw = localStorage.getItem(SEARCH_VIEW_KEY);
    return raw === 'grid' || raw === 'list' ? raw : DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
}

export function loadSort(): YtSort {
  try {
    const raw = localStorage.getItem(SEARCH_SORT_KEY);
    return SORT_CHOICES.find((c) => c.id === raw)?.id ?? DEFAULT_SORT;
  } catch {
    return DEFAULT_SORT;
  }
}

function keep(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* the choice stays for this session */
  }
}

export interface Found {
  items: YtVideo[];
  loading: boolean;
  problem: YtProblem | null;
}

interface SearchState {
  /** True while the results show in place of the list. */
  open: boolean;
  query: string;
  found: Found | null;
  view: SearchView;
  sort: YtSort;
}

export const useWatchSearch = create<SearchState>(() => ({ open: false, query: '', found: null, view: loadView(), sort: loadSort() }));

const LINK_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'twitch.tv', 'www.twitch.tv', 'm.twitch.tv']);

/**
 * A link to save: text the saver accepts (a YouTube or Twitch link, with or without a scheme, or a bare video id), or text
 * that starts with a scheme or with one of those hosts (so a half-typed or wrong link gets the saver's own message).
 * Everything else, a dotted word such as `node.js` included, is words to search.
 */
export function isLinkText(text: string): boolean {
  const t = text.trim();
  if (!t || /\s/.test(t)) return false;
  if (/^https?:\/\//i.test(t)) return true;
  if (parseLink(t).ok) return true;
  return LINK_HOSTS.has(t.split(/[/?#]/)[0]!.toLowerCase());
}

/** Why words cannot be searched (more than 100 characters, or a character YouTube's search refuses); null when they can. */
export function wordsProblem(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  if (searchWords(t)) return null;
  return [...t].length > 100 ? 'Searches can be up to 100 characters.' : 'Searches cannot hold that character.';
}

let seq = 0;

/** Run a search for the words (a new search each time Search is pressed; repeated words are free in Rust). */
export async function runWatchSearch(text: string): Promise<void> {
  const words = searchWords(text);
  if (!words) return;
  const mine = ++seq;
  useWatchSearch.setState({ open: true, query: words, found: { items: [], loading: true, problem: null } });
  try {
    const page = await youtube.search(words, true);
    if (mine === seq) useWatchSearch.setState({ found: { items: Array.isArray(page?.items) ? page.items : [], loading: false, problem: null } });
  } catch (e) {
    if (mine === seq) useWatchSearch.setState({ found: { items: [], loading: false, problem: ytProblem(e) } });
  }
  // The count of searches left changed (or the answer came from memory and it did not): ask, even for an answer that was
  // replaced, so the count never stays one too high when the older call is the last to finish.
  void readYoutubeStatus();
}

/** Back to the list. An answer still on its way is dropped. */
export function closeWatchSearch(): void {
  seq += 1;
  if (useWatchSearch.getState().open) useWatchSearch.setState({ open: false, query: '', found: null });
}

export function pickView(view: SearchView): void {
  keep(SEARCH_VIEW_KEY, view);
  useWatchSearch.setState({ view });
}

/** Order the answer on show; nothing is asked of YouTube. */
export function pickWatchSort(sort: YtSort): void {
  keep(SEARCH_SORT_KEY, sort);
  useWatchSearch.setState({ sort });
}
