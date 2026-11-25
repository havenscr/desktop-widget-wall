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
});
