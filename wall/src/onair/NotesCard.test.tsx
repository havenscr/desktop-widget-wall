import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { resetTip } from '../ui/HoverTip';
import { IDLE, type Show } from './model';
import { NotesCard } from './NotesCard';
import { useOnAirStore } from './store';

const SHOW: Show = { state: 'ok', title: 'T', parts: [{ name: 'Welcome', minutes: 5, notes: ['Say hello', 'Second note'] }, { name: 'Next one', minutes: 5, notes: [] }], skipped: 0, reason: null, readAt: 1 };

beforeEach(() => {
  resetTip();
  useOnAirStore.setState({ saved: IDLE, show: SHOW });
});

it('shows every part\'s notes as one list in file order, with no part name, arrows or step buttons', () => {
  useOnAirStore.setState({
    show: { ...SHOW, parts: [{ name: 'A', minutes: 5, notes: ['one', 'two'] }, { name: 'B', minutes: null, notes: [] }, { name: 'C', minutes: 5, notes: ['three'] }] },
  });
  const { container } = render(<NotesCard />);
  expect([...container.querySelectorAll('.oa-note span')].map((e) => e.textContent)).toEqual(['one', 'two', 'three']);
  expect(container.querySelectorAll('ul.oa-notes')).toHaveLength(1);
  expect(container.querySelector('.oa-k')?.textContent).toBe('Notes');
  expect(container.querySelector('button')).toBeNull();
  expect(container.textContent).not.toMatch(/part/i);
});

it('with a title, a right text and sizes the heading is the new one and the notes use those sizes', () => {
  const { container } = render(<NotesCard title="Outline" right="on the prompter" sizes={[30, 22]} className="x" />);
  expect(container.querySelector('section.oa-card.x')?.getAttribute('aria-label')).toBe('Outline');
  expect(container.querySelector('.oa2-hd .k')?.textContent).toBe('Outline');
  expect(container.querySelector('.oa2-hd-r')?.textContent).toBe('on the prompter');
  // jsdom has no layout: every size fits, so the largest of the given sizes is used.
  expect((container.querySelector('.oa-notes') as HTMLElement).style.getPropertyValue('--oa-note')).toBe('30px');
});

const edit = () => fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
const box = () => screen.getByLabelText('Notes, one per line') as HTMLTextAreaElement;

it('Edit opens a box with one note per line, with Save and Cancel, and no Edit before a title', () => {
  const { container, unmount } = render(<NotesCard />);
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  unmount();
  render(<NotesCard title="Notes" />);
  edit();
  expect(box().value).toBe('Say hello\nSecond note');
  expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  expect(container.querySelector('ul.oa-notes')).toBeNull();
});

it('Save sends the lines, closes the box and the list shows what the next read holds', async () => {
  const saveNotes = vi.fn(async (lines: string[]) => {
    useOnAirStore.setState({ show: { ...SHOW, parts: [{ name: '', minutes: null, notes: lines.filter(Boolean) }] } });
    return null;
  });
  useOnAirStore.setState({ saveNotes });
  const { container } = render(<NotesCard title="Notes" />);
  edit();
  fireEvent.change(box(), { target: { value: 'one\ntwo\n' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByLabelText('Notes, one per line')).toBeNull());
  expect(saveNotes).toHaveBeenCalledWith(['one', 'two', '']);
  expect([...container.querySelectorAll('.oa-note span')].map((e) => e.textContent)).toEqual(['one', 'two']);
});

it('a refusal keeps the box open with its text and shows the reason', async () => {
  useOnAirStore.setState({ saveNotes: async () => 'Not saved: more than 40 notes' });
  render(<NotesCard title="Notes" />);
  edit();
  fireEvent.change(box(), { target: { value: 'typed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Not saved: more than 40 notes');
  expect(box().value).toBe('typed');
});

it('Cancel and Escape close the box without saving, and Edit starts again from the shown notes', () => {
  const saveNotes = vi.fn(async () => null);
  useOnAirStore.setState({ saveNotes });
  render(<NotesCard title="Notes" />);
  edit();
  fireEvent.change(box(), { target: { value: 'changed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByLabelText('Notes, one per line')).toBeNull();
  edit();
  expect(box().value).toBe('Say hello\nSecond note');
  fireEvent.keyDown(box(), { key: 'Escape' });
  expect(screen.queryByLabelText('Notes, one per line')).toBeNull();
  expect(saveNotes).not.toHaveBeenCalled();
});

it('there is no Edit while the file is refused', () => {
  useOnAirStore.setState({ show: { ...SHOW, state: 'refused', parts: [], reason: 'run-of-show.txt is over 32 KB' } });
  render(<NotesCard title="Notes" />);
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
});

it('when the list cannot refresh after a save the box stays open with that line', async () => {
  useOnAirStore.setState({ saveNotes: async () => 'Saved, but the list could not refresh' });
  render(<NotesCard title="Notes" />);
  edit();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Saved, but the list could not refresh');
  expect(box()).toBeTruthy();
});
