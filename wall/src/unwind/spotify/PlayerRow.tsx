import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { IconPlayerPauseFilled, IconPlayerPlayFilled, IconPlayerSkipBackFilled, IconPlayerSkipForwardFilled } from '@tabler/icons-react';
import { isQuiet } from '../../music/model';
import { playerName, sourceKey } from '../../music/players';
import { spotify, type SpotifyPlayback } from '../../music/spotify';
import { useNowPlaying } from '../../music/useNowPlaying';
import { tip } from '../../ui/HoverTip';
import { useVisible } from '../../ui/useVisible';
import { Cover } from './Cover';
import { problemLine, seekPosition, spotifyProblem, trackLength, useSpotifyNow } from './model';

/** Playback is read again this often while the player row shows and music plays (and whenever the song changes). */
export const PLAYBACK_POLL_MS = 20_000;
/** The arrow keys move the time bar this far. */
export const SEEK_STEP_MS = 5_000;
const NOTE_MS = 6_000;

interface Anchor {
  playback: SpotifyPlayback | null;
  /** `Date.now()` when it was read. */
  at: number;
}

/**
 * The player row at the foot of the tall view: the song's cover, title and artist, previous, play or
 * pause, next, and a time bar that can be dragged (or moved with the arrow keys) to seek. What plays
 * comes from Spotify (`playback`), with a local clock between reads. The three buttons go through
 * Windows' media keys like the player at the top, so they work while Spotify is the player Windows
 * has in front; otherwise they say so instead of doing nothing. Save to Liked is not here: the
 * sign-in does not ask Spotify for permission to change the library.
 */
export function PlayerRow() {
  const visible = useVisible();
  const { info, command } = useNowPlaying();
  const title = info?.title ?? '';
  const [anchor, setAnchor] = useState<Anchor>({ playback: null, at: 0 });
  const [now, setNow] = useState(() => Date.now());
  const [drag, setDrag] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const mounted = useRef(true);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const track = useRef<HTMLDivElement | null>(null);
  const later = useCallback((f: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      f();
    }, ms);
    timers.current.add(id);
  }, []);
  useEffect(() => {
    mounted.current = true;
    const set = timers.current;
    return () => {
      mounted.current = false;
      set.forEach(clearTimeout);
      set.clear();
    };
  }, []);

  const read = useCallback(() => {
    spotify.playback().then(
      (p) => {
        if (!mounted.current) return;
        setAnchor({ playback: p ?? null, at: Date.now() });
        setNow(Date.now());
        if (p?.track?.id) useSpotifyNow.setState({ id: p.track.id });
      },
      () => {
        // A failed read keeps what is shown, but not as live: the clock stops.
        if (mounted.current) setAnchor((a) => ({ playback: a.playback ? { ...a.playback, playing: false } : null, at: Date.now() }));
      },
    );
  }, []);
  useEffect(() => {
    if (!visible) return;
    read();
    const id = setInterval(read, PLAYBACK_POLL_MS);
    return () => clearInterval(id);
  }, [visible, title, read]);

  const pb = anchor.playback;
  const song = pb?.track ?? null;
  const duration = song?.durationMs ?? 0;
  const running = !!pb?.playing && duration > 0;
  // A one second clock only while a song plays and the page shows.
  useEffect(() => {
    if (!running || !visible) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running, visible]);
  const base = pb ? pb.progressMs + (running ? Math.max(0, now - anchor.at) : 0) : 0;
  const position = Math.min(duration, drag ?? base);
  const fraction = duration > 0 ? position / duration : 0;

  const fromWindows = !isQuiet(info) && playerName(sourceKey(info)) === 'Spotify';
  const canControl = fromWindows;
  const why = `Windows sends these keys to the player in front. ${pb?.device ? `Spotify plays on ${pb.device.name}` : 'Spotify is not the player in front'}.`;
  const playing = fromWindows ? info?.playback_status?.toLowerCase() === 'playing' : !!pb?.playing;
  const press = (name: 'media_previous' | 'media_play_pause' | 'media_next') => {
    if (!canControl) return;
    command(name);
    later(read, 800);
  };

  const fail = (e: unknown) => {
    if (!mounted.current) return;
    setNote(`Could not seek. ${problemLine(spotifyProblem(e))}`);
    later(() => setNote(null), NOTE_MS);
    read();
  };
  const commit = (ms: number) => {
    if (!song) return;
    const at = Math.min(duration, Math.max(0, ms));
    // The bar moves at once; a failure puts it back.
    setAnchor((a) => (a.playback ? { playback: { ...a.playback, progressMs: at }, at: Date.now() } : a));
    setNow(Date.now());
    spotify.seek(at).then(() => later(read, 800), fail);
  };
  const fractionAt = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = (track.current ?? e.currentTarget).getBoundingClientRect();
    return r.width > 0 ? (e.clientX - r.left) / r.width : 0;
  };
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!song || e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag(seekPosition(fractionAt(e), duration));
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag === null) return;
    setDrag(seekPosition(fractionAt(e), duration));
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag === null) return;
    const ms = seekPosition(fractionAt(e), duration);
    setDrag(null);
    commit(ms);
  };
  const key = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!song || e.ctrlKey || e.altKey || e.metaKey) return;
    const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? SEEK_STEP_MS : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -SEEK_STEP_MS : 0;
    if (step === 0 && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    commit(e.key === 'Home' ? 0 : e.key === 'End' ? duration : position + step);
  };

  const control = (name: string, label: string, run: () => void, big: boolean, icon: ReactNode) => (
    <button
      type="button"
      className={`sp-pl-btn${big ? ' big' : ''}${canControl ? '' : ' off'}`}
      aria-label={label}
      aria-disabled={!canControl}
      data-control={name}
      {...tip(() => (
        <div className="sp-tipline">
          <b>{label}</b>
          {canControl ? null : <span>{why}</span>}
        </div>
      ))}
      onClick={run}
    >
      {icon}
    </button>
  );

  return (
    <div className="sp-player" aria-label="Player">
      <Cover src={song ? song.thumbUrl ?? song.imageUrl : null} size={48} className="sp-pl-cover" />
      <span className="sp-pl-title">
        <b>{song ? song.name : 'Nothing playing'}</b>
        {note ? <small className="warn" role="status">{note}</small> : <small>{song ? song.artists : 'Press play on a song or a list.'}</small>}
      </span>
      {control('previous', 'Previous song', () => press('media_previous'), false, <IconPlayerSkipBackFilled size={18} aria-hidden="true" />)}
      {control('play', playing ? 'Pause' : 'Play', () => press('media_play_pause'), true, playing ? <IconPlayerPauseFilled size={20} aria-hidden="true" /> : <IconPlayerPlayFilled size={20} aria-hidden="true" />)}
      {control('next', 'Next song', () => press('media_next'), false, <IconPlayerSkipForwardFilled size={18} aria-hidden="true" />)}
      <span className="sp-pl-time">{song ? trackLength(position) : '0:00'}</span>
      <div
        ref={track}
        className={`sp-seek${song ? '' : ' off'}`}
        role="slider"
        tabIndex={song ? 0 : -1}
        aria-label="Time in the song"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration / 1000)}
        aria-valuenow={Math.round(position / 1000)}
        aria-valuetext={song ? `${trackLength(position)} of ${trackLength(duration)}` : 'Nothing playing'}
        aria-disabled={!song}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={key}
      >
        <i style={{ width: `${fraction * 100}%` }} />
        <u style={{ left: `${fraction * 100}%` }} />
      </div>
      <span className="sp-pl-time">{song ? trackLength(duration) : '0:00'}</span>
    </div>
  );
}
