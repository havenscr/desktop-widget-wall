import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconBrandYoutube, IconCalendar, IconClock, IconEye, IconMusic, IconPlayerPlayFilled, IconPlaylistAdd, IconThumbUp, IconUser } from '@tabler/icons-react';
import type { YtVideo } from '../../music/youtube';
import { hideTip, quietFocus, tip } from '../../ui/HoverTip';
import { useToolsStore } from '../../tools/store';
import { AddMenu } from '../watch/AddToPlaylist';
import { libraryMenuOpen } from '../watch/libraryMenuModel';
import { libraryHandlers } from '../watch/libraryOpen';
import { openInBrowser } from '../watch/openInBrowser';
import type { OwnVideo } from '../watch/ownLists';
import { useWatchStore } from '../watch/store';
import { PlayingBars, arrowTarget, gridColumns } from '../spotify/Tile';
import { DETAIL_CARD_MS, compactCount, detailWords, devCardKnob, failedReason, lengthText, problemAction, problemLine, rowThumb, rowTip, rowWords, safeThumb, type YtProblem } from './model';
import { failedWords, sameList, useYtQueue, validVideoId, type QueueFrom } from './queue';

/** Arrow keys move the focus between the tiles of the grid (the card's own walk, `arrowTarget`). */
export function gridKey(e: ReactKeyboardEvent<HTMLButtonElement>): void {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  const grid = e.currentTarget.closest<HTMLElement>('.yt-grid');
  if (!grid) return;
  const tiles = [...grid.querySelectorAll<HTMLElement>('.yt-tile')];
  const at = tiles.indexOf(e.currentTarget);
  if (at < 0) return;
  e.preventDefault();
  const to = arrowTarget(at, tiles.length, gridColumns(grid, tiles), e.key);
  if (to !== at) {
    tiles[to].focus();
    tiles[to].scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
}

/**
 * A picture from YouTube's picture host, or a neutral tile with a music note when there is none or it
 * fails to load. Sent without a referrer, drawn lazily, never a link.
 */
export function YtThumb({ src, className = '' }: { src: string | null; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const safe = safeThumb(src);
  const show = safe && failed !== safe;
  return (
    <span className={`sp-cover ${className}`}>
      {show ? <img src={safe} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(safe)} /> : <IconMusic size={36} stroke={1.5} aria-hidden="true" />}
    </span>
  );
}

/** One line and the one thing to do about it. */
export function YtState({ problem, onRetry, onBack }: { problem: YtProblem; onRetry: () => void; onBack?: () => void }) {
  const action = problemAction(problem);
  return (
    <div className="yt-state" role="status">
      <span>{problemLine(problem)}</span>
      {action === 'tools' ? (
        <button type="button" className="sp-btn" onClick={() => useToolsStore.getState().openDrawer('accounts')}>
          Open Tools
        </button>
      ) : action === 'retry' ? (
        <button type="button" className="sp-btn" onClick={onRetry}>
          Retry
        </button>
      ) : action === 'back' && onBack ? (
        <button type="button" className="sp-btn" onClick={onBack}>
          Back
        </button>
      ) : null}
    </div>
  );
}

/** A plain message in the same place (an empty list). */
export function YtEmpty({ text }: { text: string }) {
  return <div className="yt-state">{text}</div>;
}

/** Skeleton tiles while the first page is read: no spinner, no text. */
export function TileSkeletons({ count }: { count: number }) {
  return (
    <div className="yt-grid" aria-busy="true" data-skeleton="tiles">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="yt-skel-tile">
          <span className="yt-skel yt-skel-cover" />
          <span className="yt-skel yt-skel-line" />
          <span className="yt-skel yt-skel-line short" />
        </div>
      ))}
    </div>
  );
}

/** Skeleton rows while the first page of a list of videos is read. */
export function RowSkeletons({ count }: { count: number }) {
  return (
    <div className="yt-rows-skel" aria-busy="true" data-skeleton="rows">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="yt-skel-row">
          <span className="yt-skel yt-skel-num" />
          <span className="yt-skel yt-skel-title" />
          <span className="yt-skel yt-skel-chan" />
          <span className="yt-skel yt-skel-len" />
        </div>
      ))}
    </div>
  );
}

