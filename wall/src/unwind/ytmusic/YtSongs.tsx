import { useEffect } from 'react';
import { IconArrowLeft } from '@tabler/icons-react';
import { tip } from '../../ui/HoverTip';
import { MAX_PAGES, PAGE_SIZE, nearEnd, readTime, videosLine } from './model';
import { closePlaylist, loadList, refreshSongs, retryMore, useYtLibrary } from './store';
import { RowSkeletons, YtEmpty, YtRows, YtState, YtThumb } from './YtParts';

/**
 * A playlist opened: Back, its picture, kicker, name and count, one real Refresh (it reads this
 * playlist from YouTube again) with the time it was last read, and its videos as rows, read 50 at
 * a time as the list scrolls. At rest it is the header row of Spotify's songs view with Refresh at
 * its right; tall, a left column of 248 and the rows on the right. The rows are not buttons: nothing
 * plays from here yet. Escape goes back (the card's own Escape leaves a `.sp-songs` view alone).
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
  if (!opened) return null;
  const capped = !!songs.next && songs.pages >= MAX_PAGES;
  const first = songs.items.length === 0;
  return (
    <div className={`sp-songs yt-songs${tall ? ' tall' : ''}`}>
      <div className="sp-shead">
        <span className="sp-backrow">
          <button type="button" className="sp-back" aria-label="Back to Playlists" title="Back to Playlists (Escape)" onClick={closePlaylist}>
            <IconArrowLeft size={20} stroke={2} aria-hidden="true" />
          </button>
          {tall ? <span className="sp-backlabel">Playlists</span> : null}
        </span>
        <YtThumb src={opened.thumb} className="yt-songthumb" />
        <span className="sp-text">
          <span className="sp-kick">Playlist</span>
          <span className="sp-name">{opened.title}</span>
          <span className="sp-line">{videosLine(opened.count)}</span>
        </span>
        <span className="yt-shactions">
          <button type="button" className="sp-btn plain yt-refresh" disabled={songs.loading} {...tip('Reads this playlist from YouTube again')} onClick={refreshSongs}>
            Refresh
          </button>
          {songs.readAt ? <span className="yt-readat">Read at {readTime(songs.readAt)}</span> : null}
        </span>
      </div>
      <div
        className="yt-scroll yt-rowscroll"
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
            foot={
              songs.problem ? (
                <YtState problem={songs.problem} onRetry={() => retryMore('songs')} onBack={closePlaylist} />
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
