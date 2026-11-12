import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { useVisible } from '../ui/useVisible';
import { nextArt, type NowPlayingInfo } from './model';

export const POLL_MS = 2000;

export interface NowPlayingState {
  info: NowPlayingInfo | null;
  art: string | null;
  command: (name: 'media_play_pause' | 'media_next' | 'media_previous') => void;
}

/** Polls get_now_playing every 2 seconds while the page is visible, never while hidden. */
export function useNowPlaying(): NowPlayingState {
  const visible = useVisible();
  const [info, setInfo] = useState<NowPlayingInfo | null>(null);
  const [art, setArt] = useState<string | null>(null);
  const artRef = useRef<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const next = await invoke<NowPlayingInfo | null>('get_now_playing');
      if (!next) {
        artRef.current = null;
        setArt(null);
        setInfo(null);
        return;
      }
      artRef.current = nextArt(next, artRef.current);
      setArt(artRef.current);
      setInfo(next);
    } catch {
      /* a failed poll keeps what is on screen */
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    const tick = () => {
      if (alive) void poll();
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [visible, poll]);

  const command = useCallback(
    (name: 'media_play_pause' | 'media_next' | 'media_previous') => {
      invoke(name)
        .catch(() => {})
        .finally(() => void poll());
    },
    [poll],
  );

  return { info, art, command };
}
