import { act, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HoverTipLayer, pinTip, resetTip, tip, TIP_ANCHOR_CHECK_MS, TIP_DELAY_MS, TIP_MOVE_PX, TIP_REFRESH_MS } from './HoverTip';

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  resetTip();
});
afterEach(() => {
  resetTip();
  vi.useRealTimers();
});

it('hides a card whose anchor leaves the page while hovered', async () => {
  let drop: () => void = () => undefined;
  function Host() {
    const [on, setOn] = useState(true);
    drop = () => setOn(false);
    return (
      <>
        {on && (
          <span className="anchor" {...tip('About this')}>
            x
          </span>
        )}
        <HoverTipLayer />
      </>
    );
  }
  const r = render(<Host />);
  fireEvent.mouseEnter(r.container.querySelector('.anchor')!);
  await flush(TIP_DELAY_MS);
  expect(document.querySelector('.hover-tip')!.textContent).toBe('About this');
  act(() => drop());
  await flush(TIP_ANCHOR_CHECK_MS);
  expect(document.querySelector('.hover-tip')).toBeNull();
});

it('redraws a shown card, so a countdown in it stays right', async () => {
  let n = 0;
  const r = render(
    <>
      <span className="anchor" {...tip(() => `call ${++n}`)}>
        x
      </span>
      <HoverTipLayer />
    </>,
  );
  fireEvent.mouseEnter(r.container.querySelector('.anchor')!);
  await flush(TIP_DELAY_MS);
  const first = document.querySelector('.hover-tip')!.textContent;
  await flush(TIP_REFRESH_MS);
  expect(document.querySelector('.hover-tip')!.textContent).not.toBe(first);
});

it('the focus that follows a click does not reopen the card; keyboard focus does', async () => {
  const r = render(
    <>
      <button type="button" className="anchor" {...tip('About this')}>
        x
      </button>
      <HoverTipLayer />
    </>,
  );
  const a = r.container.querySelector('.anchor')!;
  fireEvent.mouseDown(a);
  fireEvent.focus(a);
  await flush(0);
  expect(document.querySelector('.hover-tip')).toBeNull();
  fireEvent.blur(a);
  await flush(1000);
  fireEvent.focus(a);
  await flush(0);
  expect(document.querySelector('.hover-tip')!.textContent).toBe('About this');
});

it('a pinned card takes the pointer, ignores hovers and closes on a click elsewhere or Escape', async () => {
  const r = render(
    <>
      <span className="anchor">x</span>
      <span className="other" {...tip('Other')}>
        y
      </span>
      <HoverTipLayer />
    </>,
  );
  act(() => pinTip(r.container.querySelector('.anchor')!, 'Pick one'));
  expect(document.querySelector('.hover-tip.pinned')!.textContent).toBe('Pick one');
  fireEvent.mouseEnter(r.container.querySelector('.other')!);
  await flush(TIP_DELAY_MS);
  expect(document.querySelector('.hover-tip')!.textContent).toBe('Pick one');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(document.querySelector('.hover-tip')).toBeNull();
  act(() => pinTip(r.container.querySelector('.anchor')!, 'Pick one'));
  fireEvent.mouseDown(document.body);
  expect(document.querySelector('.hover-tip')).toBeNull();
});

it('pins a side card beside its anchor (right, else left), top aligned, inside the stage', () => {
  const size = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300);
  const tall = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(200);
  try {
    const r = render(
      <>
        <span className="anchor">x</span>
        <HoverTipLayer />
      </>,
    );
    const anchor = r.container.querySelector('.anchor')!;
    const at = (x: number, y: number) => vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({ left: x, top: y, width: 140, height: 170, right: x + 140, bottom: y + 170, x, y, toJSON: () => ({}) } as DOMRect);
    const place = () => {
      const st = (document.querySelector('.hover-tip') as HTMLElement).style;
      return [st.left, st.top, (document.querySelector('.hover-tip') as HTMLElement).dataset.side];
    };
    at(2000, 100);
    act(() => pinTip(anchor, 'Details', { side: true }));
    expect(place()).toEqual(['2154px', '100px', 'right']);
    act(() => resetTip());
    at(2400, 600);
    act(() => pinTip(anchor, 'Details', { side: true }));
    expect(place()).toEqual(['2086px', '508px', 'left']);
    act(() => resetTip());
    at(2000, 100);
    act(() => pinTip(anchor, 'Pick one'));
    expect(place()).toEqual(['1920px', '284px', 'below']);
  } finally {
    size.mockRestore();
    tall.mockRestore();
  }
});

