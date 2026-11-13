import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import {
  IconExternalLink,
  IconMovie,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerSkipBackFilled,
  IconPlayerSkipForwardFilled,
  IconPlayerStopFilled,
  IconSettings,
  IconVolume,
  IconVolumeOff,
} from '@tabler/icons-react';
import { invoke } from '../../bridge/tauri';
import { sun } from '../../horizon/renderer';
import { reviewNow } from '../../ui/reviewClock';
import { useSignalStore } from '../../signals/store';
import { tip } from '../../ui/HoverTip';
import { kindName, refKey, validRef, type WatchKind, type WatchRef } from './links';
import { LOOKS, lookFor, lookTargetName, type LookId } from './looks';
import { PlayerFrame, playerLink } from './PlayerFrame';
import { driveInAudience, useWatchStore } from './store';
import { useStopRules } from './useStopRules';

export const WATCH_PANEL_ID = 'u-panel-watch';
export const WATCH_TAB_ID = 'u-tab-watch';

/** How long "Could not open the browser" stays in the control row. */
export const OPEN_ERROR_MS = 5000;

/** The Open button's label for this kind. */
export function openLabel(kind: WatchKind): string {
  return kind === 'twitch' ? 'Open on Twitch' : 'Open in YouTube';
}

/**
 * Ask the wall to open this item on its own site; the kind and id are checked here and again
 * in Rust, which builds the normal watch address. A video may also pass the whole seconds the
 * player last reported (`at`), which Rust checks and formats. Nothing else is ever sent.
 */
export async function openInBrowser(ref: WatchRef, at?: number | null): Promise<boolean> {
  if (!validRef({ kind: ref.kind, id: ref.id })) return false;
  const t = ref.kind === 'video' && typeof at === 'number' && Number.isFinite(at) ? Math.floor(at) : 0;
  try {
    await invoke('wall2_watch_open', t > 0 ? { kind: ref.kind, id: ref.id, at: t } : { kind: ref.kind, id: ref.id });
    return true;
  } catch {
    return false;
  }
}

/** The gear beside the tabs: opens the settings sheet for how video is shown. */
export function WatchGear() {
  const open = useWatchStore((s) => s.sheet);
  return (
    <button
      type="button"
      className={`w-gear${open ? ' on' : ''}`}
      aria-label="How video is shown"
      title="How video is shown"
      aria-expanded={open}
      aria-haspopup="dialog"
      onClick={() => useWatchStore.getState().setSheet(!open)}
    >
      <IconSettings size={26} aria-hidden="true" />
    </button>
  );
}

/** The horizon draws its moon only with the stars out; the sun this far down is a safe stand-in. */
export const MOON_SUN_ALT = -4;

/** True while the horizon's moon is up (checked once a minute). */
function useMoonUp(): boolean {
  const read = () => sun(reviewNow ? reviewNow() : Date.now()).alt < MOON_SUN_ALT;
  const [up, setUp] = useState(read);
  useEffect(() => {
    const id = setInterval(() => setUp(read()), 60_000);
    return () => clearInterval(id);
  }, []);
  return up;
}

/** "1:05" or "1:02:03". */
export function clock(sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * The Look switch: the four looks in one segmented control, always in the same place under the
 * left block (never on the video), whether or not something plays. With one look for
 * everything it sets that look; with a look per kind it sets the look of the kind on (or, with
 * nothing on, of the first saved item), and its hover tip says which. Arrow keys move.
 */
export function LookSwitch({ kind }: { kind: WatchKind }) {
  const looks = useWatchStore((s) => s.looks);
  const current = lookFor(looks, kind);
  const group = lookTargetName(looks, kind);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const pick = (id: LookId) => useWatchStore.getState().pickLook(id);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = LOOKS.findIndex((l) => l.id === current);
    const next = LOOKS[(i + step + LOOKS.length) % LOOKS.length].id;
    pick(next);
    refs.current[LOOKS.findIndex((l) => l.id === next)]?.focus();
  };
  const where = group ? `Sets the look for ${group.toLowerCase()} (a look per kind is on in the settings).` : 'Sets the look for every video.';
  return (
    <div className="w-lookbar w-seg" role="radiogroup" aria-label={group ? `Look, for ${group.toLowerCase()}` : 'Look'} onKeyDown={onKey}>
      {LOOKS.map((l, i) => {
        const on = l.id === current;
        return (
          <button
            key={l.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={on ? 'on' : ''}
            {...tip(`${l.name}: ${l.hint} ${where}`)}
            onClick={() => pick(l.id)}
          >
            {l.name}
          </button>
        );
      })}
    </div>
  );
}

/** The position: elapsed, a thin bar (a click seeks) and the length; "Live" for a stream with no length. */
function Position({ live }: { live: boolean }) {
  const time = useWatchStore((s) => s.report.time);
  const duration = useWatchStore((s) => s.report.duration);
  if (time === null) return null;
  if (live || !duration) {
    return (
      <span className="w-live" {...tip('A live stream: it has no length to show.')}>
        Live
      </span>
    );
  }
  const frac = Math.min(1, time / duration);
  const seek = (e: MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (!box.width) return;
    const at = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) * duration;
    if (playerLink.send('seekTo', [Math.floor(at), true])) useWatchStore.getState().setReport({ time: Math.floor(at) });
  };
  const nudge = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.key === 'ArrowRight' ? 10 : e.key === 'ArrowLeft' ? -10 : 0;
    if (!d) return;
    e.preventDefault();
    const at = Math.min(duration, Math.max(0, time + d));
    if (playerLink.send('seekTo', [at, true])) useWatchStore.getState().setReport({ time: at });
  };
  return (
    <>
      <span className="w-t">{clock(time)}</span>
      <div
        className="w-bar"
        role="slider"
        tabIndex={0}
        aria-label="Position"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={time}
        aria-valuetext={`${clock(time)} of ${clock(duration)}`}
        {...tip('Click to jump there; arrow keys move 10 seconds.')}
        onClick={seek}
        onKeyDown={nudge}
      >
        <b style={{ width: `${(frac * 100).toFixed(2)}%` }} />
      </div>
      <span className="w-t">{clock(duration)}</span>
    </>
  );
}

