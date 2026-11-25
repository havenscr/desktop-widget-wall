import { render } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
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
