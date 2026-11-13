import { act, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HoverTipLayer, pinTip, resetTip, tip, TIP_ANCHOR_CHECK_MS, TIP_DELAY_MS, TIP_REFRESH_MS } from './HoverTip';

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
