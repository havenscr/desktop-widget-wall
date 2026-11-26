import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LINES, resetLinesStore, useLinesStore } from '../../horizon/linesSettings';
// @ts-ignore node's own file call; the stylesheet rules are read as text.
import { readFileSync } from 'node:fs';
import { DEFAULT_VIBE, VIBE_KEY, resetVibeStore, useVibeStore } from '../../horizon/vibeSettings';
import { LINES_KEY } from '../../horizon/linesSettings';
import { LinesPanel, VIBE_HINTS, VibePanel, sliderWords } from './LinesPanel';
import { HoverTipLayer, resetTip } from '../../ui/HoverTip';

/** A stylesheet's text (the path is a variable on purpose: a literal `new URL` is rewritten by the bundler). */
const sheet = (f: string): string => (readFileSync(new URL(f, import.meta.url), 'utf8') as string).replace(/\r\n/g, '\n');

beforeEach(() => {
  localStorage.clear();
  resetLinesStore();
});

describe('the Lines panel', () => {
  it('changes every kind of setting, applies presets, and resets', () => {
    render(<LinesPanel />);
    fireEvent.click(screen.getByRole('radio', { name: 'Bars' }));
    fireEvent.change(screen.getByRole('slider', { name: 'How lively' }), { target: { value: '81' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Mint' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Reflection' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Flat' }));
    expect(useLinesStore.getState()).toMatchObject({ type: 'bars', lively: 81, colours: 'mint', reflection: false, rest: 'flat' });
    fireEvent.click(screen.getByRole('button', { name: 'Calm' }));
    expect(useLinesStore.getState()).toMatchObject({ lively: 22, smooth: 72, height: 60 });
    fireEvent.click(screen.getByRole('button', { name: 'Wild' }));
    expect(useLinesStore.getState()).toMatchObject({ lively: 88, smooth: 28, height: 180 });
    act(() => screen.getByRole('button', { name: 'Reset to my usual' }).click());
    expect(useLinesStore.getState()).toMatchObject(DEFAULT_LINES);
  });

  it('reads each value back on one line in plain words and numbers', () => {
    render(<LinesPanel />);
    expect(screen.getAllByText('50, your usual')).toHaveLength(2);
    expect(screen.getByText('104 px, your usual')).toBeTruthy();
    expect(sliderWords('lively', 81)).toBe('81, livelier than usual');
    expect(sliderWords('smooth', 10)).toBe('10, snappier than usual');
    expect(sliderWords('height', 180)).toBe('180 px, taller than usual');
    expect(screen.getByRole('slider', { name: 'Height' }).getAttribute('aria-valuetext')).toBe('104 px, your usual');
  });

  it('shows the active preset only while the three sliders match it', () => {
    render(<LinesPanel />);
    expect(screen.getByRole('button', { name: 'Dancing' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Wild' }));
    expect(screen.getByRole('button', { name: 'Wild' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Dancing' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.change(screen.getByRole('slider', { name: 'Smoothness' }), { target: { value: '40' } });
    for (const name of ['Calm', 'Dancing', 'Wild']) expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).toBe('false');
  });

  it('keyboard: sliders and switch reachable, arrow keys move the chips, Space and Enter work on buttons', () => {
    render(<LinesPanel />);
    for (const name of ['How lively', 'Smoothness', 'Height']) {
      const s = screen.getByRole('slider', { name });
      expect(s.tabIndex).toBe(0);
      expect(s.getAttribute('type')).toBe('range');
    }
    const types = screen.getByRole('radiogroup', { name: 'Line type' });
    expect(screen.getByRole('radio', { name: 'Mountains' }).tabIndex).toBe(0);
    expect(screen.getByRole('radio', { name: 'Bars' }).tabIndex).toBe(-1);
    fireEvent.keyDown(types, { key: 'ArrowRight' });
    expect(useLinesStore.getState().type).toBe('bars');
    fireEvent.keyDown(types, { key: 'ArrowLeft' });
    fireEvent.keyDown(types, { key: 'ArrowLeft' });
    expect(useLinesStore.getState().type).toBe('skyline');
    fireEvent.keyDown(screen.getByRole('radiogroup', { name: 'Colours' }), { key: 'ArrowRight' });
    expect(useLinesStore.getState().colours).toBe('floor');
    fireEvent.keyDown(screen.getByRole('radiogroup', { name: 'At rest' }), { key: 'ArrowDown' });
    expect(useLinesStore.getState().rest).toBe('flat');
    // Every control is a native button or input, so Space and Enter press it.
    for (const el of [screen.getByRole('switch', { name: 'Reflection' }), ...screen.getAllByRole('radio'), ...screen.getAllByRole('button')]) expect(el.tagName).toBe('BUTTON');
    expect(screen.getByRole('switch', { name: 'Reflection' }).tabIndex).toBe(0);
  });

  it('every chip is an enabled native button and its group does not swallow Space or Enter, so the browser\'s own key press chooses it', () => {
    render(<LinesPanel />);
    for (const chip of screen.getAllByRole('radio')) {
      expect(chip.tagName).toBe('BUTTON');
      expect((chip as HTMLButtonElement).disabled).toBe(false);
    }
    // jsdom has no native button activation: this does what a browser does (Enter clicks on keydown, Space on keyup),
    // unless a handler cancelled the key.
    const press = (el: HTMLElement, key: 'Enter' | ' ') => {
      el.focus();
      const kept = fireEvent.keyDown(el, { key });
      if (key === 'Enter' && kept) fireEvent.click(el);
      const up = fireEvent.keyUp(el, { key });
      if (key === ' ' && kept && up) fireEvent.click(el);
    };
    press(screen.getByRole('radio', { name: 'Bars' }), 'Enter');
    expect(useLinesStore.getState().type).toBe('bars');
    press(screen.getByRole('radio', { name: 'Skyline' }), ' ');
    expect(useLinesStore.getState().type).toBe('skyline');
    press(screen.getByRole('radio', { name: 'Mint' }), ' ');
    expect(useLinesStore.getState().colours).toBe('mint');
    press(screen.getByRole('radio', { name: 'Flat' }), 'Enter');
    expect(useLinesStore.getState().rest).toBe('flat');
  });

  it('every control has a hint line or a tooltip made with tip()', async () => {
    render(
      <>
        <LinesPanel />
        <HoverTipLayer />
      </>,
    );
    expect(screen.getByText(/The ridgelines dance as they do today/)).toBeTruthy();
    expect(screen.getByText('One setting for the lines everywhere music plays.')).toBeTruthy();
    const controls = [...screen.getAllByRole('radio'), ...screen.getAllByRole('button'), ...screen.getAllByRole('slider'), ...screen.getAllByRole('switch')];
    // 12 radios (types, colours, at rest), 4 buttons (a reset, three presets), 3 sliders, 1 switch.
    expect(controls).toHaveLength(12 + 4 + 3 + 1);
    for (const el of controls) {
      expect(el.getAttribute('title')).toBeNull();
      resetTip();
      fireEvent.focus(el);
      await act(() => new Promise((r) => setTimeout(r, 5)));
      expect(document.querySelector('.hover-tip')?.textContent, el.getAttribute('aria-label') ?? el.textContent ?? '').toBeTruthy();
    }
    resetTip();
  });
});

describe('the Vibe section', () => {
  const sw = (name: string) => screen.getByRole('switch', { name });

  beforeEach(() => resetVibeStore());

  it('has Auto vibe, Drop Glitch, Tape Grain and Calm cap switches and a Cover choice, each with a helper line', () => {
    render(<VibePanel />);
    expect(sw('Auto vibe').getAttribute('aria-checked')).toBe('true');
    expect(sw('Drop Glitch')).toBeTruthy();
    expect(sw('Tape Grain').getAttribute('aria-checked')).toBe('false');
    expect(sw('Calm cap').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('radio', { name: 'Scene and title' }).getAttribute('aria-checked')).toBe('true');
    for (const id of ['auto', 'glitch', 'tape', 'calm']) {
      const hint = document.getElementById(`ln-${id}-hint`)!;
      expect(hint.className).toBe('ln-hint');
      expect(hint.textContent!.length).toBeGreaterThan(20);
    }
    expect(screen.getByText(VIBE_HINTS.cover)).toBeTruthy();
    expect(sw('Auto vibe').getAttribute('aria-describedby')).toBe('ln-auto-hint');
    expect(screen.getByRole('radiogroup', { name: 'Cover' }).getAttribute('aria-describedby')).toBe('ln-cover-hint');
    expect(document.getElementById('ln-cover-hint')!.textContent).toBe(VIBE_HINTS.cover);
  });

  it('shows Drop Glitch on and locked while Auto vibe is on, and free once Auto vibe is off', () => {
    render(<VibePanel />);
    const g = sw('Drop Glitch');
    expect(g.getAttribute('aria-checked')).toBe('true');
    expect(g.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('On with Auto vibe')).toBeTruthy();
    fireEvent.click(g);
    expect(useVibeStore.getState().dropGlitch).toBe(false);
    fireEvent.click(sw('Auto vibe'));
    expect(sw('Drop Glitch').getAttribute('aria-checked')).toBe('false');
    expect(sw('Drop Glitch').getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(sw('Drop Glitch'));
    expect(useVibeStore.getState().dropGlitch).toBe(true);
    // Auto vibe back on: on and locked again, and the choice made is kept.
    fireEvent.click(sw('Auto vibe'));
    expect(sw('Drop Glitch').getAttribute('aria-disabled')).toBe('true');
    expect(useVibeStore.getState().dropGlitch).toBe(true);
  });

  it('Tape Grain toggles and is kept in the vibe store, away from the Lines setting', () => {
    render(<VibePanel />);
    fireEvent.click(sw('Tape Grain'));
    expect(useVibeStore.getState().tapeGrain).toBe(true);
    expect(JSON.parse(localStorage.getItem(VIBE_KEY)!)).toMatchObject({ tapeGrain: true });
    expect(localStorage.getItem(LINES_KEY) ?? '').not.toContain('tapeGrain');
  });

  it('has Music on other tabs with Medium chosen, a helper line, and keeps a change in the vibe store', () => {
    render(<VibePanel />);
    expect(screen.getByRole('radio', { name: 'Medium' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radiogroup', { name: 'Music on other tabs' }).getAttribute('aria-describedby')).toBe('ln-music-hint');
    expect(document.getElementById('ln-music-hint')!.textContent).toBe(VIBE_HINTS.offTabMusic);
    fireEvent.click(screen.getByRole('radio', { name: 'Full' }));
    expect(useVibeStore.getState().offTabMusic).toBe('full');
    expect(JSON.parse(localStorage.getItem('wall2-vibe')!)).toMatchObject({ offTabMusic: 'full' });
  });

  it('changes Calm cap and Cover and keeps them in the vibe store, away from the Lines setting', () => {
    render(<VibePanel />);
    fireEvent.click(sw('Calm cap'));
    fireEvent.click(screen.getByRole('radio', { name: 'Scene only' }));
    expect(useVibeStore.getState()).toMatchObject({ calmCap: true, cover: 'scene' });
    expect(JSON.parse(localStorage.getItem(VIBE_KEY)!)).toMatchObject({ calmCap: true, cover: 'scene' });
    expect(localStorage.getItem(LINES_KEY) ?? '').not.toContain('calmCap');
    act(() => screen.getByRole('button', { name: 'Reset vibe' }).click());
    expect(useVibeStore.getState()).toMatchObject(DEFAULT_VIBE);
  });

  it('moves the Cover choice with the arrow keys', () => {
    render(<VibePanel />);
    screen.getByRole('radio', { name: 'Scene and title' }).focus();
    fireEvent.keyDown(screen.getByRole('radiogroup', { name: 'Cover' }), { key: 'ArrowRight' });
    expect(useVibeStore.getState().cover).toBe('scene');
  });

  it('puts each switch row out as name, switch, value, the flush right layout of the Looks sheet', () => {
    render(<VibePanel />);
    for (const name of ['Auto vibe', 'Drop Glitch', 'Tape Grain', 'Calm cap']) {
      const row = sw(name).closest('.ln-row')!;
      expect(row.classList.contains('ln-swrow')).toBe(true);
      const kids = Array.from(row.children);
      expect(kids.map((k) => k.className.split(' ')[0])).toEqual(['ln-label', 'ln-switch', 'ln-value']);
    }
    const css = sheet('../../styles/unwind.css');
    expect(css).toMatch(/\.ln-swrow \.ln-label\.ln-sw \+ \.ln-switch\s*\{\s*margin-left:\s*auto/);
    expect(css).toMatch(/\.ln-swrow \.ln-label\.ln-sw\s*\{\s*width:\s*auto/);
    expect(css).toMatch(/\.ln-swrow \.ln-switch \+ \.ln-value\s*\{\s*margin-left:\s*0/);
  });
});

describe('the Vibe page tips', () => {
  it('every control has a hint line or a tooltip made with tip()', async () => {
    render(
      <>
        <VibePanel />
        <HoverTipLayer />
      </>,
    );
    const controls = [...screen.getAllByRole('radio'), ...screen.getAllByRole('button'), ...screen.getAllByRole('switch')];
    // 5 radios (cover, music on other tabs), 1 reset, 4 switches.
    expect(controls).toHaveLength(5 + 1 + 4);
    for (const el of controls) {
      expect(el.getAttribute('title')).toBeNull();
      resetTip();
      fireEvent.focus(el);
      await act(() => new Promise((r) => setTimeout(r, 5)));
      expect(document.querySelector('.hover-tip')?.textContent).toBeTruthy();
    }
    resetTip();
  });
});

describe('the Lines page without the Vibe controls', () => {
  it('keeps the line controls and none of the vibe ones, and its reset leaves the vibe alone', () => {
    resetVibeStore();
    render(<LinesPanel />);
    for (const name of ['Auto vibe', 'Drop Glitch', 'Tape Grain', 'Calm cap']) expect(screen.queryByRole('switch', { name })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Cover' })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Music on other tabs' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset vibe' })).toBeNull();
    for (const name of ['How lively', 'Smoothness', 'Height']) expect(screen.getByRole('slider', { name })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Reflection' })).toBeTruthy();
    act(() => useVibeStore.getState().setVibe({ calmCap: true }));
    act(() => screen.getByRole('button', { name: 'Reset to my usual' }).click());
    expect(useVibeStore.getState().calmCap).toBe(true);
  });
});
