import { useCallback, useEffect, useRef, useState, type CSSProperties, type UIEvent } from 'react';
import {
  IconArrowLeft,
  IconArrowsShuffle,
  IconBrandSpotify,
  IconBrandYoutube,
  IconDisc,
  IconHeart,
  IconClock,
  IconListDetails,
  IconMusic,
  IconPlaylist,
  IconExternalLink,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerSkipBackFilled,
  IconPlayerSkipForwardFilled,
  IconSearch,
} from '@tabler/icons-react';
import { invoke } from '../../bridge/tauri';
import { useSkyKeepClear } from '../../horizon/sky';
import { isPlaying, isQuiet } from '../../music/model';
import { playerName, sourceKey } from '../../music/players';
import { spotify, type SpotifyItem, type SpotifyTrack } from '../../music/spotify';
import { useNowPlayingStore } from '../../music/store';
import { useNowPlaying } from '../../music/useNowPlaying';
import { useToolsStore } from '../../tools/store';
import { quietFocus, tip } from '../../ui/HoverTip';
import { goSpotifyHome, setSpotifyInside, useSpotifyHome } from '../libraryHome';
import { closePlaylist, useYtLibrary } from '../ytmusic/store';
import { YtMusicSide } from '../ytmusic/YtMusicSide';
import { Cover } from './Cover';
import { PlayOn } from './PlayOn';
import { PlayerRow } from './PlayerRow';
import { TrackRow, usePublicList, WhilePlays } from './SavedPlaylist';
import { Tile } from './Tile';
import { QueueView } from './TallViews';
import { LibraryRow, type Place } from '../music/LibraryRow';
import { SearchChips, SearchResults, splitHits, type SearchChip } from '../music/SearchResults';
import {
  isNowPlaying,
  kindLine,
  confirmPlayer,
  PAGE_NOTE,
  PAGE_NOTE_TIP,
  PAGE_OFF_LINE,
  PAGE_READING,
  pageLine,
  pageNoteMore,
  playDeviceId,
  playFailureLine,
  problemLine,
  SEARCH_MIN,
  SEARCH_WAIT_MS,
  songs,
  START_WAIT_S,
  spotifyProblem,
  spotifyRetryable,
  STARTING_NOTE,
  TALL_CLOSE_MS,
  TALL_OPEN_MS,
  useListenSource,
  usePublicPage,
  useSpotifyNow,
  useSpotifyStart,
  type ListenSource,
  type SpotifyProblem,
} from './model';
import { PinButton } from '../watch/PinButton';
import { usePins } from '../watch/pins';
import { finishPlay, playWhole, useSpotifyPinNote } from './playItem';
import { readSpotifyStatus, spotifyReady, useSpotifyStatus } from './status';

export type BrowseTab = 'playlists' | 'albums' | 'liked' | 'recent' | 'queue';
/** The library row, at rest and tall alike: the places of your own library, then Up next. */
export const PLACES: readonly Place<BrowseTab>[] = [
  { id: 'playlists', label: 'Playlists', icon: <IconPlaylist size={18} stroke={1.8} aria-hidden="true" /> },
  { id: 'albums', label: 'Albums', icon: <IconDisc size={18} stroke={1.8} aria-hidden="true" /> },
  { id: 'liked', label: 'Liked', icon: <IconHeart size={18} stroke={1.8} aria-hidden="true" /> },
  { id: 'recent', label: 'Recent', icon: <IconClock size={18} stroke={1.8} aria-hidden="true" /> },
  { id: 'queue', label: 'Up next', icon: <IconListDetails size={18} stroke={1.8} aria-hidden="true" /> },
];
const CHIP_ICONS = {
  playlists: <IconPlaylist size={18} stroke={1.8} aria-hidden="true" />,
  albums: <IconDisc size={18} stroke={1.8} aria-hidden="true" />,
  songs: <IconMusic size={18} stroke={1.8} aria-hidden="true" />,
};
const SEARCH_PLACEHOLDER = 'Search songs, albums and playlists';
/** A page of a list or of a playlist's songs (Spotify gives 50 at a time). */
export const PAGE = 50;
/** Within this many pixels of the end of a list, the next page is read. */
const MORE_AT_PX = 160;
/** A note at the foot of the card goes away after this long. */
export const NOTE_MS = 6000;

type ListKey = BrowseTab | 'search';

interface ListState {
  items: SpotifyItem[];
  page: number;
  more: boolean;
  loading: boolean;
  problem: SpotifyProblem | null;
  loaded: boolean;
}
const EMPTY_LIST: ListState = { items: [], page: 0, more: false, loading: false, problem: null, loaded: false };

/** What a search says when it found nothing, and while it runs. */
const NO_HITS = 'Nothing found. Try other words.';
const SEARCHING_LINE = 'Searching Spotify.';
const EMPTY_LINE: Record<BrowseTab, string> = {
  playlists: 'No playlists in your library yet.',
  albums: 'No saved albums yet.',
  liked: 'No liked songs yet.',
  recent: 'Nothing played lately.',
  queue: 'Nothing is queued.',
};

/** What a list says while its first read is on its way (it never shows blank). */
export const LOADING_LINE: Record<BrowseTab, string> = {
  playlists: 'Reading your playlists.',
  albums: 'Reading your albums.',
  liked: 'Reading your liked songs.',
  recent: 'Reading what you played lately.',
  queue: 'Reading the queue.',
};

function readTab(tab: Exclude<BrowseTab, 'queue'>, page: number): Promise<SpotifyItem[]> {
  if (tab === 'playlists') return spotify.playlists(page);
  if (tab === 'albums') return spotify.albums(page);
  if (tab === 'liked') return spotify.liked(page);
  return spotify.recent();
}


