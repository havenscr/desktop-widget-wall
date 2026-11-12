import { useEffect, useState } from 'react';
import { IconMusic, IconPlayerPauseFilled, IconPlayerPlayFilled, IconPlayerSkipBackFilled, IconPlayerSkipForwardFilled } from '@tabler/icons-react';
import { anchorProgress, formatTime, isPlaying, isQuiet, type ProgressAnchor } from '../music/model';
import { useNowPlaying } from '../music/useNowPlaying';
import { ScreensOff } from '../ui/ScreensOff';
import { useVisible } from '../ui/useVisible';

/** Position and duration, advanced locally between polls while playing. Re-renders twice a second, only while visible. */
function useProgress(info: ReturnType<typeof useNowPlaying>['info'], anchor: ProgressAnchor | null) {
  const visible = useVisible();
  const [now, setNow] = useState(() => Date.now());
  const running = visible && isPlaying(info);
  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [running, anchor]);
  return anchorProgress(anchor, now);
}

/** The Unwind tab: a large now-playing view. The moon, ripple and Watt are drawn elsewhere (horizon, buddy). Clock is in App. */
export function Unwind() {
  const { info, art, anchor, command } = useNowPlaying();
  const quiet = isQuiet(info);
  const progress = useProgress(quiet ? null : info, quiet ? null : anchor);
  const playing = isPlaying(info);
  const pct = progress ? (progress.position / progress.duration) * 100 : 0;
  return (
    <section className={`unwind${quiet ? ' quiet' : ''}`} data-place="unwind" aria-label="Unwind">
      <div className="u-art">
        {!quiet && art ? <img src={art} alt="" /> : <IconMusic size={72} stroke={1.25} aria-hidden="true" />}
      </div>
      <div className="u-text">
        {quiet ? (
          <div className="u-none">Nothing playing</div>
        ) : (
          <>
            {info?.source_app ? <div className="u-src">{info.source_app}</div> : null}
            <div className="u-title ellipsis">{info?.title || 'Unknown title'}</div>
            <div className="u-artist ellipsis">{info?.artist || info?.album || ''}</div>
          </>
        )}
        {progress && (
          <div className="u-progress">
            <div
              className="u-bar"
              role="progressbar"
              aria-label="Track position"
              aria-valuemin={0}
              aria-valuemax={Math.round(progress.duration)}
              aria-valuenow={Math.round(progress.position)}
            >
              <i style={{ width: `${pct.toFixed(2)}%` }} />
            </div>
            <div className="u-times">
              <span>{formatTime(progress.position)}</span>
              <span>{formatTime(progress.duration)}</span>
            </div>
          </div>
        )}
      </div>
      <div className="u-btns">
        <button type="button" className="u-rd" aria-label="Previous" disabled={quiet} onClick={() => command('media_previous')}>
          <IconPlayerSkipBackFilled size={40} aria-hidden="true" />
        </button>
        <button type="button" className="u-rd big" aria-label={playing ? 'Pause' : 'Play'} disabled={quiet} onClick={() => command('media_play_pause')}>
          {playing ? <IconPlayerPauseFilled size={46} aria-hidden="true" /> : <IconPlayerPlayFilled size={46} aria-hidden="true" />}
        </button>
        <button type="button" className="u-rd" aria-label="Next" disabled={quiet} onClick={() => command('media_next')}>
          <IconPlayerSkipForwardFilled size={40} aria-hidden="true" />
        </button>
      </div>
      <ScreensOff className="u-off" />
    </section>
  );
}
