import { useEffect, useId, useRef, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { IconArrowsShuffle, IconChevronRight, IconPlayerPlayFilled } from '@tabler/icons-react';
import type { SpotifyItem } from '../../music/spotify';
import { hideTip, pinTip, TIP_DELAY_MS } from '../../ui/HoverTip';
import { Cover } from './Cover';
import { kindLine, songs, tileLine } from './model';

/** After the pointer leaves a tile, its details card stays this long so the pointer can reach it. */
export const DETAILS_LINGER_MS = 300;

/** Set while the program puts focus back on a tile after Escape: that focus must not reopen the card. */
let keepClosed = false;

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
  const card = () => <TileDetails tileId={tileId} item={item} onOpen={onOpen} onPlay={onPlay} onShuffle={onShuffle} />;
  const show = (el: HTMLElement) => {
    clear();
    timer.current = setTimeout(() => pinTip(el, card, { side: true }), TIP_DELAY_MS);
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
          if (pressed.current || keepClosed) {
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
        onKeyDown={(e) => {
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
