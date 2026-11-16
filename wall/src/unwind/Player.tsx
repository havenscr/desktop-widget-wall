import { useEffect, useState } from 'react';
import {
  IconMusic,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerSkipBackFilled,
  IconPlayerSkipForwardFilled,
} from '@tabler/icons-react';
import { anchorProgress, formatTime, isPlaying, isQuiet, type NowPlayingInfo, type ProgressAnchor } from '../music/model';
import { isKnownPlayer, playerName, sourceKey } from '../music/players';
import { rejectArt } from '../music/store';
import { useSkyKeepClear } from '../horizon/sky';
import { useNowPlaying } from '../music/useNowPlaying';
import { useVisible } from '../ui/useVisible';
import { useLastPlayed } from './lastPlayed';
import { useWatchStore } from './watch/store';
import { AUTOPLAY_LINE, musicControls, next as queueNext, playAgain, previous as queuePrevious, useMusicView, type MusicView } from './ytmusic/queue';
import { StartOnWatch } from './ytmusic/YtFoot';
import { safeThumb } from './ytmusic/model';

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
 * The idle view's cover could not be decoded: drop it from the store (`rejectArt`, a no-op
 * when the store holds none) and from the remembered last track, so the placeholder tile
 * shows instead of a broken image.
 */
function dropIdleArt(src: string | null): void {
  rejectArt();
  if (src && useLastPlayed.getState().art === src) useLastPlayed.setState({ art: null });
}

/**
 * The album art's small "Video" corner button: shown only when something is saved to watch,
 * it switches Unwind to the Watch tab. Nothing else on Listen changes.
 */
function VideoCorner() {
  const count = useWatchStore((s) => s.saved.length);
  if (count === 0) return null;
  return (
    <button
      type="button"
      className="u-video"
      title={`Watch instead: ${count} saved to watch`}
      onClick={() => useWatchStore.getState().setTab('watch')}
    >
      Video
    </button>
  );
}

/**
 * Now playing as the owner chose it (7A, "cover on top, controls in the sky"): the 224 px
 * cover at the top of the centre, the source app in pink capitals, a 64 px title and the
 * artist beside it, then one row right under them: previous, play, next, the position with
 * its times, and the app's volume. Everything ends above the dancing lines. When nothing
 * plays it keeps the same footprint: the last track this wall played with "Play again" in
 * the row (or "Open Spotify to play again" when no media session exists, since play and
 * pause need one), or, before anything has played, a calm line over dim buttons.
 */