/**
 * The control's own hover card. The row's card goes at once when the pointer lands on the control, and the control's
 * focus is not also the row's (the row's handler would show its card over this one).
 */
const addTip = (() => {
  const t = tip('Add to a playlist');
  return {
    ...t,
    onMouseEnter: (e: MouseEvent) => {
      hideTip();
      t.onMouseEnter(e);
    },
    onFocus: (e: FocusEvent) => {
      e.stopPropagation();
      t.onFocus(e);
    },
  };
})();

/** Playlist rows the add menu shows before its list scrolls: three at rest, four in the tall view (so it always fits above or below a row). */
const MENU_ROWS = { rest: 3, tall: 4 } as const;

/** What a row stores in a playlist of the owner's own: what the row already holds, so no read of YouTube is needed (a length of 0, a live video, is left out). */
export function ownVideo(v: YtVideo): OwnVideo {
  return { id: v.id, title: v.title, channel: v.channel, ...(v.seconds > 0 ? { seconds: v.seconds } : {}) };
}

/** Width of the details card, and its gap to the edge of the music card, in the music card's own pixels. */
const CARD_W = 400;
const CARD_EDGE = 12;

/**
 * The details card of a search result: a larger picture, title, channel, views, likes, length, upload month and the first
 * three lines of the description. It is drawn inside the music card (`host`), at its right side, under the row when there
 * is room below, else above it, else as high as it fits, and never leaves the card. It takes no pointer, so it never
 * holds the pointer away from the row it describes.
 */
export function DetailCard({ video, anchor, host }: { video: YtVideo; anchor: HTMLElement; host: HTMLElement }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const words = detailWords(video);
  useLayoutEffect(() => {
    const box = host.getBoundingClientRect();
    const row = anchor.getBoundingClientRect();
    const scale = host.offsetWidth > 0 && box.width > 0 ? box.width / host.offsetWidth : 1;
    const inner = host.clientHeight || host.offsetHeight;
    const room = host.clientWidth || host.offsetWidth;
    // Never wider than the card less its edges, never taller than the card less its edges.
    const width = room > 0 ? Math.max(0, Math.min(CARD_W, room - 2 * CARD_EDGE)) : CARD_W;
    const maxHeight = inner > 0 ? Math.max(0, inner - 2 * CARD_EDGE) : 100_000;
    if (ref.current) {
      ref.current.style.width = `${width}px`;
      ref.current.style.maxHeight = `${maxHeight}px`;
    }
    const height = Math.min(ref.current?.offsetHeight ?? 0, maxHeight);
    const top0 = (row.top - box.top) / scale - (host.clientTop || 0);
    const bottom0 = (row.bottom - box.top) / scale - (host.clientTop || 0);
    let top = bottom0 + 6;
    if (top + height > inner - CARD_EDGE) top = top0 - 6 - height;
    top = Math.max(CARD_EDGE, Math.min(top, inner - CARD_EDGE - height));
    setAt({ left: Math.max(CARD_EDGE, room - width - CARD_EDGE), top, width, maxHeight });
  }, [host, anchor, video]);
  if (!words) return null;
  const facts: [ReactNode, string][] = [
    [<IconUser key="u" size={15} stroke={1.8} aria-hidden="true" />, video.channel],
    [<IconEye key="e" size={15} stroke={1.8} aria-hidden="true" />, words.views ? `${words.views} views` : ''],
    [<IconThumbUp key="t" size={15} stroke={1.8} aria-hidden="true" />, words.likes],
    [<IconClock key="c" size={15} stroke={1.8} aria-hidden="true" />, words.length],
    [<IconCalendar key="d" size={15} stroke={1.8} aria-hidden="true" />, words.month],
  ];
  return createPortal(
    <div ref={ref} className="yt-dcard" role="tooltip" data-detail-card="" style={{ width: at?.width ?? CARD_W, maxHeight: at?.maxHeight, overflow: 'hidden', left: at?.left ?? 0, top: at?.top ?? 0, visibility: at ? 'visible' : 'hidden' }}>
      <YtThumb src={rowThumb(video)} className="yt-dcard-pic" />
      <b className="yt-dcard-title">{video.title}</b>
      <div className="yt-dcard-facts">
        {facts.map(([icon, text], i) =>
          text ? (
            <span key={i}>
              {icon}
              {text}
            </span>
          ) : null,
        )}
      </div>
      {words.description ? <p className="yt-dcard-desc">{words.description}</p> : null}
    </div>,
    host,
  );
}

