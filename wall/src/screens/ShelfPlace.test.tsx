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

it('shows the six ShareX keys and the four more keys', () => {
  render(<ShelfPlace />);
  for (const n of ['Region', 'Screen', 'GIF', 'Record', 'Text (OCR)', 'History', 'Scroll', 'Color', 'Last', 'Ruler']) expect(screen.getByRole('button', { name: n })).toBeTruthy();
  expect(screen.getByText('More ShareX')).toBeTruthy();
});

it('a more key sends its library id', async () => {
  const sent: unknown[] = [];
  mocks.set('wall2_keys_send_library', (args) => {
    sent.push(args);
    return null;
  });
  render(<ShelfPlace />);
  fireEvent.click(screen.getByRole('button', { name: 'Ruler' }), { detail: 1 });
  await screen.findByText('ShareX: Ruler');
  expect(sent).toEqual([{ id: 'sx-ruler' }]);
});

it('lists the task app lists in the heading menu and picks the first', async () => {
  mocks.set('wall2_tasks_lists', () => ['Inbox', 'Work']);
  const calls: unknown[] = [];
  mocks.set('wall2_tasks_summary', (args) => {
    calls.push(args);
    return { next: [], remaining: 0 };
  });
  render(<ShelfPlace />);
  expect(screen.getByText('Loading lists')).toBeTruthy();
  const head = await screen.findByRole('button', { name: 'List: Inbox' });
  expect(head.getAttribute('aria-haspopup')).toBe('listbox');
  expect(head.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('option')).toBeNull();
  fireEvent.click(head);
  expect(head.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByRole('option', { name: 'Inbox' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('option', { name: 'Work' }).getAttribute('aria-selected')).toBe('false');
  await screen.findByText('Nothing open');
  expect(calls.some((a) => (a as { list?: string }).list === 'Inbox')).toBe(true);
  expect(screen.queryByRole('button', { name: 'Work' })).toBeNull();
});

it('the shelfLists setting overrides the task app lists', async () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ shelfLists: ['Mine', 'Other'] }));
  let asked = false;
  mocks.set('wall2_tasks_lists', () => {
    asked = true;
    return ['Inbox'];
  });
  render(<ShelfPlace />);
  fireEvent.click(await screen.findByRole('button', { name: 'List: Mine' }));
  expect(screen.getByRole('option', { name: 'Other' })).toBeTruthy();
  expect(screen.queryByRole('option', { name: 'Inbox' })).toBeNull();
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
  fireEvent.click(await screen.findByRole('button', { name: 'List: Inbox' }));
  fireEvent.click(screen.getByRole('option', { name: 'Work' }));
  first.unmount();
  render(<ShelfPlace />);
  expect(await screen.findByRole('button', { name: 'List: Work' })).toBeTruthy();
});

it('picking a list reads it, remembers it, closes the menu and returns focus', async () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ shelfLists: ['Inbox', 'Work'] }));
  const calls: unknown[] = [];
  mocks.set('wall2_tasks_summary', (args) => {
    calls.push(args);
    return { next: [], remaining: 0 };
  });
  render(<ShelfPlace />);
  fireEvent.click(screen.getByRole('button', { name: 'List: Inbox' }));
  fireEvent.click(screen.getByRole('option', { name: 'Work' }));
  await screen.findByText('Nothing open');
  expect(calls.some((a) => (a as { list?: string }).list === 'Work')).toBe(true);
  expect(localStorage.getItem(LIST_KEY)).toBe('Work');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'List: Work' }));
});

it('the menu moves with the arrows, picks with Enter, closes with Escape and on an outside press', async () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ shelfLists: ['Inbox', 'Work', 'Home'] }));
  render(<ShelfPlace />);
  const head = screen.getByRole('button', { name: 'List: Inbox' });
  fireEvent.click(head, { detail: 0 });
  expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Inbox' }));
  fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Work' }));
  fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(document.activeElement).toBe(head);
  fireEvent.click(head);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('listbox')).toBeNull();
  fireEvent.click(head);
  fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Home' }));
  fireEvent.click(document.activeElement as Element);
  expect(await screen.findByRole('button', { name: 'List: Home' })).toBeTruthy();
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
