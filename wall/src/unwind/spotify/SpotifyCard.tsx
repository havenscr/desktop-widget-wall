import { useCallback, useEffect, useRef, useState, type UIEvent } from 'react';
import {
  IconArrowLeft,
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
import { isPlaying, isQuiet } from '../../music/model';
import { playerName, sourceKey } from '../../music/players';
import { spotify, type SpotifyItem, type SpotifyTrack } from '../../music/spotify';
import { refreshNowPlaying, useNowPlayingStore } from '../../music/store';
import { useNowPlaying } from '../../music/useNowPlaying';
import { useToolsStore } from '../../tools/store';
import { tip } from '../../ui/HoverTip';
import { Cover } from './Cover';
import {
  itemLine,
  playProblemLine,
  problemLine,
  SEARCH_MIN,
  SEARCH_WAIT_MS,
  songs,
  spotifyProblem,
  trackLength,
  useLastContext,
  useListenSource,
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

const KIND_WORD: Record<SpotifyItem['kind'], string> = { track: 'Song', album: 'Album', playlist: 'Playlist' };

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
  return (
    <section className={`u-card sp-card${source === 'youtube' ? ' yt' : ''}`} aria-label="Music to play">
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

function Browser() {
  const [tab, setTab] = useState<BrowseTab>('playlists');
  const [lists, setLists] = useState<Record<BrowseTab, ListState>>(() => ({ search: EMPTY_LIST, playlists: EMPTY_LIST, albums: EMPTY_LIST, liked: EMPTY_LIST, recent: EMPTY_LIST }));
  const [query, setQuery] = useState('');
  const [asked, setAsked] = useState('');
  const [open, setOpen] = useState<SpotifyItem | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const nowTitle = useNowPlayingStore((s) => s.info?.title ?? '');
  const mounted = useRef(true);
  const listsRef = useRef(lists);
  listsRef.current = lists;
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

  // Search: on Enter, or after 400 ms without typing, with at least two characters.
  const runSearch = useCallback(
    (q: string) => {
      const text = q.trim();
      if (text.length < SEARCH_MIN || text === asked) return;
      setAsked(text);
      setTab('search');
      setOpen(null);
      patch('search', { loading: true, problem: null });
      spotify.search(text).then(
        (r) => {
          if (!mounted.current) return;
          const items = [...(r?.tracks ?? []), ...(r?.playlists ?? []), ...(r?.albums ?? [])];
          patch('search', { items, loading: false, loaded: true, more: false, page: 0 });
        },
        (e) => mounted.current && patch('search', { items: [], loading: false, loaded: true, problem: spotifyProblem(e) }),
      );
    },
    [asked, patch],
  );
  useEffect(() => {
    if (query.trim().length < SEARCH_MIN) return;
    const id = setTimeout(() => runSearch(query), SEARCH_WAIT_MS);
    return () => clearTimeout(id);
  }, [query, runSearch]);

  const playItem = (item: SpotifyItem) => {
    spotify.play(item.kind, item.id).then(
      () => void refreshNowPlaying(),
      (e) => mounted.current && setNote(playProblemLine(spotifyProblem(e))),
    );
  };

  const cur = lists[tab];
  return (
    <div className="sp-body">
      {open ? (
        <SongsView item={open} nowTitle={nowTitle} onBack={() => setOpen(null)} onNote={setNote} />
      ) : (
        <>
          <div className="sp-bar">
            <label className="sp-search">
              <IconSearch size={20} stroke={1.8} aria-hidden="true" />
              <input
                type="search"
                value={query}
                placeholder="Search Spotify"
                aria-label="Search Spotify"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') runSearch(query);
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
          </div>
          <div
            className="sp-list"
            role="list"
            onScroll={(e) => {
              if (tab !== 'search' && tab !== 'recent' && cur.more && !cur.loading && nearEnd(e)) load(tab, cur.page + 1);
            }}
          >
            {tab === 'search' && !asked ? (
              <div className="sp-empty">Type at least two letters, then wait a moment or press Enter.</div>
            ) : cur.problem && cur.items.length === 0 ? (
              <div className="sp-empty">
                {problemLine(cur.problem)}
                {cur.problem === 'needsSignIn' || cur.problem === 'notsetup' ? (
                  <button type="button" className="sp-btn" onClick={() => useToolsStore.getState().openDrawer('accounts')}>
                    Open Tools
                  </button>
                ) : tab !== 'search' ? (
                  <button type="button" className="sp-btn" onClick={() => load(tab, 0)}>
                    Retry
                  </button>
                ) : null}
              </div>
            ) : cur.loaded && cur.items.length === 0 ? (
              <div className="sp-empty">{EMPTY_LINE[tab]}</div>
            ) : (
              cur.items.map((item, i) => (
                <Row key={`${item.kind}-${item.id}-${i}`} item={item} kindWord={tab === 'search'} playing={item.kind === 'track' && !!nowTitle && item.name === nowTitle} onOpen={() => (item.kind === 'track' ? playItem(item) : setOpen(item))} onPlay={() => playItem(item)} />
              ))
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

/** The hover card for a row: the larger cover, the name, its line and what a click does. */
function ItemTip({ item }: { item: SpotifyItem }) {
  return (
    <div className="sp-tip">
      <Cover src={item.imageUrl ?? item.thumbUrl} size={120} />
      <div className="sp-tip-text">
        <b>{item.name}</b>
        <span>{KIND_WORD[item.kind]}</span>
        {item.subtitle ? <span>{item.subtitle}</span> : null}
        {item.count !== null && item.kind !== 'track' ? <span>{songs(item.count)}</span> : null}
        <em>{item.kind === 'track' ? 'Click to play' : 'Click for its songs, or play it all'}</em>
      </div>
    </div>
  );
}

function Row({ item, kindWord, playing, onOpen, onPlay }: { item: SpotifyItem; kindWord: boolean; playing: boolean; onOpen: () => void; onPlay: () => void }) {
  const line = kindWord ? [KIND_WORD[item.kind], itemLine(item)].filter(Boolean).join(' · ') : itemLine(item);
  return (
    <div className={`sp-row${playing ? ' on' : ''}`} role="listitem">
      <button type="button" className="sp-open" aria-label={item.kind === 'track' ? `Play ${item.name}` : `Open ${item.name}`} {...tip(() => <ItemTip item={item} />)} onClick={onOpen}>
        <Cover src={item.thumbUrl ?? item.imageUrl} size={44} />
        <span className="sp-text">
          <span className="sp-name">{item.name}</span>
          <span className="sp-line">{playing ? 'Playing now' : line}</span>
        </span>
      </button>
      {item.kind !== 'track' ? (
        <button type="button" className="sp-play" aria-label={`Play all of ${item.name}`} title={`Play all of ${item.name}`} onClick={onPlay}>
          <IconPlayerPlayFilled size={18} aria-hidden="true" />
        </button>
      ) : null}
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
 * A playlist's or album's songs, slid in over the list: Back (or Escape), the cover and
 * name, Play all, then every song (read 50 at a time as the list scrolls; it scrolls inside
 * the card and never grows it). A click plays from that song on, in its list; the song now
 * playing is marked; a song that cannot be played (a local file) is dimmed and says why.
 */
function SongsView({ item, nowTitle, onBack, onNote }: { item: SpotifyItem; nowTitle: string; onBack: () => void; onNote: (n: string) => void }) {
  const kind = item.kind === 'album' ? 'album' : 'playlist';
  const [st, setSt] = useState<SongsState>({ items: [], total: item.count ?? 0, page: 0, more: false, loading: true, problem: null });
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
  const playAll = () => spotify.play(kind, item.id).then(() => void refreshNowPlaying(), fail);
  const playFrom = (t: SpotifyTrack) => {
    if (!t.id || !t.playable) return;
    useLastContext.getState().remember({ kind, id: item.id }, st.items);
    spotify.play('track', t.id, { context: { kind, id: item.id }, offsetId: t.id }).then(() => void refreshNowPlaying(), fail);
  };

  return (
    <div className="sp-songs">
      <div className="sp-shead">
        <button type="button" className="sp-back" title="Back to the list (Escape)" onClick={onBack}>
          <IconArrowLeft size={20} stroke={2} aria-hidden="true" />
          Back
        </button>
        <Cover src={item.thumbUrl ?? item.imageUrl} size={48} />
        <span className="sp-text">
          <span className="sp-name">{item.name}</span>
          <span className="sp-line">{[item.subtitle, st.total > 0 ? songs(st.total) : null].filter(Boolean).join(' · ')}</span>
        </span>
        <button type="button" className="sp-btn fill" onClick={playAll}>
          <IconPlayerPlayFilled size={18} aria-hidden="true" />
          Play all
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
            const on = !!nowTitle && t.name === nowTitle;
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
                  <span className="sp-n">{on ? <IconPlayerPlayFilled size={14} aria-label="Playing now" /> : i + 1}</span>
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
