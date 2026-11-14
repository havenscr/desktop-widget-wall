import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { WatchRef } from './links';
import { useWatchStore } from './store';
import {
  commandMessage,
  embedUrl,
  FRAME_ALLOW,
  FRAME_REFERRER,
  FRAME_SANDBOX,
  LISTENING_MESSAGE,
  pageWhere,
  PLAYER_VOLUME,
  playerOrigin,
  readPlayerMessage,
  type YouTubeCommand,
} from './urls';

/**
 * Development only: the dev mocks (`?watch=mock`) set this so headless stills show a poster
 * picture where the frame would be. A production build never sets it, so it always renders
 * the frame.
 */
export const framePoster: { render: ((ref: WatchRef) => ReactNode) | null } = { render: null };

/** How long a play request may go without the picture starting before the pointer is let through. */
export const AUTOPLAY_WAIT_MS = 6000;
/** Twitch: how long the pointer may reach the frame after the hint opens it (or until one click). */
export const TWITCH_CLICK_MS = 10_000;
/** The "listening" handshake is sent at most once a second until the player answers, this many times. */
export const HANDSHAKE_EVERY_MS = 1000;
export const HANDSHAKE_TRIES = 10;
/** The position is taken from the player's own reports at most once a second, and not while the page is hidden. */
export const REPORT_EVERY_MS = 1000;

/**
 * The wall's controls send their commands here; the frame on screen fills it in while it is
 * mounted. Returns false when there is no loaded YouTube frame to talk to.
 */
export const playerLink: { send: (func: YouTubeCommand, args?: readonly (number | boolean)[]) => boolean } = {
  send: () => false,
};

function pageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/**
 * The one player frame, built only by `embedUrl` from a checked kind and id. It takes no
 * pointer (`pointer-events: none` on the frame itself), so the player's hover overlays never
 * show; the pointer is let through only after a refused autoplay (YouTube, until it plays) or,
 * for Twitch, for one click or `TWITCH_CLICK_MS` after the hint opens it. YouTube is driven by
 * `postMessage` to its exact embed origin, only once the frame has loaded, and read only
 * through `readPlayerMessage` (this frame's window, that origin, known shapes). A change the
 * player reports (playing, paused, ended) is never echoed back as a command. Twitch has no
 * message interface for a frame and is stopped by removing it. While the stage is out of sight
 * (`shown` false) the pointer never reaches it, whatever the player asked for; the element itself
 * is the same one either way (only its class changes), so the player never reloads.
 */
