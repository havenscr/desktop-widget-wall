import { useEffect, useId, useRef, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { IconArrowsShuffle, IconChevronRight, IconListDetails, IconPlayerPlayFilled } from '@tabler/icons-react';
import type { SpotifyItem } from '../../music/spotify';
import { hideTip, pinTip, quietFocus, TIP_DELAY_MS } from '../../ui/HoverTip';
import { libraryMenuOpen, setSourceFocus } from '../watch/libraryMenu';
import { libraryHandlers } from '../watch/libraryOpen';
import { Cover } from './Cover';
import { kindLine, songs, tileLine } from './model';

/** After the pointer leaves a tile, its details card stays this long so the pointer can reach it. */
export const DETAILS_LINGER_MS = 300;

/**
 * How many columns a grid of tiles shows right now: the browser's resolved tracks, or a `repeat(n, ...)` written
 * in the style, else the tiles that share the first one's top edge. A single column is the floor.
 */
export function gridColumns(grid: HTMLElement, tiles: HTMLElement[]): number {
  const cols = getComputedStyle(grid).gridTemplateColumns;
  const repeat = /repeat\((\d+)/.exec(cols);
  if (repeat) return Math.max(1, Number(repeat[1]));
  const tracks = cols.trim().split(/\s+/).filter((t) => /^[\d.]+px$/.test(t));
  if (tracks.length > 0) return tracks.length;
  const top = tiles[0]?.getBoundingClientRect().top;
  return Math.max(1, tiles.filter((t) => Math.abs(t.getBoundingClientRect().top - top) < 2).length);
}

/** The tile an arrow key reaches from tile `i` of `n` in a grid of `cols`: edges stay put, a short last row is reached by Down. */
export function arrowTarget(i: number, n: number, cols: number, key: string): number {
  const lastRow = Math.floor((n - 1) / cols);
  const row = Math.floor(i / cols);
  if (key === 'ArrowLeft') return i > 0 ? i - 1 : i;
  if (key === 'ArrowRight') return i < n - 1 ? i + 1 : i;
  if (key === 'ArrowUp') return i - cols >= 0 ? i - cols : i;
  if (key === 'ArrowDown') return i + cols <= n - 1 ? i + cols : row < lastRow ? n - 1 : i;
  return i;
}

/** Arrow keys move the focus between the tiles of one grid (the resting card's and the tall view's). True when it was an arrow. */
function gridKey(e: ReactKeyboardEvent<HTMLButtonElement>): boolean {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return false;
  const grid = e.currentTarget.closest<HTMLElement>('.sp-grid');
  if (!grid) return false;
  const tiles = [...grid.querySelectorAll<HTMLElement>('.sp-tile')];
  const at = tiles.indexOf(e.currentTarget);
  if (at < 0) return false;
  e.preventDefault();
  const to = arrowTarget(at, tiles.length, gridColumns(grid, tiles), e.key);
  if (to !== at) {
    tiles[to].focus();
    tiles[to].scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
  return true;
}

/** Set while the program puts focus back on a tile after Escape: that focus must not reopen the card. */
let keepClosed = false;

// Focus that a library menu gives back to its source (a tile) must not open the tile's card.
setSourceFocus((el) => {
  quietFocus();
  keepClosed = true;
  try {
    el.focus();
  } finally {
    keepClosed = false;
  }
});

/**
 * The details card for a tile (R2): the name, the kind with its owner or artist said once, the
 * song count when the bridge gives one (nothing is shown that it does not give), and Play,
 * Shuffle and Songs. It is the shared tip in its pinned form, so its buttons take the pointer.
 * From the keyboard it is the next stop after its tile (the card is drawn elsewhere in the page,
 * so the tile hands the focus over): Tab walks Play, Shuffle, Songs; Shift+Tab from Play and
 * Escape go back to the tile; Tab past Songs closes it and moves on to the next tile.
 */
function TileDetails({ tileId, item, onOpen, onPlay, onShuffle }: { tileId: string; item: SpotifyItem; onOpen: () => void; onPlay: () => void; onShuffle: () => void }) {
  const act = (f: () => void) => () => {
    hideTip(true);
    f();
  };
  const tile = () => document.querySelector<HTMLElement>(`.sp-tile[data-tile="${tileId}"]`);
  const key = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      hideTip(true);
      // Focus returns to the tile without opening its card again.
      keepClosed = true;
      try {
        tile()?.focus();
      } finally {
        keepClosed = false;
      }
      return;
    }
    if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey) return;
    const buttons = [...e.currentTarget.querySelectorAll<HTMLElement>('button')];
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && at === 0) {
      e.preventDefault();
      tile()?.focus();
    } else if (!e.shiftKey && at === buttons.length - 1) {
      const tiles = [...document.querySelectorAll<HTMLElement>('.sp-tile')];
      const next = tiles[tiles.indexOf(tile() as HTMLElement) + 1];
      hideTip(true);
      // The next tile takes the focus (and opens its own card); with none, the focus moves on by itself.
      if (next) {
        e.preventDefault();
        next.focus();
      }
    }
  };
  // Focus that leaves the card for anywhere but its tile or another tile closes it.
  const blur = (e: FocusEvent<HTMLDivElement>) => {
    const to = e.relatedTarget as Element | null;
    if (to && (e.currentTarget.contains(to) || to.closest('.sp-tile'))) return;
    hideTip(true);
  };
  return (
    <div className="sp-details" data-for={tileId} onKeyDown={key} onBlur={blur}>
      <div className="sp-dname">{item.name}</div>
      <div className="sp-dline">{kindLine(item)}</div>
      {item.count !== null ? (
        <dl className="sp-dfacts">
          <dt>Songs</dt>
          <dd>{item.count.toLocaleString('en-US')}</dd>
        </dl>
      ) : null}
      <div className="sp-dbtns">
        <button type="button" className="sp-btn fill" onClick={act(onPlay)}>
          <IconPlayerPlayFilled size={16} aria-hidden="true" />
          Play
        </button>
        <button type="button" className="sp-btn plain" onClick={act(onShuffle)}>
          <IconArrowsShuffle size={16} aria-hidden="true" />
          Shuffle
        </button>
        <button type="button" className="sp-btn plain" onClick={act(onOpen)}>
          Songs
          <IconChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** The playing song's mark (R3): four small cyan bars that move gently (still with reduced motion). */
export function PlayingBars() {
  return (
    <span className="sp-bars" role="img" aria-label="Playing now">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

/**
 * A playlist or album as a large cover tile (R1): the cover fills the tile, the name and the song
 * count under it (both shortened with an ellipsis). A click (or Enter) opens its songs; resting on
 * it, or taking keyboard focus on it, rings it and opens its details card (one card at a time, so
 * a click after a keyboard focus never leaves two); leaving it closes the card unless the pointer
 * went onto it. Tab goes into the card (see `TileDetails`); Escape closes it.
 */
export function Tile({ item, kindWord, onOpen, onPlay, onShuffle }: { item: SpotifyItem; kindWord: boolean; onOpen: () => void; onPlay: () => void; onShuffle: () => void }) {
  const tileId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A press on the tile focuses it too; that focus is the click's, and the click closes the card.
  const pressed = useRef(false);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);
  const menu = item.kind === 'track'
    ? null
    : libraryHandlers({
        entry: { kind: item.kind === 'album' ? 'spotify-album' : 'spotify-playlist', id: item.id, name: item.name, art: item.imageUrl ?? item.thumbUrl ?? undefined },
        name: item.name,
        actions: () => [
          { id: 'play', label: 'Play', icon: <IconPlayerPlayFilled size={20} aria-hidden="true" />, run: onPlay },
          { id: 'shuffle', label: 'Shuffle', icon: <IconArrowsShuffle size={20} aria-hidden="true" />, run: onShuffle },
          { id: 'songs', label: 'Songs', icon: <IconListDetails size={20} aria-hidden="true" />, run: onOpen },
        ],
      });
  const card = () => <TileDetails tileId={tileId} item={item} onOpen={onOpen} onPlay={onPlay} onShuffle={onShuffle} />;
  const show = (el: HTMLElement) => {
    clear();
    timer.current = setTimeout(() => {
      if (!libraryMenuOpen()) pinTip(el, card, { side: true });
    }, TIP_DELAY_MS);
  };
  const leave = () => {
    clear();
    timer.current = setTimeout(() => {
      if (!document.querySelector('.hover-tip:hover, .sp-tile:hover')) hideTip(true);
    }, DETAILS_LINGER_MS);
  };
  const cardOpen = () => !!document.querySelector(`.hover-tip .sp-details[data-for="${tileId}"]`);
  return (
    <div className="sp-tilebox" role="listitem">
      <button
        type="button"
        className="sp-tile"
        data-tile={tileId}
        aria-label={`${item.name}, ${kindLine(item)}${item.count !== null ? `, ${songs(item.count)}` : ''}. Open its songs`}
        onMouseEnter={(e) => show(e.currentTarget)}
        onMouseLeave={() => {
          pressed.current = false;
          leave();
        }}
        onMouseDown={() => {
          pressed.current = true;
        }}
        onFocus={(e) => {
          if (pressed.current || keepClosed || libraryMenuOpen()) {
            pressed.current = false;
            return;
          }
          clear();
          // Bring it into view first, so the card is placed where the tile will stay.
          e.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
          pinTip(e.currentTarget, card, { side: true });
        }}
        onBlur={(e) => {
          pressed.current = false;
          const to = e.relatedTarget as Element | null;
          // Focus going into the card, or on to another tile, keeps or replaces the card.
          if (to && (to.closest('.hover-tip') || to.closest('.sp-tile'))) return;
          leave();
        }}
        onContextMenu={menu?.onContextMenu}
        onKeyDown={(e) => {
          if (menu?.onMenuKey(e)) return;
          if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && gridKey(e)) return;
          if (!cardOpen() || e.ctrlKey || e.altKey || e.metaKey) return;
          if (e.key === 'Escape') {
            e.stopPropagation();
            clear();
            hideTip(true);
          } else if (e.key === 'Tab' && !e.shiftKey) {
            const first = document.querySelector<HTMLElement>(`.hover-tip .sp-details[data-for="${tileId}"] button`);
            if (first) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
        onClick={() => {
          pressed.current = false;
          clear();
          hideTip(true);
          onOpen();
        }}
      >
        <Cover src={item.imageUrl ?? item.thumbUrl} size={0} className="sp-tilecover" />
        <span className="sp-tname2">{item.name}</span>
        <span className="sp-tline">{kindWord ? `${item.kind === 'album' ? 'Album' : 'Playlist'} · ${tileLine(item)}` : tileLine(item)}</span>
      </button>
    </div>
  );
}
