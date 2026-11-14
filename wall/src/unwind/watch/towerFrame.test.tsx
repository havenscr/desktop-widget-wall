import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DriveInFrame } from './DriveInFrame';
import { DRIVE_IN_GROUND, DRIVE_IN_SCREEN } from './looks';
import { MARQUEE, MARQUEE_NAME, MARQUEE_PAUSED, MARQUEE_PLAYING, TOWER_SVG } from './towerFrame';

// The Screen tower frame: nothing of it may paint over the video's box. The painted area is
// worked out from the component's own geometry (the markup `towerFrame.ts` makes), element by
// element: rings must cut the box out exactly, outlines must stay outside it, everything else
// must have a bounding box (stroke included) that does not meet it.

type Box = [number, number, number, number]; // x0, y0, x1, y1
const V = DRIVE_IN_SCREEN;
const BOX: Box = [V.x, V.y, V.x + V.w, V.y + V.h];

/** The bounding box of a path's data (its points; arcs here are quarter circles, so their ends bound them). */
function pathBox(d: string): Box {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let cmd = '';
  const pts: [number, number][] = [];
  let i = 0;
  const num = () => Number(tokens[i++]);
  const add = () => pts.push([x, y]);
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    switch (cmd) {
      case 'M': x = num(); y = num(); sx = x; sy = y; add(); cmd = 'L'; break;
      case 'L': x = num(); y = num(); add(); break;
      case 'l': x += num(); y += num(); add(); break;
      case 'H': x = num(); add(); break;
      case 'h': x += num(); add(); break;
      case 'V': y = num(); add(); break;
      case 'v': y += num(); add(); break;
      case 'a': i += 5; x += num(); y += num(); add(); break;
      case 'z': case 'Z': x = sx; y = sy; add(); break;
      default: throw new Error(`path command ${cmd} is not handled by the test`);
    }
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const meets = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const contains = (a: Box, b: Box) => a[0] <= b[0] && a[1] <= b[1] && a[2] >= b[2] && a[3] >= b[3];
const same = (a: Box, b: Box) => a.every((v, k) => Math.abs(v - b[k]) < 0.01);

/** True when a path is a ring (even-odd) whose last subpath is exactly the video's box. */
function ringCutsBox(d: string, evenodd: boolean): boolean {
  const subs = d.split(/(?=M)/).filter(Boolean);
  return evenodd && subs.length === 2 && same(pathBox(subs[1]), BOX) && contains(pathBox(subs[0]), BOX);
}

/** Every element of the markup that could paint over the video's box, with why. */
function offenders(markup: string): { count: number; bad: string[] } {
  const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, 'image/svg+xml');
  const bad: string[] = [];
  let count = 0;
  for (const el of doc.querySelectorAll('path, rect, ellipse, circle, line')) {
    if (el.closest('defs')) continue;
    const label = `${el.tagName} ${(el.getAttribute('d') ?? el.outerHTML).slice(0, 60)}`;
    let box: Box;
    if (el.tagName === 'path') box = pathBox(el.getAttribute('d')!);
    else if (el.tagName === 'rect') {
      const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((k) => Number(el.getAttribute(k)));
      box = [x, y, x + w, y + h];
    } else if (el.tagName === 'ellipse') {
      const [cx, cy, rx, ry] = ['cx', 'cy', 'rx', 'ry'].map((k) => Number(el.getAttribute(k)));
      box = [cx - rx, cy - ry, cx + rx, cy + ry];
    } else {
      const [cx, cy, r] = ['cx', 'cy', 'r'].map((k) => Number(el.getAttribute(k)));
      box = [cx - r, cy - r, cx + r, cy + r];
    }
    // The floor mirror: a group flipped at the ground line; its pictures lie below the ground.
    if (el.closest('g[transform*="scale(1 -1)"]')) {
      const m = /translate\(0 ([\d.]+)\)/.exec(el.closest('g[transform*="scale(1 -1)"]')!.getAttribute('transform')!)!;
      box = [box[0], Number(m[1]) - box[3], box[2], Number(m[1]) - box[1]];
    }
    count++;
    const fill = el.getAttribute('fill');
    const sw = Number(el.getAttribute('stroke-width') ?? (el.getAttribute('stroke') ? 1 : 0));
    const clip = el.getAttribute('clip-path');
    if (clip) {
      // A blurred part clipped to a ring with the box cut out.
      const id = /#([\w-]+)/.exec(clip)![1];
      const cp = doc.getElementById(id)!.querySelector('path')!;
      if (!ringCutsBox(cp.getAttribute('d')!, cp.getAttribute('clip-rule') === 'evenodd')) bad.push(`${label}: its clip is not a ring round the box`);
      continue;
    }
    if (fill && fill !== 'none' && el.getAttribute('fill-rule') === 'evenodd') {
      if (!ringCutsBox(el.getAttribute('d')!, true)) bad.push(`${label}: a ring that does not cut the box out`);
      continue;
    }
    if (fill === 'none' && contains(box, BOX)) {
      // An outline round the picture: the inner edge of its stroke must stay outside the box.
      const inner: Box = [box[0] + sw / 2, box[1] + sw / 2, box[2] - sw / 2, box[3] - sw / 2];
      if (!contains(inner, BOX)) bad.push(`${label}: its stroke reaches the picture`);
      continue;
    }
    const grown: Box = [box[0] - sw / 2, box[1] - sw / 2, box[2] + sw / 2, box[3] + sw / 2];
    if (meets(grown, BOX)) bad.push(`${label}: lies over the picture`);
  }
  return { count, bad };
}

