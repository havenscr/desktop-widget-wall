import { useCallback, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import {
  IconExternalLink,
  IconInfoCircle,
  IconMovie,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerSkipBackFilled,
  IconPlayerSkipForwardFilled,
  IconPencil,
  IconPlayerStopFilled,
  IconRotate,
  IconSettings,
  IconVolume,
  IconVolumeOff,
} from '@tabler/icons-react';
import { invoke } from '../../bridge/tauri';
import { useSkyKeepClear } from '../../horizon/sky';
import { useSignalStore } from '../../signals/store';
import { useToolsStore } from '../../tools/store';
import { tip } from '../../ui/HoverTip';
import { DriveInFrame } from './DriveInFrame';
import { kindName, validRef, type WatchKind, type WatchRef } from './links';
import { lookFor } from './looks';
import { playerLink } from './PlayerFrame';
import { useWatchSky } from './StageLayer';
import { useWatchStore } from './store';
import { next as queueNext, previous as queuePrevious, useMusicView } from '../ytmusic/queue';
import { AddToPlaylistButton, useAddMenuOpen } from './AddToPlaylist';
import { useOwnLists } from './ownLists';
import { next as ownNext, NO_PLAY_LINE, playAgain as ownPlayAgain, previous as ownPrevious, useOwnFinished, useOwnView, type OwnView } from './ownPlay';
import { countText } from './OwnParts';

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

/**
 * The gear: the last button of the left block's row. It opens the settings sheet on its Looks
 * side. When the sheet closes and nothing else took the focus (Escape, its cross), the focus
 * comes back here, so the keyboard carries on from the same button.
 */
export function WatchGear() {
  const open = useWatchStore((s) => s.sheet);
  const ref = useRef<HTMLButtonElement>(null);
  const was = useRef(open);
  // Whether the focus was inside the sheet when it closed: a click on bare page, which also closes it, leaves the focus where the owner put it.
  const inside = useRef(false);
  useEffect(() => {
    if (!open) return;
    const inSheet = (t: EventTarget | null) => t instanceof Element && t.closest('.w-sheet') !== null;
    inside.current = inSheet(document.activeElement);
    const onFocus = (e: globalThis.FocusEvent) => void (inside.current = inSheet(e.target));
    const onDown = (e: globalThis.PointerEvent) => void (inside.current = inSheet(e.target));
    document.addEventListener('focusin', onFocus);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('focusin', onFocus);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [open]);
  useEffect(() => {
    const closed = was.current && !open;
    was.current = open;
    if (!closed) return;
    const a = document.activeElement;
    if (inside.current && (!a || a === document.body || a === document.documentElement)) ref.current?.focus();
  }, [open]);
  return (
    <button
      ref={ref}
      type="button"
      className={`w-gear${open ? ' on' : ''}`}
      aria-label="How video is shown"
      aria-expanded={open}
      aria-haspopup="dialog"
      {...tip('How video is shown')}
      onClick={() => useWatchStore.getState().setSheet(!open)}
    >
      <IconSettings size={22} aria-hidden="true" />
    </button>
  );
}

/** The drive-in screen with nothing on it (the drive-in look, nothing playing). */
function EmptyDriveIn() {
  useWatchSky('drivein', null, false);
  return (
    <div className="w-stage w-drivein w-empty" data-look="drivein" aria-hidden="true">
      <DriveInFrame mode="empty" />
      <div className="w-screen">
        <IconMovie size={64} stroke={1.25} />
        <span>Nothing on the screen</span>
      </div>
    </div>
  );
}

/** "1:05" or "1:02:03". */
export function clock(sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
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
        style={{ ['--f' as string]: frac.toFixed(4) }}
        {...tip('Click to jump there; arrow keys move 10 seconds.')}
        onClick={seek}
        onKeyDown={nudge}
      >
        <b style={{ width: `${(frac * 100).toFixed(2)}%` }} />
        <i className="w-mark" aria-hidden="true" />
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
  // A pick from the YouTube library: Previous and Next are the queue's (the list it came from), not the player's.
  const music = useMusicView();
  const queued = !!music && music.state !== 'stopped';
  // A video of a playlist the owner made: Previous and Next are the playlist's own.
  const own = useOwnView();
  const duration = useWatchStore((s) => s.report.duration);
  const reportTitle = useWatchStore((s) => s.report.title);
  const reportChannel = useWatchStore((s) => s.report.channel);
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
  // Only a single YouTube video can go in a playlist: its button joins the row and "Open in YouTube" shortens to make room.
  const canAdd = item.kind === 'video';
  const label = canAdd ? 'YouTube' : openLabel(item.kind);
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
            <button type="button" className="rd" aria-label="Previous" disabled={!list && !queued && !own} {...tip(own ? 'Previous in the playlist' : queued ? 'Previous in the list' : list ? `Previous. ${listTip}` : 'Previous: only for a playlist')} onClick={() => (own ? ownPrevious() : queued ? queuePrevious() : playerLink.send('previousVideo'))}>
              <IconPlayerSkipBackFilled size={20} aria-hidden="true" />
            </button>
            <button type="button" className="rd big" aria-label={paused ? 'Play' : 'Pause'} {...tip(paused ? 'Play' : 'Pause')} onClick={() => st.setPaused(!paused)}>
              {paused ? <IconPlayerPlayFilled size={22} aria-hidden="true" /> : <IconPlayerPauseFilled size={22} aria-hidden="true" />}
            </button>
            <button type="button" className="rd" aria-label="Next" disabled={own ? false : queued ? !music?.hasNext : !list} {...tip(own ? (own.last && !own.repeat ? 'This is the last video' : 'Next in the playlist') : queued ? (music?.hasNext ? 'Next in the list' : 'This is the last video in the list') : list ? `Next. ${listTip}` : 'Next: only for a playlist')} onClick={() => (own ? ownNext() : queued ? queueNext() : playerLink.send('nextVideo'))}>
              <IconPlayerSkipForwardFilled size={20} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="rd"
              aria-label={muted ? 'Sound on' : 'Mute'}
              aria-pressed={muted}
              {...tip(muted ? 'Sound on (the level is the volume under the clock)' : 'Mute the video')}
              onClick={() => st.setMuted(!muted)}
            >
              {muted ? <IconVolumeOff size={20} aria-hidden="true" /> : <IconVolume size={20} aria-hidden="true" />}
            </button>
          </>
        ) : null}
        <button type="button" className={`rd${youtube ? '' : ' big'}`} aria-label="Stop" {...tip('Stop and remove the video')} onClick={() => st.stop()}>
          <IconPlayerStopFilled size={20} aria-hidden="true" />
        </button>
        <button type="button" className="w-open" aria-label={canAdd ? openLabel(item.kind) : undefined} {...tip(`Opens this ${kindName(item.kind).toLowerCase()} on its own site in your web browser`)} onClick={() => void open()}>
          <IconExternalLink size={18} aria-hidden="true" />
          <span className="w-open-t">{label}</span>
          {/* The shown word is shorter to make room for the add button; the page text keeps the button's whole name. */}
          {canAdd ? <span className="w-vh">{openLabel(item.kind)}</span> : null}
        </button>
        {canAdd ? <AddToPlaylistButton video={{ id: item.id, ...(reportTitle ? { title: reportTitle } : {}), ...(reportChannel ? { channel: reportChannel } : {}), ...(duration !== null && duration > 0 ? { seconds: duration } : {}) }} /> : null}
        <WatchGear />
      </div>
      <div className="w-time">{line}</div>
      {own?.next ? <NextLine own={own} /> : null}
    </>
  );
}

