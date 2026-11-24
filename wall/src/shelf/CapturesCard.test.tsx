import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { arrange, copyBitmap } from './captures';
import { mocks } from '../bridge/tauri';
import { CapturesCard } from './CapturesCard';
import { clearThumbs, formatSize, formatWhen, loadThumb, POLL_MS, THUMB_BYTES_MAX, THUMB_EXTRA, thumbBytes, trimThumbs, type Capture } from './captures';

vi.mock('./captures', async (orig) => ({ ...(await orig<typeof import('./captures')>()), copyBitmap: vi.fn(async () => undefined) }));

const NOW = new Date(2026, 10, 11, 10, 24).getTime();
const MIN = 60_000;

function cap(i: number, over: Partial<Capture> = {}): Capture {
  return { id: `cap${i}`, fileName: `file-${i}.png`, title: `Title ${i}`, app: `App ${i}`, kind: 'image', time: NOW - (i + 1) * 20 * MIN, size: 400_000 + i, exists: true, ...over };
}

const LIST = [cap(0), cap(1, { kind: 'gif' }), cap(2), cap(3, { kind: 'video' }), cap(4), cap(5), cap(6)];
let calls: unknown[];

beforeEach(() => {
  calls = [];
  try {
    localStorage.clear();
  } catch {
    /* none */
  }
  clearThumbs();
  vi.mocked(copyBitmap).mockReset();
  vi.mocked(copyBitmap).mockResolvedValue(undefined);
  mocks.set('wall2_captures_list', () => LIST);
  mocks.set('wall2_captures_thumb', () => 'data:image/png;base64,AAAA');
  mocks.set('wall2_captures_act', (args) => {
    calls.push(args);
    return undefined;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const rowButtons = () => within(screen.getByRole('group', { name: 'Captures' })).getAllByRole('button');

it('shows the newest capture large with its title, its line and three buttons, and every capture as a row', async () => {
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  expect(screen.getByText(/^App 0 · .*· 391 KB$/)).toBeTruthy();
  for (const n of ['Copy', 'Open', 'Folder']) expect(screen.getByRole('button', { name: n })).toBeTruthy();
  const rows = rowButtons();
  expect(rows).toHaveLength(7);
  expect(rows[0].getAttribute('aria-current')).toBe('true');
  expect(rows[1].textContent).toContain('GIF');
  expect(rows[3].textContent).toContain('Video');
});

it('a row click shows that capture large without acting, marks the row and never reorders the list', async () => {
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  const order = () => rowButtons().map((r) => r.textContent);
  const before = order();
  fireEvent.click(screen.getByRole('button', { name: /App 2/ }));
  await screen.findByText('Title 2');
  expect(calls).toEqual([]);
  expect(order()).toEqual(before);
  const rows = rowButtons();
  expect(rows[2].getAttribute('aria-current')).toBe('true');
  expect(rows[0].getAttribute('aria-current')).toBeNull();
});

const bigPic = () => screen.getAllByRole('button').find((b) => b.className.includes('cap-pic'))!;

it('the big picture copies the picture itself and says Copied, with no native copy', async () => {
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  fireEvent.click(bigPic());
  await screen.findByText('Copied');
  expect(vi.mocked(copyBitmap)).toHaveBeenCalledTimes(1);
  expect(vi.mocked(copyBitmap).mock.calls[0][0].id).toBe('cap0');
  expect(calls).toEqual([]);
});

it('the big picture says Could not copy when the clipboard refuses', async () => {
  vi.mocked(copyBitmap).mockRejectedValue(new Error('failed'));
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  fireEvent.click(bigPic());
  await screen.findByText('Could not copy');
});

it('the big picture of a recording or a GIF copies the file natively and says Copied', async () => {
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  fireEvent.click(screen.getByRole('button', { name: /App 3/ }));
  await screen.findByText('Title 3');
  fireEvent.click(bigPic());
  await screen.findByText('Copied');
  fireEvent.click(screen.getByRole('button', { name: /App 1/ }));
  await screen.findByText('Title 1');
  fireEvent.click(bigPic());
  await Promise.resolve();
  expect(calls).toEqual([
    { id: 'cap3', action: 'copy' },
    { id: 'cap1', action: 'copy' },
  ]);
  expect(vi.mocked(copyBitmap)).not.toHaveBeenCalled();
});

it('Copy, Folder and Open send their words with the id', async () => {
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
  fireEvent.click(screen.getByRole('button', { name: 'Folder' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  await screen.findByText('Opened');
  expect(calls).toEqual([
    { id: 'cap0', action: 'copy' },
    { id: 'cap0', action: 'folder' },
    { id: 'cap0', action: 'open' },
  ]);
});

it('sorts oldest first and filters by kind, and remembers both', async () => {
  const { unmount } = render(<CapturesCard />);
  await screen.findByText('Title 0');
  fireEvent.click(screen.getByRole('button', { name: /Newest first/ }));
  expect(rowButtons()[0].textContent).toContain('App 6');
  expect(screen.getByText('Title 6')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Show: All/ }));
  const menu = screen.getByRole('menu');
  expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['All', 'Images', 'Video', 'GIF']);
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'Video' }));
  expect(screen.queryByRole('menu')).toBeNull();
  expect(rowButtons()).toHaveLength(1);
  expect(rowButtons()[0].textContent).toContain('App 3');
  unmount();
  cleanup();
  render(<CapturesCard />);
  await screen.findByText('Title 3');
  expect(rowButtons()).toHaveLength(1);
  expect(screen.getByRole('button', { name: /Oldest first/ })).toBeTruthy();
});

it('says so when a filter leaves nothing', async () => {
  mocks.set('wall2_captures_list', () => [cap(0), cap(1)]);
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  fireEvent.click(screen.getByRole('button', { name: /Show: All/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Video' }));
  await screen.findByText('No video captures yet');
});

it('a right-click opens the menu; Escape closes it; each row sends one fixed word with the id and no path', async () => {
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  fireEvent.contextMenu(screen.getByRole('button', { name: /App 2/ }));
  const menu = screen.getByRole('menu');
  expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
    'Copy image',
    'Copy as file',
    'Copy path',
    'Share link',
    'Open',
    'Edit in ShareX',
    'Pin to screen',
    'Copy text (OCR)',
    'Show in folder',
    'Move to Recycle Bin',
  ]);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  for (const [name, action] of [
    ['Copy path', 'path'],
    ['Edit in ShareX', 'edit'],
    ['Pin to screen', 'pin'],
    ['Copy text (OCR)', 'ocr'],
    ['Open', 'open'],
    ['Show in folder', 'folder'],
    ['Copy as file', 'copy'],
  ] as const) {
    fireEvent.contextMenu(screen.getByRole('button', { name: /App 2/ }));
    fireEvent.click(screen.getByRole('menuitem', { name }));
    await Promise.resolve();
    expect(calls[calls.length - 1]).toEqual({ id: 'cap2', action });
  }
});

it('the ShareX and image rows are off for a recording', async () => {
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  fireEvent.contextMenu(screen.getByRole('button', { name: /App 3/ }));
  for (const n of ['Copy image', 'Edit in ShareX', 'Pin to screen', 'Copy text (OCR)']) expect((screen.getByRole('menuitem', { name: n }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('menuitem', { name: 'Open' }) as HTMLButtonElement).disabled).toBe(false);
});

it('Move to Recycle Bin needs a second click inside 3 seconds, then the row goes', async () => {
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  fireEvent.contextMenu(screen.getByRole('button', { name: /App 2/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Move to Recycle Bin' }));
  expect(calls).toEqual([]);
  expect(screen.getByRole('menuitem', { name: 'Click again to move to Recycle Bin' })).toBeTruthy();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Click again to move to Recycle Bin' }));
  await screen.findByText('Moved to the Recycle Bin');
  expect(calls).toEqual([{ id: 'cap2', action: 'trash' }]);
  expect(rowButtons()).toHaveLength(6);
});

it('the armed row goes back after 3 seconds', async () => {
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  fireEvent.contextMenu(screen.getByRole('button', { name: /App 2/ }));
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Move to Recycle Bin' }));
  expect(screen.getByRole('menuitem', { name: 'Click again to move to Recycle Bin' })).toBeTruthy();
  await act(async () => {
    vi.advanceTimersByTime(3_100);
  });
  expect(screen.getByRole('menuitem', { name: 'Move to Recycle Bin' })).toBeTruthy();
  expect(calls).toEqual([]);
});

it('arrange keeps the list order for newest, reverses it for oldest and filters by kind', () => {
  expect(arrange(LIST, 'newest', 'all').map((c) => c.id)).toEqual(LIST.map((c) => c.id));
  expect(arrange(LIST, 'oldest', 'all')[0].id).toBe('cap6');
  expect(arrange(LIST, 'newest', 'gif').map((c) => c.id)).toEqual(['cap1']);
  expect(arrange(LIST, 'newest', 'image')).toHaveLength(5);
  expect(arrange(Array.from({ length: 40 }, (_, i) => cap(i)), 'newest', 'all')).toHaveLength(30);
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

/** jsdom plays nothing: record what the card asks of the element. */
function stubMedia() {
  const log: string[] = [];
  const proto = HTMLMediaElement.prototype;
  vi.spyOn(proto, 'play').mockImplementation(function (this: HTMLMediaElement) {
    log.push(`play ${this.getAttribute('src')?.split('#')[0]}`);
    return Promise.resolve();
  });
  vi.spyOn(proto, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    log.push(`pause ${this.getAttribute('src')?.split('#')[0] ?? 'none'}`);
  });
  vi.spyOn(proto, 'load').mockImplementation(() => {
    log.push('load');
  });
  return log;
}
const videoList = () => mocks.set('wall2_captures_list', () => [cap(0, { kind: 'video', fileName: 'rec-0.mp4' }), cap(1, { kind: 'video', fileName: 'rec-1.webm' }), cap(2, { kind: 'video', fileName: 'rec-2.mkv' }), cap(3)]);

it('a video that cannot play gets a tile and no thumbnail request; a too-big picture says so', async () => {
  const asked: unknown[] = [];
  mocks.set('wall2_captures_list', () => [cap(0, { kind: 'video', fileName: 'rec-0.mkv' }), cap(1)]);
  mocks.set('wall2_captures_thumb', (args) => {
    asked.push(args);
    return Promise.reject('too-big');
  });
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  expect(document.querySelector('.cap-big .cap-tile.video')).toBeTruthy();
  expect(document.querySelector('video')).toBeNull();
  expect(screen.getByText("Can't play here. Open it")).toBeTruthy();
  expect(screen.getByText('Video', { selector: '.cap-badge' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /App 1/ }));
  await screen.findByText('Too big to preview');
  expect(asked).toEqual([{ id: 'cap1' }]);
});

it('a recording shows a muted, looping video with no native controls, nothing playing, and asks for no thumbnail', async () => {
  const log = stubMedia();
  const asked: unknown[] = [];
  videoList();
  mocks.set('wall2_captures_thumb', (args) => {
    asked.push(args);
    return 'data:image/png;base64,AAAA';
  });
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  const v = document.querySelector('.cap-big video') as HTMLVideoElement;
  expect(v.getAttribute('src')).toMatch(/^https:\/\/wallcap\.localhost\/cap0#/);
  expect(v.muted).toBe(true);
  expect(v.loop).toBe(true);
  expect(v.hasAttribute('controls')).toBe(false);
  expect(v.getAttribute('preload')).toBe('metadata');
  expect(log.filter((l) => l.startsWith('play'))).toEqual([]);
  expect(asked).not.toContainEqual({ id: 'cap0' });
  expect(asked).not.toContainEqual({ id: 'cap1' });
  // The video sits in the Copy button; the controls do not.
  expect(v.closest('button.cap-pic')).toBeTruthy();
  const play = screen.getByRole('button', { name: 'Play this recording here' });
  expect(play.closest('button.cap-pic')).toBeNull();
  expect(screen.getByRole('button', { name: 'Sound on' })).toBeTruthy();
});

it('a click on the preview copies the recording as a file', async () => {
  stubMedia();
  videoList();
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  fireEvent.click(document.querySelector('.cap-big button.cap-pic') as HTMLElement);
  await screen.findByText('Copied');
  expect(calls).toEqual([{ id: 'cap0', action: 'copy' }]);
});

it('Play plays without copying, and Pause pauses', async () => {
  const log = stubMedia();
  videoList();
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  fireEvent.click(screen.getByRole('button', { name: 'Play this recording here' }));
  expect(log.filter((l) => l.startsWith('play'))).toEqual(['play https://wallcap.localhost/cap0']);
  expect(calls).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  expect(log[log.length - 1]).toBe('pause https://wallcap.localhost/cap0');
  expect(calls).toEqual([]);
});

it('Sound toggles the video between muted and not, without copying', async () => {
  stubMedia();
  videoList();
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  const v = document.querySelector('.cap-big video') as HTMLVideoElement;
  fireEvent.click(screen.getByRole('button', { name: 'Sound on' }));
  expect(v.muted).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Sound off' }));
  expect(v.muted).toBe(true);
  expect(calls).toEqual([]);
});

it('picking another capture removes the old element, pausing it and freeing it', async () => {
  const log = stubMedia();
  videoList();
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  const first = document.querySelector('.cap-big video') as HTMLVideoElement;
  fireEvent.click(screen.getByRole('button', { name: 'Play this recording here' }));
  log.length = 0;
  fireEvent.click(screen.getByRole('button', { name: /App 1/ }));
  await screen.findByText('Title 1');
  expect(first.isConnected).toBe(false);
  expect(first.hasAttribute('src')).toBe(false);
  expect(log).toContain('load');
  expect(log.some((l) => l.startsWith('pause'))).toBe(true);
  const next = document.querySelector('.cap-big video') as HTMLVideoElement;
  expect(next.getAttribute('src')).toMatch(/wallcap\.localhost\/cap1#/);
  expect(document.querySelectorAll('video')).toHaveLength(1);
  // A fresh element starts paused, muted and asks for Play again.
  expect(screen.getByRole('button', { name: 'Play this recording here' })).toBeTruthy();
});

it('a hidden page pauses the video and a visible one plays it again', async () => {
  const log = stubMedia();
  videoList();
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  fireEvent.click(screen.getByRole('button', { name: 'Play this recording here' }));
  const hide = (hidden: boolean) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  };
  try {
    log.length = 0;
    hide(true);
    expect(log).toContain('pause https://wallcap.localhost/cap0');
    log.length = 0;
    hide(false);
    expect(log).toContain('play https://wallcap.localhost/cap0');
  } finally {
    hide(false);
  }
});

it('a play() that a pause aborts keeps the Play intent', async () => {
  const log = stubMedia();
  videoList();
  vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => Promise.reject(new DOMException('x', 'AbortError')));
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Play this recording here' }));
  });
  expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  expect(log.length).toBeGreaterThan(0);
  // Another kind of refusal drops it.
  vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => Promise.reject(new DOMException('x', 'NotAllowedError')));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Play this recording here' }));
  });
  expect(await screen.findByRole('button', { name: 'Play this recording here' })).toBeTruthy();
});

it('focus on a control that goes away with a failed video moves to the Copy button', async () => {
  stubMedia();
  videoList();
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  const play = screen.getByRole('button', { name: 'Play this recording here' });
  play.focus();
  fireEvent.error(document.querySelector('.cap-big video') as HTMLVideoElement);
  expect(document.activeElement).toBe(document.querySelector('.cap-big button.cap-pic'));
});

it('an error from the video falls back to the tile and drops the controls', async () => {
  stubMedia();
  videoList();
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  fireEvent.error(document.querySelector('.cap-big video') as HTMLVideoElement);
  expect(document.querySelector('video')).toBeNull();
  expect(screen.getByText("Can't play here. Open it")).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Play this recording here' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();
});

it('an mkv gets the tile, not a video', async () => {
  stubMedia();
  videoList();
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  fireEvent.click(screen.getByRole('button', { name: /App 2/ }));
  await screen.findByText('Title 2');
  expect(document.querySelector('.cap-big video')).toBeNull();
  expect(document.querySelector('.cap-big .cap-tile.video')).toBeTruthy();
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

it('two list reads that land out of order still send the visible id to thumb and act', async () => {
  const first = [cap(0), cap(1)];
  const second = [cap(7), cap(0), cap(1)];
  const releases: Array<() => void> = [];
  let reads = 0;
  mocks.set('wall2_captures_list', () => {
    const mine = reads++ === 0 ? first : second;
    return new Promise((resolve) => releases.push(() => resolve(mine)));
  });
  const asked: unknown[] = [];
  mocks.set('wall2_captures_thumb', (args) => {
    asked.push(args);
    return 'data:image/png;base64,AAAA';
  });
  render(<CapturesCard />);
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
  });
  expect(releases).toHaveLength(2);
  // The newer read answers first, then the older one is ignored.
  await act(async () => {
    releases[1]();
    await Promise.resolve();
  });
  await act(async () => {
    releases[0]();
    await Promise.resolve();
  });
  await screen.findByText('Title 7');
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
  await screen.findByText('Copied');
  expect(calls).toEqual([{ id: 'cap7', action: 'copy' }]);
  expect(asked).toContainEqual({ id: 'cap7' });
});

it('the thumbnail cache is keyed by id and evicts the oldest past 48 MB, always keeping the newest', async () => {
  const big = 'a'.repeat(20 * 1024 * 1024);
  let n = 0;
  mocks.set('wall2_captures_thumb', () => {
    n += 1;
    return big;
  });
  await loadThumb(cap(0));
  await loadThumb(cap(1));
  expect(thumbBytes()).toBe(2 * big.length);
  await loadThumb(cap(2));
  expect(thumbBytes()).toBeLessThanOrEqual(THUMB_BYTES_MAX);
  expect(thumbBytes()).toBe(2 * big.length);
  expect(n).toBe(3);
  await loadThumb(cap(2));
  expect(n).toBe(3);
  await loadThumb(cap(0));
  expect(n).toBe(4);
});

it('keeps at most six pictures beyond those shown', async () => {
  let n = 0;
  mocks.set('wall2_captures_thumb', () => {
    n += 1;
    return 'data:image/png;base64,AAAA';
  });
  for (let i = 0; i < 12; i++) await loadThumb(cap(i));
  trimThumbs(['cap0', 'cap1']);
  expect(n).toBe(12);
  for (let i = 0; i < 12; i++) await loadThumb(cap(i));
  // cap0 and cap1 were kept, and so were the newest THUMB_EXTRA of the rest.
  expect(n).toBe(12 + (12 - 2 - THUMB_EXTRA));
});

it('a pick that the filter hides is dropped, so All shows the first row, not the old pick', async () => {
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  fireEvent.click(screen.getByRole('button', { name: /App 3/ }));
  await screen.findByText('Title 3');
  fireEvent.click(screen.getByRole('button', { name: /Show: All/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Images' }));
  await screen.findByText('Title 0');
  fireEvent.click(screen.getByRole('button', { name: /Show: Images/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'All' }));
  await screen.findByText('Title 0');
  expect(rowButtons()[0].getAttribute('aria-current')).toBe('true');
  expect(rowButtons()[3].getAttribute('aria-current')).toBeNull();
});

it('a refresh that no longer lists the pick drops it, and one that still lists it keeps it', async () => {
  let list = LIST;
  mocks.set('wall2_captures_list', () => list);
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  fireEvent.click(screen.getByRole('button', { name: /App 4/ }));
  await screen.findByText('Title 4');
  list = LIST.filter((c) => c.id !== 'cap0');
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
  });
  expect(rowButtons()).toHaveLength(6);
  expect(screen.getByText('Title 4')).toBeTruthy();
  list = LIST.filter((c) => c.id !== 'cap4');
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
  });
  await screen.findByText('Title 0');
  list = LIST;
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
  });
  await screen.findByText('Title 0');
  expect(rowButtons()[0].getAttribute('aria-current')).toBe('true');
});

