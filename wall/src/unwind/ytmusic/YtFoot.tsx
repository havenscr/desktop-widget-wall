import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { IconPlayerPauseFilled, IconPlayerPlayFilled, IconPlayerSkipBackFilled, IconPlayerSkipForwardFilled } from '@tabler/icons-react';
import { usePlaceStore } from '../../state/places';
import { tip } from '../../ui/HoverTip';
import { formatTime } from '../../music/model';
import { kindName } from '../watch/links';
import { playerLink } from '../watch/PlayerFrame';
import { useWatchStore } from '../watch/store';
import { seekPosition } from '../spotify/model';
import { AUTOPLAY_LINE, musicControls, next, previous, useMusicView } from './queue';
import { YtThumb } from './YtParts';

/** The arrow keys move the time bar this many seconds. */
export const FOOT_SEEK_STEP_S = 5;
/** A held arrow key sends at most one seek this often, and the last position when the key is let go. */
export const FOOT_SEEK_GAP_MS = 300;

export const EMPTY_TITLE = 'Nothing playing on the wall';
export const EMPTY_LINE = 'Pick a video to play it here';

/**
 * The foot of the tall YouTube view: a player for whatever the wall's one player holds (the Watch store),
 * as the Spotify side has its own. The wall's music (a pick from this library) has the queue's previous
 * and next; a Watch video has its title and play or pause, and previous and next only for a YouTube playlist;
 * a Twitch stream has its title only (it takes just Stop, on Watch). The time bar reads the frame's own
 * once-a-second report (no timer here) and seeks with `seekTo`, by drag or by the arrow keys (a held key sends
 * one seek every 300 ms and the last on release). When autoplay was refused for the music, the bar gives way to
 * one line and a button that goes to Watch, where one click on the picture starts it.
 */
