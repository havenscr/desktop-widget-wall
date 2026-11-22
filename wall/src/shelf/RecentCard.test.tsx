import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { RecentCard } from './RecentCard';
import { recentWhen, type RecentFile } from './recent';

const NOW = new Date(2026, 10, 11, 10, 24).getTime(); // old times: the card shows dates, the helper test passes its own clock
const MIN = 60_000;
const file = (i: number, over: Partial<RecentFile> = {}): RecentFile => ({ id: `rf${i}`, name: `Document ${i}.docx`, kind: 'document', modified: NOW - (i + 1) * 30 * MIN, ...over });
const LIST = [file(0), file(1), file(2), file(3), file(4)];
let calls: { command: string; args: unknown }[];

beforeEach(() => {
  calls = [];
  mocks.set('wall2_recent_files', () => [LIST[2], LIST[0], LIST[4], LIST[1], LIST[3]]);
  mocks.set('wall2_recent_open', (args) => {
    calls.push({ command: 'open', args });
    return undefined;
  });
  mocks.set('wall2_recent_folder', (args) => {
    calls.push({ command: 'folder', args });
    return undefined;
  });
});
afterEach(cleanup);

it('shows the files newest first, with a time on each', async () => {
  render(<RecentCard />);
  await screen.findByText('Document 0.docx');
  const rows = screen.getAllByRole('listitem');
  expect(rows).toHaveLength(5);
  expect(rows.map((r) => within(r).getByText(/^Document/).textContent)).toEqual(['Document 0.docx', 'Document 1.docx', 'Document 2.docx', 'Document 3.docx', 'Document 4.docx']);
  for (const r of rows) expect(r.querySelector('.rf-when')!.textContent).not.toBe('');
  expect(screen.getByText('newest first')).toBeTruthy();
});

it('a click on the row opens the file by id', async () => {
  render(<RecentCard />);
  await screen.findByText('Document 2.docx');
  fireEvent.click(screen.getByRole('button', { name: /^Document 2\.docx/ }));
  await screen.findByText('Opened');
  expect(calls).toEqual([{ command: 'open', args: { id: 'rf2' } }]);
});

it('the Folder button shows the file in Explorer by id and does not open it', async () => {
  render(<RecentCard />);
  await screen.findByText('Document 3.docx');
  fireEvent.click(screen.getByRole('button', { name: 'Show Document 3.docx in File Explorer' }));
  await screen.findByText('Shown in File Explorer');
  expect(calls).toEqual([{ command: 'folder', args: { id: 'rf3' } }]);
});

it('says so when the file is gone', async () => {
  mocks.set('wall2_recent_open', () => Promise.reject('missing'));
  render(<RecentCard />);
  await screen.findByText('Document 0.docx');
  fireEvent.click(screen.getByRole('button', { name: /^Document 0\.docx/ }));
  await screen.findByText('File moved or deleted');
});

it('says No recent files when there are none', async () => {
  mocks.set('wall2_recent_files', () => []);
  render(<RecentCard />);
  await screen.findByText('No recent files');
});

it('says Recent files unavailable when the read fails', async () => {
  mocks.set('wall2_recent_files', () => Promise.reject('failed'));
  render(<RecentCard />);
  await screen.findByText('Recent files unavailable');
});

it('the page never holds a path', async () => {
  render(<RecentCard />);
  await screen.findByText('Document 0.docx');
  expect(document.body.innerHTML).not.toMatch(/[A-Za-z]:\\/);
});

it('times read as a clock time today, Yesterday, a weekday, then a date', () => {
  const day = 86_400_000;
  expect(recentWhen(NOW - 40 * MIN, NOW)).toMatch(/9:44\s?AM/);
  expect(recentWhen(NOW - day, NOW)).toBe('Yesterday');
  expect(recentWhen(NOW - 3 * day, NOW)).toMatch(/^[A-Z][a-z]{2}$/);
  expect(recentWhen(NOW - 10 * day, NOW)).toBe('Nov 1');
  expect(recentWhen(0, NOW)).toBe('');
});

