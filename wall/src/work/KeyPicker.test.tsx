import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { resetTip } from '../ui/HoverTip';
import { KeyPicker, rowBlock } from './KeyPicker';
import type { LibGroup, LibKey } from './libraryModel';

const key = (id: string, label: string, kind: LibKey['kind'], runnable = true, how = 'a line'): LibKey => ({ id, label, icon: 'search', kind, how, action: null, runnable });
const LIB: LibGroup[] = [
  {
    id: 'powertoys',
    title: 'PowerToys',
    exes: [],
    keys: [key('pt-run', 'PowerToys Run', 'key', true, 'the shortcut set in PowerToys'), key('pt-color', 'Color picker', 'off', false, 'Off in PowerToys')],
  },
  { id: 'house', title: 'House', exes: [], keys: [key('tv-off', 'TV off', 'soon', false)] },
];

afterEach(() => resetTip());

function open(onChoose = vi.fn()) {
  render(<KeyPicker lib={LIB} filePins={[]} pins={[]} slot={0} adding onChoose={onChoose} onReset={() => {}} onClose={() => {}} />);
  return onChoose;
}

it('a PowerToys key that was read has no check badge and can be picked', () => {
  const choose = open();
  const row = screen.getByRole('button', { name: 'PowerToys Run' });
  expect(row.querySelector('.pk-badge')).toBeNull();
  fireEvent.click(row);
  expect(choose).toHaveBeenCalledWith('lib:pt-run');
});

it('a key whose PowerToys module is off says so and cannot be picked', () => {
  const choose = open();
  const row = screen.getByRole('button', { name: 'Color picker, Off in PowerToys' });
  expect(row.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(row);
  expect(choose).not.toHaveBeenCalled();
  expect(rowBlock(LIB[0].keys[1])).toContain('Off in PowerToys');
});

it('coming keys keep their badge and stay blocked', () => {
  open();
  expect(screen.getByRole('button', { name: 'TV off, coming' }).getAttribute('aria-disabled')).toBe('true');
});