export function YtFoot() {
  const view = useMusicView();
  const playing = useWatchStore((s) => s.playing);
  const source = useWatchStore((s) => s.source);
  const paused = useWatchStore((s) => s.paused);
  const report = useWatchStore((s) => s.report);
  const needsClick = useWatchStore((s) => s.needsClick);
  const music = view && view.state !== 'stopped' ? view : null;
  const watchItem = !music && source === 'watch' && playing ? playing : null;
  const twitch = watchItem?.kind === 'twitch';
  const playlist = watchItem?.kind === 'playlist' && report.count > 1;
  const on = !!music || !!watchItem;
  const ended = !!report.ended && on;

  const title = music ? music.title : watchItem ? (report.title ?? watchItem.label) : EMPTY_TITLE;
  const line = music ? music.channel : watchItem ? (report.channel ?? kindName(watchItem.kind)) : EMPTY_LINE;
  const thumb = music ? music.thumb : null;
  const time = on && !twitch ? report.time : null;
  const duration = on && !twitch ? report.duration : null;
  const seekable = on && !twitch && !needsClick && duration !== null && duration > 0;
  const shownPaused = paused || ended;

  const showPlay = shownPaused || !(music || (watchItem && !twitch));
  const controls = {
    previous: music ? { ok: true, tip: music.place > 1 && (time ?? 0) <= 3 ? 'Previous in the list' : 'Back to the start of this video', run: previous } : playlist ? { ok: true, tip: `Previous. Item ${report.index + 1} of ${report.count}`, run: () => void playerLink.send('previousVideo') } : { ok: false, tip: twitch ? 'Twitch takes only Stop, on Watch' : watchItem ? 'Only for a playlist' : EMPTY_TITLE, run: () => undefined },
    play: music || (watchItem && !twitch) ? { ok: true, tip: showPlay ? 'Play' : 'Pause', run: () => musicControls.togglePause() } : { ok: false, tip: twitch ? 'Twitch takes only Stop, on Watch' : EMPTY_TITLE, run: () => undefined },
    next: music ? { ok: music.hasNext, tip: music.hasNext ? 'Next in the list' : 'This is the last video in the list', run: next } : playlist ? { ok: true, tip: `Next. Item ${report.index + 1} of ${report.count}`, run: () => void playerLink.send('nextVideo') } : { ok: false, tip: twitch ? 'Twitch takes only Stop, on Watch' : watchItem ? 'Only for a playlist' : EMPTY_TITLE, run: () => undefined },
  };

  // Seeking: a drag or the arrow keys. The bar follows at once; a seek goes out on release, and a held key sends at most one every 300 ms.
  const [drag, setDrag] = useState<number | null>(null);
  const track = useRef<HTMLDivElement | null>(null);
  const keyPos = useRef<number | null>(null);
  const lastSeekAt = useRef(0);
  const keyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (keyTimer.current) clearTimeout(keyTimer.current);
      keyTimer.current = null;
    },
    [],
  );
  // Another item in the frame (Next, a pick, a Watch play): a seek still waiting belongs to the old one and is dropped, with the
  // pending position, the drag and the throttle's anchor, so it can never land on the new video.
  const itemKey = playing ? `${playing.kind}:${playing.id}` : '';
  useEffect(() => {
    if (keyTimer.current) clearTimeout(keyTimer.current);
    keyTimer.current = null;
    keyPos.current = null;
    lastSeekAt.current = 0;
    setDrag(null);
  }, [itemKey]);
  const total = duration ?? 0;
  const position = Math.min(total, Math.max(0, drag ?? time ?? 0));
  const fraction = total > 0 ? position / total : 0;
  const commit = (seconds: number) => {
    musicControls.seek(Math.min(total, Math.max(0, seconds)));
  };
  const fractionAt = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = (track.current ?? e.currentTarget).getBoundingClientRect();
    return r.width > 0 ? (e.clientX - r.left) / r.width : 0;
  };
  const secondsAt = (e: ReactPointerEvent<HTMLDivElement>) => seekPosition(fractionAt(e), total * 1000) / 1000;
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!seekable || e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag(secondsAt(e));
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag !== null) setDrag(secondsAt(e));
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag === null) return;
    const at = secondsAt(e);
    setDrag(null);
    commit(at);
  };
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
    if (!seekable || e.ctrlKey || e.altKey || e.metaKey) return;
    const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? FOOT_SEEK_STEP_S : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -FOOT_SEEK_STEP_S : 0;
    if (step === 0 && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? total : (keyPos.current ?? position) + step;
    keyPos.current = Math.min(total, Math.max(0, to));
    setDrag(keyPos.current);
    const wait = lastSeekAt.current + FOOT_SEEK_GAP_MS - Date.now();
    if (wait <= 0) sendKey();
    else if (!keyTimer.current) keyTimer.current = setTimeout(sendKey, wait);
  };

  const button = (name: 'previous' | 'play' | 'next', label: string, big: boolean, icon: ReactNode) => {
    const c = controls[name];
    return (
      <button
        type="button"
        className={`sp-pl-btn yt-fbtn yt-f${name}${big ? ' big' : ''}${c.ok ? '' : ' off'}`}
        aria-label={label}
        aria-disabled={!c.ok}
        data-control={name}
        {...tip(() => (
          <div className="sp-tipline">
            <b>{c.ok ? label : c.tip}</b>
            {c.ok && c.tip !== label ? <span>{c.tip}</span> : null}
          </div>
        ))}
        onClick={() => c.ok && c.run()}
      >
        {icon}
      </button>
    );
  };

  const clock = (s: number | null) => (s === null ? '0:00' : formatTime(s));
  return (
    <div className="sp-player yt-foot" aria-label="Player on the wall" data-state={music ? 'music' : watchItem ? 'watch' : 'none'}>
      <YtThumb src={thumb} className="sp-pl-cover yt-fcover" />
      <span className="sp-pl-title yt-ftitle">
        <b>{title}</b>
        <small>{line}</small>
      </span>
      {button('previous', 'Previous', false, <IconPlayerSkipBackFilled size={18} aria-hidden="true" />)}
      {button('play', showPlay ? 'Play' : 'Pause', true, showPlay ? <IconPlayerPlayFilled size={20} aria-hidden="true" /> : <IconPlayerPauseFilled size={20} aria-hidden="true" />)}
      {button('next', 'Next', false, <IconPlayerSkipForwardFilled size={18} aria-hidden="true" />)}
      {music && needsClick ? (
        <>
          <span className="yt-fask" role="status">
            {AUTOPLAY_LINE}
          </span>
          <StartOnWatch />
        </>
      ) : (
        <>
          <span className="sp-pl-time yt-ftime">{clock(on && !twitch ? position : null)}</span>
          <div
            ref={track}
            className={`sp-seek yt-fseek${seekable ? '' : ' off'}`}
            role="slider"
            tabIndex={seekable ? 0 : -1}
            aria-label="Time in the video"
            aria-valuemin={0}
            aria-valuemax={Math.round(total)}
            aria-valuenow={Math.round(position)}
            aria-valuetext={seekable ? `${clock(position)} of ${clock(total)}` : on ? 'Not seekable' : EMPTY_TITLE}
            aria-disabled={!seekable}
            {...(seekable ? tip(() => <div className="sp-tipline"><b>Drag to move in the video</b><span>or use the arrow keys</span></div>) : {})}
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
          <span className="sp-pl-time yt-ftime">{on && !twitch ? (total > 0 ? clock(total) : report.duration === 0 && on ? 'Live' : '0:00') : '0:00'}</span>
        </>
      )}
    </div>
  );
}

/** Autoplay was refused: show the video on Watch, where the stage is in sight and one click on it starts it. */
export function StartOnWatch() {
  return (
    <button
      type="button"
      className="sp-btn yt-startwatch"
      {...tip('Shows the video on Watch, where one click on it starts it')}
      onClick={() => {
        usePlaceStore.getState().setActive('unwind');
        useWatchStore.getState().setTab('watch');
      }}
    >
      Start it on Watch
    </button>
  );
}
