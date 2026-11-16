import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { IconBrandYoutube, IconCheck, IconPlaylistAdd, IconPlus } from '@tabler/icons-react';
import { create } from 'zustand';
import { quietFocus, tip } from '../../ui/HoverTip';
import { refKey } from './links';
import { ADD_ERRORS, MAX_LABEL, MAX_SAVED } from './saved';
import { MAX_OWN_VIDEOS, ownEntries, useOwnLists, type OwnVideo } from './ownLists';
import { countText, OwnTile } from './OwnParts';
import { useWatchStore } from './store';

/**
 * "Add to a playlist": the round button of the play row and the menu both it and a saved video's list row open.
 * The menu is a `role="menu"` of the playlists made on the wall (a check marks one that holds the video, and a click
 * on it takes the video out again) and a last row that makes a new playlist with this video in it. It takes any
 * `{ id, title?, channel?, seconds? }`, so the YouTube library uses it too (a row of the library, `limit` and `maxRows`).
 * Escape or a click outside closes it and the focus returns to the button. A playlist that is full reads "Full".
 */

export const MENU_WIDTH = 300;
/** The height of one row of the menu, in design pixels. */
export const MENU_ROW = 40;
const STAGE_H = 720;
/** True while a menu is open: the play row's controls do not fade away under it. */
export const useAddMenuOpen = create<{ open: boolean }>(() => ({ open: false }));

interface Place {
  left: number;
  top: number;
}

/**
 * Where the menu goes inside `host` (in the host's own pixels): under the anchor, with its right edge on the host's
 * (`edge: 'host'`) or the anchor's. In a card (`edge: 'anchor'`) it opens upward from the anchor when there is no room below
 * inside the host's lower edge plus 8 px, and it never leaves the 2560 by 720 stage. With `limit` (a box inside the
 * host, such as a list that ends above a player) the lower edge is that box's foot plus 8 px instead.
 */
export function place(host: HTMLElement, anchor: HTMLElement, edge: 'host' | 'anchor', height: number, limit?: HTMLElement | null): Place {
  const h = host.getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  const scale = host.offsetWidth > 0 && h.width > 0 ? h.width / host.offsetWidth : 1;
  // A positioned child is placed from the host's padding edge, so a host with a border (the music card) starts that far in. Only a
  // menu with a `limit` (the library's rows) allows for it, so the menus of Watch keep the places they have always had.
  const [bx, by] = limit ? [host.clientLeft || 0, host.clientTop || 0] : [0, 0];
  const right = edge === 'host' ? host.offsetWidth : (a.right - h.left) / scale - bx;
  const left = Math.max(8, Math.min(right - MENU_WIDTH, host.offsetWidth - MENU_WIDTH - 8));
  let top = (a.bottom - h.top) / scale - by + 6;
  if (edge === 'anchor' && height > 0) {
    const foot = limit ? (limit.getBoundingClientRect().bottom - h.top) / scale - by + 8 : host.offsetHeight + 8;
    if (top + height > foot) top = (a.top - h.top) / scale - by - 6 - height;
    // Whatever the choice, the menu stays inside the stage.
    const stage = host.closest('.stage')?.getBoundingClientRect();
    const hostY = (h.top - (stage?.top ?? 0)) / scale;
    top = Math.max(0, 8 - hostY, Math.min(top, STAGE_H - 8 - hostY - height));
  }
  return { left: edge === 'host' ? host.offsetWidth - MENU_WIDTH : left, top };
}

