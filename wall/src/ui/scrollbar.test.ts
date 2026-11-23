// @ts-ignore node's own file calls; the stylesheet is read as text.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installScrollReveal, SCROLL_REVEAL_MS, scrollerAt } from './scrollbar';

let off: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="a"></div><div id="b"></div>';
  off = installScrollReveal();
});
afterEach(() => {
  off();
  vi.useRealTimers();
});

it('marks a list that scrolls and clears the mark SCROLL_REVEAL_MS after the last scroll', () => {
  const a = document.getElementById('a')!;
  a.dispatchEvent(new Event('scroll'));
  expect(a.hasAttribute('data-sb-live')).toBe(true);
  vi.advanceTimersByTime(SCROLL_REVEAL_MS - 100);
  a.dispatchEvent(new Event('scroll'));
  vi.advanceTimersByTime(SCROLL_REVEAL_MS - 100);
  expect(a.hasAttribute('data-sb-live')).toBe(true);
  vi.advanceTimersByTime(200);
  expect(a.hasAttribute('data-sb-live')).toBe(false);
});

it('marks only the list that scrolled', () => {
  document.getElementById('a')!.dispatchEvent(new Event('scroll'));
  expect(document.getElementById('b')!.hasAttribute('data-sb-live')).toBe(false);
});

it('stops and clears everything when removed', () => {
  const a = document.getElementById('a')!;
  a.dispatchEvent(new Event('scroll'));
  off();
  expect(a.hasAttribute('data-sb-live')).toBe(false);
  a.dispatchEvent(new Event('scroll'));
  expect(a.hasAttribute('data-sb-live')).toBe(false);
  off = installScrollReveal();
});

it('touches the attribute and the timer only as needed: a scroll burst sets the mark once', () => {
  const a = document.getElementById('a')!;
  const set = vi.spyOn(a, 'setAttribute');
  for (let i = 0; i < 20; i++) a.dispatchEvent(new Event('scroll'));
  expect(set).toHaveBeenCalledTimes(1);
});

it('marks only the innermost scrolling list under the pointer, and clears when the pointer leaves the window', () => {
  document.body.innerHTML = '<div id="outer"><div id="inner"><span id="leaf"></span></div></div>';
  const scrolls = (id: string) => {
    const el = document.getElementById(id)!;
    Object.defineProperty(el, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true });
    el.style.overflowY = 'auto';
  };
  scrolls('outer');
  scrolls('inner');
  const leaf = document.getElementById('leaf')!;
  leaf.dispatchEvent(new Event('pointerover', { bubbles: true }));
  expect(document.getElementById('inner')!.hasAttribute('data-sb-hover')).toBe(true);
  expect(document.getElementById('outer')!.hasAttribute('data-sb-hover')).toBe(false);
  expect(scrollerAt(leaf, document)).toBe(document.getElementById('inner'));
  leaf.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: null }));
  expect(document.getElementById('inner')!.hasAttribute('data-sb-hover')).toBe(false);
});

// The CSS is read as text: jsdom has no scrollbar. Needles are built so this file does not hold them verbatim.
const css = readFileSync('src/ui/scrollbar.css', 'utf8').replace(/\r\n/g, '\n');
const block = (selector: string) => new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';

it('fades on the scrolling element, never as a transition on a scrollbar part (Chromium ignores those)', () => {
  expect(block(':where(*)')).toContain(['transition', '--sb-a'].join(': '));
  for (const part of ['', '-track', '-thumb']) expect(block(`::-webkit-scrollbar${part}`)).not.toContain('transition');
  expect(block('::-webkit-scrollbar-thumb')).toContain('var(--sb-a)');
});

it('holds once: the delay in CSS plus the script settle is 1 s', () => {
  const delay = /ease (\d?\.?\d+)s;/.exec(block(':where(*)'))?.[1];
  expect(Number(delay) * 1000 + SCROLL_REVEAL_MS).toBe(1000);
});

it('does not show a bar for focus or for an ancestor of the hovered list', () => {
  expect(css).not.toContain(['focus', 'within'].join('-'));
  expect(css).not.toMatch(/(^|\n):hover/);
});

it('gives a horizontal bar its own size and masks only a list that overflows', () => {
  expect(css).toContain('::-webkit-scrollbar:horizontal {\n  height: 12px;');
  expect(css).toContain('.sb-fade-bottom.over:not(.end) {');
});
