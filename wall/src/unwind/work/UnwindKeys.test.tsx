// @ts-ignore node's own file call; the stylesheet rules are read as text.
import { readFileSync } from 'node:fs';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIBRARY_DATA } from '../../bridge/devMocks/libraryData';
import { mocks } from '../../bridge/tauri';
import { PINS_KEY } from '../../work/libraryModel';
import { resetKeysFeed } from '../../work/keysFeed';
import type { KeysSummary } from '../../work/keysModel';
import { useWorkLayerStore } from './layerStore';
import { UnwindKeys } from './UnwindKeys';

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const css = (f: string) => (readFileSync(new URL(f, import.meta.url), 'utf8') as string).replace(/\r\n/g, '\n');
const DEFAULTS = ['lib:thirds', 'lib:focus', 'lib:record-169', 'lib:snip', 'lib:strip-dark'];
let sent: unknown[];

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetKeysFeed();
  sent = [];
  useWorkLayerStore.setState({ shown: true });
  const summary: KeysSummary = { front: 'app', autoId: null, exe: null, sets: [], source: 'file', defaultPins: DEFAULTS, filePins: [] };
  mocks.set('wall2_keys_summary', () => summary);
  mocks.set('wall2_keys_library', () => LIBRARY_DATA);
  mocks.set('wall2_arrange_status', () => true);
  mocks.set('wall2_keys_send_library', (a) => (sent.push(a), null));
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  localStorage.clear();
  useWorkLayerStore.setState({ shown: false });
});

describe('Unwind keys row', () => {
  it('shows the five Always here keys with one-word labels', async () => {
    const r = render(<UnwindKeys />);
    await flush(50);
    const tiles = [...r.container.querySelectorAll('.u-key')];
    expect(tiles).toHaveLength(5);
    expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual(expect.arrayContaining(['Thirds', 'Snip']));
    const words = tiles.map((t) => t.querySelector('.u-key-l')!.textContent);
    expect(words.every((w) => !/\s/.test(w ?? ''))).toBe(true);
    expect(words).toContain('Record');
  });
  it('a press sends the library key and says so in the status line', async () => {
    const r = render(<UnwindKeys />);
    await flush(50);
    fireEvent.click(r.container.querySelector('[aria-label="Snip"]')!, { detail: 1 });
    await flush(50);
    expect(sent).toEqual([{ id: 'snip' }]);
    expect(r.container.querySelector('.u-keys-line')!.textContent).toMatch(/Snip/);
  });
  it('is inert while the layer is hidden, and live while it shows', async () => {
    useWorkLayerStore.setState({ shown: false });
    const r = render(<UnwindKeys />);
    await flush(50);
    const row = r.getByTestId('u-keys');
    expect(row.hasAttribute('inert')).toBe(true);
    expect(row.hasAttribute('data-shown')).toBe(false);
    act(() => useWorkLayerStore.setState({ shown: true }));
    expect(row.hasAttribute('inert')).toBe(false);
    expect(row.hasAttribute('data-shown')).toBe(true);
  });
  it('a key that runs only from a click ignores Enter and Space', async () => {
    localStorage.setItem(PINS_KEY, JSON.stringify(['lib:displays-off']));
    const r = render(<UnwindKeys />);
    await flush(50);
    const lock = r.container.querySelector<HTMLElement>('.u-key')!;
    expect(lock.getAttribute('aria-label')).toBe('All monitors off');
    fireEvent.keyDown(lock, { key: 'Enter' });
    fireEvent.click(lock, { detail: 0 });
    await flush(50);
    expect(sent).toEqual([]);
  });
  it('fades under the grown Watch list and keeps its size and width in the stylesheet', () => {
    const s = css('../../styles/unwind-work.css');
    const under = s.slice(s.indexOf('.u-right:has(.w-card.grown'), s.indexOf('}', s.indexOf('.u-right:has(.w-card.grown')));
    expect(under).toContain('opacity: 0');
    expect(under).toContain('visibility: hidden');
    expect(under).toContain('pointer-events: none');
    expect(under).toMatch(/transition:\s*opacity var\(--u-work-out, 400ms\) ease,\s*visibility 0s linear var\(--u-work-out, 400ms\)/);
    const row = s.slice(s.indexOf('.u-keys {'), s.indexOf('}', s.indexOf('.u-keys {')));
    expect(row).toContain('left: 1px');
    expect(row).toContain('right: 1px');
    expect(row).toContain('top: 324px');
    expect(s).toMatch(/\.u-key \{[^}]*height: 64px/);
    expect(s).toMatch(/\.u-keys-tiles \{[^}]*repeat\(5, minmax\(0, 1fr\)\)[^}]*gap: 8px/);
  });
  it('all text is 16 px or more and tiles keep 10 px of padding', () => {
    const s = css('../../styles/unwind-work.css');
    const keys = s.slice(s.indexOf('.u-keys {'));
    for (const m of keys.matchAll(/font: \d+ (\d+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(16);
    expect(keys).toMatch(/\.u-key \{[^}]*padding: 0 10px/);
  });
});
