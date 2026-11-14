import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { IconHeart, IconHeartFilled, IconPlayerPauseFilled, IconPlayerPlayFilled, IconPlayerSkipBackFilled, IconPlayerSkipForwardFilled } from '@tabler/icons-react';
import { isQuiet } from '../../music/model';
import { playerName, sourceKey } from '../../music/players';
import { spotify, type SpotifyPlayback } from '../../music/spotify';
import { useNowPlaying } from '../../music/useNowPlaying';
import { useToolsStore } from '../../tools/store';
import { tip } from '../../ui/HoverTip';
import { useVisible } from '../../ui/useVisible';
import { Cover } from './Cover';
import { problemLine, seekPosition, spotifyProblem, trackLength, useSpotifyNow } from './model';
import { readSpotifyStatus, useSpotifyStatus } from './status';

/** Playback is read again this often while the player row shows and music plays (and whenever the song changes). */
export const PLAYBACK_POLL_MS = 20_000;
/** The arrow keys move the time bar this far. */
export const SEEK_STEP_MS = 5_000;
/** A held arrow key sends at most one seek this often, and the final position when the key is let go. */
export const SEEK_KEY_GAP_MS = 300;
/** After a press Spotify's answer can lag: the state is read again this long after the first read. */
const AFTER_PRESS_MS = 800;
/** The local clock re-reads the state when a song's length is reached, then not again for this long. */
const END_READ_GAP_MS = 3_000;
const NOTE_MS = 6_000;

/** The line under the song when Spotify refuses a save or a removal. */
export const SAVE_FAILED_LINE = 'Could not save this song';
export const REMOVE_FAILED_LINE = 'Could not remove this song';
/** The note on the dim heart: the sign-in predates the permission to save songs. */
export const NEEDS_PERMISSION_LINE = 'Saving songs needs one more permission. Sign in to Spotify again in Tools.';

interface Anchor {
  playback: SpotifyPlayback | null;
  /** `Date.now()` when it was read. */
  at: number;
}

type Press = 'previous' | 'play' | 'next';

