import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type UIEvent } from 'react';
import {
  IconArrowLeft,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconArrowsShuffle,
  IconBrandSpotify,
  IconBrandYoutube,
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
import { refreshNowPlaying, useNowPlayingStore } from '../../music/store';
import { useNowPlaying } from '../../music/useNowPlaying';
import { useToolsStore } from '../../tools/store';
import { quietFocus, tip } from '../../ui/HoverTip';
import { Cover } from './Cover';
import { PlayOn } from './PlayOn';
import { PlayerRow } from './PlayerRow';
import { PlayingBars, Tile } from './Tile';
import { QueueView, SearchGroups } from './TallViews';
import {
  isNowPlaying,
  kindLine,
  playDeviceId,
  playProblemLine,
  problemLine,
  SEARCH_MIN,
  SEARCH_WAIT_MS,
  songs,
  spotifyProblem,
  TALL_CLOSE_MS,
  trackLength,
  useListenSource,
  useSpotifyNow,
  useSpotifyStart,
  type ListenSource,
  type SpotifyProblem,
} from './model';
import { readSpotifyStatus, spotifyReady, useSpotifyStatus } from './status';

export type BrowseTab = 'search' | 'playlists' | 'albums' | 'liked' | 'recent' | 'queue';
/** The resting card: Search, then the library. */
export const BROWSE_TABS: readonly { id: BrowseTab; label: string }[] = [
  { id: 'search', label: 'Search' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'albums', label: 'Albums' },
  { id: 'liked', label: 'Liked' },
  { id: 'recent', label: 'Recent' },
];
/** The tall view: the search field is the search, and Up next is a tab. */
export const TALL_TABS: readonly { id: BrowseTab; label: string }[] = [
  { id: 'playlists', label: 'Playlists' },
  { id: 'albums', label: 'Albums' },
  { id: 'liked', label: 'Liked' },
  { id: 'recent', label: 'Recent' },
  { id: 'queue', label: 'Up next' },
];
/** A page of a list or of a playlist's songs (Spotify gives 50 at a time). */
export const PAGE = 50;
/** Within this many pixels of the end of a list, the next page is read. */
const MORE_AT_PX = 160;
/** After a press outside closes the tall view, its follow-up mouse events are swallowed for at most this long. */
const SWALLOW_MS = 600;
/** A note at the foot of the card goes away after this long. */
export const NOTE_MS = 6000;

interface ListState {
  items: SpotifyItem[];
  page: number;
  more: boolean;
  loading: boolean;
  problem: SpotifyProblem | null;
  loaded: boolean;
}
const EMPTY_LIST: ListState = { items: [], page: 0, more: false, loading: false, problem: null, loaded: false };

const EMPTY_LINE: Record<BrowseTab, string> = {
  search: 'Nothing found. Try other words.',
  playlists: 'No playlists in your library yet.',
  albums: 'No saved albums yet.',
  liked: 'No liked songs yet.',
  recent: 'Nothing played lately.',
  queue: 'Nothing is queued.',
};

function readTab(tab: Exclude<BrowseTab, 'search' | 'queue'>, page: number): Promise<SpotifyItem[]> {
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
 * One round button at the top right (or a click on the empty part of the top row) opens the tall
 * view: the right third of the wall, two rows of covers and a player row. It closes on the same
 * button, on Escape (the chooser first, a playlist's Back next), on a click anywhere outside it (that
 * click is swallowed, so it presses nothing behind), and by itself 15 seconds after the pointer has
 * left it, never while the pointer is on it or the search field has focus. The open state is not stored.
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
  const openBtn = useRef<HTMLButtonElement | null>(null);
  const chip = useRef<HTMLButtonElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerIn = useRef(false);
  const searchFocus = useRef(false);
  const swallowOff = useRef<(() => void) | null>(null);

  const clearClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const armClose = useCallback(() => {
    clearClose();
    if (pointerIn.current || searchFocus.current) return;
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setChooser(false);
      setTall(false);
    }, TALL_CLOSE_MS);
  }, [clearClose]);
  const close = useCallback(
    (giveFocusBack: boolean) => {
      clearClose();
      setChooser(false);
      setTall(false);
      if (giveFocusBack) {
        quietFocus();
        openBtn.current?.focus();
      }
    },
    [clearClose],
  );
  useEffect(
    () => () => {
      clearClose();
      swallowOff.current?.();
    },
    [clearClose],
  );
  useEffect(() => {
    if (source !== 'spotify' || !ready) setChooser(false);
  }, [source, ready]);
  // Without the tall view there is nothing to wait for; with it, the timer is armed by the pointer leaving.
  useEffect(() => {
    if (!tall) clearClose();
  }, [tall, clearClose]);

  // Escape closes the innermost thing: the chooser, then a playlist's Back (the songs view does it),
  // then the tall view. Captured, so the chooser's Escape does not also reach the songs view.
  useEffect(() => {
    if (!tall && !chooser) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
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
      close(true);
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [tall, chooser, card, close]);

  // A press anywhere outside closes it, and that press does nothing else: its follow-up mouse events
  // are swallowed once. The details card of a tile (drawn elsewhere in the page) counts as inside.
  useEffect(() => {
    if (!tall) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || (card && card.contains(t)) || t.closest?.('.hover-tip')) return;
      e.preventDefault();
      e.stopPropagation();
      swallowOff.current?.();
      const stop = (ev: Event) => {
        ev.preventDefault();
        ev.stopPropagation();
      };
      // The click is the last of the follow-ups: it is swallowed too, then the listeners go.
      const stopClick = (ev: Event) => {
        stop(ev);
        setTimeout(off, 0);
      };
      const id = setTimeout(() => off(), SWALLOW_MS);
      function off() {
        document.removeEventListener('mousedown', stop, true);
        document.removeEventListener('mouseup', stop, true);
        document.removeEventListener('click', stopClick, true);
        clearTimeout(id);
        if (swallowOff.current === off) swallowOff.current = null;
      }
      document.addEventListener('mousedown', stop, true);
      document.addEventListener('mouseup', stop, true);
      document.addEventListener('click', stopClick, true);
      swallowOff.current = off;
      close(false);
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
      }}
      onPointerLeave={() => {
        pointerIn.current = false;
        if (tall) armClose();
      }}
      onFocusCapture={(e) => {
        const t = e.target as Element;
        if (t.matches('input[type="search"]')) {
          searchFocus.current = true;
          clearClose();
        }
      }}
      onBlurCapture={(e) => {
        const t = e.target as Element;
        if (t.matches('input[type="search"]')) {
          searchFocus.current = false;
          if (tall && !pointerIn.current) armClose();
        }
      }}
    >
      <div
        className="sp-top"
        onClick={(e) => {
          // The empty part of the top row opens it too (not the buttons, and not once it is open).
          if (!tall && !(e.target as Element).closest('button, [role="radiogroup"], input')) setTall(true);
        }}
      >
        <SourceSwitch source={source} onPick={setSource} />
        {source === 'spotify' && ready ? null : <span className="sp-hint">Which player the wall follows</span>}
        <div className="sp-hx">
          {source === 'spotify' && ready ? <PlayOn open={chooser} onOpen={setChooser} chipRef={chip} /> : null}
          <button
            ref={openBtn}
            type="button"
            className="sp-grow"
            aria-label={tall ? 'Close the tall music view' : 'Open the tall music view'}
            aria-expanded={tall}
            {...tip(() => (
              <div className="sp-tipline">
                <b>{tall ? 'Close the tall view' : 'Open the tall view'}</b>
                <span>{tall ? 'It also closes by itself 15 seconds after the pointer leaves, and on Escape.' : 'More covers, your queue and a player row.'}</span>
              </div>
            ))}
            onClick={() => (tall ? close(false) : setTall(true))}
          >
            {tall ? <IconArrowsMinimize size={20} stroke={1.8} aria-hidden="true" /> : <IconArrowsMaximize size={20} stroke={1.8} aria-hidden="true" />}
          </button>
        </div>
      </div>
      {source === 'youtube' ? <YouTubeSide /> : <SpotifyBrowse tall={tall} />}
    </section>
  );
}