/** The row whose add menu is open: its place in the list, the video and the control the menu hangs from. */
interface OpenMenu {
  at: number;
  id: string;
  anchor: HTMLElement;
  host: HTMLElement;
  /** The rows scroller: the menu stays above its foot and closes when it scrolls. */
  scroller: HTMLElement | null;
  tall: boolean;
}

/**
 * The rows of a list of videos: number, title, channel, length. A row that plays outside YouTube is a
 * button (the play mark in place of its number on hover, Enter and Space as for any button) and plays the
 * list from that row on the wall; the row now playing (the queue's, same list, same place) is cyan with the
 * moving bars in place of its number (its number, in cyan, while paused). A row that will not play (it
 * plays only on YouTube, is private or removed, or failed this session) is greyed, with its words in the
 * length column, and is a plain `li`: no button, no click, and its hover card says why. Every row has a hover
 * card with the whole title, the channel, the length and what a click does.
 *
 * A row that plays also has "Add to a playlist": a 30 by 30 button of its own at the right end (a sibling of the
 * play button, never inside it), shown on hover of the row and on keyboard focus within it, in the length's place.
 * It opens the Watch menu (`AddMenu`) for the video; the menu is not a child of the row, so its keys and focus never
 * reach the row's hover card. It closes when the list scrolls, when the list or the row changes, on Escape and on a
 * click outside.
 */