/** Close to the end of a scrolled list. */
const nearEnd = (e: UIEvent<HTMLElement>) => {
  const el = e.currentTarget;
  return el.scrollTop + el.clientHeight >= el.scrollHeight - MORE_AT_PX;
};

/**
 * The upper right of Unwind's Listen (6A, "Spotify fills it"), with the switch of 9A on top:
 * Spotify or YouTube Music, the player the wall follows. Spotify: a search field and the
 * tabs Search, Playlists, Albums, Liked and Recent over a list with the real covers; hover on a
 * row shows the larger cover with its details, a click on a playlist or album slides to its
 * songs, and a click on a song plays it (from that song on, in its list). YouTube Music: what
 * Windows says is playing, its buttons and "Open YouTube Music". The card never controls a room.
 *
 * The card grows by itself: the pointer resting on it for 0.75 seconds opens the tall view (the right
 * third of the wall, two rows of covers and a player row), never while the chooser or a library menu is
 * open or the search field has focus. A click on the empty part of the top row opens it at once, and so
 * does keyboard focus (focus-visible) landing on a control below the top row. It shrinks by itself 0.5
 * second after the pointer has left it, never while the pointer is on it, the search field has focus, the
 * chooser or a library menu is open, or the pointer is on a details card; and on Escape (the chooser first,
 * a playlist's Back next) and on a click anywhere outside it (that click is swallowed, so it presses
 * nothing behind). The open state is not stored.
 */
export function SpotifyCard() {
  const source = useListenSource((s) => s.source);
  const setSource = useListenSource((s) => s.setSource);
  const ready = useSpotifyStatus(spotifyReady);
  // The horizon's moon keeps 40 px clear of this card (it moves to another of its places). The claim
  // follows the card's size, so it follows open and closed.
  const [card, setCard] = useState<HTMLElement | null>(null);
  useSkyKeepClear('listen-card', card);
  const [tall, setTall] = useState(false);
  const [chooser, setChooser] = useState(false);
  const chip = useRef<HTMLButtonElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chooserOpen = useRef(false);
  chooserOpen.current = chooser;
  const pointerIn = useRef(false);
  const swallowOff = useRef<(() => void) | null>(null);

  const clearClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const clearOpen = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = null;
  }, []);
  // A chooser or library menu is open, or the pointer is on a details card (drawn elsewhere in the page): the card stays as it is.
  const popupHolds = () => chooserOpen.current || !!document.querySelector('.u-lib-menu, .hover-tip:hover');
  // Keyboard focus inside the card counts like the pointer inside (the search field included): the 0.5 second starts only when
  // neither is there. `focusTo` is where focus went when this follows a blur (null: nowhere), else the focused element.
  const armClose = useCallback(
    (focusTo?: Element | null) => {
      clearClose();
      const f = focusTo === undefined ? document.activeElement : focusTo;
      if (pointerIn.current || (card && f && f !== document.body && card.contains(f))) return;
      const fire = () => {
        // A popup that belongs to the card is up: look again a moment later instead of closing under it.
        if (popupHolds()) {
          closeTimer.current = setTimeout(fire, TALL_CLOSE_MS);
          return;
        }
        closeTimer.current = null;
        setChooser(false);
        setTall(false);
      };
      closeTimer.current = setTimeout(fire, TALL_CLOSE_MS);
    },
    [clearClose, card],
  );
  // The pointer resting on the card opens it after TALL_OPEN_MS; not while a popup is open or the search field has focus.
  const armOpen = useCallback(() => {
    clearOpen();
    const fire = () => {
      const at = document.activeElement;
      if (popupHolds() || (at instanceof HTMLInputElement && card?.contains(at))) {
        openTimer.current = setTimeout(fire, TALL_OPEN_MS);
        return;
      }
      openTimer.current = null;
      setTall(true);
    };
    openTimer.current = setTimeout(fire, TALL_OPEN_MS);
  }, [clearOpen, card]);
  const close = useCallback(() => {
    clearClose();
    clearOpen();
    setChooser(false);
    setTall(false);
  }, [clearClose, clearOpen]);
  useEffect(
    () => () => {
      clearClose();
      clearOpen();
      swallowOff.current?.();
    },
    [clearClose, clearOpen],
  );
  useEffect(() => {
    if (source !== 'spotify' || !ready) setChooser(false);
  }, [source, ready]);
  // Without the tall view there is nothing to wait for; with it, the timer is armed by the pointer leaving.
  useEffect(() => {
    // Whichever way the view opened or closed, a pending rest-to-open timer is stale.
    clearOpen();
    if (!tall) clearClose();
    // Opened with neither the pointer nor the focus on it (the card has no way to know the pointer is elsewhere): the 0.5 second starts.
    else armClose();
  }, [tall, clearClose, clearOpen, armClose]);

  // Escape closes the innermost thing: the chooser, then a playlist's Back (the songs view does it),
  // then the tall view. Captured, so the chooser's Escape does not also reach the songs view.
  useEffect(() => {
    if (!tall && !chooser) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // An open library menu (drawn at the app root) has its own Escape.
      if (document.querySelector('.u-lib-menu')) return;
      const at = document.activeElement;
      // A details card has its own Escape.
      if (document.querySelector('.hover-tip .sp-details') && at && (at.closest('.hover-tip') || at.closest('.sp-tile'))) return;
      if (chooser) {
        e.stopPropagation();
        setChooser(false);
        quietFocus();
        chip.current?.focus();
        return;
      }
      if (card?.querySelector('.sp-songs')) return;
      if (at instanceof HTMLInputElement && at.type === 'search' && at.value) return;
      e.stopPropagation();
      // Focus inside the card moves to a top-row control that stays, so the next Tab does not land below it and reopen.
      if (card && at && card.contains(at)) {
        quietFocus();
        (chip.current ?? card.querySelector<HTMLElement>('.sp-top [role="radio"]'))?.focus();
      }
      close();
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [tall, chooser, card, close]);

  // A press anywhere outside closes it, and that press does nothing else: its follow-up mouse events
  // are swallowed once. The details card of a tile and a library menu (both drawn elsewhere in the page) count as inside.
  useEffect(() => {
    if (!tall) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || (card && card.contains(t)) || t.closest?.('.hover-tip') || t.closest?.('.u-lib-menu')) return;
      e.preventDefault();
      e.stopPropagation();
      swallowOff.current?.();
      const stop = (ev: Event) => {
        ev.preventDefault();
        ev.stopPropagation();
      };
      // Tied to this press, not to a time: the mouse events that follow it are swallowed until its own click (the last of them)
      // has gone by, or the press is cancelled (a pointer cancel, a context menu, an aux click, a drag, the window losing focus).
      const stopClick = (ev: Event) => {
        stop(ev);
        setTimeout(off, 0);
      };
      const cancels = ['pointercancel', 'auxclick', 'contextmenu', 'dragend'] as const;
      // The pointer going up ends the press: its click, when there is one, follows in the same turn, so the listeners
      // are let go just after it (a press that never gets a click does not leave them waiting for the next one).
      const upLater = () => void setTimeout(off, 0);
      let released = false;
      function off() {
        if (released) return;
        released = true;
        document.removeEventListener('mousedown', stop, true);
        document.removeEventListener('mouseup', stop, true);
        document.removeEventListener('click', stopClick, true);
        document.removeEventListener('pointerup', upLater, true);
        document.removeEventListener('visibilitychange', off);
        cancels.forEach((k) => document.removeEventListener(k, off, true));
        window.removeEventListener('blur', off);
        if (swallowOff.current === off) swallowOff.current = null;
      }
      document.addEventListener('mousedown', stop, true);
      document.addEventListener('mouseup', stop, true);
      document.addEventListener('click', stopClick, true);
      document.addEventListener('pointerup', upLater, true);
      document.addEventListener('visibilitychange', off);
      cancels.forEach((k) => document.addEventListener(k, off, true));
      window.addEventListener('blur', off);
      swallowOff.current = off;
      close();
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [tall, card, close]);

  return (
    <section
      ref={setCard}
      className={`u-card sp-card${source === 'youtube' ? ' yt' : ''}${tall ? ' tall' : ''}`}
      data-tall={tall ? 'true' : 'false'}
      aria-label="Music to play"
      onPointerEnter={() => {
        pointerIn.current = true;
        clearClose();
        if (!tall) armOpen();
      }}
      onPointerLeave={() => {
        pointerIn.current = false;
        clearOpen();
        if (tall) armClose();
      }}
      onFocusCapture={(e) => {
        clearClose();
        // Keyboard way in: focus-visible landing on a control below the top row (not a text field) opens it.
        const t = e.target as Element;
        if (!tall && !(t instanceof HTMLInputElement) && !t.closest('.sp-top') && t.matches(':focus-visible')) {
          clearOpen();
          setTall(true);
        }
      }}
      onBlurCapture={(e) => {
        if (tall && !pointerIn.current) armClose(e.relatedTarget as Element | null);
      }}
    >
      <div
        className="sp-top"
        onClick={(e) => {
          // The empty part of the top row opens it too (not the buttons, and not once it is open).
          if (!tall && !(e.target as Element).closest('button, [role="radiogroup"], input')) {
            clearOpen();
            setTall(true);
          }
        }}
      >
        <SourceSwitch source={source} onPick={setSource} />
        {source === 'spotify' && ready ? null : <span className="sp-hint">Which player the wall follows</span>}
        <div className="sp-hx">
          {source === 'spotify' && ready ? <PlayOn open={chooser} onOpen={setChooser} chipRef={chip} /> : null}
        </div>
      </div>
      {source === 'youtube' ? <YtMusicSide tall={tall} remote={<YouTubeSide />} /> : <SpotifyBrowse tall={tall} />}
    </section>
  );
}

