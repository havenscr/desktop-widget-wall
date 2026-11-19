import { Fragment, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { IconArrowLeft } from '@tabler/icons-react';
import type { SpotifyItem } from '../../music/spotify';
import { tip } from '../../ui/HoverTip';
import { Cover } from '../spotify/Cover';
import { trackLength } from '../spotify/model';

/** The chips of a search: All, then one per kind. */
export type SearchChip = 'all' | 'playlists' | 'albums' | 'songs';

/** Covers in a row of the All view: six at rest, five (larger) in the tall view. */
export const ROW_COVERS = { rest: 6, tall: 5 } as const;

/** What one search answered, split by kind (the counts the chips show are what came back). */
export function splitHits(items: readonly SpotifyItem[]) {
  return {
    playlists: items.filter((i) => i.kind === 'playlist'),
    albums: items.filter((i) => i.kind === 'album'),
    songs: items.filter((i) => i.kind === 'track'),
  };
}

/** The chip row of a search: square chips with counts (a radio group), and "Library" to leave the search. */
export function SearchChips({ value, counts, kinds, icons, onPick, onLeave }: { value: SearchChip; counts: { playlists: number; albums: number; songs: number }; kinds: readonly Exclude<SearchChip, 'all'>[]; icons: Record<Exclude<SearchChip, 'all'>, ReactNode>; onPick: (c: SearchChip) => void; onLeave: () => void }) {
  const words: Record<Exclude<SearchChip, 'all'>, string> = { playlists: 'Playlists', albums: 'Albums', songs: 'Songs' };
  const key = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="radio"]')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    const to = buttons[(at + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length];
    to.focus();
    to.click();
  };
  const all: readonly SearchChip[] = ['all', ...kinds];
  return (
    <div className="mu-chips">
      <div className="mu-chiplist" role="radiogroup" aria-label="Show" onKeyDown={key}>
        {all.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={value === c} tabIndex={value === c ? 0 : -1} className={`mu-chip${value === c ? ' on' : ''}`} onClick={() => onPick(c)}>
            {c === 'all' ? null : icons[c]}
            {c === 'all' ? 'All' : words[c]}
            {c === 'all' ? null : <span className="mu-chip-n">{counts[c]}</span>}
          </button>
        ))}
      </div>
      <button type="button" className="mu-leave" onClick={onLeave}>
        <IconArrowLeft size={18} stroke={1.8} aria-hidden="true" />
        Library
      </button>
    </div>
  );
}

/** A song of a search as one row: cover, name, artist and length; a click plays it. */
function SongRow({ item, playing, onPlay }: { item: SpotifyItem; playing: boolean; onPlay: () => void }) {
  return (
    <button
      type="button"
      role="listitem"
      className={`sp-li${playing ? ' on' : ''}`}
      aria-label={`Play ${item.name}${item.subtitle ? ` by ${item.subtitle}` : ''}`}
      {...tip(() => (
        <div className="sp-tipline">
          <b>{item.name}</b>
          <span>{item.subtitle ?? 'Song'}</span>
          <em>Click to play</em>
        </div>
      ))}
      onClick={onPlay}
    >
      <Cover src={item.thumbUrl ?? item.imageUrl} size={40} />
      <span className="sp-text">
        <span className="sp-li-n">{item.name}</span>
        <span className="sp-li-a">{playing ? 'Playing now' : item.subtitle ?? ''}</span>
      </span>
      {typeof item.durationMs === 'number' ? <span className="sp-li-len">{trackLength(item.durationMs)}</span> : null}
    </button>
  );
}

/**
 * What a search found, for the chip that is on. All: a row of playlist covers with "See all N", a row of albums, then the songs
 * as rows. A chip alone: that kind only, a full grid of covers (songs as rows). Chips filter the answer already held.
 */
export function SearchResults({ items, chip, tall, tile, isNow, onPlay, onChip }: { items: readonly SpotifyItem[]; chip: SearchChip; tall: boolean; tile: (item: SpotifyItem) => ReactNode; isNow: (t: { id: string | null; name: string; artists?: string | null }) => boolean; onPlay: (item: SpotifyItem) => void; onChip: (c: SearchChip) => void }) {
  const { playlists, albums, songs } = splitHits(items);
  const rows = (list: SpotifyItem[]) => (
    <div className="sp-songlist" role="list">
      {list.map((item, i) => (
        <SongRow key={`${item.id}-${i}`} item={item} playing={isNow({ id: item.id, name: item.name, artists: item.subtitle })} onPlay={() => onPlay(item)} />
      ))}
    </div>
  );
  const grid = (list: SpotifyItem[], cls = '') => (
    <div className={`sp-grid ${cls}`.trim()} role="list">
      {list.map((item, i) => (
        <Fragment key={`${item.kind}-${item.id}-${i}`}>{tile(item)}</Fragment>
      ))}
    </div>
  );
  if (chip === 'playlists') return grid(playlists);
  if (chip === 'albums') return grid(albums);
  if (chip === 'songs') return rows(songs);
  const n = tall ? ROW_COVERS.tall : ROW_COVERS.rest;
  const head = (word: string, count: number, to: SearchChip) => (
    <div className="mu-head">
      <span className="mu-head-w">{word}</span>
      <button type="button" className="mu-see" onClick={() => onChip(to)}>
        See all {count}
      </button>
    </div>
  );
  return (
    <div className="mu-all">
      {playlists.length > 0 ? (
        <>
          {head('Playlists', playlists.length, 'playlists')}
          {grid(playlists.slice(0, n), `mu-row mu-row${n}`)}
        </>
      ) : null}
      {albums.length > 0 ? (
        <>
          {head('Albums', albums.length, 'albums')}
          {grid(albums.slice(0, n), `mu-row mu-row${n}`)}
        </>
      ) : null}
      {songs.length > 0 ? (
        <>
          {head('Songs', songs.length, 'songs')}
          {rows(songs)}
        </>
      ) : null}
    </div>
  );
}
