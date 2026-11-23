import { create } from 'zustand';
import { youtube, type YtDetail, type YtPlayed, type YtVideo } from '../../music/youtube';
import { safeThumb, ytProblem, type YtProblem } from './model';
import { onLibraryReset } from './store';

/**
 * The For you tab's "Played on the wall" shelf: what the wall itself played in the last 30 days (Rust's play record, ids
 * and times), shown with the title, channel and length `wall2_youtube_videos` gives. A video YouTube no longer
 * answers for is left out. Nothing here is written by the page except through the queue (`notePlay`).
 *
 * - `rows` are the answered videos in record order (newest first); `at` maps an id to its time.
 * - The first read takes the newest `FIRST` ids (one details call); "See all" takes the rest in calls of up to 50.
 * - A read older than `STALE_MS` is repeated when the tab shows again.
 */
export interface ForYouState {
  rows: YtVideo[];
  at: ReadonlyMap<string, number>;
  /** Ids of the record not yet asked about (older than the rows). */
  rest: string[];
  loading: boolean;
  loaded: boolean;
  problem: YtProblem | null;
  readAt: number | null;
  /** A play was written while the shelf was hidden or on See all: the next show reads it again. */
  stale: boolean;
}

const blank = (): ForYouState => ({ rows: [], at: new Map(), rest: [], loading: false, loaded: false, problem: null, readAt: null, stale: false });
export const useForYou = create<ForYouState>(() => blank());

/** Ids asked about on the first read, and at most per call. */
export const FIRST = 24;
export const CHUNK = 50;
export const STALE_MS = 60_000;

let epoch = 0;
/** A forced read asked for while one was running: made once, when that one settles. */
let again = false;
/** Whether the For you tab is on screen (and the page visible), and whether it shows See all. Set by the tab. */
const view = { showing: false, all: false };
export function setForYouView(showing: boolean, all: boolean): void {
  view.showing = showing;
  view.all = all;
}
/**
 * The mood chips. A click shows that mood's shelf: Rust answers from its 7-day keep (no search) or spends one of
 * the week's ten searches. The page keeps each answer only for the session, so clicking a chip again asks nothing.
 * `backAt` is set when the budget is spent and the mood is not kept (the shelf then says which day it comes back).
 */
export interface MoodShelf { loading: boolean; rows: YtVideo[]; problem: YtProblem | null; backAt: number | null; cached: boolean; fetchedAt: number }
/** How long the page reuses an answer it fetched (the same 7 days Rust keeps it). */
export const MOOD_KEEP_MS = 7 * 24 * 3600 * 1000;
export const DEFAULT_MOOD = 'Focus';
/** `closedByUser` is set when the open chip was closed with a second click; the default mood then stays shut for the session. */
export const useMoods = create<{ open: string | null; byMood: Record<string, MoodShelf>; closedByUser: boolean }>(() => ({ open: null, byMood: {}, closedByUser: false }));
let moodEpoch = 0;

onLibraryReset(() => {
  epoch += 1;
  again = false;
  useForYou.setState(blank());
  moodEpoch += 1;
  useMoods.setState({ open: null, byMood: {}, closedByUser: false });
});

/** A video as the queue and the tiles take it. Only the picture host's own address is built. */
function videoOf(d: YtDetail): YtVideo | null {
  if (!d.title) return null;
  return { id: d.id, title: d.title, channel: d.channel ?? '', seconds: d.seconds ?? 0, thumb: safeThumb(d.thumb) ?? `https://i.ytimg.com/vi/${d.id}/mqdefault.jpg`, playable: 'yes' };
}

async function detailed(ids: string[]): Promise<YtVideo[]> {
  const out: YtVideo[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const got = await youtube.videos(ids.slice(i, i + CHUNK));
    const byId = new Map(got.map((d) => [d.id, d]));
    for (const id of ids.slice(i, i + CHUNK)) {
      const d = byId.get(id);
      const v = d ? videoOf(d) : null;
      if (v) out.push(v);
    }
  }
  return out;
}

/** Read the record and the details of its newest videos. `force` skips the freshness check. */
export async function loadForYou(force = false, now = Date.now()): Promise<void> {
  const cur = useForYou.getState();
  if (cur.loading) {
    if (force) again = true;
    return;
  }
  if (!force && cur.loaded && !cur.problem && !cur.stale && cur.readAt !== null && now - cur.readAt < STALE_MS) return;
  const mine = epoch;
  useForYou.setState({ loading: true, problem: null, stale: false });
  const settled = () => {
    if (!again) return;
    again = false;
    void loadForYou(true);
  };
  try {
    const record: YtPlayed[] = (await youtube.played()).filter((p) => typeof p?.id === 'string' && typeof p?.at === 'number');
    if (mine !== epoch) return;
    const ids = record.map((p) => p.id);
    const at = new Map(record.map((p) => [p.id, p.at]));
    const first = ids.slice(0, FIRST);
    const rows = first.length ? await detailed(first) : [];
    if (mine !== epoch) return;
    useForYou.setState({ rows, at, rest: ids.slice(FIRST), loading: false, loaded: true, problem: null, readAt: Date.now() });
    settled();
  } catch (e) {
    if (mine !== epoch) return;
    useForYou.setState({ loading: false, loaded: true, problem: ytProblem(e) });
    settled();
  }
}