it('the funnel closes its own open menu instead of reopening it', async () => {
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  const funnel = screen.getByRole('button', { name: /Show: All/ });
  fireEvent.pointerDown(funnel);
  fireEvent.click(funnel);
  expect(screen.getByRole('menu')).toBeTruthy();
  fireEvent.pointerDown(funnel);
  fireEvent.click(funnel);
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.pointerDown(funnel);
  fireEvent.click(funnel);
  expect(screen.getByRole('menu')).toBeTruthy();
});

it('a right-click on another row moves the menu there and focuses its first item', async () => {
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  fireEvent.contextMenu(screen.getByRole('button', { name: /App 2/ }));
  const first = screen.getByRole('menuitem', { name: 'Copy image' });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: 'ArrowDown' });
  expect(document.activeElement).not.toBe(screen.getByRole('menuitem', { name: 'Copy image' }));
  fireEvent.contextMenu(screen.getByRole('button', { name: /App 4/ }));
  expect(screen.getAllByRole('menu')).toHaveLength(1);
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Copy image' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Copy path' }));
  await Promise.resolve();
  expect(calls[calls.length - 1]).toEqual({ id: 'cap4', action: 'path' });
});

it('a trashed row stays hidden while the list holds it, and is forgotten once the list drops it', async () => {
  let list = LIST;
  mocks.set('wall2_captures_list', () => list);
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  fireEvent.contextMenu(screen.getByRole('button', { name: /App 2/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Move to Recycle Bin' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Click again to move to Recycle Bin' }));
  await screen.findByText('Moved to the Recycle Bin');
  expect(rowButtons()).toHaveLength(6);
  list = LIST.filter((c) => c.id !== 'cap2');
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
  });
  expect(rowButtons()).toHaveLength(6);
  // The same id back in the list later is a new file and shows.
  list = LIST;
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
  });
  expect(rowButtons()).toHaveLength(7);
});