export function PlayerFrame({ item, title, shown = true }: { item: WatchRef; title: string; shown?: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const paused = useWatchStore((s) => s.paused);
  const muted = useWatchStore((s) => s.muted);
  const started = useWatchStore((s) => s.report.started);
  const needsClick = useWatchStore((s) => s.needsClick);
  const take = needsClick && shown;
  const src = useMemo(() => embedUrl(item, pageWhere()), [item.kind, item.id]);
  const youtube = item.kind !== 'twitch';
  const target = playerOrigin(item);
  const poster = framePoster.render;
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);
  const heard = useRef(false);
  const lastReport = useRef(0);
  // Set while the store follows the player, so the paused effect does not send it back.
  const fromPlayer = useRef(false);

  // Posts go only to the loaded frame's own window and only to the exact embed origin, never `*`.
  const post = (msg: string): boolean => {
    if (!loadedRef.current) return false;
    const win = ref.current?.contentWindow;
    if (!win) return false;
    try {
      win.postMessage(msg, target);
      return true;
    } catch {
      return false;
    }
  };

  const fullVolume = () => {
    if (useWatchStore.getState().muted) post(commandMessage('mute'));
    else {
      post(commandMessage('unMute'));
      post(commandMessage('setVolume', [PLAYER_VOLUME]));
    }
  };

  const followPlayer = (paused: boolean) => {
    const st = useWatchStore.getState();
    if (st.paused === paused) return;
    fromPlayer.current = true;
    st.setPaused(paused);
  };

  useEffect(() => {
    if (!youtube || poster) return;
    playerLink.send = (func, args = []) => post(commandMessage(func, args));
    return () => {
      playerLink.send = () => false;
    };
  }, [youtube, poster, target]);

  useEffect(() => {
    if (!youtube || poster) return;
    heard.current = false;
    const on = (e: MessageEvent) => {
      const info = readPlayerMessage(e.origin, e.source, ref.current?.contentWindow ?? null, e.data);
      if (!info) return;
      heard.current = true;
      const st = useWatchStore.getState();
      if (info.ready) fullVolume();
      const list: { count?: number; index?: number } = {};
      if (info.count !== undefined) list.count = info.count;
      if (info.index !== undefined) list.index = info.index;
      if (Object.keys(list).length) st.setReport(list);
      if (info.state === 'playing') {
        followPlayer(false);
        if (!st.report.started) {
          st.setReport({ started: true, ended: false });
          fullVolume();
        } else if (st.report.ended) st.setReport({ ended: false });
        st.setNeedsClick(false);
      } else if (info.state === 'paused') {
        followPlayer(true);
      } else if (info.state === 'ended') {
        // A playlist moves on by itself after each item: only the end of its last item (or of a
        // single video or stream) shows as ended, and no command is ever sent for it.
        const r = useWatchStore.getState().report;
        const more = item.kind === 'playlist' && r.count > 1 && r.index < r.count - 1;
        if (!more) {
          st.setReport({ ended: true });
          followPlayer(true);
        }
      }
      if (info.time === undefined && info.duration === undefined) return;
      // The player reports its position several times a second; the wall takes it once a second and not while hidden.
      const now = Date.now();
      if (pageHidden() || now - lastReport.current < REPORT_EVERY_MS) return;
      lastReport.current = now;
      const pos: { time?: number; duration?: number } = {};
      if (info.time !== undefined) pos.time = Math.floor(info.time);
      if (info.duration !== undefined) pos.duration = Math.floor(info.duration);
      st.setReport(pos);
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [youtube, poster]);

  // The handshake: once the frame has loaded, "listening" once a second until the player answers
  // (ten tries at most), never while the page is hidden (it resumes when the page shows again).
  useEffect(() => {
    if (!youtube || poster || !loaded) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hello = () => {
      timer = undefined;
      if (heard.current || tries >= HANDSHAKE_TRIES || pageHidden()) return;
      tries += 1;
      post(LISTENING_MESSAGE);
      timer = setTimeout(hello, HANDSHAKE_EVERY_MS);
    };
    const onShow = () => {
      if (!pageHidden() && timer === undefined) hello();
    };
    document.addEventListener('visibilitychange', onShow);
    hello();
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [youtube, poster, loaded]);

  useEffect(() => {
    if (fromPlayer.current) {
      fromPlayer.current = false;
      return;
    }
    if (!youtube || poster) return;
    if (!paused && useWatchStore.getState().report.ended) useWatchStore.getState().setReport({ ended: false });
    post(commandMessage(paused ? 'pauseVideo' : 'playVideo'));
  }, [paused, youtube, poster]);
  useEffect(() => {
    if (!youtube || poster) return;
    if (muted) post(commandMessage('mute'));
    else {
      post(commandMessage('unMute'));
      post(commandMessage('setVolume', [PLAYER_VOLUME]));
    }
  }, [muted, youtube, poster]);

  // Autoplay refused (YouTube): a play request that has not started within the wait lets the
  // pointer through until it plays. Twitch never says it started: after the same wait the
  // control row offers the hint, which opens the pointer for one click or a short while.
  useEffect(() => {
    if (poster || paused || started) return;
    const id = setTimeout(() => {
      const st = useWatchStore.getState();
      if (youtube) st.setNeedsClick(true);
      else {
        st.setClickHint(true);
        st.setNeedsClick(true);
      }
    }, AUTOPLAY_WAIT_MS);
    return () => clearTimeout(id);
  }, [poster, paused, started, youtube, item.kind, item.id]);

  // Twitch: the pointer reaches the frame for one click (the frame takes focus) or `TWITCH_CLICK_MS`.
  useEffect(() => {
    if (youtube || poster || !needsClick) return;
    const close = () => useWatchStore.getState().setNeedsClick(false);
    const id = setTimeout(close, TWITCH_CLICK_MS);
    let check: ReturnType<typeof setTimeout> | undefined;
    const onBlur = () => {
      // A click into the frame moves the focus into it, which blurs this window.
      clearTimeout(check);
      check = setTimeout(() => {
        if (ref.current && document.activeElement === ref.current) close();
      }, 0);
    };
    window.addEventListener('blur', onBlur);
    return () => {
      clearTimeout(id);
      clearTimeout(check);
      window.removeEventListener('blur', onBlur);
    };
  }, [youtube, poster, needsClick]);

  if (poster) return <div className={`w-frame w-poster${take ? ' w-take' : ''}`}>{poster(item)}</div>;
  if (!src) return <div className="w-frame w-noframe">This page cannot hold a player. Use the Open button beside the controls.</div>;
  return (
    <iframe
      ref={ref}
      className={`w-frame${take ? ' w-take' : ''}`}
      src={src}
      title={title}
      allow={FRAME_ALLOW}
      referrerPolicy={FRAME_REFERRER}
      sandbox={FRAME_SANDBOX}
      tabIndex={take ? 0 : -1}
      onLoad={() => {
        loadedRef.current = true;
        setLoaded(true);
      }}
    />
  );
}