it('sits above its control with a tail pointing at it (below when there is no room), and a scroll takes it down', async () => {
  const r = render(
    <>
      <span className="anchor" {...tip('About this')}>
        x
      </span>
      <HoverTipLayer />
    </>,
  );
  const a = r.container.querySelector('.anchor')!;
  a.getBoundingClientRect = () => ({ left: 400, top: 300, width: 40, height: 30, right: 440, bottom: 330, x: 400, y: 300, toJSON() {} }) as DOMRect;
  fireEvent.mouseEnter(a);
  await flush(TIP_DELAY_MS);
  const card = document.querySelector<HTMLElement>('.hover-tip')!;
  expect(card.dataset.side).toBe('above');
  expect(card.style.getPropertyValue('--tail')).toMatch(/px$/);
  expect(card.getAttribute('role')).toBe('tooltip');
  act(() => void window.dispatchEvent(new Event('scroll')));
  expect(document.querySelector('.hover-tip')).toBeNull();
  // Near the top of the stage there is no room above: it goes below.
  a.getBoundingClientRect = () => ({ left: 400, top: 4, width: 40, height: 30, right: 440, bottom: 34, x: 400, y: 4, toJSON() {} }) as DOMRect;
  fireEvent.mouseLeave(a);
  fireEvent.mouseEnter(a);
  await flush(TIP_DELAY_MS);
  expect(document.querySelector<HTMLElement>('.hover-tip')!.dataset.side).toBe('below');
});

it('goes when its anchor moves more than a few pixels (Watt walking on), and stays while it holds still', async () => {
  const r = render(
    <>
      <span className="anchor" {...tip('About him')}>
        x
      </span>
      <HoverTipLayer />
    </>,
  );
  const a = r.container.querySelector('.anchor')!;
  let left = 400;
  a.getBoundingClientRect = () => ({ left, top: 300, width: 40, height: 30, right: left + 40, bottom: 330, x: left, y: 300, toJSON() {} }) as DOMRect;
  fireEvent.mouseEnter(a);
  await flush(TIP_DELAY_MS);
  expect(document.querySelector('.hover-tip')).not.toBeNull();
  left += TIP_MOVE_PX - 1;
  await flush(TIP_ANCHOR_CHECK_MS);
  expect(document.querySelector('.hover-tip')).not.toBeNull();
  left += 20;
  await flush(TIP_ANCHOR_CHECK_MS);
  expect(document.querySelector('.hover-tip')).toBeNull();
});

it('the default placement is centred over the control and clamped 12 px from the edge; align start lines the left edges up', async () => {
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: function (this: HTMLElement) { return this.classList.contains('hover-tip') ? 300 : 0; } });
  try {
    const box = (left: number) => ({ left, top: 400, width: 70, height: 36, right: left + 70, bottom: 436, x: left, y: 400, toJSON() {} }) as DOMRect;
    const r = render(
      <>
        <span className="centred" {...tip('Centred')}>x</span>
        <span className="started" {...tip('Started', { align: 'start' })}>x</span>
        <HoverTipLayer />
      </>,
    );
    const open = async (cls: string, left: number) => {
      const el = r.container.querySelector(`.${cls}`)!;
      el.getBoundingClientRect = () => box(left);
      fireEvent.mouseEnter(el);
      await flush(TIP_DELAY_MS);
      const card = document.querySelector<HTMLElement>('.hover-tip')!;
      const at = Number.parseFloat(card.style.left);
      fireEvent.mouseLeave(el);
      return at;
    };
    // Default: centred (1000 + 35 - 150), and held 12 px from the left edge for a control at x 124.
    expect(await open('centred', 1000)).toBe(885);
    expect(await open('centred', 124)).toBe(12);
    // Start: the card's left edge is the control's, and the 12 px clamp still holds at the stage's right edge.
    expect(await open('started', 124)).toBe(124);
    expect(await open('started', 2500)).toBe(2560 - 12 - 300);
  } finally {
    if (width) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', width);
  }
});
