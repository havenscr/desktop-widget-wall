import { useCallback, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
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
import { useSkyKeepClear } from '../../horizon/sky';
import { useSignalStore } from '../../signals/store';
import { useToolsStore } from '../../tools/store';
import { tip } from '../../ui/HoverTip';
import { kindName, validRef, type WatchKind, type WatchRef } from './links';
import { LOOKS, lookFor, lookTargetName, type LookId } from './looks';
import { playerLink } from './PlayerFrame';
import { useWatchSky } from './StageLayer';
import { useWatchStore } from './store';

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

/** The drive-in screen with nothing on it (the drive-in look, nothing playing). */
function EmptyDriveIn() {
  useWatchSky('drivein', null, false);
  return (
    <div className="w-stage w-drivein w-empty" data-look="drivein" aria-hidden="true">
      <div className="w-screen">
        <IconMovie size={64} stroke={1.25} />
        <span>Nothing on the screen</span>
      </div>
      <i className="w-post l" />
      <i className="w-post r" />
    </div>
  );
}

/** watch behaviour: the handlers a block that wakes the faded controls takes (`useControlsFade`). */
interface ZoneHandlers {
  onPointerEnter: () => void;
  onPointerLeave: (e: PointerEvent<HTMLElement>) => void;
  onFocus: (e: FocusEvent<HTMLElement>) => void;
  onBlur: (e: FocusEvent<HTMLElement>) => void;
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
export function LookSwitch({ kind, zone }: { kind: WatchKind; zone?: ZoneHandlers }) {
  const looks = useWatchStore((s) => s.looks);
  const current = lookFor(looks, kind);
  const group = lookTargetName(looks, kind);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  // sky layers: the moon keeps clear of the switch.
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  useSkyKeepClear('watch-look', bar);
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
    <div ref={setBar} className="w-lookbar w-seg" role="radiogroup" aria-label={group ? `Look, for ${group.toLowerCase()}` : 'Look'} onKeyDown={onKey} {...zone}>
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
function Controls({ item, openFailed, setOpenFailed }: { item: WatchRef & { label: string }; openFailed: boolean; setOpenFailed: (on: boolean) => void }) {
  const paused = useWatchStore((s) => s.paused);
  const muted = useWatchStore((s) => s.muted);
  const count = useWatchStore((s) => s.report.count);
  const index = useWatchStore((s) => s.report.index);
  const needsClick = useWatchStore((s) => s.needsClick);
  const clickHint = useWatchStore((s) => s.clickHint);
  const st = useWatchStore.getState();
  const youtube = item.kind !== 'twitch';
  const list = item.kind === 'playlist' && count > 1;
  const failTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(
    () => () => {
      clearTimeout(failTimer.current);
      setOpenFailed(false);
    },
    [setOpenFailed],
  );
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
  else if (youtube && needsClick)
    line = (
      <span className="w-clickline" role="status">
        Click the video to start
      </span>
    );
  else if (youtube) line = <Position live={item.kind === 'live'} />;
  else if (clickHint && needsClick)
    // Twitch never says whether it started: one quiet line while the pointer may reach it.
    line = (
      <span className="w-hintline" role="status">
        Not started? Click the video
      </span>
    );
  else if (clickHint)
    line = (
      <button type="button" className="w-hintbtn" {...tip('Lets the pointer reach the video for one click (or 10 seconds)')} onClick={() => st.setNeedsClick(true)}>
        Not started?
      </button>
    );
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

/** watch behaviour: how long the controls stay after the pointer or focus leaves them, while a video plays. */
export const CTL_REST_MS = 3000;
/** Development only: the dev mocks (`?wctl=rest`) shorten the wait so headless stills catch the faded block. */
export const ctlTiming = { restMs: CTL_REST_MS };

/** True for an element that takes typed text (the list's link field, a rename field). */
function typing(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return el.matches('input, textarea, select');
}

/** True when the focus on `el` is a keyboard one (`:focus-visible`); a browser without the selector counts every focus as keyboard. */
function keyboardFocus(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

/** True while something that takes Escape first is open: the Watch sheet, the tools drawer, a dialog, a menu or Watt's menu. */
function somethingOpen(): boolean {
  if (useWatchStore.getState().sheet || useToolsStore.getState().open) return true;
  return document.querySelector('[role="dialog"], [role="menu"], .watt-menu') !== null;
}

/**
 * watch behaviour (5A): whether the left block's controls are at rest (faded out). They may rest
 * only while `canRest` (something plays, not paused, no notice showing); then one timer puts them
 * to rest `CTL_REST_MS` after the pointer left the left block, the Look row and the band on the
 * video's lower edge (`peek`), and focus left the controls. Pointer, focus or a Tab press brings
 * them back at once. No timer runs while they cannot rest; the timer is cleared on unmount.
 */
function useControlsFade(canRest: boolean, peek: boolean) {
  const [rest, setRest] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hold = useRef({ now: false, look: false, focus: false, peek: false, can: false });
  hold.current.peek = peek;
  hold.current.can = canRest;
  const wake = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    setRest(false);
    const h = hold.current;
    if (!h.can || h.now || h.look || h.focus || h.peek) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      setRest(true);
    }, ctlTiming.restMs);
  }, []);
  useEffect(() => wake(), [canRest, peek, wake]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const zone = (key: 'now' | 'look') => ({
    onPointerEnter: () => {
      hold.current[key] = true;
      wake();
    },
    onPointerLeave: (e: PointerEvent<HTMLElement>) => {
      hold.current[key] = false;
      // A button the mouse clicked keeps focus after the pointer leaves; let it go so it does not hide a live control.
      const el = document.activeElement;
      if (el instanceof HTMLElement && e.currentTarget.contains(el) && !keyboardFocus(el)) el.blur();
      wake();
    },
    // Only focus that came from the keyboard holds the controls shown; a mouse click does not.
    onFocus: (e: FocusEvent<HTMLElement>) => {
      if (!keyboardFocus(e.target)) return;
      hold.current.focus = true;
      wake();
    },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      const to = e.relatedTarget as Element | null;
      if (to && to.closest('.w-now, .w-lookbar')) return;
      hold.current.focus = false;
      wake();
    },
  });
  return { rest: canRest && rest, wake, zone };
}

/**
 * The Watch tab's keys while something plays: Tab wakes the controls (and moves through them as
 * usual); Space plays or pauses when the focus is on the page, the stage or the left block outside
 * a button (a focused button keeps its own Space press), never in a field; Escape stops the video
 * unless the focus is in a field or a sheet, drawer, dialog or menu is open (those take Escape
 * first). Mounted only with the Watch panel, so no key reaches the video from another place or tab.
 */
function useWatchKeys(on: boolean, youtube: boolean, wake: () => void) {
  useEffect(() => {
    if (!on) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Tab') {
        wake();
        return;
      }
      if (e.key !== ' ' && e.key !== 'Escape') return;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
      const t = e.target instanceof Element ? e.target : null;
      if (typing(t) || typing(document.activeElement)) return;
      // Neither key acts on a button, a link or a radio: they keep their own presses.
      if (t && t.closest('button, [role="radio"], [role="button"], a')) return;
      if (e.key === 'Escape') {
        if (somethingOpen()) return;
        // Taken here, so the same press does not also leave fullscreen (a second Escape does).
        e.preventDefault();
        useWatchStore.getState().stop();
        return;
      }
      if (!youtube) return;
      const onPage = !t || t === document.body || t === document.documentElement;
      const inBlock = t !== null && t.closest('.w-now, .w-lookbar, .w-layer') !== null;
      if (!onPage && !inBlock) return;
      if (somethingOpen()) return;
      e.preventDefault();
      wake();
      const st = useWatchStore.getState();
      st.setPaused(!st.paused);
    };
    // Capture: read before a sheet or drawer that closes on Escape has gone from the page.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [on, youtube, wake]);
}

/**
 * The Watch tab's centre: what is on (kind, label, the wall's own controls and the position)
 * on the left under the tabs, and the Look switch in its fixed place under that. The video itself
 * is drawn by the stage layer (`StageLayer.tsx`), which lives on every place. With nothing on it
 * says what to do and offers the first saved item. While a video plays and he is not using them,
 * the controls fade out after `CTL_REST_MS` and only a quiet title stays (5A).
 */
export function WatchPanel() {
  const playing = useWatchStore((s) => s.playing);
  const saved = useWatchStore((s) => s.saved);
  const looks = useWatchStore((s) => s.looks);
  const paused = useWatchStore((s) => s.paused);
  const needsClick = useWatchStore((s) => s.needsClick);
  const ended = useWatchStore((s) => s.report.ended);
  const stopped = useWatchStore((s) => s.stopped);
  const peek = useWatchStore((s) => s.peek);
  const inCall = useSignalStore((s) => s.call !== null);
  const st = useWatchStore.getState();
  // sky layers: the moon keeps clear of the left block, playing or not.
  const [nowEl, setNowEl] = useState<HTMLDivElement | null>(null);
  useSkyKeepClear('watch-now', nowEl);
  const [openFailed, setOpenFailed] = useState(false);
  // Notices never hide: the click line, the hint line and an open failure keep the block shown.
  const canRest = playing !== null && !paused && !ended && !needsClick && !openFailed;
  const { rest, wake, zone } = useControlsFade(canRest, peek);
  useWatchKeys(playing !== null, playing !== null && playing.kind !== 'twitch', wake);

  if (!playing) {
    const first = saved[0];
    const kind = first?.kind ?? 'video';
    return (
      <div className="w-panel" role="tabpanel" id={WATCH_PANEL_ID} aria-labelledby={WATCH_TAB_ID} data-state="idle">
        <div className="w-now" ref={setNowEl} data-ctl="shown">
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
        {lookFor(looks, kind) === 'drivein' ? <EmptyDriveIn /> : null}
      </div>
    );
  }

  const youtube = playing.kind !== 'twitch';
  const ctl = rest ? 'rest' : 'shown';
  return (
    <div className="w-panel" role="tabpanel" id={WATCH_PANEL_ID} aria-labelledby={WATCH_TAB_ID} data-state="playing" data-ctl={ctl}>
      <div className="w-now" ref={setNowEl} data-ctl={ctl} {...zone('now')}>
        <span className="u-k u-src">{kindName(playing.kind)}</span>
        <div className="w-title" title={playing.label}>
          {playing.label}
        </div>
        <div className="w-sub" title="It plays on when you go to Listen or another place. It stops by itself when the screens or the display go off, Windows locks or a call starts.">
          {!youtube ? 'Live on the wall' : needsClick ? 'Waiting for a click on the video' : ended ? 'Ended' : paused ? 'Paused' : 'Playing on the wall'}
        </div>
        <Controls item={playing} openFailed={openFailed} setOpenFailed={setOpenFailed} />
      </div>
      <LookSwitch kind={playing.kind} zone={zone('look')} />
    </div>
  );
}
