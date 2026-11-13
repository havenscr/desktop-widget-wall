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
  playerOrigin,
  readPlayState,
} from './urls';

/**
 * Development only: the dev mocks (`?watch=mock`) set this so headless stills show a poster
 * picture where the frame would be. A production build never sets it, so it always renders
 * the frame.
 */
export const framePoster: { render: ((ref: WatchRef) => ReactNode) | null } = { render: null };

/**
 * The one player frame, built only by `embedUrl` from a checked kind and id. YouTube is
 * paused, played and muted by `postMessage` to the embed origin; Twitch has no such control
 * and is stopped by removing the frame. Messages are read only from this frame's window and
 * the exact player origin, and only for the play state.
 */
export function PlayerFrame({ item, title }: { item: WatchRef; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const paused = useWatchStore((s) => s.paused);
  const muted = useWatchStore((s) => s.muted);
  const src = useMemo(() => embedUrl(item, pageWhere()), [item.kind, item.id]);
  // The effects below post to whatever frame is current; `post` reads the ref when called.
  const youtube = item.kind !== 'twitch';
  const target = playerOrigin(item);

  const post = (msg: string) => {
    try {
      ref.current?.contentWindow?.postMessage(msg, target);
    } catch {
      /* the frame is gone */
    }
  };

  useEffect(() => {
    if (!youtube) return;
    const on = (e: MessageEvent) => {
      if (!ref.current || e.source !== ref.current.contentWindow) return;
      const st = readPlayState(e.origin, e.data);
      if (st === 'playing') useWatchStore.getState().setPaused(false);
      else if (st === 'paused' || st === 'ended') useWatchStore.getState().setPaused(true);
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [youtube]);

  useEffect(() => {
    if (youtube) post(commandMessage(paused ? 'pauseVideo' : 'playVideo'));
  }, [paused, youtube]);
  useEffect(() => {
    if (youtube) post(commandMessage(muted ? 'mute' : 'unMute'));
  }, [muted, youtube]);

  if (framePoster.render) return <div className="w-frame w-poster">{framePoster.render(item)}</div>;
  if (!src) return <div className="w-frame w-noframe">This page cannot hold a player. Open it in the browser.</div>;
  return (
    <iframe
      ref={ref}
      className="w-frame"
      src={src}
      title={title}
      allow={FRAME_ALLOW}
      referrerPolicy={FRAME_REFERRER}
      sandbox={FRAME_SANDBOX}
      onLoad={() => {
        if (youtube) post(LISTENING_MESSAGE);
      }}
    />
  );
}
