import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dictation } from '../bridge/dictations';
import { mocks } from '../bridge/tauri';
import { RecentCard } from './RecentCard';

const row = (i: number, over: Partial<Dictation> = {}): Dictation => ({
  id: `d-${i}`,
  at: new Date(2026, 10, 11, 9, 40 - i).toISOString(),
  app: i === 1 ? 'Notes' : 'Mail',
  clean: `Cleaned sentence ${i}.`,
  raw: `um raw sentence ${i}`,
  words: 3,
  ...over,
});
let copies: { id: unknown; which: unknown }[];

beforeEach(() => {
  localStorage.clear();
  copies = [];
  mocks.set('wall2_recent_files', () => []);
  mocks.set('wall2_dictations', () => [row(0), row(1), row(2)]);
  mocks.set('wall2_dictation_copy', (args) => {
    copies.push({ id: (args as { id: unknown }).id, which: (args as { which: unknown }).which });
    return undefined;
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const open = () => fireEvent.click(screen.getByRole('radio', { name: 'Dictations' }));

describe('the switch', () => {
  it('starts on Recent files and shows Dictations on a click', async () => {
    render(<RecentCard />);
    expect(screen.getByRole('radio', { name: 'Recent files' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText('Cleaned sentence 0.')).toBeNull();
    open();
    await screen.findByText('Cleaned sentence 0.');
    expect(screen.getByRole('radio', { name: 'Dictations' }).getAttribute('aria-checked')).toBe('true');
  });

  it('remembers the choice', async () => {
    const first = render(<RecentCard />);
    open();
    await screen.findByText('Cleaned sentence 0.');
    expect(localStorage.getItem('wall.shelf.recent')).toBe('dictations');
    first.unmount();
    render(<RecentCard />);
    await screen.findByText('Cleaned sentence 0.');
  });

  it('ignores a stored word it does not know', () => {
    localStorage.setItem('wall.shelf.recent', 'nonsense');
    render(<RecentCard />);
    expect(screen.getByRole('radio', { name: 'Recent files' }).getAttribute('aria-checked')).toBe('true');
  });

  it('the arrow key moves to the other side', async () => {
    render(<RecentCard />);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Recent files' }), { key: 'ArrowRight' });
    await screen.findByText('Cleaned sentence 0.');
  });
});

describe('the list', () => {
  it('shows each text with its time and app under it', async () => {
    render(<RecentCard />);
    open();
    await screen.findByText('Cleaned sentence 0.');
    const rows = document.querySelectorAll('.dc-row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1] as HTMLElement).getByText(/Notes$/)).toBeTruthy();
  });

  it('Copy and Raw ask for the right id and text', async () => {
    render(<RecentCard />);
    open();
    await screen.findByText('Cleaned sentence 1.');
    const second = document.querySelectorAll('.dc-row')[1] as HTMLElement;
    fireEvent.click(within(second).getByText('Copy'));
    await within(second).findByText('Copied');
    fireEvent.click(within(second).getByText('Raw'));
    await vi.waitFor(() => expect(copies).toHaveLength(2));
    expect(copies).toEqual([
      { id: 'd-1', which: 'clean' },
      { id: 'd-1', which: 'raw' },
    ]);
  });

  it('says Failed when the copy fails', async () => {
    mocks.set('wall2_dictation_copy', () => Promise.reject('failed'));
    render(<RecentCard />);
    open();
    await screen.findByText('Cleaned sentence 0.');
    fireEvent.click(within(document.querySelector('.dc-row') as HTMLElement).getByText('Copy'));
    await screen.findByText('Failed');
  });
});

describe('the answers when there is no list', () => {
  const cases: [string, string][] = [
    ['not-installed', 'Wispr Flow is not installed on this PC.'],
    ['no-history', 'Wispr Flow has no dictation history. Check its privacy setting.'],
    ['changed', 'Wispr Flow changed its history format. The wall cannot read it yet.'],
  ];
  for (const [word, line] of cases) {
    it(`${word} says so`, async () => {
      mocks.set('wall2_dictations', () => Promise.reject(word));
      render(<RecentCard />);
      open();
      await screen.findByText(line);
    });
  }

  it('busy and failed offer a retry that reads again', async () => {
    let n = 0;
    mocks.set('wall2_dictations', () => (n++ === 0 ? Promise.reject('busy') : [row(0)]));
    render(<RecentCard />);
    open();
    await screen.findByText('Could not read the Wispr Flow history.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Cleaned sentence 0.');
  });

  it('an empty list says so', async () => {
    mocks.set('wall2_dictations', () => []);
    render(<RecentCard />);
    open();
    await screen.findByText('No dictations yet.');
  });
});

describe('the hover card', () => {
  it('opens after 500 ms of rest, with both versions and two buttons, and closes on leave', async () => {
    render(<RecentCard />);
    open();
    await screen.findByText('Cleaned sentence 0.');
    vi.useFakeTimers();
    const first = document.querySelector('.dc-row') as HTMLElement;
    fireEvent.pointerEnter(first);
    act(() => void vi.advanceTimersByTime(499));
    expect(document.querySelector('.dc-card')).toBeNull();
    act(() => void vi.advanceTimersByTime(2));
    const card = document.querySelector('.dc-card') as HTMLElement;
    expect(card).toBeTruthy();
    expect(within(card).getByText('Cleaned sentence 0.')).toBeTruthy();
    expect(within(card).getByText('um raw sentence 0')).toBeTruthy();
    expect(within(card).getByText('Copy cleaned')).toBeTruthy();
    expect(within(card).getByText('Copy raw')).toBeTruthy();
    fireEvent.pointerLeave(first);
    act(() => void vi.advanceTimersByTime(200));
    expect(document.querySelector('.dc-card')).toBeNull();
  });

  it('a pointer that reaches the card keeps it open, and a scroll closes it', async () => {
    render(<RecentCard />);
    open();
    await screen.findByText('Cleaned sentence 0.');
    vi.useFakeTimers();
    const first = document.querySelector('.dc-row') as HTMLElement;
    fireEvent.pointerEnter(first);
    act(() => void vi.advanceTimersByTime(600));
    fireEvent.pointerLeave(first);
    fireEvent.pointerEnter(document.querySelector('.dc-card') as HTMLElement);
    act(() => void vi.advanceTimersByTime(400));
    expect(document.querySelector('.dc-card')).toBeTruthy();
    fireEvent.scroll(document.querySelector('.dc-rows') as HTMLElement);
    expect(document.querySelector('.dc-card')).toBeNull();
  });

  it('its buttons copy by id', async () => {
    render(<RecentCard />);
    open();
    await screen.findByText('Cleaned sentence 0.');
    vi.useFakeTimers();
    fireEvent.pointerEnter(document.querySelector('.dc-row') as HTMLElement);
    act(() => void vi.advanceTimersByTime(600));
    fireEvent.click(within(document.querySelector('.dc-card') as HTMLElement).getByText('Copy raw'));
    await act(async () => undefined);
    expect(copies).toEqual([{ id: 'd-0', which: 'raw' }]);
  });
});
