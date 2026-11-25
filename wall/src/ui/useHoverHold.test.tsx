import { useState } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHoverHold } from './useHoverHold';

function Probe({ enabled = true, openMs = 0, closeMs = 1500 }: { enabled?: boolean; openMs?: number; closeMs?: number }) {
  const h = useHoverHold(null, { openMs, closeMs, enabled });
  return (
    <div data-testid="z" data-on={h.active ? 'y' : 'n'} {...h.handlers}>
      <button type="button">b</button>
    </div>
  );
}
function Boxed() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const h = useHoverHold(el, { openMs: 0, closeMs: 1500, enabled: true });
  return (
    <div ref={setEl} data-testid="z" data-on={h.active ? 'y' : 'n'} {...h.handlers}>
      <button type="button">tab</button>
    </div>
  );
}
const on = (r: ReturnType<typeof render>) => r.getByTestId('z').getAttribute('data-on');
const flush = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useHoverHold', () => {
  it('shows at once on pointer enter and hides closeMs after it leaves', async () => {
    const r = render(<Probe />);
    expect(on(r)).toBe('n');
    fireEvent.pointerEnter(r.getByTestId('z'));
    expect(on(r)).toBe('y');
    fireEvent.pointerLeave(r.getByTestId('z'));
    await flush(1400);
    expect(on(r)).toBe('y');
    await flush(150);
    expect(on(r)).toBe('n');
  });
  it('coming back inside cancels the hide', async () => {
    const r = render(<Probe />);
    fireEvent.pointerEnter(r.getByTestId('z'));
    fireEvent.pointerLeave(r.getByTestId('z'));
    await flush(1000);
    fireEvent.pointerEnter(r.getByTestId('z'));
    await flush(2000);
    expect(on(r)).toBe('y');
  });
  it('waits openMs when asked to', async () => {
    const r = render(<Probe openMs={750} />);
    fireEvent.pointerEnter(r.getByTestId('z'));
    await flush(700);
    expect(on(r)).toBe('n');
    await flush(100);
    expect(on(r)).toBe('y');
  });
  it('stays off and clears when disabled', async () => {
    const r = render(<Probe />);
    fireEvent.pointerEnter(r.getByTestId('z'));
    r.rerender(<Probe enabled={false} />);
    expect(on(r)).toBe('n');
  });
  it('a mouse click leaves focus on a button inside, and the layer still hides after the pointer leaves', async () => {
    const real = Element.prototype.matches;
    // A mouse click's focus is not :focus-visible.
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, q: string) {
      return q === ':focus-visible' ? false : real.call(this, q);
    });
    const r = render(<Boxed />);
    fireEvent.pointerEnter(r.getByTestId('z'));
    const b = r.getByText('tab');
    act(() => b.focus());
    expect(document.activeElement).toBe(b);
    fireEvent.pointerLeave(r.getByTestId('z'));
    await flush(1600);
    expect(on(r)).toBe('n');
    vi.restoreAllMocks();
  });
  it('keyboard focus inside still holds it open after the pointer leaves', async () => {
    const real = Element.prototype.matches;
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, q: string) {
      return q === ':focus-visible' ? true : real.call(this, q);
    });
    const r = render(<Boxed />);
    fireEvent.pointerEnter(r.getByTestId('z'));
    act(() => r.getByText('tab').focus());
    fireEvent.pointerLeave(r.getByTestId('z'));
    await flush(3000);
    expect(on(r)).toBe('y');
    vi.restoreAllMocks();
  });
});
