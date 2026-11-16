import { useEffect, useRef } from 'react';
import { IconArrowsShuffle, IconChevronLeft, IconPencil, IconPlayerPlayFilled, IconRepeat } from '@tabler/icons-react';
import { tip } from '../../ui/HoverTip';
import { useYtQueue } from '../ytmusic/queue';
import { useOwnLists } from './ownLists';
import { jump, setFollow, type OwnView } from './ownPlay';
import { lengthText, useFadeBelow } from './OwnParts';

/**
 * The card while a playlist made on the wall plays: the playing playlist with the video on in cyan, a click on any
 * other video plays it, and the two switches (shuffle and repeat, kept on the playlist). The back arrow returns to the
 * Watch list and playback goes on; Stop and the end return to it too. The list keeps the playing row in sight when the
 * video changes, never while the pointer is in it.
 */
export function OwnFollow({ view }: { view: OwnView }) {
  const items = useOwnLists((s) => s.lists[view.listId]?.items ?? []);
  const failed = useYtQueue((s) => s.failed);
  const box = useRef<HTMLDivElement>(null);
  const inside = useRef(false);
  const own = useOwnLists.getState();
  const fade = useFadeBelow(box, items.length);

  const showPlaying = () => box.current?.querySelector<HTMLElement>('[data-playing="true"]')?.scrollIntoView?.({ block: 'nearest' });
  // The playing row is kept in sight when the video changes, never while the pointer is in the list; once the pointer leaves, it is brought into sight.
  useEffect(() => {
    if (inside.current) return;
    showPlaying();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.videoId]);

  return (
    <div className="own-wrap">
      <div className="own-head">
        <button type="button" className="own-back" aria-label="Back to the Watch list" {...tip('Back to the Watch list. It plays on.')} onClick={() => setFollow(false)}>
          <IconChevronLeft size={20} aria-hidden="true" />
        </button>
        <span className="own-name u-ell" {...tip(view.name)}>
          {view.name}
        </span>
        <span className="own-sub" {...(view.shuffle ? tip('In the shuffled order') : {})}>
          {view.place} of {view.count}
        </span>
        <span className="own-right">
          <button
            type="button"
            className={`w-own-switch${view.shuffle ? ' on' : ''}`}
            aria-label="Shuffle"
            aria-pressed={view.shuffle}
            {...tip(view.shuffle ? 'Shuffle is on' : 'Shuffle: off')}
            onClick={() => own.setShuffle(view.listId, !view.shuffle)}
          >
            <IconArrowsShuffle size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`w-own-switch${view.repeat ? ' on' : ''}`}
            aria-label="Repeat"
            aria-pressed={view.repeat}
            {...tip(view.repeat ? 'Repeat is on' : 'Repeat: off')}
            onClick={() => own.setRepeat(view.listId, !view.repeat)}
          >
            <IconRepeat size={18} aria-hidden="true" />
          </button>
        </span>
      </div>
      <div className={`own-vlist fade own-five${fade.more ? ' more' : ''}`} role="list" ref={box} onScroll={fade.check} onPointerEnter={() => void (inside.current = true)} onPointerLeave={() => {
          inside.current = false;
          showPlaying();
        }}>
        {items.map((v, i) => {
          const on = v.id === view.videoId;
          const bad = failed.get(v.id);
          const title = v.title ?? 'YouTube video';
          const words = bad === 'embed' ? 'Plays only on YouTube' : bad === 'removed' ? 'No longer on YouTube' : null;
          return (
            <div key={v.id} role="listitem">
              <button
                type="button"
                className={`own-v one${on ? ' on' : ''}${bad ? ' bad' : ''}`}
                data-playing={on}
                aria-current={on || undefined}
                aria-disabled={bad ? true : undefined}
                {...tip(on ? 'Playing now' : bad ? `${title}: ${words}` : 'Play this one now')}
                onClick={() => (on || bad ? undefined : jump(v.id))}
              >
                <span className="own-i">{on ? <IconPlayerPlayFilled size={14} aria-hidden="true" /> : i + 1}</span>
                <span className="own-t">
                  {title}
                  {words ? <em>{words}</em> : null}
                </span>
                {v.seconds !== undefined && !bad ? <span className="own-len">{lengthText(v.seconds)}</span> : null}
              </button>
            </div>
          );
        })}
      </div>
      <div className="own-foot">
        <span className="own-foot-t u-ell">{view.repeat ? 'Repeat is on: it starts again after the last video' : 'Stops after the last video'}</span>
        <button type="button" className="own-btn quiet" {...tip(`Edit ${view.name}`)} onClick={() => own.setOpen(view.listId)}>
          <IconPencil size={16} aria-hidden="true" />
          Edit
        </button>
      </div>
    </div>
  );
}
