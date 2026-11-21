import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { CapturesCard } from './CapturesCard';
import { clearThumbs, formatSize, formatWhen, POLL_MS, type Capture } from './captures';

const NOW = new Date(2026, 10, 11, 10, 24).getTime();
const MIN = 60_000;

function cap(i: number, over: Partial<Capture> = {}): Capture {
  return { id: i, fileName: `file-${i}.png`, title: `Title ${i}`, app: `App ${i}`, kind: 'image', time: NOW - (i + 1) * 20 * MIN, size: 400_000 + i, exists: true, ...over };
}

const LIST = [cap(0), cap(1, { kind: 'gif' }), cap(2), cap(3, { kind: 'video' }), cap(4), cap(5), cap(6)];
let calls: unknown[];

beforeEach(() => {
  calls = [];
  clearThumbs();
  mocks.set('wall2_captures_list', () => LIST);
  mocks.set('wall2_captures_thumb', () => 'data:image/png;base64,AAAA');
  mocks.set('wall2_captures_act', (args) => {
    calls.push(args);
    return undefined;
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('shows the newest capture large with its title, its line and three buttons, and five rows', async () => {
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  expect(screen.getByText(/^App 0 · .*· 391 KB$/)).toBeTruthy();
  for (const n of ['Copy', 'Open', 'Folder']) expect(screen.getByRole('button', { name: n })).toBeTruthy();
  const rows = within(screen.getByRole('group', { name: 'Earlier captures' })).getAllByRole('button');
  expect(rows).toHaveLength(5);
  expect(rows[0].textContent).toContain('App 1');
  expect(rows[0].textContent).toContain('GIF');
  expect(rows[2].textContent).toContain('Video');
});

it('a row click shows that capture large without opening it, and the old one joins the rows', async () => {
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  fireEvent.click(screen.getByRole('button', { name: /App 2/ }));
  await screen.findByText('Title 2');
  expect(calls).toEqual([]);
  const rows = within(screen.getByRole('group', { name: 'Earlier captures' })).getAllByRole('button');
  expect(rows).toHaveLength(5);
  expect(rows[0].textContent).toContain('App 0');
});

it('the picture opens the capture, and Copy and Folder send their words with the id', async () => {
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  fireEvent.click(screen.getAllByRole('button').find((b) => b.className.includes('cap-pic'))!);
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
  fireEvent.click(screen.getByRole('button', { name: 'Folder' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  await screen.findByText('Opened');
  expect(calls).toEqual([
    { id: 0, action: 'open' },
    { id: 0, action: 'copy' },
    { id: 0, action: 'folder' },
    { id: 0, action: 'open' },
  ]);
});

it('says so when the action fails because the file is gone', async () => {
  mocks.set('wall2_captures_act', () => Promise.reject('missing'));
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
  await screen.findByRole('status');
  expect((await screen.findAllByText('File moved or deleted')).length).toBeGreaterThan(0);
});

it('says when ShareX has no history file', async () => {
  mocks.set('wall2_captures_list', () => Promise.reject('not-found'));
  render(<CapturesCard />);
  await screen.findByText('ShareX history not found on this PC');
});

it('says when the history is empty', async () => {
  mocks.set('wall2_captures_list', () => []);
  render(<CapturesCard />);
  await screen.findByText('No captures yet. Use the keys beside this card.');
});

it('a capture whose file is gone is a dimmed row with no Open or Copy when shown large', async () => {
  mocks.set('wall2_captures_list', () => [cap(0), cap(1, { exists: false })]);
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  const row = screen.getByRole('button', { name: /App 1/ });
  expect(row.className).toContain('gone');
  expect(row.textContent).toContain('File moved or deleted');
  fireEvent.click(row);
  await screen.findByText('Title 1');
  expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
  expect(screen.getAllByText('File moved or deleted').length).toBeGreaterThan(0);
});

it('a video gets a tile and no thumbnail request; a too-big picture says so', async () => {
  const asked: unknown[] = [];
  mocks.set('wall2_captures_list', () => [cap(0, { kind: 'video' }), cap(1)]);
  mocks.set('wall2_captures_thumb', (args) => {
    asked.push(args);
    return Promise.reject('too-big');
  });
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  expect(document.querySelector('.cap-big .cap-tile.video')).toBeTruthy();
  expect(screen.getByText('Video', { selector: '.cap-badge' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /App 1/ }));
  await screen.findByText('Too big to preview');
  expect(asked).toEqual([{ id: 1 }]);
});

it('the page never holds a path', async () => {
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  expect(document.body.innerHTML).not.toMatch(/[A-Za-z]:\\/);
});

it('reads again every 10 seconds', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  let reads = 0;
  mocks.set('wall2_captures_list', () => {
    reads += 1;
    return LIST;
  });
  render(<CapturesCard />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(reads).toBe(1);
  await act(async () => {
    vi.advanceTimersByTime(POLL_MS);
    await Promise.resolve();
  });
  expect(reads).toBe(2);
});

it('formats sizes and times', () => {
  expect(formatSize(412_000)).toBe('402 KB');
  expect(formatSize(1_500_000)).toBe('1.4 MB');
  expect(formatSize(18_700_000)).toBe('18 MB');
  expect(formatSize(300)).toBe('300 B');
  expect(formatWhen(0, NOW)).toBe('');
  expect(formatWhen(NOW - 22 * MIN, NOW)).toMatch(/^10:02\sAM$/);
  expect(formatWhen(NOW - 24 * 60 * MIN, NOW)).toBe('Yesterday');
  expect(formatWhen(NOW - 72 * 60 * MIN, NOW)).toBe('Nov 8');
});
