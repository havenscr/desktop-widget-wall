import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { SETTINGS_KEY } from '../settings/settings';
import { LIST_KEY, ShelfPlace } from './ShelfPlace';

vi.mock('../work/Keys', () => ({ Keys: () => null }));
vi.mock('../work/PinnedRow', () => ({ PinnedRow: () => null }));

beforeEach(() => {
  localStorage.clear();
  mocks.set('wall2_tasks_summary', () => ({ next: [], remaining: 0 }));
});
afterEach(cleanup);

it('shows the six ShareX keys and says when no list names are set', () => {
  render(<ShelfPlace />);
  for (const n of ['Region', 'Screen', 'GIF', 'Record', 'Text (OCR)', 'History']) expect(screen.getByRole('button', { name: n })).toBeTruthy();
  expect(screen.getByText(/Add list names as shelfLists/)).toBeTruthy();
});

it('offers the settings list names, reads the picked list and remembers the pick', async () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ shelfLists: ['Inbox', 'Work'] }));
  const calls: unknown[] = [];
  mocks.set('wall2_tasks_summary', (args) => {
    calls.push(args);
    return { next: [], remaining: 0 };
  });
  render(<ShelfPlace />);
  fireEvent.click(screen.getByRole('button', { name: 'Work' }));
  await screen.findByText('Nothing open');
  expect(calls.some((a) => (a as { list?: string }).list === 'Work')).toBe(true);
  expect(localStorage.getItem(LIST_KEY)).toBe('Work');
});

it('a ShareX key sends its library id', async () => {
  const sent: unknown[] = [];
  mocks.set('wall2_keys_send_library', (args) => {
    sent.push(args);
    return null;
  });
  render(<ShelfPlace />);
  fireEvent.click(screen.getByRole('button', { name: 'Region' }), { detail: 1 });
  await screen.findByText('ShareX: Region');
  expect(sent).toEqual([{ id: 'sx-region' }]);
});