function SourceSwitch({ source, onPick }: { source: ListenSource; onPick: (s: ListenSource) => void }) {
  const status = useSpotifyStatus((s) => s.status);
  const off = !!status && !status.setup;
  // On an inner page (a playlist or album) the chosen service's name goes back to that panel's first page,
  // as its Back control does; on the first page it is only the choice it was.
  const spotifyInside = useSpotifyHome((s) => s.inside);
  const ytInside = useYtLibrary((s) => s.opened !== null);
  const home = (which: ListenSource) => (which === 'spotify' ? spotifyInside : ytInside) && source === which;
  const pick = (which: ListenSource) => {
    if (home(which)) {
      if (which === 'spotify') goSpotifyHome();
      else closePlaylist();
      return;
    }
    onPick(which);
  };
  return (
    <div className="sp-switch" role="radiogroup" aria-label="Which player the wall follows">
      <button type="button" role="radio" aria-checked={source === 'spotify'} className={source === 'spotify' ? 'on' : ''} {...tip(home('spotify') ? 'Back to Spotify home' : off ? 'Spotify is not set up on this wall' : 'Browse and play Spotify here')} onClick={() => pick('spotify')}>
        <IconBrandSpotify size={22} stroke={1.8} aria-hidden="true" />
        Spotify
        {off ? <span className="sp-off">not set up</span> : null}
      </button>
      <button type="button" role="radio" aria-checked={source === 'youtube'} className={source === 'youtube' ? 'on' : ''} {...tip(home('youtube') ? 'Back to YouTube Music home' : 'Follow YouTube Music through Windows')} onClick={() => pick('youtube')}>
        <IconBrandYoutube size={22} stroke={1.8} aria-hidden="true" />
        YouTube Music
      </button>
    </div>
  );
}

