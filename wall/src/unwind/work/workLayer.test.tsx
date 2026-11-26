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
import { NextUp } from './NextUp';
import { LAYER_CLOSE_MS, SUPPRESS_SELECTOR } from './useWorkLayer';
import { Unwind } from '../../screens/Unwind';
import { usePlaceStore } from '../../state/places';

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

describe('Unwind work layer, one shown state', () => {
  it('a dialog, menu or take takes the timeline, the keys and Next up down together, and Next up stops reading', async () => {
    let reads = 0;
    mocks.set('wall2_meet_next', () => (reads++, { accounts: [], meetings: [] }));
    render(
      <Frame place="unwind">
        <NextUp tab="watch" />
      </Frame>,
    );
    await flush();
    fireEvent.pointerEnter(main());
    await flush(50);
    const band = () => document.querySelector<HTMLElement>('.u-nu')!;
    expect(useWorkLayerStore.getState().shown).toBe(true);
    expect(band().hasAttribute('inert')).toBe(false);
    expect(reads).toBeGreaterThan(0);
    for (const html of ['<div role="dialog"></div>', '<div role="menu"></div>', '<div class="w-take"></div>', '<div class="u-lib-menu"></div>', '<div class="watt-menu"></div>']) {
      document.body.insertAdjacentHTML('beforeend', html);
      await flush(50);
      expect(useWorkLayerStore.getState().shown).toBe(false);
      expect(band().hasAttribute('inert')).toBe(true);
      expect(layer().hasAttribute('inert')).toBe(true);
      await flush(LAYER_FADE_OUT_MS + 20);
      const after = reads;
      await flush(5 * 60_000);
      expect(reads).toBe(after);
      document.body.lastElementChild!.remove();
      await flush(50);
      expect(useWorkLayerStore.getState().shown).toBe(true);
    }
  });
});

describe('Unwind work layer, nothing always mounted keeps it down', () => {
  for (const tab of ['listen', 'watch'] as const) {
    it(`a plain ${tab} render has no take, dialog or menu, so the layer can show`, async () => {
      usePlaceStore.setState({ active: 'unwind', from: 'work', zenDream: false });
      useWatchStore.getState().setTab(tab);
      mocks.set('wall2_meet_next', () => ({ accounts: [], meetings: [] }));
      render(
        <Frame place="unwind">
          <Unwind />
        </Frame>,
      );
      await flush(100);
      expect(document.querySelector(SUPPRESS_SELECTOR)).toBeNull();
      fireEvent.pointerEnter(main());
      await flush(50);
      expect(useWorkLayerStore.getState().shown).toBe(true);
    });
  }
  it('many class changes in one frame make one look', async () => {
    render(<Frame place="unwind">x</Frame>);
    await flush();
    const spy = vi.spyOn(document, 'querySelector');
    const el = document.createElement('div');
    document.body.append(el);
    for (let i = 0; i < 50; i++) el.className = `c${i}`;
    await flush(50);
    const looks = spy.mock.calls.filter((c) => c[0] === SUPPRESS_SELECTOR).length;
    spy.mockRestore();
    el.remove();
    expect(looks).toBeLessThanOrEqual(1);
  });
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
  it('under reduced motion the lift takes its place with no slide, the day line has no fade and the veil no fade in; the veil drops its blur under reduced transparency', () => {
    const s = css('../../styles/unwind-work.css');
    const block = (head: string) => {
      const at = s.indexOf(head);
      expect(at).toBeGreaterThan(-1);
      return s.slice(at, s.indexOf('\n}\n', at));
    };
    const motion = block('/* Reduced motion: the row takes its new place');
    expect(motion).toMatch(/\.main\[data-place='unwind'\]\[data-work-shown\] \.u-foot,\s*\.main\[data-place='unwind'\]\[data-work-shown\] \.u-office-slot \{\s*transition: none;/);
    expect(motion).toMatch(/\.main\[data-work-shown\] \.rib-line \{\s*transition: none;/);
    expect(motion).toMatch(/::after \{\s*animation: none;/);
    const trans = block('/* Reduced transparency');
    expect(trans).toContain('backdrop-filter: none');
    expect(trans).toContain('-webkit-backdrop-filter: none');
  });
  it('the take, dialog and menu suppression fades out too, and is not an instant cut', () => {
    const s = css('../../styles/unwind-work.css');
    const start = s.indexOf('.main:has(\n  .w-take');
    expect(start).toBeGreaterThan(-1);
    const rule = s.slice(start, s.indexOf('\n}', start));
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
