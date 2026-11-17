import { useEffect, useRef, useState } from 'react';
import { IconArrowLeft, IconArrowsShuffle, IconBrandYoutube, IconPlayerPlayFilled } from '@tabler/icons-react';
import { tip } from '../../ui/HoverTip';
import { openInBrowser } from '../watch/openInBrowser';
import { MAX_PAGES, PAGE_SIZE, nearEnd, readTime, videosLine } from './model';
import { playAll, playFrom, queueable, useYtQueue, type QueueFrom } from './queue';
import { closePlaylist, loadList, refreshSongs, retryList, useYtLibrary } from './store';
import { RowSkeletons, YtEmpty, YtRows, YtState, YtThumb } from './YtParts';

/**
 * A playlist opened: Back, its picture, kicker, name and count, one real Refresh (it reads this
 * playlist from YouTube again) and its videos as rows, read 50 at a time as the list scrolls. Play and
 * Shuffle start the wall's queue (see `queue.ts`) from the first playable row or in a random order; a row
 * starts it from that row. At rest it is the header row of Spotify's songs view with Play, Shuffle and
 * Refresh at its right (when it was last read is in Refresh's hover card); tall, a left column of 248 (Play
 * and Shuffle under the facts, then Refresh and the time it was last read) and the rows on the right.
 * Escape goes back (the card's own Escape leaves a `.sp-songs` view alone).
 */
export function YtSongs({ tall }: { tall: boolean }) {
  const opened = useYtLibrary((s) => s.opened);
  const songs = useYtLibrary((s) => s.songs);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePlaylist();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  const failed = useYtQueue((s) => s.failed);
  const [openFailed, setOpenFailed] = useState(false);
  const failTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (failTimer.current !== null) clearTimeout(failTimer.current);
  }, []);
  if (!opened) return null;
  const list: QueueFrom = { list: 'songs', playlistId: opened.id };
  const readable = songs.items.some((v) => queueable(v, failed));
  const NONE = 'None of these videos plays outside YouTube';
  const capped = !!songs.next && songs.pages >= MAX_PAGES;
  const first = songs.items.length === 0;
  return (
    <div className={`sp-songs yt-songs${tall ? ' tall' : ''}`}>
      <div className="sp-shead">
        <span className="sp-backrow">
          <button type="button" className="sp-back" aria-label="Back to Playlists" title="Back to Playlists (Escape)" onClick={closePlaylist}>
            <IconArrowLeft size={20} stroke={2} aria-hidden="true" />
          </button>
          {tall ? (
            <button type="button" className="sp-backlabel" title="Back to Playlists" onClick={closePlaylist}>
              Playlists
            </button>
          ) : null}
        </span>
        <YtThumb src={opened.thumb} className="yt-songthumb" />
        <span className="sp-text">
          <span className="sp-kick">Playlist</span>
          <span className="sp-name">{opened.title}</span>
          <span className="sp-line">{videosLine(opened.count)}</span>
        </span>
        <span className="yt-shactions">
          <span className="yt-playbtns">
            <button type="button" className="sp-btn fill big yt-playall" aria-disabled={!readable} data-disabled={readable ? undefined : ''} {...tip(readable ? 'Play this playlist on the wall, sound only' : NONE)} onClick={() => readable && playAll(songs.items, false, list)}>
              <IconPlayerPlayFilled size={18} aria-hidden="true" />
              Play
            </button>
            <button type="button" className="sp-btn plain big yt-shuffle" aria-disabled={!readable} data-disabled={readable ? undefined : ''} {...tip(readable ? 'Play it in a random order' : NONE)} onClick={() => readable && playAll(songs.items, true, list)}>
              <IconArrowsShuffle size={18} aria-hidden="true" />
              Shuffle
            </button>
          </span>
          <span className="yt-refreshrow">
            <button
              type="button"
              className="sp-btn plain yt-refresh"
              disabled={songs.loading}
              {...tip(tall || !songs.readAt ? 'Reads this playlist from YouTube again' : `Reads this playlist from YouTube again. Last read at ${readTime(songs.readAt)}`)}
              onClick={refreshSongs}
            >
              Refresh
            </button>
            {tall && songs.readAt ? <span className="yt-readat">Read at {readTime(songs.readAt)}</span> : null}
            <button
              type="button"
              className="u-rd sm yt-openyt"
              aria-label="Open in YouTube"
              {...tip(openFailed ? 'Could not open the browser' : 'Open in YouTube')}
              onClick={() => {
                setOpenFailed(false);
                // The id passes the same check as everywhere (`validRef`) before the wall asks for the link; the default browser opens it.
                void openInBrowser({ kind: 'playlist', id: opened.id }).then((ok) => {
                  if (!ok) {
                    setOpenFailed(true);
                    if (failTimer.current !== null) clearTimeout(failTimer.current);
                    failTimer.current = setTimeout(() => setOpenFailed(false), 5000);
                  }
                });
              }}
            >
              <IconBrandYoutube size={22} stroke={1.8} aria-hidden="true" />
            </button>
          </span>
        </span>
      </div>
      <div
        className="yt-scroll yt-rowscroll"
        tabIndex={0}
        role="region"
        aria-label={`Videos in ${opened.title}`}
        onScroll={(e) => {
          if (songs.next && !songs.loading && !songs.problem && nearEnd(e)) void loadList('songs', true);
        }}
      >
        {songs.problem && first ? (
          <YtState problem={songs.problem} onRetry={() => void loadList('songs')} onBack={closePlaylist} />
        ) : !songs.loaded && first ? (
          <RowSkeletons count={9} />
        ) : songs.loaded && first && !songs.loading ? (
          <YtEmpty text="No videos in this playlist." />
        ) : first ? (
          <RowSkeletons count={9} />
        ) : (
          <YtRows
            items={songs.items}
            list={list}
            onPlay={(i) => playFrom(songs.items, i, list)}
            foot={
              songs.problem ? (
                <YtState problem={songs.problem} onRetry={() => retryList('songs')} onBack={closePlaylist} />
              ) : capped ? (
                <div className="yt-cap">Showing the first {(MAX_PAGES * PAGE_SIZE).toLocaleString('en-US')}</div>
              ) : null
            }
          />
        )}
      </div>
    </div>
  );
}