/**
 * The wall's own controls for the video on (the player's own are hidden): previous and next
 * (a playlist the player reports), play or pause, mute, stop, and Open in YouTube (or on
 * Twitch); under them the position, or the line asking for a click when autoplay was refused.
 * Twitch offers no messages to a frame, so only Stop and Open show for it.
 */
function Controls({ item }: { item: WatchRef & { label: string } }) {
  const paused = useWatchStore((s) => s.paused);
  const muted = useWatchStore((s) => s.muted);
  const count = useWatchStore((s) => s.report.count);
  const index = useWatchStore((s) => s.report.index);
  const needsClick = useWatchStore((s) => s.needsClick);
  const st = useWatchStore.getState();
  const youtube = item.kind !== 'twitch';
  const list = item.kind === 'playlist' && count > 1;
  const [openFailed, setOpenFailed] = useState(false);
  const failTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(failTimer.current), []);
  const open = async () => {
    clearTimeout(failTimer.current);
    setOpenFailed(false);
    if (!(await openInBrowser(item, useWatchStore.getState().report.time))) {
      setOpenFailed(true);
      failTimer.current = setTimeout(() => setOpenFailed(false), OPEN_ERROR_MS);
    }
  };
  const label = openLabel(item.kind);
  const listTip = list ? `Item ${index + 1} of ${count}` : 'Only for a playlist';
  let line = null;
  if (openFailed)
    line = (
      <span className="w-open-fail" role="alert">
        Could not open the browser
      </span>
    );
  else if (needsClick)
    line = (
      <span className="w-clickline" role="status">
        {youtube ? 'Click the video to start' : 'Not started? Click the video'}
      </span>
    );
  else if (youtube) line = <Position live={item.kind === 'live'} />;
  return (
    <>
      <div className="w-ctl">
        {youtube ? (
          <>
            <button type="button" className="rd" aria-label="Previous" disabled={!list} {...tip(list ? `Previous. ${listTip}` : 'Previous: only for a playlist')} onClick={() => playerLink.send('previousVideo')}>
              <IconPlayerSkipBackFilled size={20} aria-hidden="true" />
            </button>
            <button type="button" className="rd big" aria-label={paused ? 'Play' : 'Pause'} {...tip(paused ? 'Play' : 'Pause')} onClick={() => st.setPaused(!paused)}>
              {paused ? <IconPlayerPlayFilled size={22} aria-hidden="true" /> : <IconPlayerPauseFilled size={22} aria-hidden="true" />}
            </button>
            <button type="button" className="rd" aria-label="Next" disabled={!list} {...tip(list ? `Next. ${listTip}` : 'Next: only for a playlist')} onClick={() => playerLink.send('nextVideo')}>
              <IconPlayerSkipForwardFilled size={20} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="rd"
              aria-label={muted ? 'Sound on' : 'Mute'}
              aria-pressed={muted}
              {...tip(muted ? 'Sound on (the player plays at full volume; the system volume sets the level)' : 'Mute the video')}
              onClick={() => st.setMuted(!muted)}
            >
              {muted ? <IconVolumeOff size={20} aria-hidden="true" /> : <IconVolume size={20} aria-hidden="true" />}
            </button>
          </>
        ) : null}
        <button type="button" className={`rd${youtube ? '' : ' big'}`} aria-label="Stop" {...tip('Stop and remove the video')} onClick={() => st.stop()}>
          <IconPlayerStopFilled size={20} aria-hidden="true" />
        </button>
        <button type="button" className="w-open" {...tip(`Opens this ${kindName(item.kind).toLowerCase()} on its own site in your web browser`)} onClick={() => void open()}>
          <IconExternalLink size={18} aria-hidden="true" />
          {label}
        </button>
      </div>
      <div className="w-time">{line}</div>
    </>
  );
}

