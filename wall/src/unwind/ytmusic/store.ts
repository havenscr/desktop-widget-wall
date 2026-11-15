import { create } from 'zustand';
import { youtube, type YtPage, type YtPlaylist, type YtVideo } from '../../music/youtube';
import { MAX_PAGES, mergePage, searchWords, ytProblem, type YtProblem } from './model';
import { readYoutubeStatus } from './status';

/**
 * The library of the YouTube side, kept apart from the components so it survives the tall view
 * opening and closing, and so a later change (playback) can read the opened list and its rows
 * from here for its queue. Plain on purpose: lists of what Rust answered, nothing else.
 *
 * - `playlists` and `liked` are read a page at a time (`next` is the token of the following page).
 * - `opened` is the playlist whose videos show; `songs` is its list. Nothing is read for it until it opens.
 * - `query` is the words last searched and `found` the answer (null when no search shows).
 * - `searchQuota` is set when YouTube said the day's searches are used up.
 * Everything is emptied by `resetLibrary`, which the side calls when the status stops being signed in.
 */
export interface Loaded<T> {
  items: T[];
  next: string | null;
  /** Pages read so far; reading stops at `MAX_PAGES`. */
  pages: number;
  loading: boolean;
  loaded: boolean;
  problem: YtProblem | null;
  /** When the first page was last read from YouTube, as a clock time (ms). */
  readAt: number | null;
}

export type YtTab = 'playlists' | 'liked';
type Key = 'playlists' | 'liked' | 'songs';

const blank = <T,>(): Loaded<T> => ({ items: [], next: null, pages: 0, loading: false, loaded: false, problem: null, readAt: null });

interface LibraryState {
  tab: YtTab;
  playlists: Loaded<YtPlaylist>;
  liked: Loaded<YtVideo>;
  opened: YtPlaylist | null;
  songs: Loaded<YtVideo>;
  query: string;
  found: Loaded<YtVideo> | null;
  searchQuota: boolean;
}

const initial = (): LibraryState => ({ tab: 'playlists', playlists: blank(), liked: blank(), opened: null, songs: blank(), query: '', found: null, searchQuota: false });

export const useYtLibrary = create<LibraryState>(() => initial());

/**
 * Answers to searches already run, by lower-cased words, so the same words again make no call at all
 * (Rust would answer from its own memory for free; this also skips the round trip). Emptied by a reset.
 */
const memo = new Map<string, { at: number; page: YtPage<YtVideo> }>();
const MEMO_MS = 60 * 60 * 1000;
const MEMO_MAX = 30;

/** Bumped by a reset: an answer that arrives after one is dropped. */
let epoch = 0;

function shaped<T>(page: YtPage<T> | null | undefined): YtPage<T> {
  return {
    items: Array.isArray(page?.items) ? page.items : [],
    next: typeof page?.next === 'string' && page.next ? page.next : null,
  };
}

function read(key: Key, token: string | null, fresh: boolean): Promise<YtPage<YtPlaylist | YtVideo>> {
  const { opened } = useYtLibrary.getState();
  if (key === 'playlists') return youtube.playlists(token, fresh);
  if (key === 'liked') return youtube.liked(token, fresh);
  return opened ? youtube.items(opened.id, token, fresh) : Promise.reject(new Error('invalid'));
}

/** A problem that means the status is out of date: ask for it again, so the card shows the right line. */
const staleStatus = (p: YtProblem) => p === 'needsSignIn' || p === 'broken' || p === 'notsetup';

/**
 * Read the first page of a list (`more` false) or the next one (`more` true). Rows already shown stay
 * while the first page is read again. `fresh` asks Rust to skip its own cache for this one list.
 */
