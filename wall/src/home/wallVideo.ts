import { useMemo } from 'react';
import { usePlaceStore } from '../state/places';
import { playerLink } from '../unwind/watch/PlayerFrame';
import type { SavedItem } from '../unwind/watch/saved';
import { useWatchStore, type PlayerReport, type WatchState } from '../unwind/watch/store';
import type { WatchKind } from '../unwind/watch/links';
import { clockMs } from './soundModel';

/**
 * The wall's own video, as Home's Now Playing block needs it. It reads the Watch store (what plays, paused,
 * the player's report, `needsClick`) and acts through the store's own actions and `playerLink`; nothing here
 * is a second player and nothing is mounted in the Watch stage (the frame lives in `WatchStageLayer`, mounted
 * for every place, so it keeps playing, and answering `playerLink.send`, while Home shows).
 */

export interface WallVideoView {
  /** The item on and the player's report, by identity: a change of either is how Home learns the frame answers or another video is on. */
  item: SavedItem;
  report: PlayerReport;
  title: string;
  kind: WatchKind;
  /** "YouTube video", "YouTube playlist, 4 of 24", "Twitch stream". */
  sub: string;
  /** The same for the split view's narrow line: "Video", "Playlist, 4 of 24". */
  shortSub: string;
  /** YouTube kinds take messages (pause, back, next); Twitch takes only Stop. */
  youtube: boolean;
  paused: boolean;
  /** Autoplay was refused (or Twitch waits for a click): the picture starts only with a click on Watch. */
  needsClick: boolean;
  /** Seconds played and the length, only when the player reports a length (a live stream has none). */
  time: { pos: number; dur: number } | null;
  /** A playlist the player reports with more than one item: back and next apply. */
  list: { index: number; count: number } | null;
}

type Snapshot = Pick<WatchState, 'playing' | 'paused' | 'needsClick' | 'report'>;

const KIND_WORDS: Record<WatchKind, string> = { video: 'YouTube video', live: 'YouTube live stream', playlist: 'YouTube playlist', twitch: 'Twitch stream' };
const SHORT_WORDS: Record<WatchKind, string> = { video: 'Video', live: 'Live stream', playlist: 'Playlist', twitch: 'Twitch stream' };

/** What Home shows for the store's state; null when nothing plays or the video has ended (nothing left to control). */
export function wallVideoView(s: Snapshot): WallVideoView | null {
  const item = s.playing;
  if (!item || s.report.ended) return null;
  const r = s.report;
  const list = item.kind === 'playlist' && r.count > 1 ? { index: r.index, count: r.count } : null;
  const place = list ? `, ${list.index + 1} of ${list.count}` : '';
  const time = item.kind !== 'twitch' && r.time !== null && r.duration !== null && r.duration > 0 ? { pos: Math.min(r.time, r.duration), dur: r.duration } : null;
  return {
    item,
    report: r,
    title: item.label,
    kind: item.kind,
    sub: KIND_WORDS[item.kind] + place,
    shortSub: SHORT_WORDS[item.kind] + place,
    youtube: item.kind !== 'twitch',
    paused: s.paused,
    needsClick: s.needsClick,
    time,
    list,
  };
}

/** The wall's video for Home, or null. Subscribes to the store's fields one by one, so only a real change redraws. */
export function useWallVideo(): WallVideoView | null {
  const playing = useWatchStore((s) => s.playing);
  const paused = useWatchStore((s) => s.paused);
  const needsClick = useWatchStore((s) => s.needsClick);
  const report = useWatchStore((s) => s.report);
  return useMemo(() => wallVideoView({ playing, paused, needsClick, report }), [playing, paused, needsClick, report]);
}

/** The controls, each the Watch tab's own call. `previous` and `next` answer false when the frame did not take the message. */
export const wallVideoControls = {
  togglePause: (): void => {
    const st = useWatchStore.getState();
    st.setPaused(!st.paused);
  },
  stop: (): void => useWatchStore.getState().stop(),
  previous: (): boolean => playerLink.send('previousVideo'),
  next: (): boolean => playerLink.send('nextVideo'),
  /** Goes to the Unwind place's Watch tab, as the rail's mark does. */
  openWatch: (): void => {
    usePlaceStore.getState().setActive('unwind');
    useWatchStore.getState().setTab('watch');
  },
};

/** "12:34 of 45:10" for the split view's line. */
export function timeOf(posSeconds: number, durSeconds: number): string {
  return `${clockMs(posSeconds * 1000)} of ${clockMs(durSeconds * 1000)}`;
}