export function YtRows({ items, foot, list, onPlay, rich = false }: { items: YtVideo[]; foot?: ReactNode; list?: QueueFrom; onPlay?: (index: number) => void; rich?: boolean }) {
  const failed = useYtQueue((s) => s.failed);
  const from = useYtQueue((s) => s.from);
  const entry = useYtQueue((s) => s.entries[s.pos]);
  const live = useWatchStore((s) => (s.source === 'music' ? (s.playing?.id ?? null) : null));
  const paused = useWatchStore((s) => s.paused || s.needsClick);
  const now = list && entry && live === entry.id && sameList(from, list) ? entry : null;
  // The playing row is found by its video, not by the place it had when it was started: a sort moves it.
  const nowAt = now ? items.findIndex((x) => x.id === now.id) : -1;
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  // The row whose "Open in YouTube" failed: its card says so for 5 seconds.
  const [openFailed, setOpenFailed] = useState<string | null>(null);
  const failTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (failTimer.current !== null && clearTimeout(failTimer.current)), []);
  // A search's rows (`rich`) have a picture, a views column and a details card that shows after the pointer rests on a row for half a second.
  const [card, setCard] = useState<{ video: YtVideo; anchor: HTMLElement; host: HTMLElement } | null>(null);
  const cardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeCard = () => {
    if (cardTimer.current !== null) clearTimeout(cardTimer.current);
    cardTimer.current = null;
    setCard(null);
  };
  useEffect(() => () => void (cardTimer.current !== null && clearTimeout(cardTimer.current)), []);
  // The card goes with its row: another list, another order, or a scroll of the list.
  // A new order, page or search also drops a half-second wait that began on the old rows (a new array of the same rows in the same order does not).
  const rowsKey = items.map((v) => v.id).join(',');
  useEffect(() => {
    if (cardTimer.current !== null) clearTimeout(cardTimer.current);
    cardTimer.current = null;
  }, [rowsKey]);
  useEffect(() => setCard((c) => (c && items.some((v) => v.id === c.video.id) && c.anchor.isConnected ? c : null)), [items]);
  const listEl = useRef<HTMLOListElement | null>(null);
  const addButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const listKey = list ? JSON.stringify(list) : '';
  // The menu goes when the list is another one, or when its row is no longer where it was (Refresh, a new page).
  useEffect(() => setMenu(null), [listKey]);
  useEffect(() => setCard(null), [listKey]);
  // ... and the details card goes when the list scrolls.
  useEffect(() => {
    const scroller = card?.anchor.closest<HTMLElement>('.yt-scroll');
    if (!scroller) return;
    scroller.addEventListener('scroll', closeCard);
    return () => scroller.removeEventListener('scroll', closeCard);
  }, [card]);
  useEffect(() => {
    setMenu((m) => (m && items[m.at]?.id === m.id ? m : null));
  }, [items]);
  // ... and when the list scrolls (a scroll of the menu's own list is a different box and does not count).
  useEffect(() => {
    const scroller = menu?.scroller;
    if (!menu || !scroller) return;
    const close = () => {
      // The focus was in the menu: it goes back to the control, as after Escape.
      if (document.activeElement?.closest('.w-pop')) {
        quietFocus();
        menu.anchor.focus();
      }
      setMenu(null);
    };
    scroller.addEventListener('scroll', close);
    return () => scroller.removeEventListener('scroll', close);
  }, [menu]);
  // Development knob: after the effects above, so their first run does not close it.
  useEffect(() => {
    if (!rich) return;
    const at = devCardKnob();
    const anchor = at === null ? null : (listEl.current?.children[at] as HTMLElement | undefined);
    const video = at === null ? undefined : items[at];
    const host = anchor?.closest<HTMLElement>('.sp-card');
    if (!anchor || !video || !host || !detailWords(video)) return;
    setCard((c) => c ?? { video, anchor, host });
  }, [rich, items]);
  const menuVideo = useMemo(() => {
    const v = menu ? items[menu.at] : undefined;
    return v ? ownVideo(v) : null;
  }, [menu, items]);
  const openAt = (at: number, id: string, anchor: HTMLElement) => {
    const host = anchor.closest<HTMLElement>('.sp-card');
    if (!host) return;
    closeCard();
    setMenu((m) => (m && m.at === at ? null : { at, id, anchor, host, scroller: anchor.closest<HTMLElement>('.yt-scroll'), tall: host.classList.contains('tall') }));
  };
  return (
    <>
      <ol ref={listEl} className={`yt-list${rich ? ' rich' : ''}`}>
        {items.map((v, i) => {
          const gone = failed.get(v.id);
          // A row marked playable whose id does not have a video id's shape cannot be played: it is greyed, not a button that does nothing.
          const bad = v.playable === 'yes' && !validVideoId(v.id);
          const words = gone ? failedWords(gone) : bad ? 'Not available' : rowWords(v.playable);
          const plays = !words && !!onPlay && v.playable === 'yes';
          const on = i === nowAt;
          const lines = rowTip(v, gone ? failedReason(gone) : bad ? 'This video cannot be played here: YouTube gave it an address the wall cannot use.' : null);
          const cells = (
            <>
              {rich ? (
                <span className="yt-n yt-thn">
                  <YtThumb src={rowThumb(v)} className="yt-rowthumb" />
                  {on && !paused ? (
                    <span className="yt-thbars">
                      <PlayingBars />
                    </span>
                  ) : plays && !on ? (
                    <IconPlayerPlayFilled className="sp-hov" size={20} aria-hidden="true" />
                  ) : null}
                </span>
              ) : (
                <span className="yt-n">
                  {on && !paused ? (
                    <PlayingBars />
                  ) : (
                    <>
                      <span className="yt-num">{i + 1}</span>
                      {plays && !on ? <IconPlayerPlayFilled className="sp-hov" size={16} aria-hidden="true" /> : null}
                    </>
                  )}
                </span>
              )}
              <span className="yt-title">{v.title}</span>
              <span className="yt-chan">{v.channel}</span>
              {rich ? <span className="yt-views">{words ? '' : compactCount(v.views)}</span> : null}
              <span className="yt-len">{words ?? lengthText(v.seconds)}</span>
            </>
          );
          const open = menu?.at === i;
          const rowCard = tip(() => (
            <div className="sp-tipline">
              <b>{lines[0]}</b>
              {lines.slice(1).map((l, n) => (
                <span key={n}>{l}</span>
              ))}
              {openFailed === v.id ? <span>Could not open the browser</span> : null}
            </div>
          ));
          // The row's right-click menu: its own actions, then Pin to the left. A row with no length pins as a live stream.
          const rowMenu = plays
            ? libraryHandlers({
                entry: { kind: 'video', id: v.id, name: v.title },
                name: v.title,
                actions: () => [
                  { id: 'play', label: 'Play', icon: <IconPlayerPlayFilled size={20} aria-hidden="true" />, run: () => onPlay?.(i) },
                  {
                    id: 'add',
                    label: 'Add to a playlist',
                    icon: <IconPlaylistAdd size={20} aria-hidden="true" />,
                    chevron: true,
                    restore: false,
                    run: () => {
                      const anchor = addButtons.current[i];
                      if (anchor) openAt(i, v.id, anchor);
                    },
                  },
                  {
                    id: 'open',
                    label: 'Open in YouTube',
                    icon: <IconBrandYoutube size={20} aria-hidden="true" />,
                    run: () =>
                      void openInBrowser({ kind: 'video', id: v.id }).then((ok) => {
                        if (ok) return;
                        setOpenFailed(v.id);
                        if (failTimer.current !== null) clearTimeout(failTimer.current);
                        failTimer.current = setTimeout(() => setOpenFailed(null), 5000);
                      }),
                  },
                ],
              })
            : null;
          return (
            <li
              key={`${v.id}-${i}`}
              className={`yt-row${words ? ' off' : ''}${on ? ' on' : ''}${plays ? ' canadd' : ''}${open ? ' menu-open' : ''}`}
              data-playable={gone || bad ? 'no' : v.playable}
              {...rowCard}
              // The row's card stays away while a menu is open (the control has its own card).
              onMouseEnter={(e) => {
                if (menu || libraryMenuOpen()) return;
                rowCard.onMouseEnter(e);
                if (!rich || !detailWords(v)) return;
                const anchor = e.currentTarget;
                const host = anchor.closest<HTMLElement>('.sp-card');
                if (!host) return;
                if (cardTimer.current !== null) clearTimeout(cardTimer.current);
                cardTimer.current = setTimeout(() => {
                  cardTimer.current = null;
                  if (!anchor.isConnected) return;
                  // The row's own small card gives way to this one.
                  hideTip();
                  setCard({ video: v, anchor, host });
                }, DETAIL_CARD_MS);
              }}
              onMouseLeave={() => {
                rowCard.onMouseLeave();
                closeCard();
              }}
              onMouseDown={() => {
                rowCard.onMouseDown();
                closeCard();
              }}
              onFocus={(e) => (menu || libraryMenuOpen() ? undefined : rowCard.onFocus(e))}
            >
              {plays ? (
                <button type="button" className="yt-play yt-cells" aria-current={on ? 'true' : undefined} aria-label={`Play ${v.title}`} onClick={() => onPlay?.(i)} onContextMenu={rowMenu?.onContextMenu} onKeyDown={rowMenu ? (e) => void rowMenu.onMenuKey(e) : undefined}>
                  {cells}
                </button>
              ) : (
                <div className="yt-cells">{cells}</div>
              )}
              {plays ? (
                <button
                  type="button"
                  className="yt-add"
                  ref={(el) => {
                    addButtons.current[i] = el;
                  }}
                  aria-label={`Add ${v.title} to a playlist`}
                  aria-haspopup="menu"
                  aria-expanded={open}
                  {...addTip}
                  onClick={(e) => openAt(i, v.id, e.currentTarget)}
                >
                  <IconPlaylistAdd size={18} aria-hidden="true" />
                </button>
              ) : null}
            </li>
          );
        })}
      </ol>
      {foot}
      {card && rich ? <DetailCard video={card.video} anchor={card.anchor} host={card.host} /> : null}
      {menu && menuVideo ? <AddMenu video={menuVideo} anchor={menu.anchor} host={menu.host} limit={menu.scroller} maxRows={menu.tall ? MENU_ROWS.tall : MENU_ROWS.rest} onClose={() => setMenu(null)} /> : null}
    </>
  );
}