/** One line and the one thing to do about it, when Spotify cannot be browsed. */
function CardLine({ text, action }: { text: string; action: 'tools' | 'retry' | null }) {
  return (
    <div className="sp-state">
      <span>{text}</span>
      {action === 'tools' ? (
        <button type="button" className="sp-btn" onClick={() => useToolsStore.getState().openDrawer('accounts')}>
          Open Tools
        </button>
      ) : action === 'retry' ? (
        <button type="button" className="sp-btn" onClick={() => void readSpotifyStatus()}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

function SpotifyBrowse({ tall }: { tall: boolean }) {
  const { status, failed } = useSpotifyStatus();
  if (!status) return failed ? <CardLine text={problemLine('down')} action="retry" /> : <div className="sp-state" aria-busy="true" />;
  if (!status.setup) return <CardLine text="Spotify is not set up on this wall. Tools says how." action="tools" />;
  if (!status.signedIn) return <CardLine text={problemLine('needsSignIn')} action="tools" />;
  return (
    <>
      <Browser tall={tall} />
      {tall ? <PlayerRow /> : null}
    </>
  );
}

/** Ask Spotify once which song plays, so the playing mark goes by track id (a failure keeps what is known). */
function useSpotifyNowRead(title: string): void {
  useEffect(() => {
    let live = true;
    spotify.playback().then(
      (p) => live && useSpotifyNow.setState({ id: p?.track?.id ?? null }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [title]);
}

/** The mark for a row: by track id when known, else title and artist (see `isNowPlaying`). */
function useIsNow(): (t: { id: string | null; name: string; artists?: string | null }) => boolean {
  const nowId = useSpotifyNow((s) => s.id);
  const title = useNowPlayingStore((s) => s.info?.title ?? '');
  const artist = useNowPlayingStore((s) => s.info?.artist ?? '');
  return (t) => isNowPlaying(t, nowId, title, artist);
}

export { finishPlay };

function Browser({ tall }: { tall: boolean }) {
  const [tab, setTab] = useState<BrowseTab>('playlists');
  const [lists, setLists] = useState<Record<ListKey, ListState>>(() => ({ search: EMPTY_LIST, playlists: EMPTY_LIST, albums: EMPTY_LIST, liked: EMPTY_LIST, recent: EMPTY_LIST, queue: EMPTY_LIST }));
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<SearchChip>('all');
  // What the search box last asked, for the empty-state line (state) and to skip asking the same
  // words twice (ref: `runSearch` must not change identity when a search starts or fails, or the
  // debounce effect below would re-arm and search again by itself).
  const [, setAsked] = useState('');
  // The words the held answer belongs to: chips and counts show only while they match the field.
  const [answeredFor, setAnsweredFor] = useState('');
  const askedRef = useRef('');
  const [open, setOpen] = useState<SpotifyItem | null>(null);
  // The card's top heading tells the panel to go home (see `SourceSwitch`); the panel tells it when it is inside.
  const homeRev = useSpotifyHome((s) => s.rev);
  const lastRev = useRef(homeRev);
  useEffect(() => {
    if (lastRev.current !== homeRev) {
      lastRev.current = homeRev;
      setOpen(null);
    }
  }, [homeRev]);
  const isOpen = open !== null;
  useEffect(() => {
    setSpotifyInside(isOpen);
    return () => setSpotifyInside(false);
  }, [isOpen]);
  const [ownNote, setNote] = useState<string | null>(null);
  const pinNote = useSpotifyPinNote((s) => s.note);
  const note = ownNote ?? pinNote;
  const nowTitle = useNowPlayingStore((s) => s.info?.title ?? '');
  useSpotifyNowRead(nowTitle);
  const isNow = useIsNow();
  const mounted = useRef(true);
  const listsRef = useRef(lists);
  listsRef.current = lists;
  // Only the newest search may change the list: an older answer (or failure) that lands late is dropped.
  const searchSeq = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void spotify.cancelStart().catch(() => undefined);
    };
  }, []);
  useEffect(() => {
    // The starting line stays until the start ends; every other note goes after `NOTE_MS`.
    if (!note || note === STARTING_NOTE) return;
    const id = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(id);
  }, [note]);

  const patch = useCallback((t: ListKey, p: Partial<ListState>) => setLists((all) => ({ ...all, [t]: { ...all[t], ...p } })), []);

  const load = useCallback(
    (t: Exclude<BrowseTab, 'queue'>, page: number) => {
      const cur = listsRef.current[t];
      if (cur.loading) return;
      patch(t, { loading: true });
      readTab(t, page).then(
        (got) => {
          if (!mounted.current) return;
          const items = Array.isArray(got) ? got : [];
          // A pin of a listed playlist or album takes the list's name and cover again (one write, only when they differ).
          if (t === 'playlists' || t === 'albums') {
            usePins.getState().refresh(items.filter((i) => i.kind === 'playlist' || i.kind === 'album').map((i) => ({ kind: i.kind === 'album' ? ('spotify-album' as const) : ('spotify-playlist' as const), id: i.id, name: i.name, art: i.imageUrl ?? i.thumbUrl })));
          }
          setLists((all) => ({ ...all, [t]: { items: page === 0 ? items : [...all[t].items, ...items], page, more: t !== 'recent' && items.length >= PAGE, loading: false, problem: null, loaded: true } }));
        },
        (e) => {
          if (!mounted.current) return;
          const problem = spotifyProblem(e);
          // Busy keeps the list it has (it is still right) and says so once.
          if (problem === 'busy' && listsRef.current[t].items.length > 0) {
            patch(t, { loading: false });
            setNote(problemLine('busy'));
          } else patch(t, { loading: false, problem, loaded: true });
        },
      );
    },
    [patch],
  );

  useEffect(() => {
    if (tab !== 'queue' && !lists[tab].loaded && !lists[tab].loading) load(tab, 0);
  }, [tab, lists, load]);
  // Search: on Enter, or after 400 ms without typing, with at least two characters. `again` asks
  // the same words once more (Retry after a failure). Nothing a search sets is read by the effect
  // below, so a failure never starts another search: only typing, Enter and Retry do.
  const runSearch = useCallback(
    (q: string, again = false) => {
      const text = q.trim();
      if (text.length < SEARCH_MIN || (text === askedRef.current && !again)) return;
      const mine = ++searchSeq.current;
      askedRef.current = text;
      setAsked(text);
      setOpen(null);
      patch('search', { loading: true, problem: null });
      spotify.search(text).then(
        (r) => {
          if (!mounted.current || mine !== searchSeq.current) return;
          const items = [...(r?.tracks ?? []), ...(r?.playlists ?? []), ...(r?.albums ?? [])];
          setAnsweredFor(text);
          patch('search', { items, loading: false, loaded: true, more: false, page: 0 });
        },
        (e) => {
          if (!mounted.current || mine !== searchSeq.current) return;
          const problem = spotifyProblem(e);
          // The same words may be asked again (Retry, or typing them once more).
          askedRef.current = '';
          setAsked('');
          // A failure keeps the last good results under a note; with none, the line and Retry show.
          if (listsRef.current.search.items.length > 0) {
            setAnsweredFor(text);
            patch('search', { loading: false, problem });
            setNote(`${problemLine(problem)} These are the last results.`);
          } else patch('search', { items: [], loading: false, loaded: true, problem });
        },
      );
    },
    [patch],
  );
  // Every normalized change of the field (an edit below the minimum, clearing it) drops the search in flight and lets the same words be asked again.
  useEffect(() => {
    if (query.trim() === askedRef.current) return;
    searchSeq.current += 1;
    askedRef.current = '';
    setAsked('');
    setLists((all) => (all.search.loading ? { ...all, search: { ...all.search, loading: false } } : all));
  }, [query]);
  useEffect(() => {
    if (query.trim().length < SEARCH_MIN) return;
    const id = setTimeout(() => runSearch(query), SEARCH_WAIT_MS);
    return () => clearTimeout(id);
  }, [query, runSearch]);

  const playIt = (item: SpotifyItem, shuffled: boolean) => {
    // Whether a player was named decides the words of a refusal ("That player ..." or about this PC).
    const named = !!playDeviceId();
    void playWhole(item, shuffled, () => mounted.current && setNote(STARTING_NOTE)).then(
      () => mounted.current && setNote(null),
      (e) => mounted.current && setNote(playFailureLine(e, named)),
    );
  };
  const playItem = (item: SpotifyItem) => playIt(item, false);
  const shuffleItem = (item: SpotifyItem) => playIt(item, true);

  // Words in the field swap the library row for the chips; clearing the field or "Library" brings the row (and the last place) back.
  const words = query.trim();
  const inSearch = words !== '';
  const hits = lists.search;
  const fresh = answeredFor === words;
  const found = splitHits(hits.items);
  const cur = lists[tab];
  const scrolled = (e: UIEvent<HTMLElement>) => {
    if (!inSearch && tab !== 'queue' && tab !== 'recent' && cur.more && !cur.loading && nearEnd(e)) load(tab, cur.page + 1);
  };
  const leaveSearch = () => {
    searchSeq.current += 1;
    askedRef.current = '';
    setAsked('');
    setAnsweredFor('');
    setChip('all');
    setQuery('');
    setLists((all) => ({ ...all, search: EMPTY_LIST }));
  };
  const searchBox = (
    <label className="sp-search">
      <IconSearch size={20} stroke={1.8} aria-hidden="true" />
      <input
        type="search"
        value={query}
        placeholder={SEARCH_PLACEHOLDER}
        aria-label="Search Spotify"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') runSearch(query, true);
        }}
      />
    </label>
  );
  const retry = hits.problem && spotifyRetryable(hits.problem) ? (
    <button type="button" className="sp-btn" onClick={() => runSearch(query, true)}>
      Retry
    </button>
  ) : null;
  const searchBody =
    hits.problem && hits.items.length === 0 ? (
      <div className="sp-empty">
        {problemLine(hits.problem)}
        {hits.problem === 'needsSignIn' || hits.problem === 'notsetup' ? (
          <button type="button" className="sp-btn" onClick={() => useToolsStore.getState().openDrawer('accounts')}>
            Open Tools
          </button>
        ) : (
          retry
        )}
      </div>
    ) : !fresh && words.length >= SEARCH_MIN && !(hits.problem && hits.items.length > 0) ? (
      <div className="sp-empty" aria-busy="true">
        {SEARCHING_LINE}
      </div>
    ) : words.length < SEARCH_MIN ? (
      <div className="sp-empty">Type at least two letters, then wait a moment or press Enter.</div>
    ) : hits.items.length === 0 && (hits.loading || !hits.loaded) ? (
      <div className="sp-empty" aria-busy="true">
        {SEARCHING_LINE}
      </div>
    ) : hits.items.length === 0 ? (
      <div className="sp-empty">{NO_HITS}</div>
    ) : (
      <>
        {hits.problem ? (
          <div className="sp-empty sp-stale">
            {problemLine(hits.problem)}
            {retry}
          </div>
        ) : null}
        <SearchResults
          items={hits.items}
          chip={chip}
          tall={tall}
          isNow={isNow}
          onPlay={playItem}
          onChip={setChip}
          tile={(item) => <Tile item={item} kindWord={false} onOpen={() => setOpen(item)} onPlay={() => playItem(item)} onShuffle={() => shuffleItem(item)} />}
        />
      </>
    );
  const songsIn = cur.items.filter((i) => i.kind === 'track');
  const lists2 = cur.items.filter((i) => i.kind !== 'track');
  const libraryBody =
    cur.problem && cur.items.length === 0 ? (
      <div className="sp-empty">
        {problemLine(cur.problem)}
        {cur.problem === 'needsSignIn' || cur.problem === 'notsetup' ? (
          <button type="button" className="sp-btn" onClick={() => useToolsStore.getState().openDrawer('accounts')}>
            Open Tools
          </button>
        ) : spotifyRetryable(cur.problem) ? (
          <button type="button" className="sp-btn" onClick={() => load(tab as Exclude<BrowseTab, 'queue'>, 0)}>
            Retry
          </button>
        ) : null}
      </div>
    ) : cur.items.length === 0 && (cur.loading || !cur.loaded) ? (
      <div className="sp-empty" aria-busy="true">
        {LOADING_LINE[tab]}
      </div>
    ) : cur.loaded && cur.items.length === 0 ? (
      <div className="sp-empty">{EMPTY_LINE[tab]}</div>
    ) : (
      <>
        {songsIn.length > 0 ? (
          <div className="sp-list" role="list">
            {songsIn.map((item, i) => (
              <Row key={`${item.id}-${i}`} item={item} playing={isNow({ id: item.id, name: item.name, artists: item.subtitle })} onPlay={() => playItem(item)} />
            ))}
          </div>
        ) : null}
        {lists2.length > 0 ? (
          <div className="sp-grid" role="list">
            {lists2.map((item, i) => (
              <Tile key={`${item.kind}-${item.id}-${i}`} item={item} kindWord={false} onOpen={() => setOpen(item)} onPlay={() => playItem(item)} onShuffle={() => shuffleItem(item)} />
            ))}
          </div>
        ) : null}
      </>
    );
  const main =
    !inSearch && tab === 'queue' ? (
      <div className="sp-main">
        <QueueView />
      </div>
    ) : (
      <div className="sp-scroll" onScroll={scrolled}>
        {inSearch ? searchBody : libraryBody}
      </div>
    );
  const songsView = open ? <SongsView item={open} tall={tall} backLabel={inSearch ? 'Search' : PLACES.find((t) => t.id === tab)?.label ?? 'Back'} onBack={() => setOpen(null)} onNote={setNote} onUpNext={tall ? () => { setOpen(null); setTab('queue'); } : undefined} /> : null;
  return (
    <div className="sp-body">
      {searchBox}
      {songsView ?? (
        <>
          {inSearch ? (
            <SearchChips value={chip} counts={fresh ? { playlists: found.playlists.length, albums: found.albums.length, songs: found.songs.length } : null} kinds={['playlists', 'albums', 'songs']} icons={CHIP_ICONS} onPick={setChip} onLeave={leaveSearch} />
          ) : (
            <LibraryRow label="Spotify library" places={PLACES} value={tab} onPick={setTab} />
          )}
          {main}
        </>
      )}
      {note ? <Note text={note} /> : null}
    </div>
  );
}

/**
 * The line at the foot of the card: an amber note, or, while the wall starts Spotify, a calm status line
 * (the Spotify mark, what is happening, and what plays as soon as it is ready, over a thin line that fills once).
 */
function Note({ text }: { text: string }) {
  const name = useSpotifyStart((s) => s.name);
  const startedAt = useSpotifyStart((s) => s.startedAt);
  const seconds = useStartSeconds(text === STARTING_NOTE ? startedAt : null);
  if (text !== STARTING_NOTE) {
    return (
      <div className="sp-note" role="status">
        {text}
      </div>
    );
  }
  return (
    <div className="sp-note starting" role="status" style={{ '--sp-wait': `${START_WAIT_S}s` } as CSSProperties}>
      <IconBrandSpotify size={24} stroke={1.8} aria-hidden="true" />
      <span className="sp-st-a">Starting Spotify in the background</span>
      <span className="sp-st-b">{name ? `${name} plays when it is ready.` : 'It plays when it is ready.'}</span>
      <span className="sp-st-n">{seconds} s</span>
      <button type="button" className="sp-linkbtn sp-st-cancel" onClick={() => void spotify.cancelStart().catch(() => undefined)}>
        Cancel
      </button>
      <span className="sp-st-line" aria-hidden="true" />
    </div>
  );
}

/** Whole seconds since the start began, ticking once a second (0 while there is no start). */
function useStartSeconds(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));
}

