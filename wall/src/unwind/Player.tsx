import { useEffect, useState } from 'react';
import {
  IconMusic,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerSkipBackFilled,
  IconPlayerSkipForwardFilled,
} from '@tabler/icons-react';
import { anchorProgress, formatTime, isPlaying, isQuiet, type NowPlayingInfo, type ProgressAnchor } from '../music/model';
import { useNowPlaying } from '../music/useNowPlaying';
import { useVisible } from '../ui/useVisible';
import { useLastPlayed } from './lastPlayed';
import { Volume } from './Volume';

/** Position and duration, advanced locally between polls while playing. Re-renders twice a second, only while visible. */
function useProgress(info: NowPlayingInfo | null, anchor: ProgressAnchor | null) {
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

/**
 * Now playing at concept size (`f_unwind` centre): 224 px art, the source app in pink
 * capitals, a 64 px title, the artist, a 520 px progress bar with times, then the
 * transport with the app's volume. When nothing plays it keeps the same footprint: the
 * last track this wall played with "Play again", or, before anything has played, a calm
 * line over the transport. Never a large empty tile.
 */
export function Player() {
  const { info, art, anchor, command } = useNowPlaying();
  const lastPlayed = useLastPlayed();
  const quiet = isQuiet(info);
  const progress = useProgress(quiet ? null : info, quiet ? null : anchor);
  const playing = isPlaying(info);
  const pct = progress ? (progress.position / progress.duration) * 100 : 0;

  // The idle view: the session's own stopped track first, then the last one seen here.
  const idle = quiet
    ? info?.title
      ? { title: info.title, artist: info.artist || info.album || '', source: info.source_app || '', art }
      : lastPlayed.last
        ? { ...lastPlayed.last, art: lastPlayed.art }
        : null
    : null;

  const transport = (
    <div className="u-transport">
      <button type="button" className="u-rd" aria-label="Previous" disabled={quiet} onClick={() => command('media_previous')}>
        <IconPlayerSkipBackFilled size={30} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="u-rd big"
        aria-label={playing ? 'Pause' : 'Play'}
        disabled={quiet && !idle}
        onClick={() => command('media_play_pause')}
      >
        {playing ? <IconPlayerPauseFilled size={40} aria-hidden="true" /> : <IconPlayerPlayFilled size={40} aria-hidden="true" />}
      </button>
      <button type="button" className="u-rd" aria-label="Next" disabled={quiet} onClick={() => command('media_next')}>
        <IconPlayerSkipForwardFilled size={30} aria-hidden="true" />
      </button>
      {!quiet && <Volume sourceApp={info?.source_app} />}
    </div>
  );

  if (quiet && !idle) {
    return (
      <div className="u-player quiet" data-state="empty">
        <div className="u-now u-calm">
          <span className="u-k">Quiet</span>
          <div className="u-np u-none">Nothing playing</div>
          <div className="u-artist">Start something in Spotify or YouTube Music and it shows here.</div>
        </div>
        {transport}
      </div>
    );
  }

  if (idle) {
    return (
      <div className="u-player quiet" data-state="idle">
        <div className="u-now">
          <div className="u-art dim">{idle.art ? <img src={idle.art} alt="" /> : <IconMusic size={72} stroke={1.25} aria-hidden="true" />}</div>
          <div className="u-meta">
            <span className="u-k">{idle.source ? `Last played on ${idle.source}` : 'Last played'}</span>
            <div className="u-np u-was u-ell">{idle.title}</div>
            <div className="u-artist u-ell">{idle.artist}</div>
            <button type="button" className="u-again" onClick={() => command('media_play_pause')}>
              <IconPlayerPlayFilled size={24} aria-hidden="true" />
              Play again
            </button>
          </div>
        </div>
        {transport}
      </div>
    );
  }

  return (
    <div className="u-player" data-state="playing">
      <div className="u-now">
        <div className="u-art">{art ? <img src={art} alt="" /> : <IconMusic size={72} stroke={1.25} aria-hidden="true" />}</div>
        <div className="u-meta">
          {info?.source_app ? <span className="u-k u-src">{info.source_app}</span> : null}
          <div className="u-np u-ell">{info?.title || 'Unknown title'}</div>
          <div className="u-artist u-ell">{info?.artist || info?.album || ''}</div>
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
      </div>
      {transport}
    </div>
  );
}
