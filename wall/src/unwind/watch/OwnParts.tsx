import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { IconPlaylist } from '@tabler/icons-react';
import { defaultLabel, validId } from './links';
import type { OwnVideo } from './ownLists';
import { reportedFor } from './ownPlay';
import type { SavedItem } from './saved';
import { clock } from './Watch';

/**
 * Small pieces the wall-made playlists share: the tile that marks one, the texts for counts and lengths, and
 * the small picture of a video. The picture address is built only from an id that passes the video shape and
 * only through `ownThumb`, an object seam the development mock replaces with drawn `data:` motifs, so no review
 * page or test loads YouTube's picture host.
 */

export const ownThumb = {
  /** The small picture's address for a video id; null for anything that is not a video id. */
  url: (id: string): string | null => (validId('video', id) ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null),
};

/** The tile of a playlist made on the wall: a violet to pink wash with the playlist icon. */
export function OwnTile({ size = 26 }: { size?: number }) {
  return (
    <i className="own-tile" style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }} aria-hidden="true">
      <IconPlaylist size={Math.round(size * 0.66)} aria-hidden="true" />
    </i>
  );
}

/** A video's small picture, or a neutral tile when it has none or cannot be loaded. */
export function OwnThumb({ id, w = 64, h = 36 }: { id: string; w?: number; h?: number }) {
  const [bad, setBad] = useState(false);
  const url = ownThumb.url(id);
  const style = { width: w, height: h };
  if (!url || bad) return <i className="own-thumb none" style={style} aria-hidden="true" />;
  return <img className="own-thumb" style={style} src={url} alt="" referrerPolicy="no-referrer" loading="lazy" draggable={false} onError={() => setBad(true)} />;
}

/** "12 videos", "1 video", "No videos". */
export function countText(n: number): string {
  return n === 0 ? 'No videos' : n === 1 ? '1 video' : `${n} videos`;
}

/** A length as the player shows it ("1:05", "1:02:03"). */
export function lengthText(seconds: number): string {
  return clock(seconds);
}

/** "10 h 13 min", "38 min", "2 h", "45 s": a sum of lengths for people. */
export function spanText(seconds: number): string {
  const t = Math.max(0, Math.round(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  if (m > 0) return `${m} min`;
  return `${t} s`;
}

/** "12 videos · 10 h 13 min"; the count alone while any length is unknown (a partial sum would read as the whole). */
export function totalsText(items: readonly OwnVideo[]): { text: string; partial: boolean } {
  const known = items.every((i) => i.seconds !== undefined);
  if (!known || items.length === 0) return { text: countText(items.length), partial: items.length > 0 };
  return { text: `${countText(items.length)} · ${spanText(items.reduce((s, i) => s + (i.seconds ?? 0), 0))}`, partial: false };
}

/** The second line of a video row: "channel · length", whichever are known. */
export function metaText(v: OwnVideo): string {
  return [v.channel, v.seconds !== undefined ? lengthText(v.seconds) : ''].filter(Boolean).join(' · ');
}

/** A saved single video as a playlist video: the owner's label as the title unless it is still the default, plus any report for it this session. */
export function savedVideo(item: SavedItem): OwnVideo {
  const known = reportedFor(item.id);
  const v: OwnVideo = { id: item.id };
  const title = item.label !== defaultLabel(item) ? item.label : known.title;
  if (title) v.title = title;
  if (known.channel) v.channel = known.channel;
  if (known.seconds !== undefined) v.seconds = known.seconds;
  return v;
}

/** The one confirmation before a playlist and its videos are deleted: "Delete <name> and its 12 videos?", Delete or Keep (Escape keeps). */
export function DeleteAsk({ name, count, onDelete, onKeep }: { name: string; count: number; onDelete: () => void; onKeep: () => void }) {
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => keep.current?.focus(), []);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onKeep();
  };
  const what = count === 0 ? `Delete ${name}?` : `Delete ${name} and its ${countText(count).toLowerCase()}?`;
  return (
    <div className="own-ask" role="dialog" aria-label={`Delete ${name}`} onKeyDown={onKey}>
      <span className="own-ask-t u-ell" title={what}>
        {what}
      </span>
      <button type="button" className="own-btn danger" onClick={onDelete}>
        Delete
      </button>
      <button ref={keep} type="button" className="own-btn" onClick={onKeep}>
        Keep
      </button>
    </div>
  );
}

/** True while a scrolling list has rows below what shows (so it can fade at the bottom); read on resize and whenever `count` changes. */
export function useFadeBelow(ref: RefObject<HTMLElement | null>, count: number) {
  const [more, setMore] = useState(false);
  const check = useCallback(() => {
    const el = ref.current;
    setMore(!!el && el.scrollHeight - el.scrollTop - el.clientHeight > 2);
  }, [ref]);
  useEffect(() => {
    check();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [check, count, ref]);
  return { more, check };
}
