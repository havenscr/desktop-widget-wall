import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { SETTINGS_KEY } from '../settings/settings';
import { LIST_KEY, MORE_KEYS, ShelfPlace } from './ShelfPlace';

vi.mock('../work/Keys', () => ({ Keys: () => null }));
vi.mock('../work/PinnedRow', () => ({ PinnedRow: () => null }));

beforeEach(() => {
  localStorage.clear();
  mocks.set('wall2_tasks_lists', () => []);
  mocks.set('wall2_tasks_summary', () => ({ next: [], remaining: 0 }));
});
afterEach(cleanup);

it('shows the six ShareX keys and the eight more keys in two rows of four', () => {
  render(<ShelfPlace />);
  for (const n of ['Region', 'Screen', 'GIF', 'Record', 'Text (OCR)', 'History']) expect(screen.getByRole('button', { name: n })).toBeTruthy();
  const more = within(screen.getByRole('group', { name: 'More ShareX keys' }));
  for (const n of ['Scroll', 'Color', 'Last', 'Ruler', 'Pin', 'Highlight', 'Folder', 'Stop rec']) expect(more.getByRole('button', { name: n })).toBeTruthy();
  expect(more.getAllByRole('button')).toHaveLength(8);
  expect(screen.getByText('More ShareX')).toBeTruthy();
});

it.each([
  ['Pin', 'sx-pin', 'ShareX: Pin a box of the screen on top of everything'],
  ['Highlight', 'sx-highlighter', 'ShareX: Ring the mouse pointer, for demos'],
  ['Folder', 'sx-folder', 'ShareX: Open the screenshots folder'],
  ['Stop rec', 'sx-stop-record', 'ShareX: Stop the screen recording and save it'],
])('the %s key sends %s and carries its helper text', async (label, id, help) => {
  const sent: unknown[] = [];
  mocks.set('wall2_keys_send_library', (args) => {
    sent.push(args);
    return null;
  });
  render(<ShelfPlace />);
  const key = within(screen.getByRole('group', { name: 'More ShareX keys' })).getByRole('button', { name: label });
  expect(MORE_KEYS.find((k) => k.id === id)?.help).toBe(help);
  fireEvent.click(key, { detail: 1 });
  await screen.findByText(`ShareX: ${label}`);
  expect(sent).toEqual([{ id }]);
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

it('puts the kind of its group on a stills key and a files key, and none on an unmapped key', async () => {
  const { SHELF_CATEGORY } = await import('./shelfKinds');
  const saved = SHELF_CATEGORY['sx-ruler'];
  delete SHELF_CATEGORY['sx-ruler'];
  try {
    render(<ShelfPlace />);
    expect(screen.getByRole('button', { name: 'Region' }).getAttribute('data-kind')).toBe('capture');
    expect(screen.getByRole('button', { name: 'History' }).getAttribute('data-kind')).toBe('app');
    expect(screen.getByRole('button', { name: 'Ruler' }).hasAttribute('data-kind')).toBe(false);
  } finally {
    if (saved) SHELF_CATEGORY['sx-ruler'] = saved;
  }
});
