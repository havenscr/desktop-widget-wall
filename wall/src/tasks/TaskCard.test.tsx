import { act, fireEvent, render, screen } from '@testing-library/react';
import { TICK_UNDO_MS } from './pendingTick';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { useFocusStore } from '../focus/store';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import { TaskCard } from './TaskCard';
import { REFRESH_MS, type TaskItem } from './model';

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const task = (id: string, title: string, est: TaskItem['est'] = null): TaskItem => ({ id, title, due_at: null, due_is_all_day: false, quadrant: null, est });

let summaryArgs: unknown[] = [];
/** Work reads `wall2_tasks_summary`; `remaining` is the count after the three shown. */
const setList = (fn: () => TaskItem[] | Promise<TaskItem[]>, remaining = 0) =>
  mocks.set('wall2_tasks_summary', async (args) => {
    summaryArgs.push(args);
    const next = await fn();
    return { next: next.slice(0, 3), remaining, dueTomorrow: { count: 0, estMinutes: 0 } };
  });

beforeEach(() => {
  summaryArgs = [];
  useFocusStore.getState().dispose();
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 11, 10, 0, 0));
  mocks.set('get_do_not_disturb', () => false);
  mocks.set('enable_do_not_disturb', () => undefined);
  mocks.set('disable_do_not_disturb', () => undefined);
});
afterEach(() => {
  useFocusStore.getState().dispose();
  vi.useRealTimers();
  mocks.clear();
});

it('shows Not set up when feeds.json has no address', async () => {
  setList(() => Promise.reject(new Error('not-configured')));
  render(<TaskCard />);
  await flush();
  expect(screen.getByText('Not set up')).toBeTruthy();
});

it('shows Nothing due for an empty list', async () => {
  setList(() => []);
  render(<TaskCard />);
  await flush();
  expect(screen.getByText('Nothing due today')).toBeTruthy();
});

it('marks a row done at once, fades it after 2 seconds, then refreshes', async () => {
  let list = [task('a', 'First'), task('b', 'Second')];
  const done = vi.fn((args?: Record<string, unknown>) => {
    list = list.filter((t) => t.id !== args?.id);
  });
  setList(() => list);
  mocks.set('wall2_task_done', done);
  render(<TaskCard />);
  await flush();
  fireEvent.click(screen.getByLabelText('Mark done: First'));
  // Past the undo window: the tick is now really completed.
  await flush(TICK_UNDO_MS);
  expect(screen.getByText('First').closest('li')?.className).toContain('done');
  await flush(1000);
  expect(screen.queryByText('First')).toBeTruthy();
  await flush(1100);
  expect(done).toHaveBeenCalledWith({ id: 'a' });
  expect(screen.queryByText('First')).toBeNull();
  expect(screen.getByText('Second')).toBeTruthy();
});

it('brings the row back with "Could not complete." when the save fails', async () => {
  setList(() => [task('a', 'First')]);
  mocks.set('wall2_task_done', () => Promise.reject(new Error('The service answered 500')));
  render(<TaskCard />);
  await flush();
  fireEvent.click(screen.getByLabelText('Mark done: First'));
  // Past the undo window: the tick is now really completed.
  await flush(TICK_UNDO_MS);
  await flush(3000);
  expect(screen.getByText('First')).toBeTruthy();
  expect(screen.getByText('Could not complete.')).toBeTruthy();
  expect(screen.getByText('First').closest('li')?.className).not.toContain('done');
});

it('brings the row back when the save fails after the fade', async () => {
  setList(() => [task('a', 'First')]);
  mocks.set('wall2_task_done', () => new Promise((_, reject) => setTimeout(() => reject(new Error('x')), 4000)));
  render(<TaskCard />);
  await flush();
  fireEvent.click(screen.getByLabelText('Mark done: First'));
  // Past the undo window: the tick is now really completed.
  await flush(TICK_UNDO_MS);
  await flush(2500);
  expect(screen.queryByText('First')).toBeNull();
  await flush(2000);
  expect(screen.getByText('First')).toBeTruthy();
  expect(screen.getByText('Could not complete.')).toBeTruthy();
});

it('keeps the last good list and shows its age when a refresh fails', async () => {
  let fail = false;
  setList(() => (fail ? Promise.reject(new Error('Could not reach the service')) : [task('a', 'First')]));
  render(<TaskCard />);
  await flush();
  fail = true;
  await flush(120_000 * 3);
  expect(screen.getByText('First')).toBeTruthy();
  expect(screen.getByText(/updated \d+ min ago/)).toBeTruthy();
});

