import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
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
  expect(screen.getByText('last 5 opened')).toBeTruthy();
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