/** A song in Liked, Recent or Search: a row that plays it, with its details on hover. */
function Row({ item, playing, onPlay }: { item: SpotifyItem; playing: boolean; onPlay: () => void }) {
  return (
    <div className={`sp-row${playing ? ' on' : ''}`} role="listitem">
      <button
        type="button"
        className="sp-open"
        aria-label={`Play ${item.name}`}
        {...tip(() => (
          <div className="sp-tip">
            <Cover src={item.imageUrl ?? item.thumbUrl} size={120} />
            <div className="sp-tip-text">
              <b>{item.name}</b>
              <span>{kindLine(item)}</span>
              <em>Click to play</em>
            </div>
          </div>
        ))}
        onClick={onPlay}
      >
        <Cover src={item.thumbUrl ?? item.imageUrl} size={44} />
        <span className="sp-text">
          <span className="sp-name">{item.name}</span>
          <span className="sp-line">{playing ? 'Playing now' : item.subtitle ?? ''}</span>
        </span>
      </button>
    </div>
  );
}

interface SongsState {
  items: SpotifyTrack[];
  total: number;
  page: number;
  more: boolean;
  loading: boolean;
  problem: SpotifyProblem | null;
}

/**
 * A playlist's or album's songs (R3), slid in over the grid: Back (or Escape), the cover, the
 * kind, the name with its song count (the total length only once every song is read, never
 * guessed), Play and Shuffle, then every song (read 50 at a time as the list scrolls; it scrolls
 * inside the card and never grows it). A click plays from that song on, in its list; the song
 * now playing is marked; a song that cannot be played (a local file) is dimmed and says why.
 */