it('holding a row for half a second starts focus named after the task', async () => {
  setList(() => [task('a', 'Write the report')]);
  render(<TaskCard />);
  await flush();
  const row = screen.getByLabelText('Open Write the report; hold to focus on it');
  fireEvent.pointerDown(row);
  await flush(400);
  expect(useFocusStore.getState().state.status).toBe('idle');
  await flush(100);
  const s = useFocusStore.getState().state;
  expect(s.status).toBe('running');
  expect(s.status === 'running' && s.label).toBe('Write the report');
  // While a session runs a press only opens the task.
  expect(row.getAttribute('aria-label')).toBe('Open Write the report');
});

it('a click on the title opens the task in the task app; a hold or a slide opens nothing', async () => {
  const opened: unknown[] = [];
  mocks.set('wall2_open_task', (args) => void opened.push(args));
  setList(() => [task('t-1', 'Write the report')]);
  render(<TaskCard />);
  await flush();
  const row = screen.getByLabelText('Open Write the report; hold to focus on it');
  fireEvent.pointerDown(row);
  await flush(120);
  fireEvent.pointerUp(row);
  fireEvent.click(row);
  await flush();
  expect(opened).toEqual([{ id: 't-1' }]);
  // A slide that cancels the hold: its click opens nothing.
  fireEvent.pointerDown(row, { clientX: 100, clientY: 30 });
  fireEvent.pointerMove(row, { clientX: 130, clientY: 30 });
  fireEvent.pointerUp(row);
  fireEvent.click(row);
  await flush();
  expect(opened).toHaveLength(1);
  // A hold starts focus, and the click that ends it opens nothing.
  fireEvent.pointerDown(row);
  await flush(500);
  fireEvent.pointerUp(row);
  fireEvent.click(row);
  await flush();
  expect(useFocusStore.getState().state.status).toBe('running');
  expect(opened).toHaveLength(1);
  // The tick circle never opens the task.
  mocks.set('wall2_task_done', () => undefined);
  fireEvent.click(screen.getByLabelText('Mark done: Write the report'));
  // Past the undo window: the tick is now really completed.
  await flush(TICK_UNDO_MS);
  await flush();
  expect(opened).toHaveLength(1);
});

it('a hold released off the row does not swallow the next click', async () => {
  const opened: unknown[] = [];
  mocks.set('wall2_open_task', (args) => void opened.push(args));
  setList(() => [task('t-1', 'Write the report')]);
  render(<TaskCard />);
  await flush();
  const row = screen.getByLabelText('Open Write the report; hold to focus on it');
  fireEvent.pointerDown(row);
  await flush(500);
  expect(useFocusStore.getState().state.status).toBe('running');
  // Released somewhere else: no click reaches the row.
  fireEvent.pointerLeave(row);
  fireEvent.pointerUp(document.body);
  await flush();
  // The next click (a keyboard Space, which has no pointer down) opens the task.
  fireEvent.click(row);
  await flush();
  expect(opened).toEqual([{ id: 't-1' }]);
});

it('a short tap or a press that slides off starts nothing', async () => {
  setList(() => [task('a', 'Write the report')]);
  render(<TaskCard />);
  await flush();
  const row = screen.getByLabelText('Open Write the report; hold to focus on it');
  fireEvent.pointerDown(row);
  await flush(200);
  fireEvent.pointerUp(row);
  fireEvent.pointerDown(row);
  await flush(300);
  fireEvent.pointerLeave(row);
  await flush(1000);
  expect(useFocusStore.getState().state.status).toBe('idle');
});

it('a finger that slides more than 12 px cancels the hold, a small wobble does not', async () => {
  setList(() => [task('a', 'Write the report')]);
  render(<TaskCard />);
  await flush();
  const row = screen.getByLabelText('Open Write the report; hold to focus on it');
  fireEvent.pointerDown(row, { clientX: 100, clientY: 30 });
  fireEvent.pointerMove(row, { clientX: 110, clientY: 34 });
  await flush(200);
  fireEvent.pointerMove(row, { clientX: 113, clientY: 30 });
  await flush(1000);
  expect(useFocusStore.getState().state.status).toBe('idle');
  fireEvent.pointerDown(row, { clientX: 100, clientY: 30 });
  fireEvent.pointerMove(row, { clientX: 108, clientY: 36 });
  await flush(500);
  expect(useFocusStore.getState().state.status).toBe('running');
});

it('pointercancel cancels the hold', async () => {
  setList(() => [task('a', 'Write the report')]);
  render(<TaskCard />);
  await flush();
  const row = screen.getByLabelText('Open Write the report; hold to focus on it');
  fireEvent.pointerDown(row, { clientX: 100, clientY: 30 });
  await flush(300);
  fireEvent.pointerCancel(row);
  await flush(1000);
  expect(useFocusStore.getState().state.status).toBe('idle');
});