/**
 * A play was just written to the record. A loaded shelf that is showing (and not on See all, whose list a read
 * would cut back to the first few) reads it again; otherwise it is marked stale and the next show reads it.
 */
export function afterPlay(): void {
  if (!useForYou.getState().loaded) return;
  if (view.showing && !view.all) void loadForYou(true);
  else useForYou.setState({ stale: true });
}

/** "See all": the rest of the record, asked about in calls of up to 50. */
export async function loadAllForYou(): Promise<void> {
  const cur = useForYou.getState();
  if (cur.loading || cur.rest.length === 0) return;
  const mine = epoch;
  const ids = cur.rest;
  useForYou.setState({ loading: true });
  try {
    const more = await detailed(ids);
    if (mine !== epoch) return;
    useForYou.setState((s) => ({ rows: [...s.rows, ...more.filter((v) => !s.rows.some((r) => r.id === v.id))], rest: [], loading: false, problem: null }));
  } catch (e) {
    if (mine !== epoch) return;
    useForYou.setState({ loading: false, problem: ytProblem(e) });
  }
}

/** When the wall played a video, in words: "Today", "Yesterday", "3 days ago", "Last week", "2 weeks ago", "Last month". */
export function whenWords(at: number | undefined, now = Date.now()): string {
  if (typeof at !== 'number') return '';
  const days = Math.floor((now / 1000 - at) / 86400);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'Last week';
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return 'Last month';
}

/** Open a mood's shelf; a second click on the open chip closes it, whatever state the shelf is in. */
export async function pickMood(mood: string): Promise<void> {
  const cur = useMoods.getState();
  if (cur.open === mood) {
    useMoods.setState({ open: null, closedByUser: true });
    return;
  }
  useMoods.setState({ open: mood, closedByUser: false });
  const have = cur.byMood[mood];
  if (have?.loading) return;
  const now = Date.now();
  // A fresh answer is reused; one older than 7 days, a problem, or a spent shelf whose day has come asks Rust again.
  const fresh = have && !have.problem && now - have.fetchedAt < MOOD_KEEP_MS;
  const spent = have && have.backAt !== null && have.rows.length === 0;
  if (fresh && !(spent && now / 1000 >= (have.backAt ?? 0))) return;
  await fetchMood(mood);
}

/** Ask Rust for the mood again (Retry on a shelf that failed). */
export async function fetchMood(mood: string): Promise<void> {
  const mine = moodEpoch;
  const put = (shelf: MoodShelf) => useMoods.setState((s) => ({ byMood: { ...s.byMood, [mood]: shelf } }));
  put({ loading: true, rows: [], problem: null, backAt: null, cached: false, fetchedAt: 0 });
  try {
    const a = await youtube.mood(mood);
    if (mine !== moodEpoch) return;
    const rows = (Array.isArray(a?.items) ? a.items : []).filter((v) => typeof v?.id === 'string' && typeof v?.title === 'string').map((v) => ({ ...v, thumb: safeThumb(v.thumb) ?? `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg` }));
    put({ loading: false, rows, problem: null, backAt: typeof a?.backAt === 'number' ? a.backAt : null, cached: a?.cached === true, fetchedAt: Date.now() });
  } catch (e) {
    if (mine !== moodEpoch) return;
    put({ loading: false, rows: [], problem: ytProblem(e), backAt: null, cached: false, fetchedAt: 0 });
  }
}

/** The calm line a spent budget shows, with the weekday the oldest search frees up in the viewer's own time zone. */
export function moodBudgetLine(backAt: number, now = Date.now()): string {
  if (new Date(backAt * 1000).toDateString() === new Date(now).toDateString()) return 'Out of mood searches this week. Back later today.';
  const day = new Date(backAt * 1000).toLocaleDateString('en-US', { weekday: 'long' });
  return `Out of mood searches this week. Back on ${day}.`;
}

/**
 * The For you tab opens on the default mood when no mood is open, so the page always has music. It goes the same
 * way as a click (a mood kept this week costs no search, a spent budget shows its calm line). A chip the user closed
 * stays closed for the session.
 */
export function openDefaultMood(): void {
  const cur = useMoods.getState();
  if (cur.open !== null || cur.closedByUser) return;
  void pickMood(DEFAULT_MOOD);
}
