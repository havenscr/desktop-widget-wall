import { IconMusic, IconPlayerPauseFilled, IconPlayerPlayFilled, IconPlayerSkipBackFilled, IconPlayerSkipForwardFilled } from '@tabler/icons-react';
import { tip } from '../ui/HoverTip';
import { isPlaying, isQuiet } from './model';
import { rejectArt } from './store';
import { useNowPlaying } from './useNowPlaying';

export function MusicBar() {
  const { info, art, command } = useNowPlaying();
  const quiet = isQuiet(info);
  return (
    <section className={`panel music${quiet ? ' quiet' : ''}`} aria-label="Music">
      <div className="art">
        {!quiet && art ? <img src={art} alt="" onError={rejectArt} /> : <IconMusic size={32} stroke={1.5} aria-hidden="true" />}
      </div>
      <div className="music-text">
        {quiet ? (
          <div className="s">Nothing playing</div>
        ) : (
          <>
            <div className="b6 ellipsis">{info?.title || 'Unknown title'}</div>
            <div className="xs ellipsis">{info?.artist || info?.album || ''}</div>
          </>
        )}
      </div>
      <div className="music-btns">
        <button type="button" className="rd" aria-label="Previous" disabled={quiet} onClick={() => command('media_previous')}>
          <IconPlayerSkipBackFilled size={28} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="rd big"
          aria-label={isPlaying(info) ? 'Pause' : 'Play'}
          disabled={quiet}
          onClick={() => command('media_play_pause')}
        >
          {isPlaying(info) ? <IconPlayerPauseFilled size={34} aria-hidden="true" /> : <IconPlayerPlayFilled size={34} aria-hidden="true" />}
        </button>
        <button type="button" className="rd" aria-label="Next" disabled={quiet} onClick={() => command('media_next')}>
          <IconPlayerSkipForwardFilled size={28} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

/**
 * The Work left wing's now playing row (concept `f_work`): art, title, artist and Previous,
 * Play or Pause, Next, always shown, all disabled when nothing plays. A long title is cut
 * with an ellipsis and carries its full text on hover; the buttons never shrink or wrap.
 */
export function MusicMini() {
  const { info, art, command } = useNowPlaying();
  const quiet = isQuiet(info);
  const title = info?.title || 'Unknown title';
  const sub = info?.artist || info?.album || '';
  return (
    <section className={`music-mini${quiet ? ' quiet' : ''}`} aria-label="Music">
      <div className="art">
        {!quiet && art ? <img src={art} alt="" onError={rejectArt} /> : <IconMusic size={26} stroke={1.5} aria-hidden="true" />}
      </div>
      <div className="music-mini-text">
        {quiet ? (
          <div className="s">Nothing playing</div>
        ) : (
          <>
            <div className="b6 ellipsis" {...tip(sub ? `${title}, ${sub}` : title)}>
              {title}
            </div>
            <div className="xs ellipsis">{sub}</div>
          </>
        )}
      </div>
      <div className="music-mini-btns">
        <button type="button" className="rd" aria-label="Previous" disabled={quiet} onClick={() => command('media_previous')}>
          <IconPlayerSkipBackFilled size={26} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="rd"
          aria-label={isPlaying(info) ? 'Pause' : 'Play'}
          disabled={quiet}
          onClick={() => command('media_play_pause')}
        >
          {isPlaying(info) ? <IconPlayerPauseFilled size={26} aria-hidden="true" /> : <IconPlayerPlayFilled size={26} aria-hidden="true" />}
        </button>
        <button type="button" className="rd" aria-label="Next" disabled={quiet} onClick={() => command('media_next')}>
          <IconPlayerSkipForwardFilled size={26} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