function SourceSwitch({ source, onPick }: { source: ListenSource; onPick: (s: ListenSource) => void }) {
  const status = useSpotifyStatus((s) => s.status);
  const off = !!status && !status.setup;
  return (
    <div className="sp-switch" role="radiogroup" aria-label="Which player the wall follows">
      <button type="button" role="radio" aria-checked={source === 'spotify'} className={source === 'spotify' ? 'on' : ''} title={off ? 'Spotify is not set up on this wall' : 'Browse and play Spotify here'} onClick={() => onPick('spotify')}>
        <IconBrandSpotify size={22} stroke={1.8} aria-hidden="true" />
        Spotify
        {off ? <span className="sp-off">not set up</span> : null}
      </button>
      <button type="button" role="radio" aria-checked={source === 'youtube'} className={source === 'youtube' ? 'on' : ''} title="Follow YouTube Music through Windows" onClick={() => onPick('youtube')}>
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

const waitSecond = () => new Promise<void>((resolve) => setTimeout(resolve, 1_000));
export async function finishPlay(answer: 'played' | 'starting', onStarting: () => void): Promise<void> {
  if (answer === 'starting') {
    onStarting();
    // The "Play on" chip says "Starting Spotify" while the start flow runs, and reads the players again after it.
    useSpotifyStart.setState({ starting: true });
    try {
      for (;;) {
        const state = await spotify.startStatus();
        if (!state.starting) {
          if (state.result !== 'played') throw new Error(state.result ?? 'failed');
          break;
        }
        await waitSecond();
      }
    } finally {
      useSpotifyStart.setState((s) => ({ starting: false, rev: s.rev + 1 }));
    }
  }
  await refreshNowPlaying();
}

/** The device a Play goes to (the owner's pick, else where the music is), or nothing for "this PC" as before. */
const deviceArg = (): { deviceId?: string } => {
  const id = playDeviceId();
  return id ? { deviceId: id } : {};
};

/** Play an item whole, or shuffled, and report startup only when Rust opened Spotify. */
async function playWhole(item: SpotifyItem, shuffled: boolean, onStarting: () => void): Promise<void> {
  await finishPlay(await spotify.play(item.kind, item.id, { shuffle: shuffled, ...deviceArg() }), onStarting);
}

function Browser({ tall }: { tall: boolean }) {
  const [tab, setTab] = useState<BrowseTab>('playlists');
  const [lists, setLists] = useState<Record<BrowseTab, ListState>>(() => ({ search: EMPTY_LIST, playlists: EMPTY_LIST, albums: EMPTY_LIST, liked: EMPTY_LIST, recent: EMPTY_LIST, queue: EMPTY_LIST }));
  const [query, setQuery] = useState('');
  // What the search box last asked, for the empty-state line (state) and to skip asking the same
  // words twice (ref: `runSearch` must not change identity when a search starts or fails, or the
  // debounce effect below would re-arm and search again by itself).
  const [asked, setAsked] = useState('');
  const askedRef = useRef('');
  const [open, setOpen] = useState<SpotifyItem | null>(null);
  const [note, setNote] = useState<string | null>(null);
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
    if (!note) return;
    const id = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(id);
  }, [note]);

  const patch = useCallback((t: BrowseTab, p: Partial<ListState>) => setLists((all) => ({ ...all, [t]: { ...all[t], ...p } })), []);

  const load = useCallback(
    (t: Exclude<BrowseTab, 'search' | 'queue'>, page: number) => {
      const cur = listsRef.current[t];
      if (cur.loading) return;
      patch(t, { loading: true });
      readTab(t, page).then(
        (got) => {
          if (!mounted.current) return;
          const items = Array.isArray(got) ? got : [];
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
    if (tab !== 'search' && tab !== 'queue' && !lists[tab].loaded && !lists[tab].loading) load(tab, 0);
  }, [tab, lists, load]);
  // Up next lives only in the tall view: closing it leaves that tab for the first one.
  useEffect(() => {
    if (!tall && tab === 'queue') setTab('playlists');
  }, [tall, tab]);

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
      setTab('search');
      setOpen(null);
      patch('search', { loading: true, problem: null });
      spotify.search(text).then(
        (r) => {
          if (!mounted.current || mine !== searchSeq.current) return;
          const items = [...(r?.tracks ?? []), ...(r?.playlists ?? []), ...(r?.albums ?? [])];
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
            patch('search', { loading: false, problem });
            setNote(`${problemLine(problem)} These are the last results.`);
          } else patch('search', { items: [], loading: false, loaded: true, problem });
        },
      );
    },
    [patch],
  );
  useEffect(() => {
    if (query.trim().length < SEARCH_MIN) return;
    const id = setTimeout(() => runSearch(query), SEARCH_WAIT_MS);
    return () => clearTimeout(id);
  }, [query, runSearch]);

  const fail = (e: unknown) => mounted.current && setNote(playProblemLine(spotifyProblem(e)));
  const playItem = (item: SpotifyItem) => {
    void playWhole(item, false, () => mounted.current && setNote('Starting Spotify')).then(() => mounted.current && setNote(null), fail);
  };
  const shuffleItem = (item: SpotifyItem) => void playWhole(item, true, () => mounted.current && setNote('Starting Spotify')).then(() => mounted.current && setNote(null), fail);

  const cur = lists[tab];
  const songsIn = cur.items.filter((i) => i.kind === 'track');
  const lists2 = cur.items.filter((i) => i.kind !== 'track');
  const scrolled = (e: UIEvent<HTMLElement>) => {
    if (tab !== 'search' && tab !== 'queue' && tab !== 'recent' && cur.more && !cur.loading && nearEnd(e)) load(tab, cur.page + 1);
  };
  // Left and right move along the tab row (the arrow keys of a tab list).
  const tabKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="tab"]')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    const to = buttons[(at + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length];
    to.focus();
    to.click();
  };
  const searchBox = (
    <label className="sp-search">
      <IconSearch size={20} stroke={1.8} aria-hidden="true" />
      <input
        type="search"
        value={query}
        placeholder="Search Spotify"
        aria-label="Search Spotify"
        onChange={(e) => {
          setQuery(e.target.value);
          // In the tall view the field is the search: emptying it goes back to the library.
          if (tall && e.target.value.trim() === '' && tab === 'search') setTab('playlists');
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') runSearch(query, true);
        }}
      />
    </label>
  );
  const tabs = tall ? TALL_TABS : BROWSE_TABS;
  const tabsEl = (
    <div className="sp-tabs" role="tablist" aria-label="Spotify library" onKeyDown={tabKey}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} tabIndex={tab === t.id || (tab === 'search' && tall && t.id === 'playlists') ? 0 : -1} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
  const grouped = tall && tab === 'search' && cur.items.length > 0;
  const list = (
    <>
      {tab === 'search' && cur.problem ? (
        <div className="sp-empty sp-stale">
          {problemLine(cur.problem)}
          <button type="button" className="sp-btn" onClick={() => runSearch(query, true)}>
            Retry
          </button>
        </div>
      ) : null}
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
            <Tile key={`${item.kind}-${item.id}-${i}`} item={item} kindWord={tab === 'search'} onOpen={() => setOpen(item)} onPlay={() => playItem(item)} onShuffle={() => shuffleItem(item)} />
          ))}
        </div>
      ) : null}
    </>
  );
  const main =
    tall && tab === 'queue' ? (
      <div className="sp-main">
        <QueueView />
      </div>
    ) : grouped ? (
      <div className="sp-main">
        {cur.problem ? (
          <div className="sp-empty sp-stale">
            {problemLine(cur.problem)}
            <button type="button" className="sp-btn" onClick={() => runSearch(query, true)}>
              Retry
            </button>
          </div>
        ) : null}
        <SearchGroups items={cur.items} isNow={isNow} onPlay={playItem} onOpen={setOpen} onShuffle={shuffleItem} />
      </div>
    ) : (
      <div className="sp-scroll" onScroll={scrolled}>
        {tab === 'search' && !asked && cur.items.length === 0 && !cur.problem ? (
          <div className="sp-empty">Type at least two letters, then wait a moment or press Enter.</div>
        ) : cur.problem && cur.items.length === 0 ? (
          <div className="sp-empty">
            {problemLine(cur.problem)}
            {cur.problem === 'needsSignIn' || cur.problem === 'notsetup' ? (
              <button type="button" className="sp-btn" onClick={() => useToolsStore.getState().openDrawer('accounts')}>
                Open Tools
              </button>
            ) : (
              <button type="button" className="sp-btn" onClick={() => (tab === 'search' ? runSearch(query, true) : load(tab as Exclude<BrowseTab, 'search' | 'queue'>, 0))}>
                Retry
              </button>
            )}
          </div>
        ) : cur.loaded && cur.items.length === 0 ? (
          <div className="sp-empty">{EMPTY_LINE[tab]}</div>
        ) : (
          list
        )}
      </div>
    );
  const songsView = open ? <SongsView item={open} tall={tall} backLabel={tabs.find((t) => t.id === tab)?.label ?? 'Back'} onBack={() => setOpen(null)} onNote={setNote} /> : null;
  return (
    <div className="sp-body">
      {tall ? (
        <>
          <div className="sp-bar">
            {tabsEl}
            {searchBox}
          </div>
          {songsView ?? main}
        </>
      ) : (
        songsView ?? (
          <>
            {searchBox}
            {tabsEl}
            {main}
          </>
        )
      )}
      {note ? (
        <div className="sp-note" role="status">
          {note}
        </div>
      ) : null}
    </div>
  );
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
function SongsView({ item, tall, backLabel, onBack, onNote }: { item: SpotifyItem; tall: boolean; backLabel: string; onBack: () => void; onNote: (n: string | null) => void }) {
  const kind = item.kind === 'album' ? 'album' : 'playlist';
  const [st, setSt] = useState<SongsState>({ items: [], total: item.count ?? 0, page: 0, more: false, loading: true, problem: null });
  const isNow = useIsNow();
  const mounted = useRef(true);
  const loading = useRef(false);
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
      if (e.key === 'Escape') onBack();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onBack]);

  const fail = (e: unknown) => mounted.current && onNote(playProblemLine(spotifyProblem(e)));
  const playAll = (shuffled: boolean) => {
    void playWhole(item, shuffled, () => onNote('Starting Spotify')).then(() => onNote(null), fail);
  };
  const playFrom = (t: SpotifyTrack) => {
    if (!t.id || !t.playable) return;
    spotify.play('track', t.id, { context: { kind, id: item.id }, offsetId: t.id, ...deviceArg() }).then((answer) => finishPlay(answer, () => onNote('Starting Spotify'))).then(() => onNote(null), fail);
  };
  const owner = kindLine(item).replace(/^(Playlist|Album)( by )?/, '');
  const all = !st.more && st.items.length > 0 && st.items.length >= st.total;
  const length = all ? totalLength(st.items.reduce((a, t) => a + (Number.isFinite(t.durationMs) ? t.durationMs : 0), 0)) : null;
  const facts = [st.total > 0 ? songs(st.total) : null, length, owner ? `by ${owner}` : null].filter(Boolean).join(' · ');

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
    </>
  );
  return (
    <div className={`sp-songs${tall ? ' tall' : ''}`}>
      <div className="sp-shead">
        <span className="sp-backrow">
          <button type="button" className="sp-back" aria-label="Back to the list" title="Back to the list (Escape)" onClick={onBack}>
            <IconArrowLeft size={20} stroke={2} aria-hidden="true" />
          </button>
          {tall ? <span className="sp-backlabel">{backLabel}</span> : null}
        </span>
        <Cover src={item.imageUrl ?? item.thumbUrl} size={tall ? 200 : 64} />
        <span className="sp-text">
          <span className="sp-kick">{kind === 'album' ? 'Album' : 'Playlist'}</span>
          <span className="sp-name">{item.name}</span>
          <span className="sp-line">{facts}</span>
        </span>
        {tall ? <span className="sp-shbtns">{playButtons}</span> : playButtons}
      </div>
      <ol
        className="sp-tracks"
        onScroll={(e) => {
          if (st.more && !st.loading && nearEnd(e)) load(st.page + 1);
        }}
      >
        {st.problem && st.items.length === 0 ? (
          <li className="sp-empty">
            {problemLine(st.problem)}
            <button type="button" className="sp-btn" onClick={() => load(0)}>
              Retry
            </button>
          </li>
        ) : !st.loading && st.items.length === 0 ? (
          <li className="sp-empty">No songs in this {kind}.</li>
        ) : (
          st.items.map((t, i) => {
            const on = isNow(t);
            const ok = t.playable && !!t.id;
            return (
              <li key={`${t.id ?? 'local'}-${i}`}>
                <button
                  type="button"
                  className={`sp-track${on ? ' on' : ''}${ok ? '' : ' off'}`}
                  aria-disabled={!ok}
                  aria-current={on ? 'true' : undefined}
                  {...tip(() => (
                    <div className="sp-tipline">
                      <b>{t.name}</b>
                      <span>{ok ? [t.artists, t.album, trackLength(t.durationMs)].filter(Boolean).join(' · ') : 'This song cannot be played here: it is a local file, or not available in this country.'}</span>
                    </div>
                  ))}
                  onClick={() => playFrom(t)}
                >
                  <span className="sp-n">
                    {on ? (
                      <PlayingBars />
                    ) : (
                      <>
                        <span className="sp-num">{i + 1}</span>
                        {ok && <IconPlayerPlayFilled className="sp-hov" size={16} aria-hidden="true" />}
                      </>
                    )}
                  </span>
                  <span className="sp-tname">{t.name}</span>
                  <span className="sp-tart">{t.artists}</span>
                  <span className="sp-tlen">{trackLength(t.durationMs)}</span>
                </button>
              </li>
            );
          })
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
