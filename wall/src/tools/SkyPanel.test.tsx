import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { SKY_KEY, resetSkyStore, skySettings } from '../backdrop/settings';
import { SkyPanel, skyLine } from './SkyPanel';

beforeEach(() => {
  localStorage.clear();
  resetSkyStore();
});
afterEach(cleanup);

it('the style row is a radio group: one of two, saved under wall2-sky', () => {
  render(<SkyPanel />);
  const wash = screen.getByRole('radio', { name: 'Colour wash' });
  const aurora = screen.getByRole('radio', { name: 'Aurora' });
  expect(wash.getAttribute('aria-checked')).toBe('true');
  fireEvent.click(aurora);
  expect(aurora.getAttribute('aria-checked')).toBe('true');
  expect(wash.getAttribute('aria-checked')).toBe('false');
  expect(JSON.parse(localStorage.getItem(SKY_KEY)!).style).toBe('aurora');
  fireEvent.keyDown(screen.getByRole('radiogroup', { name: 'Sky style' }), { key: 'ArrowLeft' });
  expect(skySettings().style).toBe('wash');
});

it('each page chip toggles by itself; Zen starts on, the rest off', () => {
  render(<SkyPanel />);
  const names = ['Zen', 'Work', 'Home', 'Unwind', 'Meet', 'On Air', 'Shelf'];
  for (const n of names) expect(screen.getByRole('button', { name: n })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Zen' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: 'Work' }).getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'Work' }));
  expect(screen.getByRole('button', { name: 'Work' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Zen' }));
  expect(JSON.parse(localStorage.getItem(SKY_KEY)!).places).toEqual(['work']);
});

it('every chip off is the off switch, and the rail line says so', () => {
  expect(skyLine(0)).toBe('sky off');
  expect(skyLine(1)).toBe('sky on 1 page');
  expect(skyLine(2)).toBe('sky on 2 pages');
});

it('says so when the graphics context is not available', () => {
  const { rerender } = render(<SkyPanel />);
  expect(screen.queryByText(/not available on this PC/)).toBeNull();
  skySettings().markUnavailable();
  rerender(<SkyPanel />);
  expect(screen.getByText(/not available on this PC/)).toBeTruthy();
});

it('the strength slider runs 10 to 100, starts at today\'s 35, saves under wall2-sky, and has helper text', () => {
  render(<SkyPanel />);
  const slider = screen.getByRole('slider', { name: 'Strength' }) as HTMLInputElement;
  expect([slider.min, slider.max, slider.value]).toEqual(['10', '100', '35']);
  expect(screen.getByText(/Faint to as strong as Zen/)).toBeTruthy();
  expect(screen.queryByText('Text may be harder to read at this strength.')).toBeNull();
  fireEvent.change(slider, { target: { value: '100' } });
  expect(JSON.parse(localStorage.getItem(SKY_KEY)!).strength).toBe(1);
  expect(screen.getByText('100%')).toBeTruthy();
});

it('the hint appears only past the readable level on a page with text, not on Zen alone', () => {
  render(<SkyPanel />);
  const slider = screen.getByRole('slider', { name: 'Strength' });
  fireEvent.change(slider, { target: { value: '100' } });
  expect(screen.queryByText('Text may be harder to read at this strength.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Unwind' }));
  expect(screen.getByText('Text may be harder to read at this strength.')).toBeTruthy();
  fireEvent.change(slider, { target: { value: '35' } });
  expect(screen.queryByText('Text may be harder to read at this strength.')).toBeNull();
});
