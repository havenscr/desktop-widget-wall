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
  /** Which read the problem belongs to, so Retry repeats that one (the first page or a next page); null without a problem. */
  failed: 'first' | 'more' | null;
  /** Whether the failed first-page read asked Rust to skip its cache (a Refresh), so Retry does the same. */
  failedFresh: boolean;
  /** When the first page was last read from YouTube, as a clock time (ms). */
  readAt: number | null;
}

export type YtTab = 'playlists' | 'liked';
type Key = 'playlists' | 'liked' | 'songs';

const blank = <T,>(): Loaded<T> => ({ items: [], next: null, pages: 0, loading: false, loaded: false, problem: null, failed: null, failedFresh: false, readAt: null });

interface LibraryState {
  tab: YtTab;
  playlists: Loaded<YtPlaylist>;
  liked: Loaded<YtVideo>;
  opened: YtPlaylist | null;
  songs: Loaded<YtVideo>;
  /** A start asked from a tile's menu: the opened playlist plays (or shuffles) when its first page has arrived; `queue.ts` runs it. */
  pendingStart: { id: string; shuffled: boolean } | null;
  query: string;
  found: Loaded<YtVideo> | null;
  searchQuota: boolean;
}

const initial = (): LibraryState => ({ tab: 'playlists', playlists: blank(), liked: blank(), opened: null, songs: blank(), pendingStart: null, query: '', found: null, searchQuota: false });

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

/**
 * Whether the library is on screen: mounted (the YouTube side shows it) and the page visible. Nothing is
 * read while it is not, and an answer that arrives while it is closed is dropped (what is loaded stays).
 * A development build mounts, unmounts and mounts again at once: the answer then still lands, since the
 * library is shown when it arrives.
 */
const view = { mounted: false, visible: true };
const canRead = () => view.mounted && view.visible;
/** The library was mounted; the returned function says it is gone. */
export function libraryMounted(): () => void {
  view.mounted = true;
  return () => {
    view.mounted = false;
  };
}
export function libraryVisible(visible: boolean): void {
  view.visible = visible;
}

/** How long a loaded list is trusted before the card reads it again on being shown (Rust's own cache times). */
const STALE_MS: Record<'playlists' | 'liked', number> = { playlists: 60 * 60 * 1000, liked: 10 * 60 * 1000 };

/**
 * Start the reads the library is waiting for, once it can read: the first page of the shown list when it has
 * none (or its read failed with nothing to show, or it is older than Rust keeps it), and the opened playlist's
 * first page when that never got read. What is already loaded, with the pages read, stays: Refresh re-reads.
 */
export function startReads(now = Date.now()): void {
  if (!canRead()) return;
  const s = useYtLibrary.getState();
  if (s.opened && !s.songs.loaded && !s.songs.loading) void loadList('songs');
  const cur = s[s.tab];
  if (cur.loading) return;
  const old = cur.readAt !== null && now - cur.readAt > STALE_MS[s.tab];
  if (!cur.loaded || old || (cur.problem && cur.items.length === 0)) void loadList(s.tab);
}

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
  if (!canRead()) return;
  const state = useYtLibrary.getState();
  const cur = state[key] as Loaded<YtPlaylist | YtVideo>;
  if (cur.loading) return;
  if (more && (!cur.next || cur.pages >= MAX_PAGES || cur.problem)) return;
  const mine = epoch;
  const forId = key === 'songs' ? state.opened?.id : null;
  const set = (patch: (c: Loaded<YtPlaylist | YtVideo>) => Loaded<YtPlaylist | YtVideo>) => useYtLibrary.setState((s) => ({ [key]: patch(s[key] as Loaded<YtPlaylist | YtVideo>) }) as Partial<LibraryState>);
  const gone = () => mine !== epoch || (key === 'songs' && useYtLibrary.getState().opened?.id !== forId);
  set((c) => ({ ...c, loading: true, problem: null, failed: null }));
  try {
    const page = shaped(await read(key, more ? cur.next : null, fresh));
    if (gone()) return;
    // The library was closed while this read ran: what is loaded stays as it was.
    if (!view.mounted) return void set((c) => ({ ...c, loading: false }));
    set((c) => ({
      // One rule for every page: a video already in the list is not added again.
      items: mergePage(more ? (c.items as { id: string }[]) : [], page.items as { id: string }[]) as typeof c.items,
      next: page.next,
      pages: more ? c.pages + 1 : 1,
      loading: false,
      loaded: true,
      problem: null,
      failed: null,
      failedFresh: false,
      readAt: more ? c.readAt : Date.now(),
    }));
  } catch (e) {
    if (gone()) return;
    if (!view.mounted) return void set((c) => ({ ...c, loading: false }));
    const problem = ytProblem(e);
    // The native side clears its token chain when it says `invalid`: the token held here is dead, so Retry starts from page one.
    const dead = more && problem === 'invalid';
    set((c) => ({ ...c, loading: false, loaded: true, problem, failed: more && !dead ? 'more' : 'first', failedFresh: !more && fresh, next: dead ? null : c.next, pages: dead ? 0 : c.pages }));
    if (staleStatus(problem)) void readYoutubeStatus();
  }
}

