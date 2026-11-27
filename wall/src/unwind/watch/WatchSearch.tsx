import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { IconLayoutGrid, IconList, IconPlaylistAdd } from '@tabler/icons-react';
import type { YtVideo } from '../../music/youtube';
import { tip } from '../../ui/HoverTip';
import { useSignalStore } from '../../signals/store';
import { PLAY_TIP, compactCount, lengthText, rowReason, rowThumb, rowWords, sortVideos, videosLine } from '../ytmusic/model';
import { validVideoId } from '../ytmusic/queue';
import { useYoutubeStatus } from '../ytmusic/status';
import { YtEmpty, YtState, YtThumb, ownVideo } from '../ytmusic/YtParts';
import { YtSortButton } from '../ytmusic/YtSort';
import { AddMenu } from './AddToPlaylist';
import { closeWatchSearch, resetWatchSearch, pickView, pickWatchSort, runWatchSearch, useWatchSearch, type SearchView } from './searchStore';
import { useWatchStore } from './store';

/** "87 searches left today" (the same allowance as Listen's search); empty while the count is not known. */
export function leftToday(left: number | null | undefined): string {
  if (typeof left !== 'number' || !Number.isFinite(left)) return '';
  const n = Math.max(0, Math.floor(left));
  return `${n} ${n === 1 ? 'search' : 'searches'} left today`;
}

const VIEWS: { id: SearchView; label: string; icon: ReactNode }[] = [
  { id: 'grid', label: 'Show the results as a grid', icon: <IconLayoutGrid size={20} stroke={1.8} aria-hidden="true" /> },
  { id: 'list', label: 'Show the results as a list', icon: <IconList size={20} stroke={1.8} aria-hidden="true" /> },
];

/**
 * The results of a Watch search, in place of the saved list: a header line (the count, the sort, the grid or list switch
 * and the way back), the videos in a two column grid or a list of rows, and a foot line (scroll hint, searches left).
 * A click on a result plays it on the wall; its plus saves it to a playlist, as on Listen. The card stays as it is
 * while browsing; the video that plays keeps playing.
 */