/**
 * The video in the scene, in its look. Nothing of the wall's is drawn on the video: the Look
 * switch and every control sit in the left block. Glows, the floor's light and the drive-in's
 * frame and posts sit around the picture, never over it.
 */
function VideoStage({ item, look }: { item: WatchRef & { label: string }; look: LookId }) {
  const moonUp = useMoonUp();
  const audience = useWatchStore(driveInAudience);
  const sky = look === 'sky';
  return (
    <>
      <div className={`w-stage w-${look}`} data-look={look} data-audience={audience ? `${audience.x},${audience.y},${audience.w},${audience.h}` : undefined}>
        {look === 'feather' ? <div className="w-glow" aria-hidden="true" /> : null}
        {look === 'sun' ? <div className="w-halo" aria-hidden="true" /> : null}
        {/* The moon sits behind the feathered picture: its disc is dimmed where the soft edge would let it through.
            The sun's disc and the drive-in screen cover the moon whole, and the whole sky is not see-through. */}
        {look === 'feather' && moonUp ? <div className="w-moonveil" aria-hidden="true" /> : null}
        {look === 'drivein' ? <div className="w-spill" aria-hidden="true" /> : null}
        {look === 'sun' ? <div className="w-streak" aria-hidden="true" /> : null}
        <div className="w-screen">
          <PlayerFrame key={refKey(item)} item={item} title={item.label} />
        </div>
        {/* Whole sky: a dark wash behind the text on the left, over the picture. */}
        {sky ? <div className="w-scrim" aria-hidden="true" /> : null}
        {look === 'drivein' ? (
          <>
            <i className="w-post l" aria-hidden="true" />
            <i className="w-post r" aria-hidden="true" />
          </>
        ) : null}
      </div>
      {/* The floor picks up a faint wash of the sky's colour (approved page, B). One frame cannot be
          mirrored, so this is a still colour wash in the page's light colours, taking no pointer. */}
      {sky ? <div className="w-skyspill" aria-hidden="true" /> : null}
    </>
  );
}

/**
 * The Watch tab's centre: what is on (kind, label, the wall's own controls and the position)
 * on the left under the tabs, the Look switch in its fixed place under that, and the video
 * placed in the scene to its right in the chosen look. With nothing on it says what to do
 * and offers the first saved item. The stop rules run while this is mounted.
 */
export function WatchPanel() {
  useStopRules();
  const playing = useWatchStore((s) => s.playing);
  const saved = useWatchStore((s) => s.saved);
  const looks = useWatchStore((s) => s.looks);
  const paused = useWatchStore((s) => s.paused);
  const needsClick = useWatchStore((s) => s.needsClick);
  const stopped = useWatchStore((s) => s.stopped);
  const inCall = useSignalStore((s) => s.call !== null);
  const st = useWatchStore.getState();

  if (!playing) {
    const first = saved[0];
    const kind = first?.kind ?? 'video';
    return (
      <div className="w-panel" role="tabpanel" id={WATCH_PANEL_ID} aria-labelledby={WATCH_TAB_ID} data-state="idle">
        <div className="w-now">
          <span className="u-k">Watch</span>
          <div className="w-title w-none">Nothing on</div>
          <div className="w-sub">
            {stopped ? `${stopped} ` : ''}
            {first ? 'Pick something from your list, or paste another link there.' : 'Paste a YouTube or Twitch link into the list on the right to save it here.'}
          </div>
          {first ? (
            <button
              type="button"
              className="u-again w-start"
              disabled={inCall}
              title={inCall ? 'Video waits until the call ends' : `Play ${first.label}`}
              onClick={() => st.play(first)}
            >
              <IconPlayerPlayFilled size={24} aria-hidden="true" />
              <span className="u-ell">Play {first.label}</span>
            </button>
          ) : null}
        </div>
        <LookSwitch kind={kind} />
        {lookFor(looks, kind) === 'drivein' ? (
          <div className="w-stage w-drivein w-empty" data-look="drivein" aria-hidden="true">
            <div className="w-screen">
              <IconMovie size={64} stroke={1.25} />
              <span>Nothing on the screen</span>
            </div>
            <i className="w-post l" />
            <i className="w-post r" />
          </div>
        ) : null}
      </div>
    );
  }

  const look = lookFor(looks, playing.kind);
  const youtube = playing.kind !== 'twitch';
  return (
    <div className="w-panel" role="tabpanel" id={WATCH_PANEL_ID} aria-labelledby={WATCH_TAB_ID} data-state="playing">
      <div className="w-now">
        <span className="u-k u-src">{kindName(playing.kind)}</span>
        <div className="w-title" title={playing.label}>
          {playing.label}
        </div>
        <div className="w-sub" title="It stops by itself when you leave Watch or Unwind, the screens or the display go off, Windows locks or a call starts.">
          {needsClick ? 'Waiting for a click on the video' : youtube ? (paused ? 'Paused' : 'Playing on the wall') : 'Live on the wall'}
        </div>
        <Controls item={playing} />
      </div>
      <LookSwitch kind={playing.kind} />
      <VideoStage item={playing} look={look} />
    </div>
  );
}