it('treats a summary with no next list as a failed read, not as nothing due', async () => {
  mocks.set('wall2_tasks_summary', () => ({ remaining: 0 }));
  render(<TaskCard />);
  await flush();
  expect(screen.getByText('Tasks unavailable')).toBeTruthy();
  expect(screen.queryByText('Nothing due today')).toBeNull();
});

it('reads the due-today tasks without the home tag, shows estimates, and has no "more can wait" line', async () => {
  setList(() => [task('a', 'First', '45'), task('b', 'Second', '60plus'), task('c', 'Third')], 9);
  const r = render(<TaskCard />);
  await flush();
  expect(summaryArgs[0]).toEqual({ notTag: 'home', due: 'today', limit: 60 });
  expect([...r.container.querySelectorAll('.est')].map((e) => e.textContent)).toEqual(['45 m', '60+ m']);
  expect(screen.queryByText(/more can wait/)).toBeNull();
  // The heading counts every row the read reported: the three shown and nine beyond them.
  expect(screen.getByText('Due today')).toBeTruthy();
  expect(screen.getByText('12')).toBeTruthy();
});

it('says how many of the due tasks are overdue, and puts the count where "more can wait" was', async () => {
  const overdue = { ...task('o', 'Late one'), due_at: '2026-11-09', due_is_all_day: true };
  setList(() => [overdue, task('b', 'Today one'), { ...overdue, id: 'p', title: 'Late two' }]);
  render(<TaskCard />);
  await flush();
  expect(screen.getByText('3, 2 overdue')).toBeTruthy();
});

it('with nothing due today the block reads Next up, with the next three and a dim line', async () => {
  mocks.set('wall2_tasks_summary', async (args) => {
    summaryArgs.push(args);
    return args?.due
      ? { next: [], remaining: 0, dueTomorrow: { count: 0, estMinutes: 0 }, dueToday: 0 }
      : { next: [task('n1', 'Later one'), task('n2', 'Later two')], remaining: 40, dueTomorrow: { count: 0, estMinutes: 0 } };
  });
  render(<TaskCard />);
  await flush();
  expect(summaryArgs).toEqual([{ notTag: 'home', due: 'today', limit: 60 }, { notTag: 'home' }]);
  expect(screen.getByText('Next up')).toBeTruthy();
  expect(screen.queryByText('Due today')).toBeNull();
  expect(screen.getByText('Nothing due today')).toBeTruthy();
  expect(screen.getByText('Later one')).toBeTruthy();
  expect(screen.queryByText(/more can wait/)).toBeNull();
});

it('Next up with no tasks at all reads Due today with Nothing due', async () => {
  mocks.set('wall2_tasks_summary', async () => ({ next: [], remaining: 0, dueTomorrow: { count: 0, estMinutes: 0 } }));
  render(<TaskCard />);
  await flush();
  expect(screen.getByText('Due today')).toBeTruthy();
  expect(screen.getByText('Nothing due today')).toBeTruthy();
});

it('the list scrolls only with more than three rows, and the arrow keys and Page keys move it by rows', async () => {
  const many = Array.from({ length: 12 }, (_, i) => task(`r${i}`, `Row ${i}`));
  mocks.set('wall2_tasks_summary', async () => ({ next: many, remaining: 0, dueTomorrow: { count: 0, estMinutes: 0 }, dueToday: 12 }));
  const r = render(<TaskCard />);
  await flush();
  const list = r.container.querySelector('.tasks-list') as HTMLUListElement;
  expect(list.classList.contains('scrolls')).toBe(true);
  expect(r.container.querySelectorAll('.tk3').length).toBe(12);
  // jsdom has no layout: 12 rows of 71 px in a 213 px view.
  Object.defineProperty(list, 'clientHeight', { value: 213, configurable: true });
  Object.defineProperty(list, 'scrollHeight', { value: 852, configurable: true });
  fireEvent.keyDown(list, { key: 'ArrowDown' });
  expect(list.scrollTop).toBe(71);
  fireEvent.keyDown(list, { key: 'PageDown' });
  expect(list.scrollTop).toBe(71 + 213);
  fireEvent.keyDown(list, { key: 'ArrowUp' });
  expect(list.scrollTop).toBe(71 + 213 - 71);
  fireEvent.keyDown(list, { key: 'a' });
  expect(list.scrollTop).toBe(71 + 213 - 71);
  // Never past the ends.
  fireEvent.keyDown(list, { key: 'PageUp' });
  fireEvent.keyDown(list, { key: 'PageUp' });
  expect(list.scrollTop).toBe(0);
  for (let i = 0; i < 12; i++) fireEvent.keyDown(list, { key: 'PageDown' });
  expect(list.scrollTop).toBe(852 - 213);
});

