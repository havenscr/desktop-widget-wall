import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
// @ts-ignore node's own file call; the stylesheet rules are read as text.
import { readFileSync } from 'node:fs';
import watchCard from './watch/WatchCard.tsx?raw';
import watchSrc from './watch/Watch.tsx?raw';
import playerSrc from './Player.tsx?raw';
import { FitTitle, fitSizes, linesAllowed } from '../ui/FitTitle';
import { spillTitles, agentsLineWidth, textWidth, CORNER_LEFT, SPILL_GAP, type Chip } from '../ribbon/model';

const read = (f: string): string => readFileSync(`src/styles/${f}`, 'utf8') as string;
const unwindCss = read('unwind.css');
const workCss = read('unwind-work.css');
const ribbonCss = read('ribbon.css');
const norm = (s: string) => s.replace(/\r\n/g, '\n');
const rule = (css: string, sel: string): string => {
  const text = norm(css);
  const at = text.indexOf(`\n${sel} {`);
  if (at < 0) throw new Error(`no rule for ${sel}`);
  return text.slice(at, text.indexOf('}', at));
};

describe('labels show in full', () => {
  it('the title steps down but never below 16 px, and never clamps', () => {
    expect(Math.min(...fitSizes(48))).toBe(16);
    expect(Math.min(...fitSizes(64))).toBe(16);
    expect(linesAllowed(48, 48, 2)).toBe(2);
    expect(linesAllowed(34, 48, 2)).toBe(3);
    const title = rule(unwindCss, '.w-title');
    expect(title).not.toContain('line-clamp');
    expect(title).not.toContain('overflow: hidden');
    const np = rule(unwindCss, '.u-np');
    expect(np).not.toContain('nowrap');
    expect(np).toContain('overflow-wrap: anywhere');
  });

  it('a long title renders whole in the title box', () => {
    const long = '1994 PURPLE CHROME ENGINE | Synthwave Retro Mix for long drives';
    const r = render(
      <FitTitle top={48} firstLines={2} lh={1.1} className="w-title">
        {long}
      </FitTitle>,
    );
    expect(r.container.querySelector('.w-title')!.textContent).toBe(long);
  });

  it('steps the size down until the lines fit, and stops at 16 px', () => {
    // 40 px per 16 px line of 1.1: the box is as tall as its lines at whatever size is set.
    const spy = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      const size = parseFloat(this.style.fontSize) || 48;
      const linesAt = Math.ceil((size * 40) / 48 / 6);
      return Math.round(linesAt * size * 1.1);
    });
    try {
      const r = render(
        <FitTitle top={48} firstLines={2} lh={1.1} className="w-title">
          {'A title long enough to need more lines than the biggest size allows'}
        </FitTitle>,
      );
      const px = parseFloat((r.container.querySelector('.w-title') as HTMLElement).style.fontSize);
      expect(px).toBeLessThan(48);
      expect(px).toBeGreaterThanOrEqual(16);
    } finally {
      spy.mockRestore();
    }
  });

  it('a selector that is not in the stylesheet throws', () => {
    expect(() => rule(unwindCss, '.no-such-rule')).toThrow();
  });

  it('the Watch and Listen titles use the fitting title, not an ellipsis row', () => {
    expect(norm(watchSrc)).toContain('<FitTitle');
    expect(norm(playerSrc)).not.toMatch(/className="u-np[^"]*u-ell/);
    expect(norm(playerSrc)).not.toMatch(/className=\{`u-np u-ell/);
  });

  it('Watch list names wrap instead of an ellipsis', () => {
    expect(norm(watchCard)).not.toContain('w-label u-ell');
    expect(rule(unwindCss, '.w-label')).toContain('overflow-wrap: anywhere');
  });

  it('the Next up title wraps and is fitted, not cut', () => {
    const t = rule(workCss, '.u-nu-title');
    expect(t).not.toContain('nowrap');
    expect(t).not.toContain('ellipsis');
    expect(norm(readFileSync('src/unwind/work/NextUp.tsx', 'utf8') as string)).toContain('<FitTitle');
  });

  it('a chip carries its name past its edge, and the second row is 16 px', () => {
    expect(rule(ribbonCss, '.rib .ev.spill')).toContain('overflow: visible');
    expect(Number(/font: 400 (\d+)px/.exec(rule(ribbonCss, '.rib .ev-row'))![1])).toBeGreaterThanOrEqual(16);
  });
});

const chip = (key: string, x: number, width: number, title: string): Chip =>
  ({ key, title, x, width, state: 'next', live: false, lane: 0, lanes: 1, narrow: false, beside: null, start: 0, end: 0, accountId: null, canOpen: false, category: null }) as Chip;

describe('chip titles that do not fit', () => {
  it('carry on over empty track', () => {
    const c = chip('a', 400, 100, 'CAA AE session with a long name');
    expect(spillTitles([c], [], []).get('a')?.mode).toBe('side');
  });
  it('drop to a second row when the next chip is close', () => {
    const a = chip('a', 400, 100, 'CAA AE session with a long name');
    const b = chip('b', 560, 100, 'Next');
    expect(spillTitles([a, b], [560], []).get('a')?.mode).toBe('row');
  });
  it('stay faded when the second row is taken', () => {
    const a = chip('a', 400, 100, 'CAA AE session with a long name');
    const b = chip('b', 560, 100, 'Next');
    expect(spillTitles([a, b], [560], [{ x: 380, width: 400 }]).has('a')).toBe(false);
  });
  it('a title near the corner button stays short of it', () => {
    const c = chip('a', CORNER_LEFT - 200, 100, 'A long name for a chip near the end of the day');
    const got = spillTitles([c], [], []).get('a');
    expect(got === undefined || got.x + got.width <= CORNER_LEFT - SPILL_GAP).toBe(true);
  });
  it('a title never runs across the needle', () => {
    const c = chip('a', 400, 100, 'CAA AE session with a long name');
    const got = spillTitles([c], [], [], [{ x: 560, width: 12 }]).get('a');
    expect(got).toBeUndefined();
    expect(spillTitles([c], [], [], [{ x: 1500, width: 12 }]).get('a')?.mode).toBe('side');
  });
  it('a title that fits is left alone', () => {
    expect(spillTitles([chip('a', 400, 300, 'Standup')], [], []).size).toBe(0);
  });
});

describe('the agents line width', () => {
  it('follows the words, not a fixed width per character', () => {
    expect(textWidth('iii', 16)).toBeGreaterThan(0);
    expect(agentsLineWidth('1 working')).toBeLessThan(agentsLineWidth('1 needs you, 1 working (1 through helpers)'));
  });
});