it('a trashed row that the list holds in place again after 10 seconds shows (it was restored)', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  mocks.set('wall2_captures_list', () => [...LIST]);
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  fireEvent.contextMenu(screen.getByRole('button', { name: /App 2/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Move to Recycle Bin' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Click again to move to Recycle Bin' }));
  await screen.findByText('Moved to the Recycle Bin');
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
  });
  expect(rowButtons()).toHaveLength(6);
  vi.setSystemTime(NOW + 11_000);
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
  });
  expect(rowButtons()).toHaveLength(7);
});

it('says ShareX is not installed for edit, pin and read-text, and the bin failure in its own words', async () => {
  mocks.set('wall2_captures_act', () => Promise.reject('not-installed'));
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  for (const name of ['Edit in ShareX', 'Pin to screen', 'Copy text (OCR)']) {
    fireEvent.contextMenu(screen.getByRole('button', { name: /App 2/ }));
    fireEvent.click(screen.getByRole('menuitem', { name }));
    await screen.findByText('ShareX is not installed');
    cleanup();
    render(<CapturesCard />);
    await screen.findByText('Title 0');
  }
  mocks.set('wall2_captures_act', () => Promise.reject('recycle-failed'));
  fireEvent.contextMenu(screen.getByRole('button', { name: /App 2/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Move to Recycle Bin' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Click again to move to Recycle Bin' }));
  await screen.findByText('Could not move to the Recycle Bin');
  expect(rowButtons()).toHaveLength(7);
});

