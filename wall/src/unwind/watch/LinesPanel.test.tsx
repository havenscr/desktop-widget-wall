import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { DEFAULT_LINES, resetLinesStore, useLinesStore } from '../../horizon/linesSettings';
import { LinesPanel } from './LinesPanel';

beforeEach(() => { localStorage.clear(); resetLinesStore(); });

it('changes every kind of setting, applies presets, and resets', () => {
  render(<LinesPanel />);
  fireEvent.click(screen.getByRole('radio', { name: 'Bars' }));
  fireEvent.change(screen.getByLabelText(/How lively/), { target: { value: '81' } });
  fireEvent.click(screen.getByRole('radio', { name: 'Mint' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Reflection' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Flat' }));
  expect(useLinesStore.getState()).toMatchObject({ type: 'bars', lively: 81, colours: 'mint', reflection: false, rest: 'flat' });
  fireEvent.click(screen.getByRole('button', { name: 'Calm' }));
  expect(useLinesStore.getState()).toMatchObject({ lively: 22, smooth: 72, height: 60 });
  act(() => screen.getByRole('button', { name: 'Reset to my usual' }).click());
  expect(useLinesStore.getState()).toMatchObject(DEFAULT_LINES);
});