export function AddMenu({
  video,
  anchor,
  host,
  edge = 'anchor',
  limit,
  maxRows,
  onClose,
}: {
  video: OwnVideo;
  anchor: HTMLElement;
  host: HTMLElement;
  edge?: 'host' | 'anchor';
  /** A box inside the host whose foot the menu must stay above (it opens upward instead). */
  limit?: HTMLElement | null;
  /** At most this many playlist rows show; more scroll inside the list (the menu then always fits above or below a row). */
  maxRows?: number;
  onClose: () => void;
}) {
  const saved = useWatchStore((s) => s.saved);
  const lists = useOwnLists((s) => s.lists);
  const entries = ownEntries(saved);
  const full = saved.length >= MAX_SAVED;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('My playlist');
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState<Place | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  // An error line adds about 30 px: a menu with a `limit` is placed again when it shows or goes.
  useLayoutEffect(() => setAt(place(host, anchor, edge, menu.current?.offsetHeight ?? 0, limit)), [host, anchor, edge, limit, entries.length, adding, limit ? error : null]);
  useEffect(() => {
    useAddMenuOpen.setState({ open: true });
    return () => useAddMenuOpen.setState({ open: false });
  }, []);
  // The first row takes the focus when it opens.
  useEffect(() => {
    if (!at) return;
    quietFocus();
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at === null]);
  useEffect(() => {
    if (adding) {
      field.current?.focus();
      field.current?.select();
    }
  }, [adding]);
  // A click outside closes it; the click itself goes on to what it hit.
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target instanceof Node ? e.target : null;
      if (t && (menu.current?.contains(t) || anchor.contains(t))) return;
      onClose();
      // As with Escape, the focus goes back to the button (a click on another control then takes it from there).
      quietFocus();
      anchor.focus();
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [anchor, onClose]);

  const close = (back: boolean) => {
    onClose();
    if (back) {
      quietFocus();
      anchor.focus();
    }
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Enter' && document.activeElement instanceof HTMLElement && document.activeElement.getAttribute('role') === 'menuitem') {
      // Enter picks the focused row (the key's own press, not left to a click).
      e.preventDefault();
      document.activeElement.click();
    } else if (e.key === 'Tab') close(false);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length : i) - 1;
      items[next]?.focus();
    }
  };

  const pick = (id: string, label: string) => {
    const list = lists[id];
    const own = useOwnLists.getState();
    if (list?.items.some((i) => i.id === video.id)) own.removeVideo(id, video.id);
    else {
      const refused = own.addVideo(id, video);
      if (refused) setError(`${label}: ${refused}`);
    }
  };
  // The plain choice: the video by itself in the Watch list, with its real title when this menu knows it.
  const aloneKey = refKey({ kind: 'video', id: video.id });
  const alone = saved.some((i) => refKey(i) === aloneKey);
  const pickAlone = () => {
    const st = useWatchStore.getState();
    if (alone) {
      st.remove(aloneKey);
      return;
    }
    const refused = st.addRef({ kind: 'video', id: video.id }, false);
    if (refused) setError(`Watch list: ${refused}`);
    else if (video.title) st.fillLabel(aloneKey, video.title);
  };
  const make = () => {
    const made = useOwnLists.getState().create(name, video);
    if (!made.ok) {
      setError(made.error);
      return;
    }
    close(true);
  };

  const style = at ? { left: at.left, top: at.top, width: MENU_WIDTH } : { left: 0, top: 0, width: MENU_WIDTH, visibility: 'hidden' as const };
  return createPortal(
    <div ref={menu} className="w-pop" role="menu" aria-label="Add this video to a playlist" style={style} onKeyDown={onKey}>
      <div className="w-pop-k">Add this video to</div>
      <div className={`w-pop-rows${limit ? ' limited' : ''}`} style={maxRows ? { maxHeight: maxRows * MENU_ROW } : undefined}>
        {entries.map((e) => {
          const list = lists[e.id];
          const count = list?.items.length ?? 0;
          const has = !!list?.items.some((i) => i.id === video.id);
          const isFull = !has && count >= MAX_OWN_VIDEOS;
          return (
            <button
              key={e.id}
              type="button"
              role="menuitem"
              className={`w-pop-row${has ? ' has' : ''}${isFull ? ' full' : ''}`}
              aria-disabled={isFull || undefined}
              {...tip(isFull ? `This playlist is full (${MAX_OWN_VIDEOS})` : has ? `Take this video out of ${e.label}` : `Add this video to ${e.label}`)}
              onClick={() => (isFull ? undefined : pick(e.id, e.label))}
            >
              <OwnTile size={26} />
              <span className="u-ell">{e.label}</span>
              {has ? <IconCheck size={18} aria-hidden="true" className="w-pop-check" /> : null}
              <em aria-hidden="true">{isFull ? 'Full' : count}</em>
              <span className="w-vh">, {countText(count).toLowerCase()}</span>
            </button>
          );
        })}
        <button
          type="button"
          role="menuitem"
          className={`w-pop-row${alone ? ' has' : ''}${!alone && full ? ' full' : ''}`}
          aria-disabled={(!alone && full) || undefined}
          {...tip(alone ? 'Take this video out of the Watch list' : full ? ADD_ERRORS.full : 'Save this video in the Watch list on its own, not in a playlist')}
          onClick={() => (!alone && full ? undefined : pickAlone())}
        >
          <IconBrandYoutube size={26} aria-hidden="true" />
          <span className="u-ell">Watch list, on its own</span>
          {alone ? <IconCheck size={18} aria-hidden="true" className="w-pop-check" /> : null}
        </button>
      </div>
      {adding ? (
        <form
          className="w-pop-new"
          onSubmit={(e) => {
            e.preventDefault();
            make();
          }}
        >
          <input
            ref={field}
            className="w-name-in"
            value={name}
            maxLength={MAX_LABEL}
            aria-label="Name for the new playlist"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setAdding(false);
                setError(null);
              }
            }}
          />
          <button type="submit" className="w-mini" aria-label="Make the playlist" {...tip('Make the playlist with this video in it')}>
            <IconCheck size={20} aria-hidden="true" />
          </button>
        </form>
      ) : (
        <button
          type="button"
          role="menuitem"
          className="w-pop-row dim"
          aria-disabled={full || undefined}
          {...tip(full ? ADD_ERRORS.full : 'Make a playlist with this video in it')}
          onClick={() => (full ? undefined : setAdding(true))}
        >
          <i className="w-pop-plus">
            <IconPlus size={16} aria-hidden="true" />
          </i>
          <span className="u-ell">New playlist</span>
        </button>
      )}
      {error ? (
        <div className="w-err" role="alert">
          {error}
        </div>
      ) : null}
    </div>,
    host,
  );
}

/** The round button of the play row that opens the menu for the video in the frame. */
export function AddToPlaylistButton({ video }: { video: OwnVideo }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  // The menu is a child of the left block (not of the control row): its right edge is the block's.
  useLayoutEffect(() => setHost(btn.current?.closest<HTMLElement>('.w-now') ?? null), []);
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`rd w-addpl${open ? ' lit' : ''}`}
        aria-label="Add to a playlist"
        aria-haspopup="menu"
        aria-expanded={open}
        {...tip('Add to a playlist')}
        onClick={() => setOpen((o) => !o)}
      >
        <IconPlaylistAdd size={20} aria-hidden="true" />
      </button>
      {open && host && btn.current ? <AddMenu video={video} anchor={btn.current} host={host} edge="host" onClose={() => setOpen(false)} /> : null}
    </>
  );
}
