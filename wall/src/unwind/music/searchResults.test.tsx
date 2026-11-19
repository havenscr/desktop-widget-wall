// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IconDisc, IconMusic, IconPlaylist } from '@tabler/icons-react';
import type { SpotifyItem } from '../../music/spotify';
import { LibraryRow } from './LibraryRow';
import { SearchChips, SearchResults, splitHits, type SearchChip } from './SearchResults';

const mk = (n: number, kind: SpotifyItem['kind']): SpotifyItem => ({ kind, id: `${kind}${n}`, name: `${kind} ${n}`, subtitle: 'x' }) as SpotifyItem;
const many = (kind: SpotifyItem['kind'], n: number) => Array.from({ length: n }, (_, i) => mk(i, kind));
const icons = { playlists: <IconPlaylist />, albums: <IconDisc />, songs: <IconMusic /> };
const isNow = () => false;
const tile = (i: SpotifyItem) => <div className="sp-tile" key={i.id}>{i.name}</div>;

describe('SearchResults', () => {
  const items = [...many('playlist', 8), ...many('album', 7), ...many('track', 3)];
  const show = (chip: SearchChip, tall = false) => render(<SearchResults items={items} chip={chip} tall={tall} tile={tile} isNow={isNow} onPlay={vi.fn()} onChip={vi.fn()} />);

  it('All: playlists, albums, then songs, with six covers a row at rest and five tall', () => {
    const { container, unmount } = show('all');
    expect([...container.querySelectorAll('.mu-head-w')].map((e) => e.textContent)).toEqual(['Playlists', 'Albums', 'Songs']);
    expect([...container.querySelectorAll('.mu-row')].map((r) => r.querySelectorAll('.sp-tile').length)).toEqual([6, 6]);
    expect(screen.getByRole('button', { name: 'See all 8' })).toBeTruthy();
    unmount();
    const t = show('all', true);
    expect([...t.container.querySelectorAll('.mu-row')].map((r) => r.querySelectorAll('.sp-tile').length)).toEqual([5, 5]);
  });
  it('a chip shows one kind only, and See all picks the chip', () => {
    const onChip = vi.fn();
    const { container } = render(<SearchResults items={items} chip="all" tall={false} tile={tile} isNow={isNow} onPlay={vi.fn()} onChip={onChip} />);
    fireEvent.click(screen.getByRole('button', { name: 'See all 7' }));
    expect(onChip).toHaveBeenCalledWith('albums');
    expect(container.querySelectorAll('.sp-li')).toHaveLength(3);
    const only = show('albums');
    expect(only.container.querySelectorAll('.sp-tile')).toHaveLength(7);
    expect(only.container.querySelector('.sp-li')).toBeNull();
  });
  it('splitHits counts each kind', () => {
    const h = splitHits(items);
    expect([h.playlists.length, h.albums.length, h.songs.length]).toEqual([8, 7, 3]);
  });
});

describe('SearchChips and LibraryRow', () => {
  it('chips are a radio group with counts and Library leaves', () => {
    const onPick = vi.fn();
    const onLeave = vi.fn();
    render(<SearchChips value="all" counts={{ playlists: 20, albums: 20, songs: 50 }} kinds={['playlists', 'albums', 'songs']} icons={icons} onPick={onPick} onLeave={onLeave} />);
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['All', 'Playlists20', 'Albums20', 'Songs50']);
    fireEvent.click(screen.getByRole('radio', { name: /Songs/ }));
    expect(onPick).toHaveBeenCalledWith('songs');
    fireEvent.click(screen.getByRole('button', { name: 'Library' }));
    expect(onLeave).toHaveBeenCalled();
  });
  it('the library row starts with the word and has one lit tab', () => {
    const { container } = render(<LibraryRow label="Lib" places={[{ id: 'a', label: 'A', icon: null }, { id: 'b', label: 'B', icon: null }]} value="b" onPick={vi.fn()} />);
    expect(container.querySelector('.mu-lib-word')?.textContent).toBe('Library');
    expect(screen.getByRole('tab', { name: 'B' }).getAttribute('aria-selected')).toBe('true');
  });
});
