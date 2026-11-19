import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { IconArrowsShuffle, IconListDetails, IconPlayerPlayFilled, IconSearch } from '@tabler/icons-react';
import type { YtPlaylist, YtVideo } from '../../music/youtube';
import { tip } from '../../ui/HoverTip';
import { useVisible } from '../../ui/useVisible';
import { libraryMenuOpen } from '../watch/libraryMenuModel';
import { libraryHandlers } from '../watch/libraryOpen';
import { MAX_PAGES, PAGE_SIZE, SEARCH_TIP, SPENT_LINE, devSearchKnob, nearEnd, searchSpent, searchesLine, videosLine } from './model';
import { ForYou } from './ForYou';
import { loadForYou } from './forYou';
import { playFrom } from './queue';
import { useYoutubeStatus } from './status';
import { YtSongs } from './YtSongs';
import { libraryMounted, libraryVisible, loadList, openPlaylist, retryList, runSearch, searchesBack, setTab, startReads, useYtLibrary, type Loaded, type YtTab } from './store';
import { RowSkeletons, TileSkeletons, YtEmpty, YtRows, YtState, YtThumb, gridKey } from './YtParts';

const TABS: { id: YtTab; label: string }[] = [
  { id: 'foryou', label: 'For you' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'liked', label: 'Liked' },
];
const EMPTY_LINE: Record<Exclude<YtTab, 'foryou'>, string> = { playlists: 'No playlists yet', liked: 'No liked videos yet' };

function PlaylistTile({ p }: { p: YtPlaylist }) {
  // The right-click menu: Play and Shuffle open the playlist and start it when its first page arrives; then Pin to the left.
  const menu = libraryHandlers({
    entry: { kind: 'playlist', id: p.id, name: p.title, art: p.thumb ?? undefined },
    name: p.title,
    actions: () => [
      { id: 'play', label: 'Play', icon: <IconPlayerPlayFilled size={20} aria-hidden="true" />, run: () => openPlaylist(p, 'play') },
      { id: 'shuffle', label: 'Shuffle', icon: <IconArrowsShuffle size={20} aria-hidden="true" />, run: () => openPlaylist(p, 'shuffle') },
      { id: 'videos', label: 'Videos', icon: <IconListDetails size={20} aria-hidden="true" />, run: () => openPlaylist(p) },
    ],
  });
  const card = tip(() => (
    <div className="sp-tipline">
      <b>{p.title}</b>
      <span>{videosLine(p.count)}</span>
      <span>Click to see its videos</span>
    </div>
  ));
  return (
    <div className="sp-tilebox">
      <button
        type="button"
        className="sp-tile yt-tile"
        onKeyDown={(e) => {
          if (!menu.onMenuKey(e)) gridKey(e);
        }}
        onContextMenu={menu.onContextMenu}
        {...card}
        // The card does not come back while a library menu is open.
        onMouseEnter={(e) => (libraryMenuOpen() ? undefined : card.onMouseEnter(e))}
        onFocus={(e) => (libraryMenuOpen() ? undefined : card.onFocus(e))}
        onClick={() => openPlaylist(p)}
      >
        <YtThumb src={p.thumb} className="sp-tilecover yt-cover" />
        <span className="sp-tname2">{p.title}</span>
        <span className="sp-tline yt-count">{videosLine(p.count)}</span>
      </button>
    </div>
  );
}

/** What stands under a list: a failed next page with its Retry, or the cap. */
function ListFoot({ cur, name }: { cur: Loaded<unknown>; name: 'playlists' | 'liked' }) {
  if (cur.problem) return <YtState problem={cur.problem} onRetry={() => retryList(name)} />;
  if (cur.next && cur.pages >= MAX_PAGES) return <div className="yt-cap">Showing the first {(MAX_PAGES * PAGE_SIZE).toLocaleString('en-US')}</div>;
  return null;
}

/**
 * The library on the YouTube side: one row with the tabs Playlists and Liked and the search field,
 * and under it the owner's playlists as tiles (four columns at rest, five tall), or his liked videos
 * or the answer to a search as rows. A tile opens its videos. Search runs on Enter only, never on
 * typing (each search that is not repeated spends one of about 100 a day). A row of Liked or of the search
 * answer plays from that row on the wall (see `queue.ts`).
 */