export function WatchResults({ host }: { host: HTMLElement | null }) {
  const found = useWatchSearch((s) => s.found);
  const query = useWatchSearch((s) => s.query);
  const view = useWatchSearch((s) => s.view);
  const sort = useWatchSearch((s) => s.sort);
  const playingId = useWatchStore((s) => (s.playing?.kind === 'video' ? s.playing.id : null));
  const inCall = useSignalStore((s) => s.call !== null);
  const left = useYoutubeStatus((s) => s.status?.searchesLeft ?? null);
  const ordered = useMemo(() => sortVideos(found?.items ?? [], sort), [found?.items, sort]);
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const check = useCallback(() => {
    const el = scroller.current;
    setMore(!!el && el.scrollHeight - el.scrollTop - el.clientHeight > 2);
  }, []);
  useEffect(() => {
    check();
    const el = scroller.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [check, ordered, view]);
  // The add menu goes when the results change order or the list scrolls.
  useEffect(() => setMenu(null), [ordered, view]);
  useEffect(() => {
    const el = scroller.current;
    if (!menu || !el) return;
    const close = () => setMenu(null);
    el.addEventListener('scroll', close);
    return () => el.removeEventListener('scroll', close);
  }, [menu]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('.w-pop')) {
      e.preventDefault();
      e.stopPropagation();
      closeWatchSearch();
    }
  };
  const menuVideo = menu ? ordered.find((v) => v.id === menu.id) : undefined;

  const cell = (v: YtVideo, i: number) => {
    const bad = v.playable === 'yes' && !validVideoId(v.id);
    const words = bad ? 'Not available' : rowWords(v.playable);
    const plays = !words && v.playable === 'yes';
    const on = playingId === v.id;
    const wait = inCall && !on;
    const meta = [v.channel, v.views != null ? `${compactCount(v.views)} views` : ''].filter(Boolean).join(' · ');
    const len = words ?? lengthText(v.seconds);
    const reason = bad ? 'This video cannot be played here.' : rowReason(v.playable);
    const body =
      view === 'grid' ? (
        <>
          <span className="ws-pic">
            <YtThumb src={rowThumb(v)} className="ws-thumb" />
            {len ? <span className="ws-dur">{len}</span> : null}
          </span>
          <span className="ws-title">{v.title}</span>
          <span className="ws-meta">{meta}</span>
        </>
      ) : (
        <>
          <YtThumb src={rowThumb(v)} className="ws-thumb" />
          <span className="ws-text">
            <span className="ws-title">{v.title}</span>
            <span className="ws-meta">{v.channel}</span>
          </span>
          <span className="ws-views">{words ? '' : compactCount(v.views)}</span>
          <span className="ws-len">{len}</span>
        </>
      );
    return (
      <li key={`${v.id}-${i}`} className={`ws-item${on ? ' on' : ''}${plays ? '' : ' off'}`}>
        {plays ? (
          <button
            type="button"
            className="ws-play"
            disabled={wait}
            aria-current={on ? 'true' : undefined}
            aria-label={`Play ${v.title}`}
            {...tip(wait ? 'Video waits until the call ends' : PLAY_TIP)}
            onClick={() => useWatchStore.getState().playPinned({ kind: 'video', id: v.id }, v.title)}
          >
            {body}
          </button>
        ) : (
          <div className="ws-play" {...(reason ? tip(reason) : {})}>
            {body}
          </div>
        )}
        {plays ? (
          <button
            type="button"
            className="ws-add"
            aria-label={`Add ${v.title} to a playlist`}
            aria-haspopup="menu"
            aria-expanded={menu?.id === v.id}
            {...tip('Add to a playlist')}
            onClick={(e) => {
              const anchor = e.currentTarget;
              setMenu((m) => (m?.id === v.id ? null : { id: v.id, anchor }));
            }}
          >
            <IconPlaylistAdd size={20} aria-hidden="true" />
          </button>
        ) : null}
      </li>
    );
  };

  let body;
  if (!found || found.loading) body = <YtEmpty text="Searching YouTube" />;
  else if (found.problem) body = <YtState problem={found.problem} onRetry={() => void runWatchSearch(query)} />;
  else if (found.items.length === 0) body = <YtEmpty text="Nothing found. Try other words." />;
  else body = <ol className={`ws-${view}`}>{ordered.map(cell)}</ol>;

  const ready = !!found && !found.loading && !found.problem;
  return (
    <div className="ws" onKeyDown={onKeyDown}>
      <div className="ws-bar">
        <span className="ws-n" aria-live="polite">
          {ready ? videosLine(found.items.length) : found?.loading ? 'Searching' : ''}
        </span>
        <YtSortButton value={sort} onPick={pickWatchSort} labelled />
        <div className="ws-seg" role="group" aria-label="Results view">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" className={view === v.id ? 'on' : undefined} aria-pressed={view === v.id} aria-label={v.label} {...tip(v.label)} onClick={() => pickView(v.id)}>
              {v.icon}
            </button>
          ))}
        </div>
        <button type="button" className="ws-back" {...tip('Back to the watch list. The video keeps playing.')} onClick={resetWatchSearch}>
          ← Watch list
        </button>
      </div>
      <div ref={scroller} className={`ws-scroll${more ? ' more' : ''}`} tabIndex={0} role="region" aria-label="Search results" onScroll={check}>
        {body}
      </div>
      {menu && menuVideo && host ? <AddMenu video={ownVideo(menuVideo)} anchor={menu.anchor} host={host} limit={scroller.current} maxRows={4} onClose={() => setMenu(null)} /> : null}
      <div className="ws-foot">
        <span style={{ visibility: ready && more ? 'visible' : 'hidden' }}>Scroll for more</span>
        <span>{leftToday(left)}</span>
      </div>
    </div>
  );
}
