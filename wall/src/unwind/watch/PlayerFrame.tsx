import { useEffect, useMemo, useRef, type ReactNode } from 'react';
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
/** The "listening" handshake is sent at most once a second until the player answers, this many times. */
export const HANDSHAKE_EVERY_MS = 1000;
export const HANDSHAKE_TRIES = 10;
/** The position is taken from the player's own reports at most once a second, and not while the page is hidden. */
export const REPORT_EVERY_MS = 1000;

/**
 * The wall's controls send their commands here; the frame on screen fills it in while it is
 * mounted. Returns false when there is no YouTube frame to talk to.
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
 * show; only when a play request has not started within `AUTOPLAY_WAIT_MS` is the pointer let
 * through so the video can be clicked. YouTube is driven by `postMessage` to its exact embed
 * origin and read only through `readPlayerMessage` (this frame's window, that origin, known
 * shapes). Twitch has no message interface for a frame and is stopped by removing it.
 */
export function PlayerFrame({ item, title }: { item: WatchRef; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const paused = useWatchStore((s) => s.paused);
  const muted = useWatchStore((s) => s.muted);
  const started = useWatchStore((s) => s.report.started);
  const needsClick = useWatchStore((s) => s.needsClick);
  const src = useMemo(() => embedUrl(item, pageWhere()), [item.kind, item.id]);
  const youtube = item.kind !== 'twitch';
  const target = playerOrigin(item);
  const poster = framePoster.render;
  const heard = useRef(false);
  const lastReport = useRef(0);

  // Posts go only to the frame's own window and only to the exact embed origin, never `*`.
  const post = (msg: string): boolean => {
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
      if (info.state === 'playing') {
        if (st.paused) st.setPaused(false);
        if (!st.report.started) {
          st.setReport({ started: true });
          fullVolume();
        }
        st.setNeedsClick(false);
      } else if (info.state === 'paused' || info.state === 'ended') {
        if (!st.paused) st.setPaused(true);
      }
      const list: { count?: number; index?: number } = {};
      if (info.count !== undefined) list.count = info.count;
      if (info.index !== undefined) list.index = info.index;
      if (Object.keys(list).length) st.setReport(list);
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

  useEffect(() => {
    if (youtube && !poster) post(commandMessage(paused ? 'pauseVideo' : 'playVideo'));
  }, [paused, youtube, poster]);
  useEffect(() => {
    if (!youtube || poster) return;
    if (muted) post(commandMessage('mute'));
    else {
      post(commandMessage('unMute'));
      post(commandMessage('setVolume', [PLAYER_VOLUME]));
    }
  }, [muted, youtube, poster]);

  // Autoplay refused: a play request that has not started within the wait lets the pointer through.
  useEffect(() => {
    if (poster || paused || started) return;
    const id = setTimeout(() => useWatchStore.getState().setNeedsClick(true), AUTOPLAY_WAIT_MS);
    return () => clearTimeout(id);
  }, [poster, paused, started, item.kind, item.id]);

  if (poster) return <div className="w-frame w-poster">{poster(item)}</div>;
  if (!src) return <div className="w-frame w-noframe">This page cannot hold a player. Use the Open button beside the controls.</div>;
  return (
    <iframe
      ref={ref}
      className={`w-frame${needsClick ? ' w-take' : ''}`}
      src={src}
      title={title}
      allow={FRAME_ALLOW}
      referrerPolicy={FRAME_REFERRER}
      sandbox={FRAME_SANDBOX}
      tabIndex={needsClick ? 0 : -1}
      onLoad={() => {
        if (!youtube) return;
        // The handshake asks the player to report; repeated once a second until it answers.
        let tries = 0;
        const hello = () => {
          if (heard.current || tries >= HANDSHAKE_TRIES || !ref.current) return;
          tries += 1;
          post(LISTENING_MESSAGE);
          setTimeout(hello, HANDSHAKE_EVERY_MS);
        };
        hello();
      }}
    />
  );
}
