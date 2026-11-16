import { render } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { resetTip } from '../ui/HoverTip';
import { IDLE, type Show } from './model';
import { NotesCard } from './NotesCard';
import { useOnAirStore } from './store';

const SHOW: Show = { state: 'ok', title: 'T', parts: [{ name: 'Welcome', minutes: 5, notes: ['Say hello', 'Second note'] }, { name: 'Next one', minutes: 5, notes: [] }], skipped: 0, reason: null, readAt: 1 };

/** The card's markup with no props, rendered by the code before the new On Air frame added props to it. */
const BEFORE = "<section class=\"panel oa-card\" aria-label=\"Notes for this part\"><span class=\"k oa-k ellipsis\">Notes for this part \u00b7 Welcome</span><ul class=\"oa-notes\" style=\"--oa-note: 36px;\"><li class=\"oa-note\"><i class=\"oa-dot\" aria-hidden=\"true\"></i><span>Say hello</span></li><li class=\"oa-note\"><i class=\"oa-dot\" aria-hidden=\"true\"></i><span>Second note</span></li><li class=\"oa-more\" hidden=\"\"></li></ul><div class=\"oa-card-foot\"><button type=\"button\" class=\"oa-btn fill oa-step\" aria-disabled=\"true\"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"22\" height=\"22\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"tabler-icon tabler-icon-arrow-left\" aria-hidden=\"true\"><path d=\"M5 12l14 0\"></path><path d=\"M5 12l6 6\"></path><path d=\"M5 12l6 -6\"></path></svg>Previous part</button><button type=\"button\" class=\"oa-btn cy oa-step\" aria-disabled=\"false\">Next part<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"22\" height=\"22\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"tabler-icon tabler-icon-arrow-right\" aria-hidden=\"true\"><path d=\"M5 12l14 0\"></path><path d=\"M13 18l6 -6\"></path><path d=\"M13 6l6 6\"></path></svg></button><span class=\"xs oa-nextline ellipsis\">Next: Next one, 5 min</span></div></section>";

beforeEach(() => {
  resetTip();
  useOnAirStore.setState({ saved: IDLE, show: SHOW });
});

it('with no props the card renders exactly the markup it rendered before', () => {
  expect(render(<NotesCard />).container.innerHTML).toBe(BEFORE);
});

it('with a title, a right text and sizes the heading is the new one and the notes use those sizes', () => {
  const { container } = render(<NotesCard title="Outline" right="on the prompter" sizes={[30, 22]} className="x" />);
  expect(container.querySelector('section.oa-card.x')?.getAttribute('aria-label')).toBe('Outline');
  expect(container.querySelector('.oa2-hd .k')?.textContent).toBe('Outline \u00b7 Welcome');
  expect(container.querySelector('.oa2-hd-r')?.textContent).toBe('on the prompter');
  // jsdom has no layout: every size fits, so the largest of the given sizes is used.
  expect((container.querySelector('.oa-notes') as HTMLElement).style.getPropertyValue('--oa-note')).toBe('30px');
});