it('a held arrow key adds to where the last step is heading, not to a half-finished smooth scroll', async () => {
  const many = Array.from({ length: 12 }, (_, i) => task(`r${i}`, `Row ${i}`));
  mocks.set('wall2_tasks_summary', async () => ({ next: many, remaining: 0, dueTomorrow: { count: 0, estMinutes: 0 }, dueToday: 12 }));
  const r = render(<TaskCard />);
  await flush();
  const list = r.container.querySelector('.tasks-list') as HTMLUListElement;
  Object.defineProperty(list, 'clientHeight', { value: 213, configurable: true });
  Object.defineProperty(list, 'scrollHeight', { value: 852, configurable: true });
  // A smooth scroll that has not moved yet: scrollTop stays 0 while the key repeats.
  const targets: number[] = [];
  (list as unknown as { scrollTo: (o: { top: number; behavior: string }) => void }).scrollTo = (o) => {
    targets.push(o.top);
    expect(o.behavior).toBe('smooth');
  };
  for (let i = 0; i < 4; i++) fireEvent.keyDown(list, { key: 'ArrowDown' });
  expect(targets).toEqual([71, 142, 213, 284]);
  expect(list.scrollTop).toBe(0);
});

it('three rows or fewer do not scroll', async () => {
  setList(() => [task('a', 'One'), task('b', 'Two'), task('c', 'Three')]);
  const r = render(<TaskCard />);
  await flush();
  expect(r.container.querySelector('.tasks-list')?.classList.contains('scrolls')).toBe(false);
});

it('ticking the first row in view while scrolled does not jump the list: the same place, the next row slides in', async () => {
  const many = Array.from({ length: 10 }, (_, i) => task(`r${i}`, `Row ${i}`));
  let list = many;
  mocks.set('wall2_tasks_summary', async () => ({ next: list, remaining: 0, dueTomorrow: { count: 0, estMinutes: 0 }, dueToday: list.length }));
  mocks.set('wall2_task_done', (args) => {
    list = list.filter((t) => t.id !== args?.id);
  });
  const r = render(<TaskCard />);
  await flush();
  const el = r.container.querySelector('.tasks-list') as HTMLUListElement;
  // jsdom has no layout: a row's box is its place in the list times 71 px.
  const pos = (li: Element) => [...(li.parentElement?.children ?? [])].indexOf(li);
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('tk3') ? pos(this) * 71 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('tk3') ? 71 : 0;
  });
  el.scrollTop = 142;
  fireEvent.scroll(el);
  const firstInView = () => [...el.children].find((li) => (li as HTMLElement).offsetTop + 71 > el.scrollTop + 1) as HTMLElement;
  expect(firstInView().dataset.task).toBe('r2');
  // Tick the first row in view (row 2), let it save and fade out.
  fireEvent.click(screen.getByLabelText('Mark done: Row 2'));
  await flush(TICK_UNDO_MS);
  await flush(2100);
  expect(screen.queryByText('Row 2')).toBeNull();
  // The list did not jump: the offset is the same, and the next row now fills the first place in view.
  expect(el.scrollTop).toBe(142);
  expect(firstInView().dataset.task).toBe('r3');
  expect(firstInView().offsetTop - el.scrollTop).toBe(0);
  // The correction a refresh makes is instant, never smooth (the style is put back after it).
  expect(el.style.scrollBehavior).toBe('');
});

it('a refresh that adds a row above the view keeps the rows in view where they were, instantly', async () => {
  let list = Array.from({ length: 10 }, (_, i) => task(`r${i}`, `Row ${i}`));
  mocks.set('wall2_tasks_summary', async () => ({ next: list, remaining: 0, dueTomorrow: { count: 0, estMinutes: 0 }, dueToday: list.length }));
  const r = render(<TaskCard />);
  await flush();
  const el = r.container.querySelector('.tasks-list') as HTMLUListElement;
  const pos = (li: Element) => [...(li.parentElement?.children ?? [])].indexOf(li);
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('tk3') ? pos(this) * 71 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('tk3') ? 71 : 0;
  });
  el.scrollTop = 142;
  fireEvent.scroll(el);
  list = [task('new', 'New overdue'), ...list];
  await flush(120_000);
  const first = [...el.children].find((li) => (li as HTMLElement).dataset.task === 'r2') as HTMLElement;
  expect(first.offsetTop - el.scrollTop).toBe(0);
  expect(el.style.scrollBehavior).toBe('');
});