/**
 * The player row at the foot of the tall view: the song's cover, title and artist, previous, play or
 * pause, next, and a time bar that can be dragged (or moved with the arrow keys) to seek. What plays
 * comes from Spotify (`playback`), with a local clock between reads. While Spotify reports a player
 * (this PC, a phone, a speaker) the three buttons act on that player through Spotify's own commands, so
 * the row controls what it shows wherever the music plays; Windows' media keys are used only when Spotify
 * reports no player and the Windows session is Spotify on this PC. After a press, and when a song's
 * length is reached, the state is read again.
 *
 * The heart at the right end saves the playing song to Liked Songs and removes it again. Whether the
 * song is saved is read once per song (never on a timer); a click shows the change at once and puts it
 * back with one line if Spotify refuses. A song without an id (a podcast episode, a local file) and
 * nothing playing have no heart. A sign-in made before the permission to save was asked for leaves the
 * heart dim: a click explains and offers Tools, where signing in again fixes it with no restart.
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
  // A held arrow key: the position it has reached, when the last seek went out, and the timer for the next one.
  const keyPos = useRef<number | null>(null);
  const lastSeekAt = useRef(0);
  const keyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endReadAt = useRef(0);
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
      if (keyTimer.current) clearTimeout(keyTimer.current);
      keyTimer.current = null;
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
  // The song's length is reached (or a change made on a phone moved things): ask Spotify what plays now.
  useEffect(() => {
    if (!running || base < duration || Date.now() - endReadAt.current < END_READ_GAP_MS) return;
    endReadAt.current = Date.now();
    read();
  }, [running, base, duration, read]);

  // The heart: saved or not for the song that plays now, keyed by its id so another song's answer is never shown.
  const trackId = song?.id ?? null;
  const canSave = useSpotifyStatus((st) => st.status?.canSave === true);
  const [liked, setLiked] = useState<{ id: string; saved: boolean | null; failed: boolean } | null>(null);
  const [ask, setAsk] = useState(false);
  const heart = liked && liked.id === trackId ? liked : null;
  const saved = heart?.saved === true;
  const wrap = useRef<HTMLSpanElement | null>(null);
  const heartBtn = useRef<HTMLButtonElement | null>(null);
  // The id a click has already changed: a late read must not undo it. And whether a save call is out.
  const touched = useRef<string | null>(null);
  const saving = useRef(false);
  useEffect(() => {
    setAsk(false);
    touched.current = null;
    if (!trackId) return;
    let live = true;
    spotify.saved(trackId).then(
      (answer) => {
        if (!live) return;
        if (touched.current !== trackId) setLiked({ id: trackId, saved: answer, failed: false });
        // That call refreshed the token if it had to, so Spotify has now said which permissions the sign-in holds.
        if (useSpotifyStatus.getState().status?.canSave !== true) void readSpotifyStatus();
      },
      () => {
        if (live && touched.current !== trackId) setLiked({ id: trackId, saved: null, failed: true });
      },
    );
    return () => {
      live = false;
    };
  }, [trackId]);
  useEffect(() => {
    if (!ask) return;
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Node && !wrap.current?.contains(e.target)) setAsk(false);
    };
    // Escape closes the note first, the innermost thing: on the window in the capture phase, so the card's own Escape (which closes the tall view) does not also run.
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setAsk(false);
      heartBtn.current?.focus();
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', escape, true);
    };
  }, [ask]);
  const flip = (id: string) => {
    const before = heart;
    const on = !(before?.saved === true);
    touched.current = id;
    saving.current = true;
    setLiked({ id, saved: on, failed: false });
    spotify.save(id, on).then(
      () => {
        saving.current = false;
      },
      (e) => {
        saving.current = false;
        if (!mounted.current) return;
        // The heart goes back, unless the song has changed meanwhile (the new song has its own read).
        setLiked((cur) => (cur && cur.id === id ? before ?? { id, saved: null, failed: false } : cur));
        if (spotifyProblem(e) === 'needsSignIn') {
          useSpotifyStatus.setState((st) => ({ status: st.status ? { ...st.status, canSave: false } : st.status }));
          setAsk(true);
          return;
        }
        setNote(on ? SAVE_FAILED_LINE : REMOVE_FAILED_LINE);
        later(() => setNote(null), NOTE_MS);
      },
    );
  };
  const heartClick = () => {
    if (!trackId || saving.current) return;
    if (canSave) {
      flip(trackId);
      return;
    }
    // The sign-in may have been renewed since the status was read: ask again before explaining.
    spotify.status().then(
      (st) => {
        if (!mounted.current) return;
        if (st && typeof st === 'object') useSpotifyStatus.setState({ status: st, failed: false });
        if (st?.canSave) flip(trackId);
        else setAsk(true);
      },
      () => mounted.current && setAsk(true),
    );
  };
  const heartLabel = canSave ? (saved ? 'Remove from Liked Songs' : 'Save to Liked Songs') : 'Save to Liked Songs (needs a new sign-in)';

  const fromWindows = !isQuiet(info) && playerName(sourceKey(info)) === 'Spotify';
  // Spotify reports a player: its own commands, whichever device plays. None: Windows' keys, but only for Spotify on this PC.
  const viaSpotify = !!pb;
  const viaWindows = !pb && fromWindows;
  const canControl = viaSpotify || viaWindows;
  const why = 'Nothing is playing in Spotify.';
  const playing = viaSpotify ? !!pb?.playing : viaWindows ? info?.playback_status?.toLowerCase() === 'playing' : false;

  const failNote = (verb: string, e: unknown) => {
    if (!mounted.current) return;
    setNote(`Could not ${verb}. ${problemLine(spotifyProblem(e))}`);
    later(() => setNote(null), NOTE_MS);
    read();
  };
  const press = (name: Press) => {
    if (!canControl) return;
    if (viaWindows) {
      command(name === 'previous' ? 'media_previous' : name === 'next' ? 'media_next' : 'media_play_pause');
      later(read, AFTER_PRESS_MS);
      return;
    }
    const verb = name === 'previous' ? 'go back' : name === 'next' ? 'skip' : playing ? 'pause' : 'play';
    const run = name === 'previous' ? spotify.previous() : name === 'next' ? spotify.next() : playing ? spotify.pause() : spotify.resume();
    run.then(
      () => {
        if (!mounted.current) return;
        read();
        later(read, AFTER_PRESS_MS);
      },
      (e) => failNote(verb, e),
    );
  };

  const commit = (ms: number) => {
    if (!song) return;
    const at = Math.min(duration, Math.max(0, ms));
    // The bar moves at once; a failure puts it back.
    setAnchor((a) => (a.playback ? { playback: { ...a.playback, progressMs: at }, at: Date.now() } : a));
    setNow(Date.now());
    spotify.seek(at).then(() => later(read, AFTER_PRESS_MS), (e) => failNote('seek', e));
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
  // Arrow keys: the bar follows each repeat, but a seek goes out at most every 300 ms, and the final position when the key is let go.
  const sendKey = () => {
    if (keyTimer.current) clearTimeout(keyTimer.current);
    keyTimer.current = null;
    const at = keyPos.current;
    if (at === null) return;
    keyPos.current = null;
    lastSeekAt.current = Date.now();
    setDrag(null);
    commit(at);
  };
  const key = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!song || e.ctrlKey || e.altKey || e.metaKey) return;
    const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? SEEK_STEP_MS : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -SEEK_STEP_MS : 0;
    if (step === 0 && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? duration : (keyPos.current ?? position) + step;
    keyPos.current = Math.min(duration, Math.max(0, to));
    setDrag(keyPos.current);
    const wait = lastSeekAt.current + SEEK_KEY_GAP_MS - Date.now();
    if (wait <= 0) sendKey();
    else if (!keyTimer.current) keyTimer.current = setTimeout(sendKey, wait);
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
      {control('previous', 'Previous song', () => press('previous'), false, <IconPlayerSkipBackFilled size={18} aria-hidden="true" />)}
      {control('play', playing ? 'Pause' : 'Play', () => press('play'), true, playing ? <IconPlayerPauseFilled size={20} aria-hidden="true" /> : <IconPlayerPlayFilled size={20} aria-hidden="true" />)}
      {control('next', 'Next song', () => press('next'), false, <IconPlayerSkipForwardFilled size={18} aria-hidden="true" />)}
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
        onKeyUp={() => {
          if (keyPos.current !== null) sendKey();
        }}
      >
        <i style={{ width: `${fraction * 100}%` }} />
        <u style={{ left: `${fraction * 100}%` }} />
      </div>
      <span className="sp-pl-time">{song ? trackLength(duration) : '0:00'}</span>
      {trackId ? (
        <span className="sp-heart-wrap" ref={wrap}>
          <button
            ref={heartBtn}
            type="button"
            className={`sp-pl-btn sp-heart${canSave && saved ? ' on' : ''}${canSave ? '' : ' off'}`}
            aria-label={heartLabel}
            aria-pressed={canSave ? saved : undefined}
            data-control="heart"
            data-saved={saved ? 'true' : 'false'}
            {...tip(() => (
              <div className="sp-tipline">
                <b>{canSave ? (saved ? 'Remove from Liked Songs' : 'Save to Liked Songs') : 'Save to Liked Songs'}</b>
                {canSave ? heart?.failed ? <span>Could not check if it is saved.</span> : null : <span>Needs one more Spotify permission. Click to see how.</span>}
              </div>
            ))}
            onClick={heartClick}
          >
            {saved ? <IconHeartFilled size={18} aria-hidden="true" /> : <IconHeart size={18} aria-hidden="true" />}
          </button>
          {ask ? (
            <div className="sp-heart-ask" role="group" aria-label="Saving songs">
              <p>{NEEDS_PERMISSION_LINE}</p>
              <button
                type="button"
                className="sp-btn"
                onClick={() => {
                  setAsk(false);
                  useToolsStore.getState().openDrawer('accounts');
                }}
              >
                Open Tools
              </button>
            </div>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
