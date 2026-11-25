// @ts-ignore node's own file call; the stylesheet rules are read as text.
import { readFileSync } from 'node:fs';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { TALL_CLOSE_MS, TALL_OPEN_MS } from '../spotify/model';
import { SAVED_KEY, type SavedItem } from './saved';
import { resetWatch, useWatchStore } from './store';
import { WatchCard } from './WatchCard';

vi.setConfig({ testTimeout: 20_000 });

const ITEMS: SavedItem[] = Array.from({ length: 12 }, (_, i) => ({ kind: 'twitch', id: `channel_${i}`, label: `Channel ${i}` }) as SavedItem);
const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const card = () => document.querySelector<HTMLElement>('.w-card')!;
const css = (f: string) => (readFileSync(new URL(f, import.meta.url), 'utf8') as string).replace(/\r\n/g, '\n');

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem(SAVED_KEY, JSON.stringify(ITEMS));
  resetWatch();
  useWatchStore.getState().setTab('watch');
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  localStorage.clear();
});

describe('the Watch list card grows while pointed at', () => {
  it('grows after the Listen wait, and shrinks the Listen moment after the pointer leaves', async () => {
    render(<WatchCard />);
    expect(card().classList.contains('grown')).toBe(false);
    fireEvent.pointerEnter(card());
    await flush(TALL_OPEN_MS - 50);
    expect(card().classList.contains('grown')).toBe(false);
    await flush(50);
    expect(card().classList.contains('grown')).toBe(true);
    fireEvent.pointerLeave(card());
    await flush(TALL_CLOSE_MS - 50);
    expect(card().classList.contains('grown')).toBe(true);
    await flush(50);
    expect(card().classList.contains('grown')).toBe(false);
  });

  it('a pass through the card that is shorter than the wait never grows it', async () => {
    render(<WatchCard />);
    fireEvent.pointerEnter(card());
    await flush(200);
    fireEvent.pointerLeave(card());
    await flush(TALL_OPEN_MS * 2);
    expect(card().classList.contains('grown')).toBe(false);
  });

  it('stays at its size when the list is empty', async () => {
    localStorage.setItem(SAVED_KEY, '[]');
    resetWatch();
    render(<WatchCard />);
    fireEvent.pointerEnter(card());
    await flush(TALL_OPEN_MS + 50);
    expect(card().classList.contains('grown')).toBe(false);
  });

  it('the style grows the card to the editor height with Listen\'s open and close timing, inside the 720 px strip', () => {
    const s = css('../../styles/ownlists.css');
    const rule = s.slice(s.indexOf('.w-card.grown {'));
    expect(rule).toContain('height: 630px;');
    expect(rule).toContain('transition-duration: 250ms, 240ms;');
    expect(s).toContain('transition: opacity 250ms ease, height 400ms ease-out;');
  });
});