afterEach(cleanup);

describe('the drive-in box', () => {
  it('is exactly 16:9 and stands where the owner chose it', () => {
    expect(V.w / V.h).toBeCloseTo(16 / 9, 10);
    expect(V).toEqual({ x: 1244, y: 54, w: 672, h: 378 });
    expect(DRIVE_IN_GROUND).toBe(505);
  });
});

describe('the Screen tower frame', () => {
  it('has no element that paints over the video box (geometry from the component itself)', () => {
    const r = offenders(TOWER_SVG);
    expect(r.count).toBeGreaterThan(40);
    expect(r.bad).toEqual([]);
  });

  it('the check fails when a part is drawn over the picture, a ring misses the box or an outline reaches in', () => {
    expect(offenders(`${TOWER_SVG}<rect x="1300" y="100" width="40" height="40" fill="#fff"/>`).bad.length).toBe(1);
    expect(offenders(`${TOWER_SVG}<path d="M1200 40h700v400h-700z" fill="#000"/>`).bad.length).toBe(1);
    expect(offenders(`<path d="M1000 0h1200v600h-1200z M1250 60h660v370h-660z" fill="#000" fill-rule="evenodd"/>`).bad.length).toBe(1);
    expect(offenders(`<path d="M1236 46h688v394h-688z" fill="none" stroke="#fff" stroke-width="20"/>`).bad.length).toBe(1);
  });

  it('keeps the frame within the clearances the layout needs', () => {
    // The outer footing ends at x 1965, 35 px short of the list card (x 2000), and the left one at x 1195, 111 px clear of the Look switch (which ends at x 1084).
    const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${TOWER_SVG}</svg>`, 'image/svg+xml');
    let right = 0;
    let left = 1e9;
    for (const el of doc.querySelectorAll('path')) {
      if (el.closest('defs') || el.closest('g[transform*="scale(1 -1)"]')) continue;
      const b = pathBox(el.getAttribute('d')!);
      right = Math.max(right, b[2]);
      left = Math.min(left, b[0]);
    }
    expect(right).toBeLessThanOrEqual(1965);
    expect(left).toBeGreaterThanOrEqual(1195);
  });
});

describe('the marquee', () => {
  const on = (container: HTMLElement) => [...container.querySelectorAll('text.w-mq')].filter((t) => t.getAttribute('data-on') === '1').map((t) => t.textContent);

  it('says NOW SHOWING while playing, INTERMISSION while paused and the name alone with nothing on', () => {
    const { container, rerender } = render(<DriveInFrame mode="playing" />);
    expect(on(container)).toEqual([MARQUEE_PLAYING]);
    expect(MARQUEE_PLAYING).toBe('WATT’S DRIVE-IN · NOW SHOWING');
    rerender(<DriveInFrame mode="paused" />);
    expect(on(container)).toEqual([MARQUEE_PAUSED]);
    expect(MARQUEE_PAUSED).toBe('WATT’S DRIVE-IN · INTERMISSION');
    rerender(<DriveInFrame mode="empty" />);
    expect(on(container)).toEqual([MARQUEE_NAME]);
    expect(MARQUEE_NAME).toBe('WATT’S DRIVE-IN');
  });

  it('cross-fades: the words that are off stay in the page at opacity 0 so the stylesheet can fade them', () => {
    const { container, rerender } = render(<DriveInFrame mode="playing" />);
    const words = () => [...container.querySelectorAll<SVGTextElement>('text.w-mq')].map((t) => [t.textContent, t.style.opacity]);
    expect(words()).toEqual([[MARQUEE_PLAYING, '1'], [MARQUEE_PAUSED, '0'], [MARQUEE_NAME, '0']]);
    const before = container.querySelectorAll('text.w-mq')[0];
    rerender(<DriveInFrame mode="paused" />);
    // The same elements, not new ones: a transition only runs on an element that stays.
    expect(container.querySelectorAll('text.w-mq')[0]).toBe(before);
    expect(words()).toEqual([[MARQUEE_PLAYING, '0'], [MARQUEE_PAUSED, '1'], [MARQUEE_NAME, '0']]);
  });

  it('sits on the board, under the picture, and the frame takes no pointer', () => {
    const { container } = render(<DriveInFrame mode="playing" />);
    const svg = container.querySelector('svg')!;
    expect(svg.style.pointerEvents).toBe('none');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    const t = container.querySelector('text.w-mq')!;
    expect(Number(t.getAttribute('y'))).toBeGreaterThan(MARQUEE.y);
    expect(Number(t.getAttribute('y'))).toBeLessThan(MARQUEE.y + MARQUEE.h);
    expect(MARQUEE.y).toBeGreaterThan(V.y + V.h);
  });
});
