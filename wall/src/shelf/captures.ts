import { useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { reviewNow } from '../ui/reviewClock';
import { useVisible } from '../ui/useVisible';

/** One ShareX capture as Rust describes it. The page never gets a path: `id`, an opaque string that stays the same for the same file across reads, is all it can name a capture by. */
export interface Capture {
  id: string;
  fileName: string;
  title: string;
  app: string;
  kind: 'image' | 'gif' | 'video' | 'other';
  /** Epoch milliseconds; 0 when ShareX wrote no usable time. */
  time: number;
  size: number;
  exists: boolean;
}

/** The fixed words Rust accepts for `wall2_captures_act` (see `Action::parse`). Copy image is made in the page and is not one of them. */
export type CaptureAction = 'open' | 'copy' | 'folder' | 'path' | 'edit' | 'pin' | 'ocr' | 'trash';

/** `notfound`: ShareX has no history file on this PC. `error`: the read failed and nothing older is held. */
export interface CapturesState {
  status: 'loading' | 'ready' | 'notfound' | 'error';
  items: Capture[];
}

export type CapturesFeed = CapturesState & { reload: () => void };

/** How often the list is read while the Shelf is visible, and on window focus. */
export const POLL_MS = 10_000;
/** Captures drawn: the large one and the list beside it (Rust sends at most 30). */
export const SHOWN = 30;

export type SortOrder = 'newest' | 'oldest';
export type KindFilter = 'all' | 'image' | 'video' | 'gif';
export const SORTS: readonly SortOrder[] = ['newest', 'oldest'];
export const FILTERS: readonly KindFilter[] = ['all', 'image', 'video', 'gif'];
export const FILTER_WORDS: Record<KindFilter, string> = { all: 'All', image: 'Images', video: 'Video', gif: 'GIF' };

/** The captures to draw: Rust's list is newest first; `kind` comes from the file extension. */
export function arrange(items: Capture[], sort: SortOrder, filter: KindFilter): Capture[] {
  const kept = filter === 'all' ? items.slice() : items.filter((c) => c.kind === filter);
  return (sort === 'oldest' ? kept.reverse() : kept).slice(0, SHOWN);
}

/** One remembered choice. A stored word that is not one of `allowed` is ignored; storage that throws is ignored. */
export function usePref<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const got = localStorage.getItem(key);
      return allowed.find((a) => a === got) ?? fallback;
    } catch {
      return fallback;
    }
  });
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      /* the choice just is not remembered */
    }
  };
  return [value, set];
}

/** The picture of an image capture on the clipboard as a bitmap (PNG), made here from the picture the card already holds. Rejects when it cannot. */
export async function copyBitmap(c: Capture): Promise<void> {
  if (c.kind !== 'image' || !c.exists) throw new Error('not-image');
  const src = await loadThumb(c);
  const img = new Image();
  img.src = src;
  await img.decode();
  if (img.naturalWidth * img.naturalHeight > 40_000_000) throw new Error('too-big');
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d')?.drawImage(img, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('failed');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

const clock = reviewNow ?? (() => Date.now());

/** The Captures list, read now, every 10 seconds while the page is visible, and when the window gets focus. */
export function useCaptures(): CapturesFeed {
  const visible = useVisible();
  const [state, setState] = useState<CapturesState>({ status: 'loading', items: [] });
  const seq = useRef(0);
  const again = useRef<() => void>(() => undefined);
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
    again.current = read;
    read();
    const timer = setInterval(read, POLL_MS);
    window.addEventListener('focus', read);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('focus', read);
    };
  }, [visible]);
  return { ...state, reload: () => again.current() };
}

/** The most data-URL text the picture cache holds (about the bytes of memory it costs). */
export const THUMB_BYTES_MAX = 48 * 1024 * 1024;
/** Pictures kept beyond those on the card. */
export const THUMB_EXTRA = 6;

interface Held {
  p: Promise<string>;
  bytes: number;
}
const thumbs = new Map<string, Held>();

/** The bytes the cache holds now (pictures still loading count as 0). */
export const thumbBytes = (): number => [...thumbs.values()].reduce((n, h) => n + h.bytes, 0);

/** Drop the oldest pictures until the cache is within its byte budget; the newest is always kept. */
function evict(): void {
  let total = thumbBytes();
  for (const key of [...thumbs.keys()]) {
    if (total <= THUMB_BYTES_MAX || thumbs.size <= 1) break;
    total -= thumbs.get(key)?.bytes ?? 0;
    thumbs.delete(key);
  }
}

/** Keep every picture of the ids shown and at most `THUMB_EXTRA` others (the newest of them). */
export function trimThumbs(shown: string[]): void {
  const on = new Set(shown);
  const others = [...thumbs.keys()].filter((k) => !on.has(k));
  for (const key of others.slice(0, Math.max(0, others.length - THUMB_EXTRA))) thumbs.delete(key);
}

/** The picture of a capture as a data URL, cached by its id. Rejects with Rust's word (for example `too-big`). */
export function loadThumb(c: Capture): Promise<string> {
  const key = c.id;
  const held = thumbs.get(key);
  if (held) return held.p;
  const entry: Held = { p: Promise.resolve(''), bytes: 0 };
  entry.p = invoke<string>('wall2_captures_thumb', { id: c.id }).then(
    (src) => {
      if (thumbs.get(key) === entry) {
        entry.bytes = src.length;
        evict();
      }
      return src;
    },
    (e: unknown) => {
      // A picture over the limit stays over it; any other failure may pass next time.
      if ((e instanceof Error ? e.message : String(e)) !== 'too-big' && thumbs.get(key) === entry) thumbs.delete(key);
      throw e;
    },
  );
  thumbs.set(key, entry);
  return entry.p;
}

/** Forget every cached picture (tests). */
export function clearThumbs(): void {
  thumbs.clear();
}

export type Thumb = { state: 'none' } | { state: 'loading' } | { state: 'ready'; src: string } | { state: 'big' } | { state: 'failed' };

/** The picture for a capture: none for a video or a missing file, `big` when Rust says `too-big`. */
export function useThumb(c: Capture, enabled = true): Thumb {
  const wants = enabled && c.exists && (c.kind === 'image' || c.kind === 'gif');
  const key = c.id;
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
    // The id names the capture; the object itself changes on every read.
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
