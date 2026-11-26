// @ts-ignore node's own file call; the stylesheet rules are read as text.
import { readFileSync } from 'node:fs';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { Frame, ribbonKind } from '../../screens/Frame';
import { MAIN_GAP, MAIN_ROWS } from '../../screens/frameLayout';
import { LAYER_FADE_OUT_MS } from './UnwindTimeline';
import { resetWatch, useWatchStore } from '../watch/store';
import { useWatchRest } from '../watch/rest';
import { useWorkLayerStore } from './layerStore';
import { LAYER_CLOSE_MS } from './useWorkLayer';

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const layer = () => document.querySelector<HTMLElement>('.u-work')!;
const main = () => document.querySelector<HTMLElement>('.main')!;
const css = (f: string) => (readFileSync(new URL(f, import.meta.url), 'utf8') as string).replace(/\r\n/g, '\n');

beforeEach(() => {
  vi.useFakeTimers();
  resetWatch();
  useWatchRest.setState({ rest: false, cardHeld: false });
  useWorkLayerStore.setState({ shown: false, held: false });
  mocks.set('wall2_meet_day', () => ({ accounts: [], events: [] }));
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
});

describe('Unwind work layer', () => {
  it('Unwind has no ribbon of its own at rest', () => {
    expect(ribbonKind('unwind')).toBeNull();
  });
  it('shows a thin line at rest and the layer is hidden and inert', async () => {
    render(<Frame place="unwind">x</Frame>);
    await flush();
    expect(document.querySelector('.rib-line')).not.toBeNull();
    expect(layer().hasAttribute('data-shown')).toBe(false);
    expect(layer().hasAttribute('inert')).toBe(true);
    expect(document.querySelector('.u-work .rib')).toBeNull();
  });
  it('the pointer shows it at once, and it hides 1.5 s after the pointer leaves', async () => {
    render(<Frame place="unwind">x</Frame>);
    fireEvent.pointerEnter(main());
    await flush();
    expect(layer().hasAttribute('data-shown')).toBe(true);
    expect(layer().hasAttribute('inert')).toBe(false);
    expect(document.querySelector('.u-work .rib')).not.toBeNull();
    fireEvent.pointerLeave(main());
    await flush(1400);
    expect(layer().hasAttribute('data-shown')).toBe(true);
    await flush(150);
    expect(layer().hasAttribute('data-shown')).toBe(false);
    expect(layer().hasAttribute('inert')).toBe(true);
    await flush(500);
    expect(document.querySelector('.u-work .rib')).toBeNull();
  });
  it('stays down while the controls rest or the sheet is open', async () => {
    useWatchRest.setState({ rest: true });
    render(<Frame place="unwind">x</Frame>);
    fireEvent.pointerEnter(main());
    await flush();
    expect(layer().hasAttribute('data-shown')).toBe(false);
    act(() => useWatchRest.setState({ rest: false }));
    await flush();
    expect(layer().hasAttribute('data-shown')).toBe(true);
    act(() => useWatchStore.setState({ sheet: true }));
    await flush();
    expect(layer().hasAttribute('data-shown')).toBe(false);
  });
  it('is not mounted on other places', () => {
    render(<Frame place="work">x</Frame>);
    expect(document.querySelector('.u-work')).toBeNull();
    fireEvent.pointerEnter(main());
    expect(useWorkLayerStore.getState().shown).toBe(false);
  });
  it('the stylesheet fades and hides it, and honors reduced motion', () => {
    const s = css('../../styles/unwind-work.css');
    expect(s).toContain('.u-work[data-shown]');
    expect(s).toMatch(/opacity 250ms/);
    expect(s).toContain('opacity var(--u-work-out, 400ms)');
    expect(s).toContain('prefers-reduced-motion');
  });
  it('the take, dialog and menu suppression fades out too, and is not an instant cut', () => {
    const s = css('../../styles/unwind-work.css');
    const rule = s.slice(s.indexOf(".main:has(.w-take"), s.indexOf('}', s.indexOf(".main:has(.w-take")));
    expect(rule).toContain('visibility: hidden');
    expect(rule).toMatch(/transition:\s*opacity var\(--u-work-out, 400ms\) ease,\s*visibility 0s linear var\(--u-work-out, 400ms\)/);
  });
  it('the CSS fade and the unmount wait share one source', async () => {
    const s = css('../../styles/unwind-work.css');
    expect(s).toContain('var(--u-work-out, 400ms)');
    expect(LAYER_FADE_OUT_MS).toBe(400);
    render(<Frame place="unwind">x</Frame>);
    expect(layer().style.getPropertyValue('--u-work-out')).toBe(`${LAYER_FADE_OUT_MS}ms`);
    fireEvent.pointerEnter(main());
    await flush();
    fireEvent.pointerLeave(main());
    await flush(1500);
    expect(layer().hasAttribute('data-shown')).toBe(false);
    await flush(LAYER_FADE_OUT_MS - 20);
    expect(document.querySelector('.u-work .rib')).not.toBeNull();
    await flush(40);
    expect(document.querySelector('.u-work .rib')).toBeNull();
  });
  it('the layer stays in the foot band, clear of the player controls, and its backdrop takes no pointer', () => {
    const s = css('../../styles/unwind-work.css');
    const height = Number(/\.u-work \{[^}]*?height: (\d+)px/.exec(s)?.[1]);
    const frame = MAIN_ROWS.reduce((a, h) => a + h, 0) + MAIN_GAP * (MAIN_ROWS.length - 1);
    // The controls live in the top band (the first row); the layer starts below it.
    expect(frame - height).toBeGreaterThanOrEqual(MAIN_ROWS[0]);
    const before = s.slice(s.indexOf('.u-work::before'), s.indexOf('}', s.indexOf('.u-work::before')));
    expect(before).toContain('pointer-events: none');
  });
  it('sits under the music card and the Watch list (grown or shrinking) that reach into the foot band', () => {
    const s = css('../../styles/unwind-work.css');
    const u = css('../../styles/unwind.css');
    const z = Number(/\.u-work \{[^}]*?z-index: (\d+)/.exec(s)?.[1]);
    expect(Number(/\.sp-card \{[^}]*?z-index: (\d+)/.exec(u)?.[1])).toBeGreaterThan(z);
    expect(s).toMatch(/\.w-card \{[^}]*?position: relative;\s*z-index: (\d+)/);
    expect(Number(/\.w-card \{[^}]*?position: relative;\s*z-index: (\d+)/.exec(s)?.[1])).toBeGreaterThan(z);
  });
  it('held (the keys row menu or picker open) keeps the layer up after the pointer leaves, and not past a rest', async () => {
    render(<Frame place="unwind">x</Frame>);
    fireEvent.pointerEnter(main());
    await flush();
    act(() => useWorkLayerStore.setState({ held: true }));
    fireEvent.pointerLeave(main());
    await flush(LAYER_CLOSE_MS + 500);
    expect(useWorkLayerStore.getState().shown).toBe(true);
    act(() => useWatchRest.setState({ rest: true }));
    await flush();
    expect(useWorkLayerStore.getState().shown).toBe(false);
    act(() => useWatchRest.setState({ rest: false }));
    await flush();
    expect(useWorkLayerStore.getState().shown).toBe(true);
    act(() => useWorkLayerStore.setState({ held: false }));
    await flush(LAYER_CLOSE_MS + 500);
    expect(useWorkLayerStore.getState().shown).toBe(false);
  });
});
