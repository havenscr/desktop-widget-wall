import { create } from 'zustand';
import { youtube, type YtDetail, type YtPlayed, type YtVideo } from '../../music/youtube';
import { safeThumb, ytProblem, type YtProblem } from './model';
import { onLibraryReset } from './store';

/**
 * The For you tab's "Back to" shelf: what the wall itself played in the last 30 days (Rust's play record, ids
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
onLibraryReset(() => {
  epoch += 1;
  again = false;
  useForYou.setState(blank());
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