function SongsView({ item, tall, backLabel, onBack, onNote, onUpNext }: { item: SpotifyItem; tall: boolean; backLabel: string; onBack: () => void; onNote: (n: string | null) => void; onUpNext?: () => void }) {
  const kind = item.kind === 'album' ? 'album' : 'playlist';
  const [st, setSt] = useState<SongsState>({ items: [], total: item.count ?? 0, page: 0, more: false, loading: true, problem: null });
  const isNow = useIsNow();
  const mounted = useRef(true);
  const loading = useRef(false);
  // The public page switch lives in Tools, Accounts, Spotify; a change there takes effect on this page at once.
  const pageOn = usePublicPage((s) => s.on);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const load = useCallback(
    (page: number) => {
      if (loading.current) return;
      loading.current = true;
      setSt((s) => ({ ...s, loading: true }));
      spotify.tracks(kind, item.id, page).then(
        (r) => {
          loading.current = false;
          if (!mounted.current) return;
          const got = Array.isArray(r?.items) ? r.items : [];
          setSt((s) => ({ items: page === 0 ? got : [...s.items, ...got], total: typeof r?.total === 'number' ? r.total : s.total, page, more: r?.more === true, loading: false, problem: null }));
        },
        (e) => {
          loading.current = false;
          if (!mounted.current) return;
          const problem = spotifyProblem(e);
          if (problem === 'busy') onNote(problemLine('busy'));
          setSt((s) => ({ ...s, loading: false, problem }));
        },
      );
    },
    [item.id, kind, onNote],
  );
  useEffect(() => load(0), [load]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      // An open library menu or chooser takes this Escape; the playlist closes on the next one.
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('.u-lib-menu')) onBack();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onBack]);

  const fail = (e: unknown, named: boolean) => mounted.current && onNote(playFailureLine(e, named));
  const playAll = (shuffled: boolean) => {
    const named = !!playDeviceId();
    void playWhole(item, shuffled, () => onNote(STARTING_NOTE)).then(() => onNote(null), (e) => fail(e, named));
  };
  const playFrom = (t: SpotifyTrack) => {
    if (!t.id || !t.playable) return;
    useSpotifyStart.setState({ name: t.name });
    const named = !!playDeviceId();
    void (async () => {
      try {
        const player = await confirmPlayer();
        const answer = await spotify.play('track', t.id as string, { context: { kind, id: item.id }, offsetId: t.id as string, ...player });
        await finishPlay(answer, () => onNote(STARTING_NOTE));
        onNote(null);
      } catch (e) {
        fail(e, named);
      }
    })();
  };
  // A playlist the owner saved but did not make: Spotify lists no songs for it, so the public page (if allowed) or the "while it plays" view takes over.
  const saved = st.problem === 'notYours' && kind === 'playlist' && st.items.length === 0;
  const { list: pub, retry: retryPage, retryReady } = usePublicList(item, saved && pageOn);
  const pageList = saved && pageOn && pub.state === 'ready' && pub.items.length > 0 ? pub : null;
  const rows = pageList ? pageList.items : st.items;
  const total = pageList ? item.count ?? pageList.listed : st.total;
  const owner = kindLine(item).replace(/^(Playlist|Album)( by )?/, '');
  const all = !st.more && rows.length > 0 && rows.length >= total;
  // The total length shows only when every song is listed and every one has a length.
  const length = all && rows.every((t) => t.durationMs > 0) ? totalLength(rows.reduce((a, t) => a + (Number.isFinite(t.durationMs) ? t.durationMs : 0), 0)) : null;
  const lead = [total > 0 ? songs(total) : null, length].filter(Boolean).join(' · ');
  const by = owner ? `by ${owner}` : '';
  // A playlist read from the public page says so, quietly, beside its facts.
  const note = pageList ? PAGE_NOTE : null;
  const noteMore = pageList ? pageNoteMore(pageList.items.length, item.count ?? pageList.listed) : '';

  // At rest Pin follows Shuffle as a word; in the tall column it is a round icon in the back row (Back, the tab name, Pin).
  const pinButton = (className: string, icon: boolean) => (
    <PinButton
      entry={{ kind: item.kind === 'album' ? 'spotify-album' : 'spotify-playlist', id: item.id, name: item.name, art: item.imageUrl ?? item.thumbUrl ?? undefined }}
      name={item.name}
      className={className}
      icon={icon}
      cannotLine="This item's address is not one the wall can keep."
    />
  );
  const playButtons = (
    <>
      <button type="button" className="sp-btn fill big" onClick={() => playAll(false)}>
        <IconPlayerPlayFilled size={18} aria-hidden="true" />
        Play
      </button>
      <button type="button" className="sp-btn plain big" onClick={() => playAll(true)}>
        <IconArrowsShuffle size={18} aria-hidden="true" />
        Shuffle
      </button>
      {tall ? null : pinButton('sp-btn plain big sp-pin', false)}
    </>
  );
  return (
    <div className={`sp-songs${tall ? ' tall' : ''}`}>
      <div className="sp-shead">
        <span className="sp-backrow">
          <button type="button" className="sp-back" aria-label="Back to the list" title="Back to the list (Escape)" onClick={onBack}>
            <IconArrowLeft size={20} stroke={2} aria-hidden="true" />
          </button>
          {tall ? (
            <button type="button" className="sp-backlabel" title="Back to the list" onClick={onBack}>
              {backLabel}
            </button>
          ) : null}
          {tall ? pinButton('sp-btn plain sp-pin sp-tallpin', true) : null}
        </span>
        <Cover src={item.imageUrl ?? item.thumbUrl} size={tall ? 200 : 64} />
        <span className="sp-text">
          <span className="sp-kick">{kind === 'album' ? 'Album' : 'Playlist'}</span>
          <span className="sp-name">{item.name}</span>
          <span className="sp-line">
            {lead}
            {note ? (
              <>
                {lead ? ' · ' : ''}
                <span className="sp-pnote" {...tip(PAGE_NOTE_TIP + noteMore)}>
                  {note}
                </span>
              </>
            ) : null}
            {by ? `${lead || note ? ' · ' : ''}${by}` : ''}
          </span>
        </span>
        {tall ? <span className="sp-shbtns">{playButtons}</span> : playButtons}
      </div>
      <ol
        className="sp-tracks"
        onScroll={(e) => {
          if (st.more && !st.loading && nearEnd(e)) load(st.page + 1);
        }}
      >
        {saved ? (
          pageList ? (
            <>
              {rows.map((t, i) => (
                <TrackRow key={`${t.id ?? 'local'}-${i}`} t={t} index={i} on={isNow(t)} onPlay={playFrom} />
              ))}
            </>
          ) : !pageOn ? (
            <WhilePlays item={item} status={{ line: PAGE_OFF_LINE, off: true }} onNote={onNote} onPlayFrom={playFrom} onUpNext={onUpNext} />
          ) : pub.state === 'failed' ? (
            <WhilePlays
              item={item}
              status={{ line: pageLine(pub.problem), tryLater: pub.problem === 'connection' || pub.problem === 'failed', onRetry: (pub.problem === 'connection' || pub.problem === 'failed') && retryReady ? retryPage : undefined }}
              onNote={onNote}
              onPlayFrom={playFrom}
              onUpNext={onUpNext}
            />
          ) : pub.state === 'ready' ? (
            <WhilePlays item={item} status={{ line: pageLine('empty') }} onNote={onNote} onPlayFrom={playFrom} onUpNext={onUpNext} />
          ) : (
            <li className="sp-empty" aria-busy="true">
              {PAGE_READING}
            </li>
          )
        ) : st.problem && st.items.length === 0 ? (
          <li className="sp-empty">
            {problemLine(st.problem)}
            {/* An album Spotify will not list: Retry cannot help and is not offered. */}
            {spotifyRetryable(st.problem) ? (
              <button type="button" className="sp-btn" onClick={() => load(0)}>
                Retry
              </button>
            ) : null}
          </li>
        ) : st.loading && st.items.length === 0 ? (
          <li className="sp-empty" aria-busy="true">
            Reading the songs.
          </li>
        ) : !st.loading && st.items.length === 0 ? (
          <li className="sp-empty">No songs in this {kind}.</li>
        ) : (
          st.items.map((t, i) => <TrackRow key={`${t.id ?? 'local'}-${i}`} t={t} index={i} on={isNow(t)} onPlay={playFrom} />)
        )}
      </ol>
    </div>
  );
}