it('a refresh in the middle of a key scroll carries the scroll on to the moved target, smoothly', async () => {
  let list = Array.from({ length: 10 }, (_, i) => task(`r${i}`, `Row ${i}`));
  mocks.set('wall2_tasks_summary', async () => ({ next: list, remaining: 0, dueTomorrow: { count: 0, estMinutes: 0 }, dueToday: list.length }));
  const r = render(<TaskCard />);
  await flush();
  const el = r.container.querySelector('.tasks-list') as HTMLUListElement;
  const pos = (li: Element) => [...(li.parentElement?.children ?? [])].indexOf(li);
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('tk3') ? pos(this) * 71 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('tk3') ? 71 : 0;
  });
  Object.defineProperty(el, 'clientHeight', { value: 213, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true });
  const calls: { top: number; behavior: string }[] = [];
  (el as unknown as { scrollTo: (o: { top: number; behavior: string }) => void }).scrollTo = (o) => calls.push(o);
  el.scrollTop = 142;
  fireEvent.scroll(el);
  await flush(REFRESH_MS - 100);
  fireEvent.keyDown(el, { key: 'ArrowDown' });
  expect(calls).toEqual([{ top: 213, behavior: 'smooth' }]);
  // A refresh puts a row above the view while the smooth scroll is on its way.
  list = [task('new', 'New overdue'), ...list];
  await flush(150);
  expect(calls).toEqual([{ top: 213, behavior: 'smooth' }, { top: 284, behavior: 'smooth' }]);
  expect(el.style.scrollBehavior).toBe('');
});

it('an overdue row has one amber mark in its own slot, with how late it is on hover; no other row has anything there', async () => {
  const late = { ...task('o', 'Late one', '30'), due_at: '2026-11-09', due_is_all_day: true };
  const yesterday = { ...task('y', 'Yesterday one', null), due_at: '2026-11-10', due_is_all_day: true };
  const today = { ...task('t', 'Today one', '15'), due_at: '2026-11-11', due_is_all_day: true };
  mocks.set('wall2_tasks_summary', async () => ({ next: [late, yesterday, today, task('n', 'No date')], remaining: 0, dueTomorrow: { count: 0, estMinutes: 0 } }));
  const r = render(<TaskCard />);
  await flush();
  const rows = [...r.container.querySelectorAll('.tk3')];
  // Every row keeps the slot, so the tags and the time column line up; only the overdue rows fill it.
  expect(rows.map((row) => row.querySelectorAll('.od-slot').length)).toEqual([1, 1, 1, 1]);
  expect(rows.map((row) => row.querySelectorAll('.od-slot .od-mark').length)).toEqual([1, 1, 0, 0]);
  expect(rows[0]!.querySelector('.od-mark')?.getAttribute('aria-label')).toBe('Due Monday, 2 days ago');
  expect(rows[1]!.querySelector('.od-mark')?.getAttribute('aria-label')).toBe('Due yesterday');
  expect(rows[0]!.querySelector('.od-mark svg')?.getAttribute('class')).toContain('tabler-icon-clock-exclamation');
  expect(rows[0]!.querySelector('.od-mark svg')?.getAttribute('width')).toBe('18');
  // The slot sits between the title and tags and the time column.
  const kids = [...rows[0]!.querySelector('.tk-main')!.children].map((c) => c.className.split(' ')[0]);
  expect(kids.slice(-2)).toEqual(['od-slot', 'chip-col']);
  expect(screen.getByText('4, 2 overdue')).toBeTruthy();
});

it('shows each row\'s tags: the first as a named chip, the rest as dots, with the tag name on hover', async () => {
  const tagged = {
    ...task('a', 'Fix the garage door'),
    tags: [
      { label: 'Repairs', icon: 'tool', color: 'pink' },
      { label: 'Phone Call', icon: 'phone', color: 'blue' },
      { label: 'Misc', icon: null, color: null },
    ],
  };
  setList(() => [tagged, task('b', 'No tags here')]);
  const r = render(<TaskCard />);
  await flush();
  const rows = r.container.querySelectorAll('.tk3');
  expect(rows[0]!.querySelectorAll('.t-chip').length).toBe(0);
  expect(rows[0]!.querySelectorAll('.t-dot').length).toBe(3);
  expect(rows[0]!.querySelectorAll('.t-dot')[0]!.getAttribute('aria-label')).toBe('Repairs');
  expect(rows[0]!.querySelectorAll('.t-dot')[1]!.getAttribute('aria-label')).toBe('Phone Call');
  expect((rows[0]!.querySelector('.t-dot') as HTMLElement).style.getPropertyValue('--c')).toBe('240,138,192');
  // A tag with no colour carries no colour variable (the dim default draws it).
  expect((rows[0]!.querySelectorAll('.t-dot')[2] as HTMLElement).style.getPropertyValue('--c')).toBe('');
  // A row with no tags has nothing extra: just the title and its time column.
  expect(rows[1]!.querySelector('.t-tags')).toBeNull();
  expect(rows[1]!.querySelectorAll('.chip-col').length).toBe(1);
});

