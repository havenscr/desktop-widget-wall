import { useCallback, useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent, type UIEvent } from 'react';
import {
  IconArrowLeft,
  IconArrowsShuffle,
  IconBrandSpotify,
  IconChevronRight,
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
import { hideTip, pinTip, tip, TIP_DELAY_MS } from '../../ui/HoverTip';
import { Cover } from './Cover';
import {
  isNowPlaying,
  kindLine,
  playProblemLine,
  problemLine,
  SEARCH_MIN,
  SEARCH_WAIT_MS,
  songs,
  spotifyProblem,
  tileLine,
  trackLength,
  useListenSource,
  useSpotifyNow,
  type ListenSource,
  type SpotifyProblem,
} from './model';
import { readSpotifyStatus, useSpotifyStatus } from './status';

export type BrowseTab = 'search' | 'playlists' | 'albums' | 'liked' | 'recent';
export const BROWSE_TABS: readonly { id: BrowseTab; label: string }[] = [
  { id: 'search', label: 'Search' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'albums', label: 'Albums' },
  { id: 'liked', label: 'Liked' },
  { id: 'recent', label: 'Recent' },
];
/** A page of a list or of a playlist's songs (Spotify gives 50 at a time). */
export const PAGE = 50;
/** Within this many pixels of the end of a list, the next page is read. */
const MORE_AT_PX = 160;
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
};

function readTab(tab: Exclude<BrowseTab, 'search'>, page: number): Promise<SpotifyItem[]> {
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
 */
export function SpotifyCard() {
  const source = useListenSource((s) => s.source);
  const setSource = useListenSource((s) => s.setSource);
  // The horizon's moon keeps 40 px clear of this card (it moves to another of its places).
  const [card, setCard] = useState<HTMLElement | null>(null);
  useSkyKeepClear('listen-card', card);
  return (
    <section ref={setCard} className={`u-card sp-card${source === 'youtube' ? ' yt' : ''}`} aria-label="Music to play">
      <div className="sp-top">
        <SourceSwitch source={source} onPick={setSource} />
        <span className="sp-hint">Which player the wall follows</span>
      </div>
      {source === 'youtube' ? <YouTubeSide /> : <SpotifyBrowse />}
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

function SpotifyBrowse() {
  const { status, failed } = useSpotifyStatus();
  if (!status) return failed ? <CardLine text={problemLine('down')} action="retry" /> : <div className="sp-state" aria-busy="true" />;
  if (!status.setup) return <CardLine text="Spotify is not set up on this wall. Tools says how." action="tools" />;
  if (!status.signedIn) return <CardLine text={problemLine('needsSignIn')} action="tools" />;
  return <Browser />;
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

/** Play an item whole, or shuffled (the shuffle switch first, then the play). */
function playWhole(item: SpotifyItem, shuffled: boolean): Promise<void> {
  const go = () => spotify.play(item.kind, item.id);
  return (shuffled ? spotify.shuffle(true).then(go) : go()).then(() => void refreshNowPlaying());
}

function Browser() {
  const [tab, setTab] = useState<BrowseTab>('playlists');
  const [lists, setLists] = useState<Record<BrowseTab, ListState>>(() => ({ search: EMPTY_LIST, playlists: EMPTY_LIST, albums: EMPTY_LIST, liked: EMPTY_LIST, recent: EMPTY_LIST }));
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
    };
  }, []);
  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(id);
  }, [note]);

  const patch = useCallback((t: BrowseTab, p: Partial<ListState>) => setLists((all) => ({ ...all, [t]: { ...all[t], ...p } })), []);

  const load = useCallback(
    (t: Exclude<BrowseTab, 'search'>, page: number) => {
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
    if (tab !== 'search' && !lists[tab].loaded && !lists[tab].loading) load(tab, 0);
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
    setNote('Starting Spotify');
    void playWhole(item, false).then(() => mounted.current && setNote(null), fail);
  };
  const shuffleItem = (item: SpotifyItem) => void playWhole(item, true).catch(fail);

  const cur = lists[tab];
  const songsIn = cur.items.filter((i) => i.kind === 'track');
  const lists2 = cur.items.filter((i) => i.kind !== 'track');
  const scrolled = (e: UIEvent<HTMLElement>) => {
    if (tab !== 'search' && tab !== 'recent' && cur.more && !cur.loading && nearEnd(e)) load(tab, cur.page + 1);
  };
  return (
    <div className="sp-body">
      {open ? (
        <SongsView item={open} onBack={() => setOpen(null)} onNote={setNote} />
      ) : (
        <>
          <label className="sp-search">
            <IconSearch size={20} stroke={1.8} aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder="Search Spotify"
              aria-label="Search Spotify"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runSearch(query, true);
              }}
            />
          </label>
          <div className="sp-tabs" role="tablist" aria-label="Spotify library">
            {BROWSE_TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
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
                  <button type="button" className="sp-btn" onClick={() => (tab === 'search' ? runSearch(query, true) : load(tab, 0))}>
                    Retry
                  </button>
                )}
              </div>
            ) : cur.loaded && cur.items.length === 0 ? (
              <div className="sp-empty">{EMPTY_LINE[tab]}</div>
            ) : (
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
            )}
          </div>
        </>
      )}
      {note ? (
        <div className="sp-note" role="status">
          {note}
        </div>
      ) : null}
    </div>
  );
}

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
function PlayingBars() {
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
function Tile({ item, kindWord, onOpen, onPlay, onShuffle }: { item: SpotifyItem; kindWord: boolean; onOpen: () => void; onPlay: () => void; onShuffle: () => void }) {
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
function SongsView({ item, onBack, onNote }: { item: SpotifyItem; onBack: () => void; onNote: (n: string) => void }) {
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
    onNote('Starting Spotify');
    void playWhole(item, shuffled).catch(fail);
  };
  const playFrom = (t: SpotifyTrack) => {
    if (!t.id || !t.playable) return;
    spotify.play('track', t.id, { context: { kind, id: item.id }, offsetId: t.id }).then(() => void refreshNowPlaying(), fail);
  };
  const owner = kindLine(item).replace(/^(Playlist|Album)( by )?/, '');
  const all = !st.more && st.items.length > 0 && st.items.length >= st.total;
  const length = all ? totalLength(st.items.reduce((a, t) => a + (Number.isFinite(t.durationMs) ? t.durationMs : 0), 0)) : null;
  const facts = [st.total > 0 ? songs(st.total) : null, length, owner ? `by ${owner}` : null].filter(Boolean).join(' · ');

  return (
    <div className="sp-songs">
      <div className="sp-shead">
        <button type="button" className="sp-back" aria-label="Back to the list" title="Back to the list (Escape)" onClick={onBack}>
          <IconArrowLeft size={20} stroke={2} aria-hidden="true" />
        </button>
        <Cover src={item.imageUrl ?? item.thumbUrl} size={64} />
        <span className="sp-text">
          <span className="sp-kick">{kind === 'album' ? 'Album' : 'Playlist'}</span>
          <span className="sp-name">{item.name}</span>
          <span className="sp-line">{facts}</span>
        </span>
        <button type="button" className="sp-btn fill big" onClick={() => playAll(false)}>
          <IconPlayerPlayFilled size={18} aria-hidden="true" />
          Play
        </button>
        <button type="button" className="sp-btn plain big" onClick={() => playAll(true)}>
          <IconArrowsShuffle size={18} aria-hidden="true" />
          Shuffle
        </button>
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