/** The Next line (a playlist of the owner's own): "Next" and the title of the video after this one. */
function NextLine({ own }: { own: OwnView }) {
  return (
    <div className="w-next" {...tip(own.next!.title)}>
      <span className="w-next-k">Next</span>
      <b className="u-ell">{own.next!.title}</b>
    </div>
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
  if (useWatchStore.getState().sheet || useToolsStore.getState().open || useOwnLists.getState().open !== null) return true;
  return document.querySelector('[role="dialog"], [role="menu"], .watt-menu') !== null;
}

/**
 * watch behaviour (5A): whether the left block's controls are at rest (faded out). They may rest
 * only while `canRest` (something plays, not paused, no notice showing, the sheet closed); then one timer puts them
 * to rest `CTL_REST_MS` after the pointer left the left block (the gear is its row's last button) and the band on the
 * video's lower edge (`peek`), and focus left the controls. Pointer, focus or a Tab press brings
 * them back at once. No timer runs while they cannot rest; the timer is cleared on unmount.
 */
function useControlsFade(canRest: boolean, peek: boolean) {
  const [rest, setRest] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hold = useRef({ now: false, focus: false, peek: false, can: false });
  hold.current.peek = peek;
  hold.current.can = canRest;
  const wake = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    setRest(false);
    const h = hold.current;
    if (!h.can || h.now || h.focus || h.peek) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      setRest(true);
    }, ctlTiming.restMs);
  }, []);
  useEffect(() => wake(), [canRest, peek, wake]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const zone = () => ({
    onPointerEnter: () => {
      hold.current.now = true;
      wake();
    },
    onPointerLeave: (e: PointerEvent<HTMLElement>) => {
      hold.current.now = false;
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
      if (to && to.closest('.w-now')) return;
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
      const inBlock = t !== null && t.closest('.w-now, .w-layer') !== null;
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
 * on the left, starting at the line Listen's player starts at, with the gear (how video is shown) as the last button of its row. The video itself
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
  const reportTitle = useWatchStore((s) => s.report.title);
  const reportChannel = useWatchStore((s) => s.report.channel);
  const fromMusic = useWatchStore((s) => s.source === 'music' || s.source === 'own');
  const own = useOwnView();
  const finished = useOwnFinished();
  const lists = useOwnLists((s) => s.lists);
  const menuOpen = useAddMenuOpen((s) => s.open);
  const stopped = useWatchStore((s) => s.stopped);
  const sheetOpen = useWatchStore((s) => s.sheet);
  const peek = useWatchStore((s) => s.peek);
  const inCall = useSignalStore((s) => s.call !== null);
  const st = useWatchStore.getState();
  // sky layers: the moon keeps clear of the left block, playing or not.
  const [nowEl, setNowEl] = useState<HTMLDivElement | null>(null);
  useSkyKeepClear('watch-now', nowEl);
  const [openFailed, setOpenFailed] = useState(false);
  // Notices never hide: the click line, the hint line and an open failure keep the block shown.
  // So does the sheet the gear opened: the row (and the lit gear) stays while it is open.
  const canRest = playing !== null && !paused && !ended && !needsClick && !openFailed && !sheetOpen && !menuOpen;
  const { rest, wake, zone } = useControlsFade(canRest, peek);
  useWatchKeys(playing !== null, playing !== null && playing.kind !== 'twitch', wake);

  const finishedEntry = finished ? saved.find((i) => i.kind === 'own' && i.id === finished.listId) : undefined;
  if (!playing && finished && finishedEntry) {
    // The playlist ran out (repeat off) or nothing in it could play: the frame is gone and this block says so, with the way on.
    const firstVideo = lists[finished.listId]?.items[0];
    const bye = finished.none ? NO_PLAY_LINE : finished.played === finished.total ? `All ${countText(finished.total).toLowerCase()} played` : `${finished.played} of ${countText(finished.total).toLowerCase()} played`;
    return (
      <div className="w-panel" role="tabpanel" id={WATCH_PANEL_ID} aria-labelledby={WATCH_TAB_ID} data-state="idle">
        <div className="w-now" ref={setNowEl} data-ctl="shown">
          <span className="u-k u-src">Your playlist · ended</span>
          <div className="w-title" {...tip(finishedEntry.label)}>
            {finishedEntry.label}
          </div>
          <div className="w-by u-ell">{bye}</div>
          <div className="w-sub">{finished.none ? 'Every video was skipped' : 'Stopped after the last video'}</div>
          <div className="w-ctl w-idle own-ended">
            {finished.none ? (
              <button type="button" className="own-pillbtn cy" disabled={!firstVideo} {...tip('Opens the first video on YouTube in your web browser')} onClick={() => firstVideo && void openInBrowser({ kind: 'video', id: firstVideo.id })}>
                <IconExternalLink size={18} aria-hidden="true" />
                Open in YouTube
              </button>
            ) : (
              <button type="button" className="own-pillbtn cy" disabled={inCall} {...tip(inCall ? 'Video waits until the call ends' : 'Play the playlist again from the start')} onClick={() => ownPlayAgain()}>
                <IconRotate size={18} aria-hidden="true" />
                Play again
              </button>
            )}
            <button type="button" className="own-pillbtn" {...tip(`Edit ${finishedEntry.label}`)} onClick={() => useOwnLists.getState().setOpen(finished.listId)}>
              <IconPencil size={16} aria-hidden="true" />
              Edit the playlist
            </button>
            <WatchGear />
          </div>
        </div>
      </div>
    );
  }
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
          <div className="w-ctl w-idle">
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
            <WatchGear />
          </div>
        </div>
        {lookFor(looks, kind) === 'drivein' ? <EmptyDriveIn /> : null}
      </div>
    );
  }

  const youtube = playing.kind !== 'twitch';
  // A single video or live stream shows what the player says it is; until then (and for a playlist or Twitch) the saved label.
  const single = playing.kind === 'video' || playing.kind === 'live';
  const byReport = single && reportTitle !== null;
  // A video of the owner's own playlist: the player's title and channel, else the ones kept on the playlist.
  const shownTitle = own ? own.title : byReport ? reportTitle! : playing.label;
  const channel = own ? own.channel || null : single ? reportChannel : null;
  const ctl = rest ? 'rest' : 'shown';
  return (
    <div className="w-panel" role="tabpanel" id={WATCH_PANEL_ID} aria-labelledby={WATCH_TAB_ID} data-state="playing" data-ctl={ctl}>
      <div className="w-now" ref={setNowEl} data-ctl={ctl} {...zone()}>
        <span className="u-k u-src">{own ? `Your playlist · ${own.place} of ${own.count}` : kindName(playing.kind)}</span>
        <div
          className="w-title"
          {...tip(
            <>
              {shownTitle}
              {byReport && !fromMusic && playing.label !== shownTitle ? (
                <>
                  <br />
                  Saved as: {playing.label}
                </>
              ) : null}
            </>,
          )}
        >
          {shownTitle}
        </div>
        {channel ? (
          <div className="w-by u-ell" {...tip(`Channel: ${channel}. As the player reports it.`)}>
            {channel}
          </div>
        ) : null}
        <div className="w-sub" title="It plays on when you go to Listen or another place. It stops by itself when the screens or the display go off, Windows locks or a call starts.">
          {own?.note ? (
            <span className="own-skip" role="status">
              <IconInfoCircle size={22} aria-hidden="true" />
              <span>{own.note}</span>
            </span>
          ) : !youtube ? (
            'Live on the wall'
          ) : needsClick ? (
            'Waiting for a click on the video'
          ) : ended ? (
            'Ended'
          ) : paused ? (
            'Paused'
          ) : own ? (
            <span className="own-playing u-ell">Playing {own.name}</span>
          ) : (
            'Playing on the wall'
          )}
        </div>
        <Controls item={playing} openFailed={openFailed} setOpenFailed={setOpenFailed} />
      </div>
    </div>
  );
}