it('a tag text is plain text, never markup', async () => {
  const hostile = { label: '<img src=x onerror=alert(1)>', icon: '"><script>x</script>', color: '<b>' };
  setList(() => [{ ...task('a', 'Odd tag'), tags: [hostile] }]);
  const r = render(<TaskCard />);
  await flush();
  expect(r.container.querySelector('img')).toBeNull();
  expect(r.container.querySelector('script')).toBeNull();
  expect(r.container.querySelector('.t-dot')?.getAttribute('aria-label')).toBe('<img src=x onerror=alert(1)>');
});

it('shows a completed task again when a later list has it open (reopened or recurring)', async () => {
  let list = [task('a', 'First')];
  setList(() => list);
  mocks.set('wall2_task_done', () => {
    list = [];
  });
  render(<TaskCard />);
  await flush();
  fireEvent.click(screen.getByLabelText('Mark done: First'));
  // Past the undo window: the tick is now really completed.
  await flush(TICK_UNDO_MS);
  await flush(2100);
  expect(screen.queryByText('First')).toBeNull();
  await flush(0);
  // The list fetched after the save no longer has it; the id is free again.
  list = [task('a', 'First')];
  await flush(120_000);
  const row = screen.getByText('First').closest('li');
  expect(row).toBeTruthy();
  expect(row?.className).not.toContain('done');
});

it('queues one trailing refresh when a refresh is requested during a request', async () => {
  let list = [task('a', 'First'), task('b', 'Second')];
  const waiting: Array<() => void> = [];
  let defer = false;
  const calls = vi.fn();
  setList(() => {
    calls();
    const snapshot = [...list];
    if (!defer) return snapshot;
    return new Promise((resolve) => waiting.push(() => resolve(snapshot)));
  });
  mocks.set('wall2_task_done', (args) => {
    list = list.filter((t) => t.id !== args?.id);
  });
  render(<TaskCard />);
  await flush();
  defer = true;
  fireEvent.click(screen.getByLabelText('Mark done: First'));
  // Past the undo window: the tick is now really completed.
  await flush(TICK_UNDO_MS);
  fireEvent.click(screen.getByLabelText('Mark done: Second'));
  // Past the undo window: the tick is now really completed.
  await flush(TICK_UNDO_MS);
  await flush(2100);
  // The first completion started a refresh; the second one asked while it ran.
  expect(calls).toHaveBeenCalledTimes(2);
  await act(async () => waiting.shift()?.());
  await flush(0);
  expect(calls).toHaveBeenCalledTimes(3);
  await act(async () => waiting.shift()?.());
  await flush(0);
  expect(screen.queryByText('First')).toBeNull();
  expect(screen.queryByText('Second')).toBeNull();
  expect(screen.getByText('Nothing due today')).toBeTruthy();
});

it('a tick waits five seconds with Done and Undo before completing', async () => {
  setList(() => [task('a', 'First'), task('b', 'Second')]);
  const done = vi.fn();
  mocks.set('wall2_task_done', done);
  render(<TaskCard />);
  await flush();
  fireEvent.click(screen.getByLabelText('Mark done: First'));
  const row = screen.getByText('First').closest('li')!;
  expect(row.className).toContain('pending');
  expect(row.textContent).toContain('Done.');
  expect(row.querySelector('.tick-bar')).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Undo: First' })).toBeTruthy();
  // One pending tick per row: the circle is off while it waits.
  expect((screen.getByLabelText('Mark done: First') as HTMLButtonElement).disabled).toBe(true);
  await flush(TICK_UNDO_MS - 100);
  expect(done).not.toHaveBeenCalled();
  await flush(100);
  expect(done).toHaveBeenCalledTimes(1);
  expect(done).toHaveBeenCalledWith({ id: 'a' });
});

it('Undo puts the row back and completes nothing', async () => {
  setList(() => [task('a', 'First')]);
  const done = vi.fn();
  mocks.set('wall2_task_done', done);
  render(<TaskCard />);
  await flush();
  fireEvent.click(screen.getByLabelText('Mark done: First'));
  await flush(3000);
  fireEvent.click(screen.getByRole('button', { name: 'Undo: First' }));
  const row = screen.getByText('First').closest('li')!;
  expect(row.className).not.toContain('pending');
  expect(row.textContent).not.toContain('Done.');
  expect((screen.getByLabelText('Mark done: First') as HTMLButtonElement).disabled).toBe(false);
  await flush(TICK_UNDO_MS * 2);
  expect(done).not.toHaveBeenCalled();
});