/** Retry the read that failed: the first page (a failed Refresh or re-read) or the next page. */
export function retryList(key: Key): void {
  const cur = useYtLibrary.getState()[key] as Loaded<YtPlaylist | YtVideo>;
  const more = (cur.failed ?? 'more') === 'more';
  useYtLibrary.setState((s) => ({ [key]: { ...s[key], problem: null, failed: null } }) as Partial<LibraryState>);
  void loadList(key, more, !more && cur.failedFresh);
}

export function setTab(tab: YtTab): void {
  useYtLibrary.setState({ tab, opened: null, songs: blank(), query: '', found: null });
  if (!useYtLibrary.getState()[tab].loaded) void loadList(tab);
}

/** Open a playlist; `start` also asks for it to play, or shuffle, as soon as its first page has arrived (any other open or a close cancels it). */
export function openPlaylist(p: YtPlaylist, start?: 'play' | 'shuffle'): void {
  useYtLibrary.setState({ opened: p, songs: blank(), pendingStart: start ? { id: p.id, shuffled: start === 'shuffle' } : null });
  void loadList('songs');
}

export function closePlaylist(): void {
  useYtLibrary.setState({ opened: null, songs: blank(), pendingStart: null });
}

/** Read the opened playlist again from YouTube (page one; the rest as the list scrolls). */
export function refreshSongs(): void {
  void loadList('songs', false, true);
}

/** Each search takes the next number; an answer applies only while it still carries the latest one. */
let searchSeq = 0;
/** Searches in flight by lower-cased words: the same words asked again share the call. */
const flights = new Map<string, Promise<YtPage<YtVideo>>>();

/** Run a search. Only ever called by Enter: each one that is not repeated spends one of the day's searches. */
export async function runSearch(text: string): Promise<void> {
  const words = searchWords(text);
  if (!words || !canRead()) return;
  const mine = epoch;
  const seq = ++searchSeq;
  const key = words.toLowerCase();
  const seen = memo.get(key);
  if (seen && Date.now() - seen.at < MEMO_MS) {
    useYtLibrary.setState({ opened: null, songs: blank(), query: words, found: { items: seen.page.items, next: null, pages: 1, loading: false, loaded: true, problem: null, failed: null, failedFresh: false, readAt: seen.at } });
    return;
  }
  useYtLibrary.setState({ opened: null, songs: blank(), query: words, found: { ...blank<YtVideo>(), loading: true } });
  let flight = flights.get(key);
  if (!flight) {
    flight = youtube.search(words);
    flights.set(key, flight);
    const started = flight;
    const done = () => {
      if (flights.get(key) === started) flights.delete(key);
    };
    started.then(done, done);
  }
  // This search is over for the page if it is old (a newer one was asked), or if the library was closed meanwhile.
  const stale = () => mine !== epoch || seq !== searchSeq;
  const closed = () => {
    if (view.mounted) return false;
    if (seq === searchSeq) useYtLibrary.setState({ query: '', found: null });
    return true;
  };
  try {
    const page = shaped(await flight);
    if (mine === epoch) {
      memo.set(key, { at: Date.now(), page });
      if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value as string);
    }
    if (stale() || closed()) return;
    useYtLibrary.setState({ found: { items: mergePage<YtVideo>([], page.items), next: null, pages: 1, loading: false, loaded: true, problem: null, failed: null, failedFresh: false, readAt: Date.now() } });
  } catch (e) {
    if (stale() || closed()) return;
    const problem = ytProblem(e);
    useYtLibrary.setState((s) => ({ found: { ...blank<YtVideo>(), loaded: true, problem, failed: 'first' }, searchQuota: s.searchQuota || problem === 'quota' }));
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

const resetHooks = new Set<() => void>();
/** Something that holds a per-session fact about the library (the queue's failed videos) says how to clear it with the library. */
export function onLibraryReset(fn: () => void): void {
  resetHooks.add(fn);
}

/** Empty everything: signed out, a new client, or a status that is not signed in. */
export function resetLibrary(): void {
  epoch += 1;
  resetHooks.forEach((fn) => fn());
  memo.clear();
  flights.clear();
  useYtLibrary.setState(initial());
}
