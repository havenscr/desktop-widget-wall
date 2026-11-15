import { tip } from '../../ui/HoverTip';
import { UP_NEXT_ROWS } from '../spotify/UpNext';
import { jump, upcoming, useQueueActive, useYtQueue } from './queue';
import { lengthText } from './model';
import { YtThumb } from './YtParts';

/**
 * Up next while the wall's music plays: the next entries of the queue after the one now on, in the same
 * place and with the same markup and classes as the Spotify side's (`UpNext.tsx`): a 48 px picture, the
 * title and the channel. A click plays that entry (it is `jump`: the entries before it are skipped, none is
 * removed); hover has the whole title, the channel and the length. Nothing when the music is not the wall's
 * or no entry is left.
 */
export function YtUpNext({ rows = UP_NEXT_ROWS }: { rows?: number } = {}) {
  const active = useQueueActive();
  const entries = useYtQueue((s) => s.entries);
  const pos = useYtQueue((s) => s.pos);
  const failed = useYtQueue((s) => s.failed);
  if (!active) return null;
  const next = upcoming({ entries, pos, failed }, rows);
  if (next.length === 0) return null;
  return (
    <div className="u-next" aria-label="Up next">
      <span className="u-k">Up next</span>
      <ol className="u-next-list">
        {next.map(({ entry, index }) => (
          <li key={`${entry.id}-${index}`}>
            <button
              type="button"
              className="u-next-row"
              {...tip(() => (
                <div className="sp-tipline">
                  <b>{entry.title}</b>
                  <span>{[entry.channel, lengthText(entry.seconds)].filter(Boolean).join(' · ')}</span>
                </div>
              ))}
              onClick={() => jump(index)}
            >
              <YtThumb src={entry.thumb} className="yt-upcover" />
              <span className="u-next-t">{entry.title}</span>
              <span className="u-next-a">{entry.channel}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
