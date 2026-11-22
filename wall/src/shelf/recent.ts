import { useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { reviewNow } from '../ui/reviewClock';
import { useVisible } from '../ui/useVisible';

/** One recently opened file as Rust describes it. The page never gets a path: `id`, an opaque string, is all it can name a file by. */
export interface RecentFile {
  id: string;
  name: string;
  /** Epoch milliseconds the file was last opened; 0 when not known. */
  modified: number;
  kind: string;
}

export interface RecentState {
  status: 'loading' | 'ready' | 'error';
  items: RecentFile[];
}

/** How often the list is read while the Shelf is visible, and on window focus. */
export const RECENT_POLL_MS = 60_000;
/** Files drawn. */
export const RECENT_SHOWN = 20;

const clock = reviewNow ?? (() => Date.now());

/** The recent files, read now, every 60 seconds while the page is visible, and when the window gets focus. */
export function useRecentFiles(): RecentState {
  const visible = useVisible();
  const [state, setState] = useState<RecentState>({ status: 'loading', items: [] });
  const seq = useRef(0);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    const read = () => {
      const mine = ++seq.current;
      invoke<RecentFile[]>('wall2_recent_files').then(
        (items) => {
          if (alive && mine === seq.current) setState({ status: 'ready', items: [...items].sort((a, b) => b.modified - a.modified).slice(0, RECENT_SHOWN) });
        },
        () => {
          if (alive && mine === seq.current) setState((s) => (s.items.length > 0 ? s : { status: 'error', items: [] }));
        },
      );
    };
    read();
    const timer = setInterval(read, RECENT_POLL_MS);
    window.addEventListener('focus', read);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('focus', read);
    };
  }, [visible]);
  return state;
}

/** "9:40 AM" today, "Yesterday", the weekday within the last week, otherwise "Nov 3". Empty when the time is not known. */
export function recentWhen(ms: number, now: number = clock()): string {
  if (!ms) return '';
  const d = new Date(ms);
  const n = new Date(now);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(n) - day(d)) / 86_400_000);
  if (days <= 0) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
