import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { SETTINGS_KEY } from '../settings/settings';
import { LIST_KEY, ShelfPlace } from './ShelfPlace';

vi.mock('../work/Keys', () => ({ Keys: () => null }));
vi.mock('../work/PinnedRow', () => ({ PinnedRow: () => null }));

beforeEach(() => {
  localStorage.clear();
  mocks.set('wall2_tasks_lists', () => []);
  mocks.set('wall2_tasks_summary', () => ({ next: [], remaining: 0 }));
});
afterEach(cleanup);

it('shows the six ShareX keys', () => {
  render(<ShelfPlace />);
  for (const n of ['Region', 'Screen', 'GIF', 'Record', 'Text (OCR)', 'History']) expect(screen.getByRole('button', { name: n })).toBeTruthy();
});

it('shows the task app lists as chips and picks the first', async () => {
  mocks.set('wall2_tasks_lists', () => ['Inbox', 'Work']);
  const calls: unknown[] = [];
  mocks.set('wall2_tasks_summary', (args) => {
    calls.push(args);
    return { next: [], remaining: 0 };
  });
  render(<ShelfPlace />);
  expect(screen.getByText('Loading lists')).toBeTruthy();
  const inbox = await screen.findByRole('button', { name: 'Inbox' });
  expect(inbox.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: 'Work' }).getAttribute('aria-pressed')).toBe('false');
  await screen.findByText('Nothing open');
  expect(calls.some((a) => (a as { list?: string }).list === 'Inbox')).toBe(true);
});

it('the shelfLists setting overrides the task app lists', async () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ shelfLists: ['Mine'] }));
  let asked = false;
  mocks.set('wall2_tasks_lists', () => {
    asked = true;
    return ['Inbox'];
  });
  render(<ShelfPlace />);
  expect(await screen.findByRole('button', { name: 'Mine' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Inbox' })).toBeNull();
  expect(asked).toBe(false);
});

it('says when the lists cannot be read', async () => {
  mocks.set('wall2_tasks_lists', () => Promise.reject(new Error('down')));
  render(<ShelfPlace />);
  expect(await screen.findByText('Lists unavailable')).toBeTruthy();
});

it('says when the task app has no lists', async () => {
  mocks.set('wall2_tasks_lists', () => []);
  render(<ShelfPlace />);
  expect(await screen.findByText('No lists in the task app')).toBeTruthy();
});

it('the remembered pick survives a remount', async () => {
  mocks.set('wall2_tasks_lists', () => ['Inbox', 'Work']);
  const first = render(<ShelfPlace />);
  fireEvent.click(await screen.findByRole('button', { name: 'Work' }));
  first.unmount();
  render(<ShelfPlace />);
  const work = await screen.findByRole('button', { name: 'Work' });
  expect(work.getAttribute('aria-pressed')).toBe('true');
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
