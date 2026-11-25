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
import { PinnedRow } from '../../work/PinnedRow';
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
    const tiles = [...r.container.querySelectorAll('.u-key:not(.empty)')];
    expect(tiles).toHaveLength(5);
    const labelOf = (id: string) => LIBRARY_DATA.flatMap((g) => g.keys).find((k) => k.id === id)!.label;
    expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual(DEFAULTS.map((d) => labelOf(d.slice(4))));
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
    const r = render(<UnwindKeys />);
    await flush(50);
    const row = r.getByTestId('u-keys');
    act(() => useWorkLayerStore.setState({ shown: false }));
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
    const lock = r.container.querySelector<HTMLElement>('.u-key:not(.empty)')!;
    expect(lock.getAttribute('aria-label')).toBe('All monitors off');
    fireEvent.keyDown(lock, { key: 'Enter' });
    fireEvent.click(lock, { detail: 0 });
    await flush(50);
    expect(sent).toEqual([]);
  });
  it('fades under the grown Watch list and keeps its size and width in the stylesheet', () => {
    const s = css('../../styles/unwind-work.css');
    const at = s.indexOf('.u-right:has(.w-card.grown, .w-card.closing');
    expect(at).toBeGreaterThan(-1);
    const under = s.slice(at, s.indexOf('}', at));
    expect(under).toContain('opacity: 0');
    expect(under).toContain('visibility: hidden');
    expect(under).toContain('pointer-events: none');
    expect(under).toMatch(/transition:\s*opacity var\(--u-work-out, 400ms\) ease,\s*visibility 0s linear var\(--u-work-out, 400ms\)/);
    const row = s.slice(s.indexOf('.u-keys {'), s.indexOf('}', s.indexOf('.u-keys {')));
    expect(row).toContain('left: 1px');
    expect(row).toContain('right: 1px');
    expect(row).toContain('top: calc(var(--room-top, 332px) - 8px)');
    expect(s).toMatch(/\.u-key \{[^}]*height: 64px/);
    expect(s).toMatch(/\.u-keys-tiles \{[^}]*repeat\(5, minmax\(0, 1fr\)\)[^}]*gap: 8px/);
  });
  it('all text is 16 px or more and tiles keep 6 px of side padding', () => {
    const s = css('../../styles/unwind-work.css');
    const keys = s.slice(s.indexOf('.u-keys {'));
    for (const m of keys.matchAll(/font: \d+ (\d+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(16);
    expect(keys).toMatch(/\.u-key\.deck-tile\.key-tile \{[^}]*padding: 0 6px/);
  });
  it('always has five equal places: one pin leaves four quiet empty ones, three leaves two', async () => {
    for (const [pins, empty] of [[['lib:thirds'], 4], [['lib:thirds', 'lib:focus', 'lib:snip'], 2]] as const) {
      localStorage.setItem(PINS_KEY, JSON.stringify(pins));
      const r = render(<UnwindKeys />);
      await flush(50);
      expect(r.container.querySelectorAll('.u-keys-tiles > .u-key-wrap > .u-key')).toHaveLength(5);
      expect(r.container.querySelectorAll('.u-key:not(.empty)')).toHaveLength(pins.length);
      const empties = [...r.container.querySelectorAll('.u-key.empty')];
      expect(empties).toHaveLength(empty);
      expect(empties.every((e) => e.tagName === 'BUTTON' && e.getAttribute('aria-label') === 'Add a key')).toBe(true);
      r.unmount();
    }
    expect(css('../../styles/unwind-work.css')).toMatch(/\.u-key\.empty \{[^}]*border: 1px dashed/);
  });
  it('asks nothing of the key feed or the library while the row is hidden', async () => {
    useWorkLayerStore.setState({ shown: false });
    let asked = 0;
    mocks.set('wall2_keys_library', () => (asked++, LIBRARY_DATA));
    mocks.set('wall2_keys_summary', () => (asked++, { front: 'app', autoId: null, exe: null, sets: [], source: 'file', defaultPins: DEFAULTS, filePins: [] }));
    render(<UnwindKeys />);
    await flush(100);
    expect(asked).toBe(0);
    act(() => useWorkLayerStore.setState({ shown: true }));
    await flush(100);
    expect(asked).toBeGreaterThan(0);
  });
  it('reads real sizes: every text in the row is 16 px or more and a label never wraps', async () => {
    const style = document.createElement('style');
    style.textContent = css('../../styles/unwind-work.css');
    document.head.appendChild(style);
    const r = render(<UnwindKeys />);
    await flush(50);
    const key = r.container.querySelector<HTMLElement>('.u-key:not(.empty)')!;
    expect(parseFloat(getComputedStyle(key).fontSize)).toBeGreaterThanOrEqual(16);
    expect(parseFloat(getComputedStyle(r.container.querySelector<HTMLElement>('.u-keys-line')!).fontSize)).toBeGreaterThanOrEqual(16);
    expect(getComputedStyle(r.container.querySelector<HTMLElement>('.u-key-l')!).whiteSpace).toBe('nowrap');
    style.remove();
  });
  it('tiles are Work key tiles with the same kind for the same pins', async () => {
    const u = render(<UnwindKeys />);
    await flush(50);
    const unwindKinds = [...u.container.querySelectorAll('.u-key:not(.empty)')].map((t) => [t.getAttribute('aria-label'), t.getAttribute('data-kind')]);
    expect(u.container.querySelector('.u-key:not(.empty)')!.className).toBe('deck-tile key-tile u-key');
    u.unmount();
    const w = render(<PinnedRow />);
    await flush(50);
    const workKinds = [...w.container.querySelectorAll('.pin-tile')].map((t) => [t.getAttribute('aria-label'), t.getAttribute('data-kind')]);
    expect(unwindKinds.length).toBe(5);
    expect(unwindKinds.every(([, k]) => !!k)).toBe(true);
    expect(unwindKinds).toEqual(workKinds);
  });
  it('a key that cannot run has no kind, as on Work', async () => {
    localStorage.setItem(PINS_KEY, JSON.stringify(['lib:thirds']));
    mocks.set('wall2_arrange_status', () => false);
    const r = render(<UnwindKeys />);
    await flush(50);
    const t = r.container.querySelector('.u-key:not(.empty)')!;
    expect(t.classList.contains('off')).toBe(true);
    expect(t.hasAttribute('data-kind')).toBe(false);
  });
  it('no label is cut with an ellipsis and none is clipped', () => {
    const s = css('../../styles/unwind-work.css');
    const keys = s.slice(s.indexOf('.u-key {'), s.indexOf('.u-keys-line {'));
    expect(keys).not.toContain('ellipsis');
    expect(keys).not.toContain('line-clamp');
    expect(keys).toMatch(/\.u-key-l \{[^}]*white-space: nowrap/);
    expect(keys).toMatch(/\.u-key\.deck-tile\.key-tile \{[^}]*height: 64px/);
  });
  it('fits labels to the measured tile width, with a fake measure and a real width', async () => {
    localStorage.setItem(PINS_KEY, JSON.stringify(['lib:record-169', 'lib:snip']));
    const w = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 60 });
    try {
      const r = render(<UnwindKeys measure={(t) => t.length * 10} />);
      await flush(50);
      for (const l of r.container.querySelectorAll('.u-key-l')) expect((l.textContent ?? '').length * 10).toBeLessThanOrEqual(60);
    } finally {
      if (w) Object.defineProperty(HTMLElement.prototype, 'clientWidth', w);
    }
  });
  it('a right-click opens the full Work key menu, and Move right changes the stored row', async () => {
    const r = render(<UnwindKeys />);
    await flush(50);
    fireEvent.contextMenu(r.container.querySelector('[aria-label="Thirds"]')!);
    await flush(10);
    const rows = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((b) => b.textContent);
    expect(rows).toEqual(['Run it now', 'Move left', 'Move right', 'Replace with another key', 'Rename...', 'Remove from Always here']);
    expect(useWorkLayerStore.getState().held).toBe(true);
    fireEvent.click([...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent === 'Move right')!, { detail: 1 });
    await flush(300);
    expect(JSON.parse(localStorage.getItem(PINS_KEY)!).slice(0, 2)).toEqual(['lib:focus', 'lib:thirds']);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(useWorkLayerStore.getState().held).toBe(false);
  });
  it('the ContextMenu key and Shift+F10 open the menu too', async () => {
    const r = render(<UnwindKeys />);
    await flush(50);
    fireEvent.keyDown(r.container.querySelector('[aria-label="Snip"]')!, { key: 'ContextMenu' });
    await flush(10);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    await flush(300);
    fireEvent.keyDown(r.container.querySelector('[aria-label="Snip"]')!, { key: 'F10', shiftKey: true });
    await flush(10);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
  });
  it('an empty place has Add a key, which opens the picker and adds the key', async () => {
    localStorage.setItem(PINS_KEY, JSON.stringify(['lib:thirds']));
    const r = render(<UnwindKeys />);
    await flush(50);
    fireEvent.contextMenu(r.container.querySelector('.u-key.empty')!);
    await flush(10);
    expect([...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent)).toEqual(['Add a key']);
    fireEvent.click(document.querySelector('[role="menuitem"]')!, { detail: 1 });
    await flush(10);
    const dlg = document.querySelector('.pk');
    expect(dlg).not.toBeNull();
    expect(useWorkLayerStore.getState().held).toBe(true);
    fireEvent.click(dlg!.querySelector('button.pk-row:not([aria-disabled="true"])')!);
    await flush(300);
    expect(JSON.parse(localStorage.getItem(PINS_KEY)!)).toHaveLength(2);
  });
  it('Rename shows the name on this row and on the Work row, Reset clears it, and a name too wide for the tile cannot be saved', async () => {
    const wide = (t: string) => t.length * 10;
    const r = render(<UnwindKeys measure={wide} />);
    await flush(50);
    const work = render(<PinnedRow />);
    await flush(50);
    fireEvent.contextMenu(r.container.querySelector('[aria-label="Snip"]')!);
    await flush(10);
    fireEvent.click([...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent === 'Rename...')!, { detail: 1 });
    await flush(10);
    const field = document.querySelector<HTMLInputElement>('input[aria-label="Name"]')!;
    const save = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Save')!;
    expect(save.disabled).toBe(true);
    fireEvent.change(field, { target: { value: 'A very long name here' } });
    expect(document.querySelector('.key-rename-fit')!.textContent).toMatch(/Too long/);
    expect(save.disabled).toBe(true);
    fireEvent.change(field, { target: { value: 'Grab' } });
    expect(document.querySelector('.key-rename-fit')!.textContent).toMatch(/Fits/);
    fireEvent.click(save);
    await flush(300);
    expect(JSON.parse(localStorage.getItem('wall2-keys-pin-names')!)).toEqual({ 'lib:snip': 'Grab' });
    expect(r.container.querySelector('[aria-label="Grab"] .u-key-l')!.textContent).toBe('Grab');
    expect(work.container.querySelector('.pin-tile[aria-label="Grab"] .deck-lbl')!.textContent).toBe('Grab');
    fireEvent.contextMenu(r.container.querySelector('[aria-label="Grab"]')!);
    await flush(10);
    fireEvent.click([...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent === 'Rename...')!, { detail: 1 });
    await flush(10);
    fireEvent.click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Reset')!);
    await flush(300);
    expect(localStorage.getItem('wall2-keys-pin-names')).toBeNull();
    expect(r.container.querySelector('[aria-label="Snip"]')).not.toBeNull();
    expect(work.container.querySelector('.pin-tile[aria-label="Snip"]')).not.toBeNull();
  });
  it('the layer suppression leaves the keys row menu and picker out, and the popovers fade', () => {
    const s = css('../../styles/unwind-work.css');
    expect(s).toContain("[role='dialog']:not(.u-keys *)");
    expect(s).toContain("[role='menu']:not(.u-keys *)");
    expect(s).toMatch(/\.u-fade\.out > \* \{[^}]*animation: u-keys-pop-out/);
  });
});
