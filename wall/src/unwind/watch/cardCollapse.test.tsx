// @ts-ignore node's own file call; the stylesheet rules are read as text.
import { readFileSync } from 'node:fs';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { TALL_CLOSE_MS, TALL_OPEN_MS } from '../spotify/model';
import { SAVED_KEY, type SavedItem } from './saved';
import { resetWatch, useWatchStore } from './store';
import { WatchCard } from './WatchCard';
import { CARD_COLLAPSE_MS } from './useListGrow';

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

describe('the Watch card shrinking back', () => {
  it('marks closing in the same render the card lets go: no state is grown, then neither grown nor closing', async () => {
    render(<WatchCard />);
    const states: string[] = [];
    const seen: (string | null)[] = [];
    const watch = new MutationObserver((rs) => rs.forEach((r) => seen.push(r.oldValue)));
    watch.observe(card(), { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
    fireEvent.pointerEnter(card());
    await flush(TALL_OPEN_MS + 20);
    fireEvent.pointerLeave(card());
    await flush(TALL_CLOSE_MS + 20);
    await flush(CARD_COLLAPSE_MS + 20);
    watch.takeRecords().forEach((r) => seen.push(r.oldValue));
    watch.disconnect();
    states.push(...(seen.filter((v) => v !== null) as string[]), card().className);
    expect(states.some((c) => c.includes('grown'))).toBe(true);
    states.forEach((c, i) => {
      if (i > 0 && states[i - 1].includes('grown')) expect(c.includes('grown') || c.includes('closing')).toBe(true);
    });
  });
  it('is marked closing for its collapse time after it stops growing, so what is under it waits', async () => {
    render(<WatchCard />);
    expect(card().style.getPropertyValue('--w-collapse')).toBe(`${CARD_COLLAPSE_MS}ms`);
    fireEvent.pointerEnter(card());
    await flush(TALL_OPEN_MS + 20);
    expect(card().classList.contains('grown')).toBe(true);
    expect(card().classList.contains('closing')).toBe(false);
    fireEvent.pointerLeave(card());
    await flush(TALL_CLOSE_MS + 20);
    expect(card().classList.contains('grown')).toBe(false);
    expect(card().classList.contains('closing')).toBe(true);
    await flush(CARD_COLLAPSE_MS - 60);
    expect(card().classList.contains('closing')).toBe(true);
    await flush(100);
    expect(card().classList.contains('closing')).toBe(false);
  });
  it('growing again during the shrink cancels the wait', async () => {
    render(<WatchCard />);
    fireEvent.pointerEnter(card());
    await flush(TALL_OPEN_MS + 20);
    fireEvent.pointerLeave(card());
    await flush(TALL_CLOSE_MS + 20);
    expect(card().classList.contains('closing')).toBe(true);
    fireEvent.pointerEnter(card());
    await flush(TALL_OPEN_MS + 20);
    expect(card().classList.contains('closing')).toBe(false);
    expect(card().classList.contains('grown')).toBe(true);
  });
  it('the keys stay hidden and take no pointer while it grows or shrinks, and the card stays above them', () => {
    const w = css('../../styles/unwind-work.css');
    const at = w.indexOf('.u-right:has(.w-card.grown, .w-card.closing');
    const rule = w.slice(at, w.indexOf('}', at));
    expect(rule).toContain('visibility: hidden');
    expect(rule).toContain('pointer-events: none');
    expect(w).toMatch(/\.w-card \{[^}]*?position: relative;\s*z-index: 2/);
    // the card's own height transition and the wait share one length
    expect(css('../../styles/ownlists.css')).toContain('height var(--w-collapse, 400ms) ease-out');
    expect(CARD_COLLAPSE_MS).toBe(400);
  });
});
