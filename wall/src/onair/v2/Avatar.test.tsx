import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { Avatar, avatarTile } from './Comments';

afterEach(cleanup);

const A = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
const B = 'data:image/gif;base64,R0lGODlhAQABAAAAACx=';
const img = (c: HTMLElement) => c.querySelector('img') as HTMLImageElement;

it('a new address after a load starts waiting, then loads', () => {
  const { container, rerender } = render(<Avatar name="Zed" src={A} />);
  fireEvent.load(img(container));
  expect(img(container).getAttribute('data-loaded')).toBe('true');
  rerender(<Avatar name="Zed" src={B} />);
  expect(img(container).getAttribute('src')).toBe(B);
  expect(img(container).getAttribute('data-loaded')).toBe('false');
  fireEvent.load(img(container));
  expect(img(container).getAttribute('data-loaded')).toBe('true');
});

it('a new address after an error shows the image again', () => {
  const { container, rerender } = render(<Avatar name="Zed" src={A} />);
  fireEvent.error(img(container));
  expect(img(container)).toBeNull();
  expect(container.querySelector('.oa2-cm-tile')).not.toBeNull();
  rerender(<Avatar name="Zed" src={B} />);
  expect(img(container).getAttribute('src')).toBe(B);
  expect(img(container).getAttribute('data-loaded')).toBe('false');
});

it('a complete cached image is shown without waiting for a load event', () => {
  const complete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete');
  const width = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth');
  Object.defineProperty(HTMLImageElement.prototype, 'complete', { configurable: true, get: () => true });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => 40 });
  try {
    const { container } = render(<Avatar name="Zed" src={A} />);
    expect(img(container).getAttribute('data-loaded')).toBe('true');
  } finally {
    if (complete) Object.defineProperty(HTMLImageElement.prototype, 'complete', complete); else delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).complete;
    if (width) Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', width); else delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).naturalWidth;
  }
});

it('picks whole graphemes for the tile letter', () => {
  expect(avatarTile('\u{1F468}‍\u{1F469}‍\u{1F467} Fam').letter).toBe('F');
  expect(avatarTile('\u{1F468}‍\u{1F469}‍\u{1F467}').letter).toBe('\u{1F468}‍\u{1F469}‍\u{1F467}');
  expect(avatarTile('\u{1F1E8}\u{1F1E6}').letter).toBe('\u{1F1E8}\u{1F1E6}');
  expect(avatarTile('\u{1F1E8}\u{1F1E6}maple').letter).toBe('M');
  expect(avatarTile('@дом').letter).toBe('Д');
  expect(avatarTile('@').letter).toBe('?');
});