/** "2 h 48 min", "48 min" for a list's total length. */
function totalLength(ms: number): string {
  const min = Math.round(ms / 60_000);
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} h ${min % 60} min` : `${min} min`;
}

/**
 * YouTube Music chosen (9A): what Windows says is playing, its three buttons (sent through
 * Windows, as the player above does) and "Open YouTube Music". No browsing here: YouTube
 * Music offers no way to browse from outside its own window.
 */
function YouTubeSide() {
  const { info, art, command } = useNowPlaying();
  const quiet = isQuiet(info);
  const playing = isPlaying(info);
  const from = playerName(sourceKey(info));
  const [failed, setFailed] = useState(false);
  const open = () => {
    setFailed(false);
    invoke('wall2_open_link', { kind: 'youtube-music' }).catch(() => setFailed(true));
  };
  return (
    <div className="sp-yt">
      <div className="sp-yt-now">
        <Cover src={quiet ? null : art} size={84} />
        <span className="sp-text">
          <span className="sp-name">{quiet ? 'Nothing playing' : info?.title || 'Unknown title'}</span>
          <span className="sp-line">{quiet ? 'Start something in YouTube Music and it shows here.' : [info?.artist, from && from !== 'YouTube Music' ? `on ${from}` : null].filter(Boolean).join(' · ')}</span>
        </span>
      </div>
      <div className="sp-yt-row">
        <button type="button" className="u-rd sm" aria-label="Previous in YouTube Music" disabled={quiet} onClick={() => command('media_previous')}>
          <IconPlayerSkipBackFilled size={20} aria-hidden="true" />
        </button>
        <button type="button" className="u-rd sm big" aria-label={playing ? 'Pause YouTube Music' : 'Play YouTube Music'} disabled={quiet && !info?.title} onClick={() => command('media_play_pause')}>
          {playing ? <IconPlayerPauseFilled size={22} aria-hidden="true" /> : <IconPlayerPlayFilled size={22} aria-hidden="true" />}
        </button>
        <button type="button" className="u-rd sm" aria-label="Next in YouTube Music" disabled={quiet} onClick={() => command('media_next')}>
          <IconPlayerSkipForwardFilled size={20} aria-hidden="true" />
        </button>
        <button type="button" className="sp-btn sp-ytopen" onClick={open}>
          <IconExternalLink size={20} stroke={1.8} aria-hidden="true" />
          Open YouTube Music
        </button>
      </div>
      <div className="sp-ytnote">{failed ? 'Could not open YouTube Music.' : 'The wall plays, pauses and skips YouTube Music through Windows. Browsing happens in its own window.'}</div>
    </div>
  );
}