it('leaving the place completes a tick still waiting', async () => {
  setList(() => [task('a', 'First')]);
  const done = vi.fn();
  mocks.set('wall2_task_done', done);
  const r = render(<TaskCard />);
  await flush();
  fireEvent.click(screen.getByLabelText('Mark done: First'));
  await flush(1000);
  r.unmount();
  await flush();
  expect(done).toHaveBeenCalledWith({ id: 'a' });
});

it('a failed completion says Could not complete with Retry, and Retry completes again', async () => {
  setList(() => [task('a', 'First')]);
  let fail = true;
  const done = vi.fn(() => (fail ? Promise.reject(new Error('The service answered 500')) : undefined));
  mocks.set('wall2_task_done', done);
  render(<TaskCard />);
  await flush();
  fireEvent.click(screen.getByLabelText('Mark done: First'));
  await flush(TICK_UNDO_MS);
  expect(screen.getByText('Could not complete.')).toBeTruthy();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await flush();
  expect(done).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('Could not complete.')).toBeNull();
});

it('a closing window completes a waiting tick exactly once', async () => {
  setList(() => [task('a', 'First')]);
  const done = vi.fn();
  mocks.set('wall2_task_done', done);
  render(<TaskCard />);
  await flush();
  fireEvent.click(screen.getByLabelText('Mark done: First'));
  await flush(1000);
  window.dispatchEvent(new Event('pagehide'));
  window.dispatchEvent(new Event('beforeunload'));
  await flush(TICK_UNDO_MS * 2);
  expect(done).toHaveBeenCalledTimes(1);
  expect(done).toHaveBeenCalledWith({ id: 'a' });
});

it('the page going hidden (a screen lock) does not cut the undo window short; the tick commits once when it ends, an undone tick never', async () => {
  setList(() => [task('a', 'First'), task('b', 'Second')]);
  const done = vi.fn();
  mocks.set('wall2_task_done', done);
  render(<TaskCard />);
  await flush();
  fireEvent.click(screen.getByLabelText('Mark done: First'));
  fireEvent.click(screen.getByLabelText('Mark done: Second'));
  fireEvent.click(screen.getByRole('button', { name: 'Undo: Second' }));
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  try {
    document.dispatchEvent(new Event('visibilitychange'));
    await flush(TICK_UNDO_MS - 1000);
    expect(done).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Undo: First' })).toBeTruthy();
    await flush(TICK_UNDO_MS);
  } finally {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  }
  expect(done).toHaveBeenCalledTimes(1);
  expect(done).toHaveBeenCalledWith({ id: 'a' });
});

it('the tags card opens when the row\'s main button takes keyboard focus, with no extra tab stop', async () => {
  resetTip();
  const tags = [{ label: 'Repairs', icon: 'tool', color: 'pink' }, { label: 'Garden', icon: 'plant-2', color: 'green' }];
  setList(() => [{ ...task('a', 'Water the plants'), tags }]);
  const { container } = render(
    <>
      <TaskCard />
      <HoverTipLayer />
    </>,
  );
  await flush();
  const main = container.querySelector('.tk-main') as HTMLElement;
  expect(container.querySelector('.t-tags')?.hasAttribute('tabindex')).toBe(false);
  expect(container.querySelectorAll('.tk3 [tabindex]')).toHaveLength(0);
  expect(document.querySelector('.t-tip')).toBeNull();
  act(() => main.focus());
  await flush(10);
  expect([...document.querySelectorAll('.t-tip-name')].map((e) => e.textContent)).toEqual(['Repairs', 'Garden']);
  act(() => main.blur());
  await flush(10);
  expect(document.querySelector('.t-tip')).toBeNull();
});

const lateRow = (id: string, title: string): TaskItem => ({ ...task(id, title), due_at: '2026-11-09', due_is_all_day: true });
const timedRow = (id: string, title: string, hour: number): TaskItem => ({ ...task(id, title), due_at: new Date(2026, 10, 11, hour, 0).toISOString() });
const MIX = () => [lateRow('o', 'Late one'), task('b', 'Bare one'), timedRow('l', 'Later one', 15)];

it('the Later today switch is off by default: later timed rows hide, every other row shows', async () => {
  setList(MIX);
  render(<TaskCard />);
  await flush();
  const sw = screen.getByRole('switch', { name: /later today/i });
  expect(sw.getAttribute('aria-checked')).toBe('false');
  expect(screen.getByText('Late one')).toBeTruthy();
  expect(screen.getByText('Bare one')).toBeTruthy();
  expect(screen.queryByText('Later one')).toBeNull();
  expect(screen.getByText('2, 1 overdue \u00b7 1 later')).toBeTruthy();
});

it('a timed row earlier today always shows', async () => {
  setList(() => [timedRow('e', 'Earlier one', 9), timedRow('l', 'Later one', 15)]);
  render(<TaskCard />);
  await flush();
  expect(screen.getByText('Earlier one')).toBeTruthy();
  expect(screen.queryByText('Later one')).toBeNull();
});

