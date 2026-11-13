import { expect, it, vi } from 'vitest';
import { isTopWindow, startIfTop } from './topWindow';

it('starts the wall only as the top window', () => {
  const top = {} as Window;
  const me = { self: top, top } as unknown as Window;
  (me as unknown as { self: unknown }).self = me;
  (me as unknown as { top: unknown }).top = me;
  const boot = vi.fn();
  expect(isTopWindow(me)).toBe(true);
  expect(startIfTop(me, boot)).toBe(true);
  expect(boot).toHaveBeenCalledTimes(1);
});

it('refuses to start inside a frame, or when the top window cannot be read', () => {
  const framed = { self: {}, top: {} } as unknown as Window;
  const boot = vi.fn();
  expect(isTopWindow(framed)).toBe(false);
  expect(startIfTop(framed, boot)).toBe(false);
  const throwing = {
    self: {},
    get top(): Window {
      throw new Error('blocked');
    },
  } as unknown as Window;
  expect(startIfTop(throwing, boot)).toBe(false);
  expect(boot).not.toHaveBeenCalled();
});

it('is the top window in the test page', () => {
  expect(isTopWindow()).toBe(true);
});

// The policies' `frame-ancestors 'none'` and two-host `frame-src` are checked by the Rust test
// `wall2_watch::tests::wall2_policies_refuse_framing` (the web tests cannot read outside `wall/`).