export async function loadList(key: Key, more = false, fresh = false): Promise<void> {
  const state = useYtLibrary.getState();
  const cur = state[key] as Loaded<YtPlaylist | YtVideo>;
  if (cur.loading) return;
  if (more && (!cur.next || cur.pages >= MAX_PAGES || cur.problem)) return;
  const mine = epoch;
  const forId = key === 'songs' ? state.opened?.id : null;
  const set = (patch: (c: Loaded<YtPlaylist | YtVideo>) => Loaded<YtPlaylist | YtVideo>) => useYtLibrary.setState((s) => ({ [key]: patch(s[key] as Loaded<YtPlaylist | YtVideo>) }) as Partial<LibraryState>);
  set((c) => ({ ...c, loading: true, problem: null }));
  try {
    const page = shaped(await read(key, more ? cur.next : null, fresh));
    if (mine !== epoch || (key === 'songs' && useYtLibrary.getState().opened?.id !== forId)) return;
    set((c) => ({
      items: more ? (mergePage(c.items as { id: string }[], page.items as { id: string }[]) as typeof c.items) : page.items,
      next: page.next,
      pages: more ? c.pages + 1 : 1,
      loading: false,
      loaded: true,
      problem: null,
      readAt: more ? c.readAt : Date.now(),
    }));
  } catch (e) {
    if (mine !== epoch || (key === 'songs' && useYtLibrary.getState().opened?.id !== forId)) return;
    const problem = ytProblem(e);
    set((c) => ({ ...c, loading: false, loaded: true, problem }));
    if (staleStatus(problem)) void readYoutubeStatus();
  }
}

/** Try the failed next page again (a problem on a later page keeps the rows already read). */
export function retryMore(key: Key): void {
  useYtLibrary.setState((s) => ({ [key]: { ...s[key], problem: null } }) as Partial<LibraryState>);
  void loadList(key, true);
}

export function setTab(tab: YtTab): void {
  useYtLibrary.setState({ tab, opened: null, songs: blank(), query: '', found: null });
  if (!useYtLibrary.getState()[tab].loaded) void loadList(tab);
}

export function openPlaylist(p: YtPlaylist): void {
  useYtLibrary.setState({ opened: p, songs: blank() });
  void loadList('songs');
}

export function closePlaylist(): void {
  useYtLibrary.setState({ opened: null, songs: blank() });
}

/** Read the opened playlist again from YouTube (page one; the rest as the list scrolls). */
export function refreshSongs(): void {
  void loadList('songs', false, true);
}

/** Run a search. Only ever called by Enter: each one that is not repeated spends one of the day's searches. */
export async function runSearch(text: string): Promise<void> {
  const words = searchWords(text);
  if (!words) return;
  const mine = epoch;
  const key = words.toLowerCase();
  const seen = memo.get(key);
  if (seen && Date.now() - seen.at < MEMO_MS) {
    useYtLibrary.setState({ opened: null, songs: blank(), query: words, found: { items: seen.page.items, next: null, pages: 1, loading: false, loaded: true, problem: null, readAt: seen.at } });
    return;
  }
  useYtLibrary.setState({ opened: null, songs: blank(), query: words, found: { ...blank<YtVideo>(), loading: true } });
  try {
    const page = shaped(await youtube.search(words));
    if (mine !== epoch || useYtLibrary.getState().query !== words) return;
    memo.set(key, { at: Date.now(), page });
    if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value as string);
    useYtLibrary.setState({ found: { items: page.items, next: null, pages: 1, loading: false, loaded: true, problem: null, readAt: Date.now() } });
  } catch (e) {
    if (mine !== epoch || useYtLibrary.getState().query !== words) return;
    const problem = ytProblem(e);
    useYtLibrary.setState((s) => ({ found: { ...blank<YtVideo>(), loaded: true, problem }, searchQuota: s.searchQuota || problem === 'quota' }));
    if (staleStatus(problem)) void readYoutubeStatus();
  }
  // The count of searches left changed (or the answer came from memory and it did not): ask.
  void readYoutubeStatus();
}

export function clearSearch(): void {
  useYtLibrary.setState({ query: '', found: null });
}

/** The day's searches are available again (the status says so). */
export function searchesBack(): void {
  if (useYtLibrary.getState().searchQuota) useYtLibrary.setState({ searchQuota: false });
}

/** Empty everything: signed out, a new client, or a status that is not signed in. */
export function resetLibrary(): void {
  epoch += 1;
  memo.clear();
  useYtLibrary.setState(initial());
}
