import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { IconSearch } from '@tabler/icons-react';
import type { YtPlaylist, YtVideo } from '../../music/youtube';
import { tip } from '../../ui/HoverTip';
import { arrowTarget, gridColumns } from '../spotify/Tile';
import { MAX_PAGES, PAGE_SIZE, SEARCH_TIP, SPENT_LINE, devSearchKnob, nearEnd, searchSpent, searchesLine, videosLine } from './model';
import { useYoutubeStatus } from './status';
import { YtSongs } from './YtSongs';
import { loadList, openPlaylist, retryMore, runSearch, searchesBack, setTab, useYtLibrary, type Loaded, type YtTab } from './store';
import { RowSkeletons, TileSkeletons, YtEmpty, YtRows, YtState, YtThumb } from './YtParts';

const TABS: { id: YtTab; label: string }[] = [
  { id: 'playlists', label: 'Playlists' },
  { id: 'liked', label: 'Liked' },
];
const EMPTY_LINE: Record<YtTab, string> = { playlists: 'No playlists yet', liked: 'No liked videos yet' };

/** Arrow keys move the focus between the tiles of the grid (the card's own walk, `arrowTarget`). */
function gridKey(e: ReactKeyboardEvent<HTMLButtonElement>): void {
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

function PlaylistTile({ p }: { p: YtPlaylist }) {
  return (
    <div className="sp-tilebox">
      <button
        type="button"
        className="sp-tile yt-tile"
        onKeyDown={gridKey}
        {...tip(() => (
          <div className="sp-tipline">
            <b>{p.title}</b>
            <span>{videosLine(p.count)}</span>
            <span>Click to see its videos</span>
          </div>
        ))}
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
  if (cur.problem) return <YtState problem={cur.problem} onRetry={() => retryMore(name)} />;
  if (cur.next && cur.pages >= MAX_PAGES) return <div className="yt-cap">Showing the first {(MAX_PAGES * PAGE_SIZE).toLocaleString('en-US')}</div>;
  return null;
}

/**
 * The library on the YouTube side: one row with the tabs Playlists and Liked and the search field,
 * and under it the owner's playlists as tiles (four columns at rest, five tall), or his liked videos
 * or the answer to a search as rows. A tile opens its videos. Search runs on Enter only, never on
 * typing (each search that is not repeated spends one of about 100 a day). Nothing plays from here.
 */
export function YtBrowse({ tall }: { tall: boolean }) {
  const tab = useYtLibrary((s) => s.tab);
  const lists = useYtLibrary((s) => s[s.tab]);
  const opened = useYtLibrary((s) => s.opened);
  const query = useYtLibrary((s) => s.query);
  const found = useYtLibrary((s) => s.found);
  const quotaSaid = useYtLibrary((s) => s.searchQuota);
  const left = useYoutubeStatus((s) => s.status?.searchesLeft ?? null);
  const [text, setText] = useState('');
  // Opening the card reads the current list again (Rust answers from memory while it is fresh).
  useEffect(() => {
    void loadList(useYtLibrary.getState().tab);
    const knob = devSearchKnob();
    if (knob) void runSearch(knob);
  }, []);
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
          <button key={t.id} type="button" role="tab" aria-selected={!searching && tab === t.id} tabIndex={!searching && tab === t.id ? 0 : -1} className={!searching && tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
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
        <div className="yt-scroll yt-rowscroll">
          {found?.problem ? (
            <YtState problem={found.problem} onRetry={() => void runSearch(query)} />
          ) : !found || found.loading || !found.loaded ? (
            <RowSkeletons count={8} />
          ) : found.items.length === 0 ? (
            <YtEmpty text="Nothing found. Try other words." />
          ) : (
            <YtRows items={found.items} />
          )}
        </div>
      </div>
    );
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
      <YtRows items={lists.items as YtVideo[]} foot={<ListFoot cur={lists} name="liked" />} />
    );
    main = (
      <div
        className={`yt-scroll${tab === 'liked' ? ' yt-rowscroll' : ''}`}
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