export function YtBrowse({ tall }: { tall: boolean }) {
  const tab = useYtLibrary((s) => s.tab);
  const lists = useYtLibrary((s) => (s.tab === 'foryou' ? s.playlists : s[s.tab]));
  const opened = useYtLibrary((s) => s.opened);
  const query = useYtLibrary((s) => s.query);
  const found = useYtLibrary((s) => s.found);
  const quotaSaid = useYtLibrary((s) => s.searchQuota);
  const left = useYoutubeStatus((s) => s.status?.searchesLeft ?? null);
  const [text, setText] = useState('');
  // The library tells the store when it is on screen: nothing is read while the page is hidden or after the
  // side is gone, and what is waiting is read once it shows. What is loaded stays across the tall view
  // opening and closing (Refresh is the way to read again); only a list older than Rust keeps it is read.
  const visible = useVisible();
  useEffect(() => libraryMounted(), []);
  const knobRun = useRef(false);
  useEffect(() => {
    libraryVisible(visible);
    if (!visible) return;
    startReads();
    const knob = knobRun.current ? null : devSearchKnob();
    knobRun.current = true;
    if (knob) void runSearch(knob);
  }, [visible]);
  // The For you shelf is read each time its tab shows (a read under a minute old is kept).
  useEffect(() => {
    if (visible && tab === 'foryou') void loadForYou();
  }, [visible, tab]);
  useEffect(() => {
    if (query === '') setText('');
  }, [query]);
  useEffect(() => {
    if (typeof left === 'number' && left > 0) searchesBack();
  }, [left]);
  const spent = searchSpent(left, quotaSaid);
  const line = searchesLine(left);

  const tabKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    const to = buttons[(at + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length];
    to.focus();
    to.click();
  };
  const searching = query !== '';
  const bar = (
    <div className="yt-bar">
      <div className="sp-tabs" role="tablist" aria-label="Your YouTube library" onKeyDown={tabKey}>
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={!searching && tab === t.id} tabIndex={(!searching && tab === t.id) || (searching && t.id === 'playlists') ? 0 : -1} className={!searching && tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <label className={`sp-search yt-search${spent ? ' spent' : ''}`} {...(line || spent ? tip(SEARCH_TIP) : {})}>
        <IconSearch size={20} stroke={1.8} aria-hidden="true" />
        <input
          type="search"
          value={text}
          maxLength={100}
          disabled={spent}
          placeholder={spent ? '' : 'Search music on YouTube'}
          aria-label={spent ? SPENT_LINE : 'Search music on YouTube'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runSearch(text);
          }}
        />
        {spent ? <span className="yt-spent">{SPENT_LINE}</span> : null}
        {line && !spent ? <span className="yt-left">{line}</span> : null}
      </label>
    </div>
  );

  // A playlist opened: tall keeps the bar above it, at rest it takes the card (Back, name, Refresh).
  let main;
  if (opened) main = <YtSongs tall={tall} />;
  else if (searching) {
    main = (
      <div className="yt-main">
        <div className="yt-resultsbar">
          <span className="yt-resultsfor">
            Results for <b>{query}</b>
          </span>
          <button type="button" className="sp-btn plain" onClick={() => setTab('playlists')}>
            Back to Playlists
          </button>
        </div>
        <div className="yt-scroll yt-rowscroll" tabIndex={0} role="region" aria-label="Search results">
          {found?.problem ? (
            <YtState problem={found.problem} onRetry={() => void runSearch(query)} />
          ) : !found || found.loading || !found.loaded ? (
            <RowSkeletons count={8} />
          ) : found.items.length === 0 ? (
            <YtEmpty text="Nothing found. Try other words." />
          ) : (
            <YtRows items={found.items} list={{ list: 'found', query }} onPlay={(i) => playFrom(found.items, i, { list: 'found', query })} />
          )}
        </div>
      </div>
    );
  } else if (tab === 'foryou') {
    main = <ForYou tall={tall} />;
  } else {
    const first = lists.items.length === 0;
    const body = lists.problem && first ? (
      <YtState problem={lists.problem} onRetry={() => void loadList(tab)} />
    ) : !lists.loaded && first ? (
      tab === 'playlists' ? <TileSkeletons count={tall ? 10 : 8} /> : <RowSkeletons count={8} />
    ) : lists.loaded && first && !lists.loading ? (
      <YtEmpty text={EMPTY_LINE[tab]} />
    ) : first ? (
      tab === 'playlists' ? <TileSkeletons count={tall ? 10 : 8} /> : <RowSkeletons count={8} />
    ) : tab === 'playlists' ? (
      <>
        <div className="yt-grid">
          {(lists.items as YtPlaylist[]).map((p) => (
            <PlaylistTile key={p.id} p={p} />
          ))}
        </div>
        <ListFoot cur={lists} name="playlists" />
      </>
    ) : (
      <YtRows items={lists.items as YtVideo[]} list={{ list: 'liked' }} onPlay={(i) => playFrom(lists.items as YtVideo[], i, { list: 'liked' })} foot={<ListFoot cur={lists} name="liked" />} />
    );
    main = (
      <div
        className={`yt-scroll${tab === 'liked' ? ' yt-rowscroll' : ''}`}
        {...(tab === 'liked' ? { tabIndex: 0, role: 'region', 'aria-label': 'Liked videos' } : {})}
        onScroll={(e) => {
          if (lists.next && !lists.loading && !lists.problem && nearEnd(e)) void loadList(tab, true);
        }}
      >
        {body}
      </div>
    );
  }
  return (
    <div className="yt-lib" data-tall={tall ? 'true' : 'false'}>
      {opened && !tall ? null : bar}
      {main}
    </div>
  );
}
