import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
  const group = (name: string) => screen.getByRole('radiogroup', { name });
  const chip = (g: string, name: string) => within(group(g)).getByRole('radio', { name });

  beforeEach(() => resetVibeStore());

  it('has two groups, Music reacts and Screen look, with every control in its place', () => {
    render(<VibePanel />);
    const text = document.body.textContent!;
    expect(text.indexOf('Music reacts')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('Music reacts')).toBeLessThan(text.indexOf('Screen look'));
    const order = ['Reset vibe', 'Auto vibe', 'Drop Glitch', 'Calm cap', 'Mountain dance', 'Music on other tabs', 'Screen look', 'Tape Grain', 'Aurora'];
    const at = order.map((n) => text.indexOf(n));
    expect(at.every((v) => v >= 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(sw('Auto vibe').getAttribute('aria-checked')).toBe('true');
    expect(sw('Tape Grain').getAttribute('aria-checked')).toBe('false');
    expect(sw('Calm cap').getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('radiogroup', { name: 'Cover' })).toBeNull();
  });

  it('shows the Reset vibe button on the first heading row', () => {
    render(<VibePanel />);
    const head = screen.getByText('Music reacts').closest('.ln-row')!;
    expect(within(head as HTMLElement).getByRole('button', { name: /Reset vibe/ })).toBeTruthy();
  });

  it('Drop Glitch is one chip row: Off, Tear, Split, Roll, Flash, with Tear chosen', () => {
    render(<VibePanel />);
    const names = within(group('Drop Glitch')).getAllByRole('radio').map((r) => r.textContent);
    expect(names).toEqual(['Off', 'Tear', 'Split', 'Roll', 'Flash']);
    expect(chip('Drop Glitch', 'Tear').getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('switch', { name: 'Drop Glitch' })).toBeNull();
  });

  it('each Drop Glitch chip sets its look and keeps it in the vibe store', () => {
    render(<VibePanel />);
    for (const [name, id] of [['Off', 'off'], ['Split', 'split'], ['Roll', 'roll'], ['Flash', 'flash'], ['Tear', 'tear']] as const) {
      fireEvent.click(chip('Drop Glitch', name));
      expect(useVibeStore.getState().dropGlitch).toBe(id);
      expect(JSON.parse(localStorage.getItem(VIBE_KEY)!)).toMatchObject({ dropGlitch: id });
      expect(chip('Drop Glitch', name).getAttribute('aria-checked')).toBe('true');
    }
  });

  it('Off stays off with Auto vibe on: nothing locks the choice', () => {
    render(<VibePanel />);
    expect(sw('Auto vibe').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(chip('Drop Glitch', 'Off'));
    expect(useVibeStore.getState()).toMatchObject({ auto: true, dropGlitch: 'off' });
    expect(chip('Drop Glitch', 'Off').getAttribute('aria-checked')).toBe('true');
    expect(chip('Drop Glitch', 'Off').getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(chip('Drop Glitch', 'Roll'));
    expect(useVibeStore.getState().dropGlitch).toBe('roll');
  });

  it('Mountain dance is a chip row: Off, Low, Medium, High, with Medium chosen and a one-line hint', () => {
    render(<VibePanel />);
    expect(within(group('Mountain dance')).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Off', 'Low', 'Medium', 'High']);
    expect(chip('Mountain dance', 'Medium').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('How much the music moves the mountain lines.')).toBeTruthy();
    for (const [name, id] of [['Off', 'off'], ['Low', 'low'], ['High', 'high'], ['Medium', 'medium']] as const) {
      fireEvent.click(chip('Mountain dance', name));
      expect(useVibeStore.getState().mountain).toBe(id);
    }
    expect(JSON.parse(localStorage.getItem(VIBE_KEY)!)).toMatchObject({ mountain: 'medium' });
  });

  it('Tape Grain toggles and is kept in the vibe store, away from the Lines setting', () => {
    render(<VibePanel />);
    fireEvent.click(sw('Tape Grain'));
    expect(useVibeStore.getState().tapeGrain).toBe(true);
    expect(JSON.parse(localStorage.getItem(VIBE_KEY)!)).toMatchObject({ tapeGrain: true });
    expect(localStorage.getItem(LINES_KEY) ?? '').not.toContain('tapeGrain');
  });

  it('has Music on other tabs with Medium chosen and no hint line: its sentence is a hover tip on the name', () => {
    render(<VibePanel />);
    const g = group('Music on other tabs');
    expect(within(g).getByRole('radio', { name: 'Medium' }).getAttribute('aria-checked')).toBe('true');
    expect(g.getAttribute('aria-describedby')).toBeNull();
    expect(document.body.textContent).not.toContain(VIBE_HINTS.offTabMusic);
    fireEvent.click(within(g).getByRole('radio', { name: 'Full' }));
    expect(useVibeStore.getState().offTabMusic).toBe('full');
    expect(JSON.parse(localStorage.getItem('wall2-vibe')!)).toMatchObject({ offTabMusic: 'full' });
  });

  it('has an Aurora row with Off, Soft and Full chips and Full chosen', () => {
    render(<VibePanel />);
    const g = group('Aurora');
    expect(within(g).getByRole('radio', { name: 'Full' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(g).getByRole('radio', { name: 'Soft' }));
    expect(useVibeStore.getState().aurora).toBe('soft');
    fireEvent.click(within(g).getByRole('radio', { name: 'Off' }));
    expect(JSON.parse(localStorage.getItem('wall2-vibe')!)).toMatchObject({ aurora: 'off' });
    fireEvent.click(screen.getByRole('button', { name: /Reset vibe/ }));
    expect(useVibeStore.getState().aurora).toBe('full');
  });

  it('changes Calm cap and keeps them in the vibe store, away from the Lines setting', () => {
    render(<VibePanel />);
    fireEvent.click(sw('Calm cap'));
    expect(useVibeStore.getState()).toMatchObject({ calmCap: true });
    expect(JSON.parse(localStorage.getItem(VIBE_KEY)!)).toMatchObject({ calmCap: true });
    expect(localStorage.getItem(LINES_KEY) ?? '').not.toContain('calmCap');
    act(() => screen.getByRole('button', { name: 'Reset vibe' }).click());
    expect(useVibeStore.getState()).toMatchObject(DEFAULT_VIBE);
  });

  it('puts a switch row out as name, switch, short hint, and the chips are the page chips', () => {
    render(<VibePanel />);
    for (const name of ['Auto vibe', 'Tape Grain', 'Calm cap']) {
      const row = sw(name).closest('.ln-row')!;
      expect(row.classList.contains('ln-swrow')).toBe(true);
      expect(Array.from(row.children).map((k) => k.className.split(' ')[0])).toEqual(['ln-label', 'ln-switch', 'ln-short']);
    }
    for (const name of ['Drop Glitch', 'Mountain dance', 'Music on other tabs', 'Aurora']) expect(group(name).classList.contains('ln-chips')).toBe(true);
  });

  it('keeps every font at 16 px or more and every chip with room at its sides', () => {
    const css = sheet('../../styles/unwind.css');
    const block = (sel: string) => css.replace(/\r\n/g, '\n').match(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    for (const sel of ['.ln-gh', '.ln-short', '.ln-chips button,\n.ln-reset']) {
      const px = /font(?:-size)?:[^;]*?(\d+)px/.exec(block(sel));
      expect(px, sel).not.toBeNull();
      expect(Number(px![1]), sel).toBeGreaterThanOrEqual(16);
    }
    expect(block('.ln-chips button,\n.ln-reset')).toMatch(/padding:\s*0 14px/);
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
    // 5 + 4 + 3 + 3 radios (Drop Glitch, Mountain dance, Music on other tabs, Aurora), 1 reset, 3 switches.
    expect(controls).toHaveLength(15 + 1 + 3);
    for (const el of controls) {
      expect(el.getAttribute('title')).toBeNull();
      resetTip();
      fireEvent.focus(el);
      await act(() => new Promise((r) => setTimeout(r, 5)));
      expect(document.querySelector('.hover-tip')?.textContent).toBeTruthy();
    }
    resetTip();
  });

  it('every setting name carries its full sentence as a hover tip', async () => {
    render(
      <>
        <VibePanel />
        <HoverTipLayer />
      </>,
    );
    for (const [label, sentence] of [['Auto vibe', VIBE_HINTS.auto], ['Drop Glitch', VIBE_HINTS.dropGlitch], ['Calm cap', VIBE_HINTS.calmCap], ['Mountain dance', VIBE_HINTS.mountain], ['Music on other tabs', VIBE_HINTS.offTabMusic], ['Tape Grain', VIBE_HINTS.tapeGrain], ['Aurora', VIBE_HINTS.aurora]] as const) {
      resetTip();
      fireEvent.focus(screen.getByText(label));
      await act(() => new Promise((r) => setTimeout(r, 5)));
      expect(document.querySelector('.hover-tip')?.textContent, label).toBe(sentence);
    }
    resetTip();
  });
});

describe('the Lines page without the Vibe controls', () => {
  it('keeps the line controls and none of the vibe ones, and its reset leaves the vibe alone', () => {
    resetVibeStore();
    render(<LinesPanel />);
    for (const name of ['Auto vibe', 'Tape Grain', 'Calm cap']) expect(screen.queryByRole('switch', { name })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Drop Glitch' })).toBeNull();
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
