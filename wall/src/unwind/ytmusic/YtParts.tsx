import { useState, type ReactNode } from 'react';
import { IconMusic, IconPlayerPlayFilled } from '@tabler/icons-react';
import type { YtVideo } from '../../music/youtube';
import { tip } from '../../ui/HoverTip';
import { useToolsStore } from '../../tools/store';
import { useWatchStore } from '../watch/store';
import { PlayingBars } from '../spotify/Tile';
import { failedReason, lengthText, problemAction, problemLine, rowTip, rowWords, safeThumb, type YtProblem } from './model';
import { failedWords, sameList, useYtQueue, validVideoId, type QueueFrom } from './queue';

/**
 * A picture from YouTube's picture host, or a neutral tile with a music note when there is none or it
 * fails to load. Sent without a referrer, drawn lazily, never a link.
 */
export function YtThumb({ src, className = '' }: { src: string | null; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const safe = safeThumb(src);
  const show = safe && failed !== safe;
  return (
    <span className={`sp-cover ${className}`}>
      {show ? <img src={safe} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(safe)} /> : <IconMusic size={36} stroke={1.5} aria-hidden="true" />}
    </span>
  );
}

/** One line and the one thing to do about it. */
export function YtState({ problem, onRetry, onBack }: { problem: YtProblem; onRetry: () => void; onBack?: () => void }) {
  const action = problemAction(problem);
  return (
    <div className="yt-state" role="status">
      <span>{problemLine(problem)}</span>
      {action === 'tools' ? (
        <button type="button" className="sp-btn" onClick={() => useToolsStore.getState().openDrawer('accounts')}>
          Open Tools
        </button>
      ) : action === 'retry' ? (
        <button type="button" className="sp-btn" onClick={onRetry}>
          Retry
        </button>
      ) : action === 'back' && onBack ? (
        <button type="button" className="sp-btn" onClick={onBack}>
          Back
        </button>
      ) : null}
    </div>
  );
}

/** A plain message in the same place (an empty list). */
export function YtEmpty({ text }: { text: string }) {
  return <div className="yt-state">{text}</div>;
}

/** Skeleton tiles while the first page is read: no spinner, no text. */
export function TileSkeletons({ count }: { count: number }) {
  return (
    <div className="yt-grid" aria-busy="true" data-skeleton="tiles">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="yt-skel-tile">
          <span className="yt-skel yt-skel-cover" />
          <span className="yt-skel yt-skel-line" />
          <span className="yt-skel yt-skel-line short" />
        </div>
      ))}
    </div>
  );
}

/** Skeleton rows while the first page of a list of videos is read. */
export function RowSkeletons({ count }: { count: number }) {
  return (
    <div className="yt-rows-skel" aria-busy="true" data-skeleton="rows">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="yt-skel-row">
          <span className="yt-skel yt-skel-num" />
          <span className="yt-skel yt-skel-title" />
          <span className="yt-skel yt-skel-chan" />
          <span className="yt-skel yt-skel-len" />
        </div>
      ))}
    </div>
  );
}

/**
 * The rows of a list of videos: number, title, channel, length. A row that plays outside YouTube is a
 * button (the play mark in place of its number on hover, Enter and Space as for any button) and plays the
 * list from that row on the wall; the row now playing (the queue's, same list, same place) is cyan with the
 * moving bars in place of its number (its number, in cyan, while paused). A row that will not play (it
 * plays only on YouTube, is private or removed, or failed this session) is greyed, with its words in the
 * length column, and is a plain `li`: no button, no click, and its hover card says why. Every row has a hover
 * card with the whole title, the channel, the length and what a click does.
 */
export function YtRows({ items, foot, list, onPlay }: { items: YtVideo[]; foot?: ReactNode; list?: QueueFrom; onPlay?: (index: number) => void }) {
  const failed = useYtQueue((s) => s.failed);
  const from = useYtQueue((s) => s.from);
  const entry = useYtQueue((s) => s.entries[s.pos]);
  const live = useWatchStore((s) => (s.source === 'music' ? (s.playing?.id ?? null) : null));
  const paused = useWatchStore((s) => s.paused || s.needsClick);
  const now = list && entry && live === entry.id && sameList(from, list) ? entry : null;
  return (
    <>
      <ol className="yt-list">
        {items.map((v, i) => {
          const gone = failed.get(v.id);
          // A row marked playable whose id does not have a video id's shape cannot be played: it is greyed, not a button that does nothing.
          const bad = v.playable === 'yes' && !validVideoId(v.id);
          const words = gone ? failedWords(gone) : bad ? 'Not available' : rowWords(v.playable);
          const plays = !words && !!onPlay && v.playable === 'yes';
          const on = now !== null && now.id === v.id && now.at === i;
          const lines = rowTip(v, gone ? failedReason(gone) : bad ? 'This video cannot be played here: YouTube gave it an address the wall cannot use.' : null);
          const cells = (
            <>
              <span className="yt-n">
                {on && !paused ? (
                  <PlayingBars />
                ) : (
                  <>
                    <span className="yt-num">{i + 1}</span>
                    {plays && !on ? <IconPlayerPlayFilled className="sp-hov" size={16} aria-hidden="true" /> : null}
                  </>
                )}
              </span>
              <span className="yt-title">{v.title}</span>
              <span className="yt-chan">{v.channel}</span>
              <span className="yt-len">{words ?? lengthText(v.seconds)}</span>
            </>
          );
          return (
            <li
              key={`${v.id}-${i}`}
              className={`yt-row${words ? ' off' : ''}${on ? ' on' : ''}`}
              data-playable={gone || bad ? 'no' : v.playable}
              {...tip(() => (
                <div className="sp-tipline">
                  <b>{lines[0]}</b>
                  {lines.slice(1).map((l, n) => (
                    <span key={n}>{l}</span>
                  ))}
                </div>
              ))}
            >
              {plays ? (
                <button type="button" className="yt-play yt-cells" aria-current={on ? 'true' : undefined} aria-label={`Play ${v.title}`} onClick={() => onPlay?.(i)}>
                  {cells}
                </button>
              ) : (
                <div className="yt-cells">{cells}</div>
              )}
            </li>
          );
        })}
      </ol>
      {foot}
    </>
  );
}