export function Player() {
  const { info, art, anchor, command } = useNowPlaying();
  const lastPlayed = useLastPlayed();
  const quiet = isQuiet(info);
  const progress = useProgress(quiet ? null : info, quiet ? null : anchor);
  const playing = isPlaying(info);
  // A media session exists (stopped or paused counts); with none, play and pause do nothing.
  const hasSession = !!info && !!info.playback_status && info.playback_status !== 'unknown';
  const pct = progress ? (progress.position / progress.duration) * 100 : 0;
  const source = sourceKey(info);
  const rawSourceLabel = playerName(source);
  const watchPlaying = useWatchStore((s) => s.playing);
  const watchStopped = useWatchStore((s) => s.lastStopped);
  const webView = rawSourceLabel?.toLowerCase() === 'msedgewebview2';
  const watchTitle = (value: string | null | undefined) => value?.trim().replace(/ - YouTube$/i, '').trim();
  const sessionTitle = watchTitle(info?.title);
  // The wall's own video is the web view by name, or any session whose title is what Watch plays
  // (or last stopped) under an id that is not a known player: the web view's id changes by build.
  const ownVideo = webView || (source !== null && !isKnownPlayer(source));
  const watchMatch = !!sessionTitle && ownVideo && [watchPlaying, watchStopped].some((item) => watchTitle(item?.label) === sessionTitle);
  const sourceLabel = watchMatch ? 'Watch' : webView ? 'an app on this PC' : rawSourceLabel;
  // The horizon's moon keeps 40 px clear of the player (it moves to another of its places).
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  useSkyKeepClear('listen-player', box);

  // The idle view: the session's own stopped track first, then the last one seen here.
  const idle = quiet
    ? info?.title
      ? { title: info.title, artist: info.artist || info.album || '', source: sourceLabel ?? '', art }
      : lastPlayed.last
        ? { ...lastPlayed.last, art: lastPlayed.art }
        : null
    : null;

  // The wall's own music (a pick from the YouTube library) is drawn from the stores, not from Windows: while it plays when
  // Windows names it (or offers no playing session), and, stopped or ended, when nothing else was played since. Spotify or
  // another app playing at the same time keeps today's rule (the Windows session shows).
  const music = useMusicView();
  const lastOwn = !lastPlayed.last || lastPlayed.last.source.toLowerCase() === 'msedgewebview2' || [music?.entry.title, music?.title].some((t) => !!t && watchTitle(lastPlayed.last?.title) === watchTitle(t));
  const ownMusic = music !== null && (music.state === 'playing' || music.state === 'paused' ? quiet || watchMatch : quiet && lastOwn);
  if (ownMusic && music) return <MusicPlayer music={music} setBox={setBox} />;

  const progressBar = progress ? (
    <div className="u-progress">
      <span className="u-t">{formatTime(progress.position)}</span>
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
      <span className="u-t">{formatTime(progress.duration)}</span>
    </div>
  ) : null;

  // The idle row's own words beside the buttons: Play again, or why play cannot start here.
  const again = watchMatch ? (
    <button type="button" className="u-again" onClick={() => useWatchStore.getState().setTab('watch')}>
      Back to Watch
    </button>
  ) : idle ? (
    hasSession ? (
      <button type="button" className="u-again" onClick={() => command('media_play_pause')}>
        <IconPlayerPlayFilled size={22} aria-hidden="true" />
        Play again
      </button>
    ) : (
      <div className="u-again-off">{idle.source ? `Open ${idle.source} to play again` : 'Open the player to play again'}</div>
    )
  ) : quiet ? (
    <div className="u-again-off">Play picks up where you stopped</div>
  ) : null;

  const transport = (
    <div className="u-transport">
      <button type="button" className="u-rd" aria-label="Previous" disabled={quiet} onClick={() => command('media_previous')}>
        <IconPlayerSkipBackFilled size={30} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="u-rd big"
        aria-label={playing ? 'Pause' : 'Play'}
        disabled={quiet && !(idle && hasSession)}
        onClick={() => command('media_play_pause')}
      >
        {playing ? <IconPlayerPauseFilled size={40} aria-hidden="true" /> : <IconPlayerPlayFilled size={40} aria-hidden="true" />}
      </button>
      <button type="button" className="u-rd" aria-label="Next" disabled={quiet} onClick={() => command('media_next')}>
        <IconPlayerSkipForwardFilled size={30} aria-hidden="true" />
      </button>
      {progressBar}
      {again}
    </div>
  );

  if (quiet && !idle) {
    return (
      <div ref={setBox} className="u-player quiet" data-state="empty">
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
      <div ref={setBox} className="u-player quiet" data-state="idle">
        <div className="u-now">
          <div className="u-art dim">
            {idle.art ? <img src={idle.art} alt="" onError={() => dropIdleArt(idle.art)} /> : <IconMusic size={72} stroke={1.25} aria-hidden="true" />}
            <VideoCorner />
          </div>
          <div className="u-meta">
            <span className="u-k">{watchMatch ? 'Last played in Watch' : idle.source ? `Last played on ${idle.source}` : 'Last played'}</span>
            <div className="u-np u-was u-ell">{idle.title}</div>
            <div className="u-artist u-ell">{idle.artist}</div>
            {transport}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={setBox} className="u-player" data-state="playing">
      <div className="u-now">
        <div className="u-art">
          {art ? <img src={art} alt="" onError={rejectArt} /> : <IconMusic size={72} stroke={1.25} aria-hidden="true" />}
          <VideoCorner />
        </div>
        <div className="u-meta">
          {sourceLabel ? <span className="u-k u-src">{watchMatch ? 'Playing in Watch' : sourceLabel}</span> : null}
          <div className="u-np u-ell">{info?.title || 'Unknown title'}</div>
          <div className="u-artist u-ell">{info?.artist || info?.album || ''}</div>
          {transport}
        </div>
      </div>
    </div>
  );
}

/**
 * The top player for the wall's own music: kicker "YouTube, on the wall", the title and channel, the picture of the
 * pick, the time bar from the frame's once-a-second report, and previous, play or pause and next that drive the
 * queue (not Windows' media keys). Stopped or ended with the queue kept it says "Last played on the wall" with
 * "Play again". Autoplay refused: one line and a button to Watch. No volume here: the slider under the clock is the
 * wall's video level.
 */
function MusicPlayer({ music, setBox }: { music: MusicView; setBox: (el: HTMLDivElement | null) => void }) {
  const live = music.state === 'playing' || music.state === 'paused';
  const dur = music.duration ?? 0;
  const pos = Math.min(dur, music.time ?? 0);
  const art = safeThumb(music.thumb);
  const [failed, setFailed] = useState<string | null>(null);
  const showArt = art && failed !== art;
  const toggle = () => (live ? musicControls.togglePause() : playAgain());
  const bar =
    live && dur > 0 ? (
      <div className="u-progress">
        <span className="u-t">{formatTime(pos)}</span>
        <div className="u-bar" role="progressbar" aria-label="Track position" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(pos)}>
          <i style={{ width: `${((pos / dur) * 100).toFixed(2)}%` }} />
        </div>
        <span className="u-t">{formatTime(dur)}</span>
      </div>
    ) : null;
  const transport = (
    <div className="u-transport">
      <button type="button" className="u-rd" aria-label="Previous" disabled={!live} onClick={queuePrevious}>
        <IconPlayerSkipBackFilled size={30} aria-hidden="true" />
      </button>
      <button type="button" className="u-rd big" aria-label={music.state === 'playing' ? 'Pause' : 'Play'} onClick={toggle}>
        {music.state === 'playing' ? <IconPlayerPauseFilled size={40} aria-hidden="true" /> : <IconPlayerPlayFilled size={40} aria-hidden="true" />}
      </button>
      <button type="button" className="u-rd" aria-label="Next" disabled={!live || !music.hasNext} onClick={queueNext}>
        <IconPlayerSkipForwardFilled size={30} aria-hidden="true" />
      </button>
      {bar}
      {music.needsClick ? (
        <>
          <span className="u-again-off">{AUTOPLAY_LINE}</span>
          <StartOnWatch />
        </>
      ) : !live ? (
        <button type="button" className="u-again" onClick={playAgain}>
          <IconPlayerPlayFilled size={22} aria-hidden="true" />
          Play again
        </button>
      ) : null}
    </div>
  );
  return (
    <div ref={setBox} className={`u-player${live ? '' : ' quiet'}`} data-state={live ? 'playing' : 'idle'} data-wall-music="true">
      <div className="u-now">
        <div className={`u-art${live ? '' : ' dim'}`}>
          {showArt ? <img src={art} alt="" referrerPolicy="no-referrer" onError={() => setFailed(art)} /> : <IconMusic size={72} stroke={1.25} aria-hidden="true" />}
          <VideoCorner />
        </div>
        <div className="u-meta">
          <span className="u-k u-src">{live ? 'YouTube, on the wall' : 'Last played on the wall'}</span>
          <div className={`u-np u-ell${live ? '' : ' u-was'}`}>{music.title}</div>
          <div className="u-artist u-ell">{music.channel}</div>
          {transport}
        </div>
      </div>
    </div>
  );
}
