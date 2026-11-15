import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useRef } from 'react';
import { useRemeasure } from './useRemeasure';

let observers: FakeObserver[] = [];

class FakeObserver {
  cb: ResizeObserverCallback;
  observed: Element[] = [];
  disconnected = false;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
    observers.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  fire(width: number) {
    this.cb([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
}

function Probe({ measure }: { measure: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useRemeasure(ref, measure);
  return <div ref={ref} />;
}

describe('useRemeasure', () => {
  const realRO = globalThis.ResizeObserver;
  const realFonts = Object.getOwnPropertyDescriptor(document, 'fonts');

  beforeEach(() => {
    observers = [];
    (globalThis as { ResizeObserver: unknown }).ResizeObserver = FakeObserver;
  });
  afterEach(() => {
    globalThis.ResizeObserver = realRO;
    if (realFonts) Object.defineProperty(document, 'fonts', realFonts);
    else delete (document as unknown as { fonts?: unknown }).fonts;
  });

  it('measures when the element width changes, not when it stays the same', () => {
    const measure = vi.fn();
    render(<Probe measure={measure} />);
    expect(observers).toHaveLength(1);
    observers[0].fire(300);
    expect(measure).toHaveBeenCalledTimes(1);
    observers[0].fire(300);
    expect(measure).toHaveBeenCalledTimes(1);
    observers[0].fire(320);
    expect(measure).toHaveBeenCalledTimes(2);
  });

  it('measures once when the fonts finish loading', async () => {
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } });
    const measure = vi.fn();
    render(<Probe measure={measure} />);
    await Promise.resolve();
    await Promise.resolve();
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it('disconnects on unmount and ignores a late font load', async () => {
    let resolve: () => void = () => undefined;
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: new Promise<void>((r) => (resolve = r)) } });
    const measure = vi.fn();
    const { unmount } = render(<Probe measure={measure} />);
    unmount();
    expect(observers[0].disconnected).toBe(true);
    resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(measure).not.toHaveBeenCalled();
  });

  it('uses the latest measure function', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Probe measure={first} />);
    rerender(<Probe measure={second} />);
    observers[0].fire(100);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
