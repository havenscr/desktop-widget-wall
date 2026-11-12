import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { useVisible } from '../ui/useVisible';
import { nextArt, type NowPlayingInfo } from './model';

export const POLL_MS = 2000;

type Command = 'media_play_pause' | 'media_next' | 'media_previous';

export interface NowPlayingState {
  info: NowPlayingInfo | null;
  art: string | null;
  command: (name: Command) => void;
}

/**
 * Polls get_now_playing every 2 seconds while the page is visible, never while
 * hidden. One poll runs at a time and the next is scheduled only after it ends;
 * a sequence number drops an answer that a newer poll has already replaced.
 */
export function useNowPlaying(): NowPlayingState {
  const visible = useVisible();
  const [info, setInfo] = useState<NowPlayingInfo | null>(null);
  const [art, setArt] = useState<string | null>(null);
  const artRef = useRef<string | null>(null);
  const mounted = useRef(false);
  const seq = useRef(0);
  const inFlight = useRef(false);
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const pollOnce = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const next = await invoke<NowPlayingInfo | null>('get_now_playing');
      if (!mounted.current || mine !== seq.current) return;
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

  const run = useCallback(async () => {
    if (inFlight.current) {
      again.current = true;
      return;
    }
    inFlight.current = true;
    clearTimeout(timer.current);
    try {
      do {
        again.current = false;
        await pollOnce();
      } while (again.current && active.current && mounted.current);
    } finally {
      inFlight.current = false;
    }
    if (active.current && mounted.current) timer.current = setTimeout(() => void run(), POLL_MS);
  }, [pollOnce]);

  useEffect(() => {
    if (!visible) return;
    active.current = true;
    void run();
    return () => {
      active.current = false;
      clearTimeout(timer.current);
    };
  }, [visible, run]);

  const command = useCallback(
    (name: Command) => {
      invoke(name)
        .catch(() => {})
        .finally(() => {
          if (document.hidden || !active.current || !mounted.current) return;
          void run();
        });
    },
    [run],
  );

  return { info, art, command };
}
