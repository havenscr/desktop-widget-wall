import { useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { reviewNow } from '../ui/reviewClock';
import { useVisible } from '../ui/useVisible';

/** One ShareX capture as Rust describes it. The page never gets a path: `id` is all it can name a capture by. */
export interface Capture {
  id: number;
  fileName: string;
  title: string;
  app: string;
  kind: 'image' | 'gif' | 'video' | 'other';
  /** Epoch milliseconds; 0 when ShareX wrote no usable time. */
  time: number;
  size: number;
  exists: boolean;
}

export type CaptureAction = 'open' | 'copy' | 'folder';

/** `notfound`: ShareX has no history file on this PC. `error`: the read failed and nothing older is held. */
export interface CapturesState {
  status: 'loading' | 'ready' | 'notfound' | 'error';
  items: Capture[];
}

/** How often the list is read while the Shelf is visible, and on window focus. */
export const POLL_MS = 10_000;
/** Captures drawn: the large one and the five before it. */
export const SHOWN = 6;

const clock = reviewNow ?? (() => Date.now());

/** A stable name for a capture across reads (ids are positions and shift when a new capture lands). */
export const captureKey = (c: Capture): string => `${c.time}:${c.fileName}:${c.size}`;

/** The Captures list, read now, every 10 seconds while the page is visible, and when the window gets focus. */
export function useCaptures(): CapturesState {
  const visible = useVisible();
  const [state, setState] = useState<CapturesState>({ status: 'loading', items: [] });
  const seq = useRef(0);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    const read = () => {
      const mine = ++seq.current;
      invoke<Capture[]>('wall2_captures_list').then(
        (items) => {
          if (alive && mine === seq.current) setState({ status: 'ready', items });
        },
        (e: unknown) => {
          if (!alive || mine !== seq.current) return;
          const word = e instanceof Error ? e.message : String(e);
          if (word === 'not-found') setState({ status: 'notfound', items: [] });
          else setState((s) => (s.items.length > 0 ? s : { status: 'error', items: [] }));
        },
      );
    };
    read();
    const timer = setInterval(read, POLL_MS);
    window.addEventListener('focus', read);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('focus', read);
    };
  }, [visible]);
  return state;
}

const THUMB_CACHE_MAX = 24;
const thumbs = new Map<string, Promise<string>>();

/** The picture of a capture as a data URL, cached by id, time and size. Rejects with Rust's word (for example `too-big`). */
export function loadThumb(c: Capture): Promise<string> {
  const key = `${c.id}:${captureKey(c)}`;
  const held = thumbs.get(key);
  if (held) return held;
  const p = invoke<string>('wall2_captures_thumb', { id: c.id }).catch((e: unknown) => {
    // A picture over the limit stays over it; any other failure may pass next time.
    if ((e instanceof Error ? e.message : String(e)) !== 'too-big') thumbs.delete(key);
    throw e;
  });
  thumbs.set(key, p);
  while (thumbs.size > THUMB_CACHE_MAX) {
    const oldest = thumbs.keys().next().value;
    if (oldest === undefined) break;
    thumbs.delete(oldest);
  }
  return p;
}

/** Forget every cached picture (tests). */
export function clearThumbs(): void {
  thumbs.clear();
}

export type Thumb = { state: 'none' } | { state: 'loading' } | { state: 'ready'; src: string } | { state: 'big' } | { state: 'failed' };

/** The picture for a capture: none for a video or a missing file, `big` when Rust says `too-big`. */
export function useThumb(c: Capture): Thumb {
  const wants = c.exists && (c.kind === 'image' || c.kind === 'gif');
  const key = `${c.id}:${captureKey(c)}`;
  const [got, setGot] = useState<{ key: string; thumb: Thumb } | null>(null);
  useEffect(() => {
    if (!wants) return;
    let alive = true;
    loadThumb(c).then(
      (src) => alive && setGot({ key, thumb: { state: 'ready', src } }),
      (e: unknown) => alive && setGot({ key, thumb: { state: (e instanceof Error ? e.message : String(e)) === 'too-big' ? 'big' : 'failed' } }),
    );
    return () => {
      alive = false;
    };
    // The key names the capture; the object itself changes on every read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, wants]);
  if (!wants) return { state: 'none' };
  return got && got.key === key ? got.thumb : { state: 'loading' };
}

/** "412 KB", "1.4 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** "11:02 AM" today, "Yesterday", else "Nov 9". Empty when there is no time. */
export function formatWhen(ms: number, now: number = clock()): string {
  if (!ms) return '';
  const d = new Date(ms);
  const n = new Date(now);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(n) - day(d)) / 86_400_000);
  if (days <= 0) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** The badge word for a kind that has one. */
export const kindWord = (c: Capture): string | null => (c.kind === 'gif' ? 'GIF' : c.kind === 'video' ? 'Video' : null);
