import { useEffect, type ReactNode } from 'react';
import { tip } from '../../ui/HoverTip';
import { useToolsStore } from '../../tools/store';
import { HINT_TIP, hintFor, sideMode } from './model';
import { readYoutubeStatus, useYoutubeStatus, useYoutubeStatusPoll } from './status';
import { resetLibrary } from './store';
import { AUTOPLAY_LINE, useMusicView, useYtQueue } from './queue';
import { YtBrowse } from './YtBrowse';
import { StartOnWatch, YtFoot } from './YtFoot';

/**
 * The YouTube side of the music card. Set up and signed in, it is the library (the owner's
 * playlists, his liked videos and a music search, read through YouTube's data service with the
 * read-only sign-in). Otherwise it is today's remote (`remote`: what Windows plays and three
 * buttons), unchanged, with one line and one button under it saying what to do. The status is read
 * every minute while this side shows, and again whenever the Tools drawer closes. A pick plays on the wall
 * (see `queue.ts`); tall, the foot player under the library shows and drives whatever the wall's player holds.
 */
export function YtMusicSide({ tall, remote }: { tall: boolean; remote: ReactNode }) {
  useYoutubeStatusPoll();
  const status = useYoutubeStatus((s) => s.status);
  const failed = useYoutubeStatus((s) => s.failed);
  const mode = sideMode(status, failed);
  // Signed out, a new setup or a refused one: nothing of the old library is kept.
  useEffect(() => {
    if (mode !== 'library' && mode !== 'checking' && mode !== 'unreadable') resetLibrary();
  }, [mode]);
  if (mode === 'library') {
    return (
      <>
        <YtBrowse tall={tall} />
        {tall ? <YtFoot /> : null}
        <YtNote tall={tall} />
      </>
    );
  }
  const hint = hintFor(mode);
  return (
    <>
      {remote}
      {hint ? (
        <div className="yt-hint" {...tip(HINT_TIP)}>
          <span className="yt-hint-text">{hint.text}</span>
          {hint.action === 'tools' ? (
            <button type="button" className="sp-btn" onClick={() => useToolsStore.getState().openDrawer('accounts')}>
              Open Tools
            </button>
          ) : (
            <button type="button" className="sp-btn" onClick={() => void readYoutubeStatus()}>
              Retry
            </button>
          )}
        </div>
      ) : null}
    </>
  );
}

/**
 * The one quiet line inside the card: a skipped video, the stop after five, or (at rest, where there is no foot
 * player) autoplay refused with the button that goes to Watch. It sits at the foot of the card at rest and just above
 * the foot player when tall, and goes after 8 seconds or at the next play (the queue clears it).
 */
function YtNote({ tall }: { tall: boolean }) {
  const note = useYtQueue((s) => s.note);
  const view = useMusicView();
  if (!tall && view?.needsClick) {
    return (
      <div className="yt-note ask" role="status">
        <span>{AUTOPLAY_LINE}</span>
        <StartOnWatch />
      </div>
    );
  }
  if (!note) return null;
  return (
    <div className="yt-note" role="status">
      {note}
    </div>
  );
}