// Share link: the menu row, its second step, the one send and the lines for each answer.
let shared: unknown[];
let shareAnswer: () => Promise<unknown>;

const openShare = async () => {
  fireEvent.contextMenu(screen.getByRole('button', { name: /App 2/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Share link' }));
};
const goButton = () => document.querySelector('.cap-step-go') as HTMLButtonElement;

function armShare() {
  shared = [];
  shareAnswer = async () => ({ url: 'https://go-ae.org/s/k7Qm2x', copied: true });
  mocks.set('wall2_captures_share', (args) => {
    shared.push(args);
    return shareAnswer();
  });
}

it('the capture menu has Share link with its help text, and a gone capture cannot be shared', async () => {
  armShare();
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  fireEvent.contextMenu(screen.getByRole('button', { name: /App 2/ }));
  const item = screen.getByRole('menuitem', { name: 'Share link' }) as HTMLButtonElement;
  expect(item.disabled).toBe(false);
  expect(item.title).toContain('go-ae.org');
  expect(item.title).toContain('asks once more');
  fireEvent.keyDown(document, { key: 'Escape' });
  cleanup();
  mocks.set('wall2_captures_list', () => [cap(0, { exists: false })]);
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  fireEvent.contextMenu(screen.getAllByRole('button', { name: /App 0/ })[0]);
  expect((screen.getByRole('menuitem', { name: 'Share link' }) as HTMLButtonElement).disabled).toBe(true);
});

it('choosing Share link turns the menu into the second step and sends nothing yet', async () => {
  armShare();
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  await openShare();
  expect(screen.getByText('Anyone with the link can see this.')).toBeTruthy();
  expect(screen.getByText('Uploads to go-ae.org and copies the link.')).toBeTruthy();
  expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Share link', 'Back']);
  expect(goButton().title).toContain('go-ae.org');
  expect(document.activeElement).toBe(goButton());
  expect(shared).toEqual([]);
});

it('Back and Escape return to the first step; a second Escape closes the menu', async () => {
  armShare();
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  await openShare();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Back' }));
  expect(screen.getByRole('menuitem', { name: 'Copy path' })).toBeTruthy();
  expect(screen.queryByText('Anyone with the link can see this.')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Share link' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Share link' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByRole('menuitem', { name: 'Copy path' })).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(shared).toEqual([]);
});

it('Enter confirms: one call with the capture id and nothing else, then Link copied', async () => {
  armShare();
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  await openShare();
  fireEvent.keyDown(goButton(), { key: 'Enter' });
  await screen.findByText('Link copied');
  expect(shared).toEqual([{ id: 'cap2' }]);
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.body.innerHTML).not.toContain('go-ae.org/s/');
});

it('the Share link button confirms by click too, and Enter on Back goes back instead', async () => {
  armShare();
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  await openShare();
  const back = screen.getByRole('menuitem', { name: 'Back' });
  back.focus();
  fireEvent.keyDown(back, { key: 'Enter' });
  expect(shared).toEqual([]);
  expect(screen.getByRole('menuitem', { name: 'Share link' })).toBeTruthy();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Share link' }));
  fireEvent.click(goButton());
  await screen.findByText('Link copied');
  expect(shared).toHaveLength(1);
});

it('while uploading it says so, the row is off, and a second send is blocked', async () => {
  armShare();
  let finish: (v: unknown) => void = () => undefined;
  shareAnswer = () => new Promise<unknown>((r) => (finish = r));
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  await openShare();
  const go = goButton();
  fireEvent.click(go);
  fireEvent.click(go);
  await screen.findByText('Sharing...');
  expect(shared).toHaveLength(1);
  // The menu is closed; opening it again shows the row off.
  fireEvent.contextMenu(screen.getByRole('button', { name: /App 3/ }));
  expect((screen.getByRole('menuitem', { name: 'Share link' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(document, { key: 'Escape' });
  await act(async () => finish({ url: 'https://go-ae.org/s/k7Qm2x', copied: true }));
  await screen.findByText('Link copied');
  expect(screen.queryByText('Sharing...')).toBeNull();
  expect(shared).toHaveLength(1);
});

it('a link the clipboard missed stays in the chip, selectable, and a retry starts clean', async () => {
  armShare();
  shareAnswer = async () => ({ url: 'https://go-ae.org/s/k7Qm2x', copied: false });
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  await openShare();
  fireEvent.click(goButton());
  const chip = await screen.findByText('Link ready, copy failed: https://go-ae.org/s/k7Qm2x');
  expect(chip.className).toContain('cap-chip-link');
  expect(screen.queryByText('Link copied')).toBeNull();
  vi.useFakeTimers();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(screen.getByText(/Link ready, copy failed/)).toBeTruthy();
  vi.useRealTimers();
  shareAnswer = async () => ({ url: 'https://go-ae.org/s/k7Qm2x', copied: true });
  await openShare();
  fireEvent.click(goButton());
  await screen.findByText('Link copied');
  expect(screen.queryByText(/copy failed/)).toBeNull();
  expect(shared).toHaveLength(2);
});

it('only share messages use the wrapping chip look; other results keep the plain chip', async () => {
  armShare();
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  await openShare();
  fireEvent.click(goButton());
  expect((await screen.findByText('Link copied')).className).toContain('cap-chip-share');
  expect((await screen.findByText('Link copied')).className).not.toContain('cap-chip-link');
});

it('a share answer with no link is failed', async () => {
  armShare();
  shareAnswer = async () => 'https://go-ae.org/s/k7Qm2x';
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  await openShare();
  fireEvent.click(goButton());
  await screen.findByText('Could not share. Try again.');
});

it('Link copied goes away after a few seconds', async () => {
  armShare();
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  await openShare();
  vi.useFakeTimers();
  fireEvent.click(goButton());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(screen.getByText('Link copied')).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(7_000);
  });
  expect(screen.queryByText('Link copied')).toBeNull();
});

it.each([
  ['no-key', 'Add the share key in Tools first.'],
  ['bad-key', 'go-ae.org refused the share key. Check it in Tools.'],
  ['too-big', 'This file is over 100 MB.'],
  ['missing', 'This capture is gone.'],
  ['failed', 'Could not share. Try again.'],
  ['something-else', 'Could not share. Try again.'],
])('the answer %s shows its plain line and frees the row to try again', async (word, line) => {
  armShare();
  shareAnswer = () => Promise.reject(word);
  render(<CapturesCard />);
  await screen.findByText('Title 0');
  await openShare();
  fireEvent.click(goButton());
  await screen.findByText(line);
  expect(screen.queryByText('Link copied')).toBeNull();
  fireEvent.contextMenu(screen.getByRole('button', { name: /App 2/ }));
  expect((screen.getByRole('menuitem', { name: 'Share link' }) as HTMLButtonElement).disabled).toBe(false);
});
