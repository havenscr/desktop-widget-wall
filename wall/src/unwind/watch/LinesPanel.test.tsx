import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LINES, resetLinesStore, useLinesStore } from '../../horizon/linesSettings';
import { LinesPanel, sliderWords } from './LinesPanel';
import { HoverTipLayer, resetTip } from '../../ui/HoverTip';

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

  it('every control has a hint line or a tooltip made with tip()', async () => {
    render(
      <>
        <LinesPanel />
        <HoverTipLayer />
      </>,
    );
    expect(screen.getByText(/The ridgelines dance as they do today/)).toBeTruthy();
    expect(screen.getByText('One setting for the lines everywhere music plays.')).toBeTruthy();
    const controls = [...screen.getAllByRole('radio'), ...screen.getAllByRole('button'), ...screen.getAllByRole('slider'), screen.getByRole('switch')];
    expect(controls).toHaveLength(5 + 5 + 2 + 3 + 1 + 3 + 1);
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
