import { useState, type ReactNode } from 'react';
import { IconMusic } from '@tabler/icons-react';
import type { YtVideo } from '../../music/youtube';
import { tip } from '../../ui/HoverTip';
import { useToolsStore } from '../../tools/store';
import { lengthText, problemAction, problemLine, rowTip, rowWords, safeThumb, type YtProblem } from './model';

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
 * The rows of a list of videos: number, title, channel, length. Not buttons: nothing plays from
 * here yet, so a row has no click, no pointer cursor and no play mark, only a hover card with the
 * whole title, the channel, the length and, for a greyed row, why. A row that will not play outside
 * YouTube is greyed and its length says so.
 */
export function YtRows({ items, foot }: { items: YtVideo[]; foot?: ReactNode }) {
  return (
    <>
      <ol className="yt-list">
        {items.map((v, i) => {
          const words = rowWords(v.playable);
          const lines = rowTip(v);
          return (
            <li
              key={`${v.id}-${i}`}
              className={`yt-row${words ? ' off' : ''}`}
              data-playable={v.playable}
              {...tip(() => (
                <div className="sp-tipline">
                  <b>{lines[0]}</b>
                  {lines.slice(1).map((l) => (
                    <span key={l}>{l}</span>
                  ))}
                </div>
              ))}
            >
              <span className="yt-n">{i + 1}</span>
              <span className="yt-title">{v.title}</span>
              <span className="yt-chan">{v.channel}</span>
              <span className="yt-len">{words ?? lengthText(v.seconds)}</span>
            </li>
          );
        })}
      </ol>
      {foot}
    </>
  );
}