it('draws up to 20 rows, each with a decorative icon tinted by kind', async () => {
  const many = Array.from({ length: 20 }, (_, i) => file(i, { name: i === 0 ? 'Chart.pdf' : `Item ${i}.docx` }));
  mocks.set('wall2_recent_files', () => many);
  render(<RecentCard />);
  await screen.findByText('Chart.pdf');
  expect(screen.getAllByRole('listitem')).toHaveLength(20);
  const icon = screen.getAllByRole('listitem')[0].querySelector('.rf-icon') as HTMLElement;
  expect(icon.style.color).toBe('rgb(255, 107, 107)');
  expect(icon.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
});

const PIC = 'data:image/png;base64,AAAA';

describe('preview', () => {
  let asked: string[];
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    asked = [];
    mocks.set('wall2_recent_files', () => [file(0), file(1, { name: 'Notes 1.txt', kind: 'other' })]);
    mocks.set('wall2_recent_preview', (args) => {
      asked.push((args as { id: string }).id);
      return PIC;
    });
  });
  afterEach(() => vi.useRealTimers());

  it('appears after the pointer rests 500 ms on a row that can have one', async () => {
    render(<RecentCard />);
    await screen.findByText('Document 0.docx');
    const row = screen.getAllByRole('listitem')[0];
    fireEvent.pointerEnter(row);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(document.querySelector('.rf-preview')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    const img = document.querySelector('.rf-preview img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(PIC);
    expect(document.querySelector('.rf-preview-name')!.textContent).toBe('Document 0.docx');
    fireEvent.pointerLeave(row);
    expect(document.querySelector('.rf-preview')).toBeNull();
  });

  it('never asks for a text file', async () => {
    render(<RecentCard />);
    await screen.findByText('Notes 1.txt');
    fireEvent.pointerEnter(screen.getAllByRole('listitem')[1]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(asked).toEqual([]);
    expect(document.querySelector('.rf-preview')).toBeNull();
  });

  it('shows nothing for none', async () => {
    mocks.set('wall2_recent_preview', () => 'none');
    render(<RecentCard />);
    await screen.findByText('Document 0.docx');
    fireEvent.pointerEnter(screen.getAllByRole('listitem')[0]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(document.querySelector('.rf-preview')).toBeNull();
  });

  it('ignores a slow answer once the pointer has left', async () => {
    let release: (v: string) => void = () => undefined;
    mocks.set('wall2_recent_preview', () => new Promise<string>((r) => (release = r)));
    render(<RecentCard />);
    await screen.findByText('Document 0.docx');
    const row = screen.getAllByRole('listitem')[0];
    fireEvent.pointerEnter(row);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    fireEvent.pointerLeave(row);
    await act(async () => {
      release(PIC);
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(document.querySelector('.rf-preview')).toBeNull();
  });

  it('goes when the list scrolls', async () => {
    render(<RecentCard />);
    await screen.findByText('Document 0.docx');
    fireEvent.pointerEnter(screen.getAllByRole('listitem')[0]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(document.querySelector('.rf-preview')).not.toBeNull();
    fireEvent.scroll(document.querySelector('.rf-rows')!);
    expect(document.querySelector('.rf-preview')).toBeNull();
  });

  it('asks again after 30 s when the answer was none', async () => {
    let n = 0;
    mocks.set('wall2_recent_preview', () => (++n === 1 ? 'none' : PIC));
    render(<RecentCard />);
    await screen.findByText('Document 0.docx');
    const row = screen.getAllByRole('listitem')[0];
    fireEvent.pointerEnter(row);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(n).toBe(1);
    fireEvent.pointerLeave(row);
    fireEvent.pointerEnter(row);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(n).toBe(1);
    expect(document.querySelector('.rf-preview')).toBeNull();
    fireEvent.pointerLeave(row);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    fireEvent.pointerEnter(row);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(n).toBe(2);
    expect(document.querySelector('.rf-preview')).not.toBeNull();
  });

  it('goes when the shown file leaves the list', async () => {
    let list = [file(0), file(1)];
    mocks.set('wall2_recent_files', () => list);
    render(<RecentCard />);
    await screen.findByText('Document 0.docx');
    fireEvent.pointerEnter(screen.getAllByRole('listitem')[0]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(document.querySelector('.rf-preview')).not.toBeNull();
    list = [file(1)];
    fireEvent.focus(window);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(screen.queryByText('Document 0.docx')).toBeNull();
    expect(document.querySelector('.rf-preview')).toBeNull();
  });
});
