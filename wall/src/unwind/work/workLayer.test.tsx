// @ts-ignore node's own file call; the stylesheet rules are read as text.
import { readFileSync } from 'node:fs';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { Frame, ribbonKind } from '../../screens/Frame';
import { resetWatch, useWatchStore } from '../watch/store';
import { useWatchRest } from '../watch/rest';
import { useWorkLayerStore } from './layerStore';

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
  useWorkLayerStore.setState({ shown: false });
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
    expect(s).toMatch(/opacity 400ms/);
    expect(s).toContain('prefers-reduced-motion');
  });
});