it('turning Later today on shows the later timed rows', async () => {
  setList(MIX);
  render(<TaskCard />);
  await flush();
  fireEvent.click(screen.getByRole('switch'));
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  expect(screen.getByText('Later one')).toBeTruthy();
  expect(screen.getByText('3, 1 overdue')).toBeTruthy();
  fireEvent.click(screen.getByRole('switch'));
  expect(screen.queryByText('Later one')).toBeNull();
});

it('the switch tip says what it does in each state', async () => {
  resetTip();
  setList(MIX);
  render(
    <>
      <TaskCard />
      <HoverTipLayer />
    </>,
  );
  await flush();
  const sw = screen.getByRole('switch');
  fireEvent.mouseEnter(sw);
  await flush(1500);
  expect(document.querySelector('.hover-tip')?.textContent ?? '').toContain('Hiding tasks due later today. Click to show them.');
  fireEvent.mouseLeave(sw);
  fireEvent.click(sw);
  fireEvent.mouseEnter(screen.getByRole('switch'));
  await flush(1500);
  expect(document.querySelector('.hover-tip')?.textContent ?? '').toContain('Showing tasks due later today. Click to hide them.');
});

it('the choice is stored under wall.tasks.showLater and survives a remount', async () => {
  setList(MIX);
  const first = render(<TaskCard />);
  await flush();
  fireEvent.click(screen.getByRole('switch'));
  expect(localStorage.getItem('wall.tasks.showLater')).toBe('1');
  first.unmount();
  render(<TaskCard />);
  await flush();
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  expect(screen.getByText('Later one')).toBeTruthy();
});

it('the old overdue key is ignored', async () => {
  localStorage.setItem('wall.tasks.showOverdue', '0');
  setList(MIX);
  render(<TaskCard />);
  await flush();
  expect(screen.getByText('Late one')).toBeTruthy();
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
});

it('a later row appears once the clock passes its time', async () => {
  setList(() => [timedRow('l', 'Three o\'clock', 15)]);
  render(<TaskCard />);
  await flush();
  expect(screen.queryByText('Three o\'clock')).toBeNull();
  expect(screen.getByText('Nothing due yet. 1 later today')).toBeTruthy();
  await flush(5 * 3_600_000 + 60_000);
  expect(screen.getByText('Three o\'clock')).toBeTruthy();
});

it('only later-today tasks with the switch off: empty text and header hint count them', async () => {
  setList(() => [timedRow('a', 'Three one', 15), timedRow('b', 'Four one', 16)]);
  render(<TaskCard />);
  await flush();
  expect(screen.getByText('Nothing due yet. 2 later today')).toBeTruthy();
  expect(screen.getByText('2 later')).toBeTruthy();
});

it('with the switch on there is no later hint', async () => {
  setList(() => [timedRow('a', 'Three one', 15)]);
  render(<TaskCard />);
  await flush();
  fireEvent.click(screen.getByRole('switch'));
  expect(screen.getByText('Three one')).toBeTruthy();
  expect(screen.queryByText(/later\b(?! today)/)).toBeNull();
  expect(screen.queryByText(/Nothing due yet/)).toBeNull();
});

it('a mix shows the visible count plus how many are held back', async () => {
  setList(() => [timedRow('e', 'Earlier one', 9), timedRow('l', 'Later one', 15), timedRow('m', 'Later two', 17)]);
  render(<TaskCard />);
  await flush();
  expect(screen.getByText('1 \u00b7 2 later')).toBeTruthy();
});

it('the Later today switch still works when storage throws', async () => {
  setList(MIX);
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  render(<TaskCard />);
  await flush();
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
  fireEvent.click(screen.getByRole('switch'));
  expect(screen.getByText('Later one')).toBeTruthy();
  get.mockRestore();
  set.mockRestore();
});

it('a titled card gets no Later today switch', async () => {
  setList(() => [task('b', 'Today one')]);
  render(<TaskCard title="Anything" />);
  await flush();
  expect(screen.queryByRole('switch')).toBeNull();
});

it('Next up mode shows no Later today switch, even with no rows at all', async () => {
  mocks.set('wall2_tasks_summary', async (args) =>
    args?.due
      ? { next: [], remaining: 0, dueTomorrow: { count: 0, estMinutes: 0 }, dueToday: 0 }
      : { next: [], remaining: 0, dueTomorrow: { count: 0, estMinutes: 0 } },
  );
  render(<TaskCard />);
  await flush();
  expect(screen.getByText('Nothing due today')).toBeTruthy();
  expect(screen.queryByRole('switch')).toBeNull();
});
