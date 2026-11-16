import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { encodeIcon, encodeSet } from '../../vite-plugin-tabler-icons.mjs';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import { TaskTags } from './TaskTags';
import { decodeIcon, ICON_NAME, setIconDataForTests } from './tagIcons';
import { DOT_PX, TAG_GAP_PX, TAG_HUES, tagHue } from './tagStyle';

afterEach(() => setIconDataForTests(null));

const tags = [
  { label: 'Repairs', icon: 'tool', color: 'pink' },
  { label: 'Phone Call', icon: 'phone', color: 'blue' },
  { label: 'Garden', icon: 'plant-2', color: 'green' },
];

it('the eleven colour names map to eight hues as the task app does', () => {
  expect(Object.keys(TAG_HUES).sort()).toEqual(['blue', 'brown', 'green', 'khaki', 'lime', 'magenta', 'orange', 'pink', 'red', 'slate', 'teal']);
  expect(new Set(Object.values(TAG_HUES)).size).toBe(8);
  expect(tagHue('khaki')).toBe(tagHue('lime'));
  expect(tagHue('orange')).toBe(tagHue('brown'));
  expect(tagHue('red')).toBe(tagHue('pink'));
  expect(tagHue('chartreuse')).toBeNull();
  expect(tagHue('constructor')).toBeNull();
  expect(tagHue(null)).toBeNull();
});

const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
};
const mix = (fg: string, bg: string, a: number) => {
  const f = parseInt(fg.slice(1), 16);
  const b = parseInt(bg.slice(1), 16);
  const part = (s: number) => Math.round(((f >> s) & 255) * a + ((b >> s) & 255) * (1 - a));
  return '#' + [16, 8, 0].map((s) => part(s).toString(16).padStart(2, '0')).join('');
};

/**
 * The backgrounds a task row meets, measured on the gallery stills at morning, noon, dusk and night:
 * the darkest sky, the typical sky, the brightest sky pixel behind Work's block (dusk), the brightest
 * behind Home's list, and a lighter navy beyond any of them.
 */
const BACKGROUNDS = ['#06071d', '#0a0e2b', '#15072e', '#101a3d', '#1a1440'];
const NO_COLOUR = '#b7afd6'; // the wall's --dim, which a tag with no colour uses

it('every hue and the no-colour grey is 4.5 or more as 16 px text on its own 20 percent wash, on every background a row has', () => {
  const hues = [...new Set(Object.values(TAG_HUES)), NO_COLOUR];
  expect(hues.length).toBe(9);
  for (const bg of BACKGROUNDS) {
    for (const hex of hues) {
      // The tint is the tag's colour at 20 percent over the background, under the text and the glyph.
      const wash = mix(hex, bg, 0.2);
      const ratio = (lum(hex) + 0.05) / (lum(wash) + 0.05);
      expect(ratio, `${hex} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

it('the contrast check can fail: a dim colour on a light background is under 4.5', () => {
  const ratio = (lum('#7f779f') + 0.05) / (lum(mix('#7f779f', '#1a1440', 0.2)) + 0.05);
  expect(ratio).toBeLessThan(4.5);
});

it('each tag is a round pill with only its icon: one, two and three tags, and none', () => {
  for (const n of [1, 2, 3]) {
    const r = render(<TaskTags tags={tags.slice(0, n)} />);
    const pills = r.container.querySelectorAll('.t-dot');
    expect(pills.length).toBe(n);
    expect(r.container.querySelectorAll('.t-chip, .t-label').length).toBe(0);
    for (const p of pills) expect(p.textContent).toBe('');
    expect([...pills].map((d) => d.getAttribute('aria-label'))).toEqual(tags.slice(0, n).map((t) => t.label));
  }
  expect(DOT_PX).toBe(26);
  expect(TAG_GAP_PX).toBe(4);
  expect(render(<TaskTags tags={[]} />).container.innerHTML).toBe('');
  expect(render(<TaskTags />).container.innerHTML).toBe('');
});

it('the hover card lists every tag of the row with its icon and full name', async () => {
  const r = render(
    <>
      <TaskTags tags={tags} />
      <HoverTipLayer />
    </>,
  );
  fireEvent.mouseEnter(r.container.querySelector('.t-tags') as HTMLElement);
  const card = await waitFor(() => {
    const el = document.querySelector('.t-tip');
    if (!el) throw new Error('no card yet');
    return el;
  }, { timeout: 2000 });
  expect([...card.querySelectorAll('.t-tip-name')].map((e) => e.textContent)).toEqual(['Repairs', 'Phone Call', 'Garden']);
  expect(card.querySelectorAll('.t-tip-row svg').length).toBe(3);
});

const nodes: [string, Record<string, string>][] = [
  ['path', { d: 'M4 19a2 2 0 1 0 4 0' }],
  ['path', { d: 'M1 1h2', fill: 'currentColor' }],
  ['path', { d: 'M2 2h2', fill: 'currentColor', stroke: 'none' }],
  ['path', { d: 'M3 3h2', opacity: '.5' }],
];

it('the icon data encodes and decodes every attribute the set uses, and refuses anything else', () => {
  const spec = encodeIcon(nodes);
  expect(spec).toBe('M4 19a2 2 0 1 0 4 0|f~M1 1h2|s~M2 2h2|o~M3 3h2');
  expect(decodeIcon(spec)).toEqual([
    { d: 'M4 19a2 2 0 1 0 4 0' },
    { d: 'M1 1h2', fill: 'currentColor' },
    { d: 'M2 2h2', fill: 'currentColor', stroke: 'none' },
    { d: 'M3 3h2', opacity: '.5' },
  ]);
  expect(() => encodeIcon([['circle', { d: 'M0 0' }]])).toThrow();
  expect(() => encodeIcon([['path', { d: 'M0 0', onclick: 'x' }]])).toThrow();
  expect(() => encodeIcon([['path', { d: 'M0 0', fill: 'red' }]])).toThrow();
  expect(encodeSet({ a: nodes }).a).toBe(spec);
  // A path with text that is not path data is dropped, never drawn.
  expect(decodeIcon('M1 1h2|"><script>|f~<x>')).toEqual([{ d: 'M1 1h2' }]);
});

it('icon names are plain names only', () => {
  for (const ok of ['tag', 'plant-2', 'a'.repeat(64), 'shopping-cart']) expect(ICON_NAME.test(ok), ok).toBe(true);
  for (const bad of ['', 'Tag', 'a b', 'a_b', '../x', 'a'.repeat(65), '<svg>', 'tag\n']) expect(ICON_NAME.test(bad), bad).toBe(false);
});

it('a tag draws its icon from the loaded data as an inline svg of elements, and the plain tag glyph before it loads or for an unknown name', () => {
  setIconDataForTests({ phone: 'M5 4h4l2 5l-2.5 1.5a11 11 0 0 0 5 5l1.5 -2.5l5 2v4a2 2 0 0 1 -2 2a16 16 0 0 1 -15 -15a2 2 0 0 1 2 -2' });
  const r = render(<TaskTags tags={[{ label: 'Calls', icon: 'phone', color: 'blue' }, { label: 'Odd', icon: 'not-a-real-icon', color: 'blue' }]} />);
  const chipSvg = r.container.querySelector('.t-dot svg')!;
  expect(chipSvg.getAttribute('data-icon')).toBe('phone');
  expect(chipSvg.getAttribute('viewBox')).toBe('0 0 24 24');
  expect(chipSvg.getAttribute('stroke')).toBe('currentColor');
  expect(chipSvg.getAttribute('stroke-width')).toBe('2');
  expect(chipSvg.getAttribute('stroke-linecap')).toBe('round');
  expect(chipSvg.getAttribute('fill')).toBe('none');
  expect(chipSvg.querySelectorAll('path').length).toBe(1);
  // The unknown name falls back to the plain tag glyph (Tabler's own tag icon).
  expect(r.container.querySelectorAll('.t-dot svg')[1]?.getAttribute('data-icon')).toBeNull();
  expect(r.container.querySelectorAll('.t-dot svg')[1]?.getAttribute('class')).toContain('tabler-icon-tag');
});

const sources = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

it('the icon data is loaded only through import(): no source file imports it statically, and no code sets markup from it', () => {
  const files = Object.entries(sources).filter(([name]) => !name.endsWith('.d.ts'));
  expect(files.length).toBeGreaterThan(100);
  const staticImports = files.filter(([, text]) => /^\s*import[^(\n]*['"]virtual:tabler-icon-data['"]/m.test(text)).map(([name]) => name);
  expect(staticImports).toEqual([]);
  expect(sources['./tagIcons.tsx']).toContain("import('virtual:tabler-icon-data')");
  for (const f of ['./tagIcons.tsx', './TaskTags.tsx']) expect(sources[f]).not.toContain('dangerouslySetInnerHTML');
});

it('the real icon chunk holds the owner\'s kind of names and loads on demand', async () => {
  const mod = await import('virtual:tabler-icon-data');
  for (const name of ['tag', 'shopping-cart', 'plant-2', 'phone', 'tool']) expect(mod.default[name], name).toBeTruthy();
  expect(Object.keys(mod.default).length).toBeGreaterThan(5000);
  for (const spec of Object.values(mod.default)) expect(decodeIcon(spec).length).toBeGreaterThan(0);
});

it('draws at most three pills; the rest are named only in the hover card', async () => {
  resetTip();
  const five = [...tags, { label: 'Errands', icon: 'tool', color: 'teal' }, { label: 'Paperwork', icon: 'phone', color: 'red' }];
  for (const n of [3, 4, 5]) {
    const r = render(<TaskTags tags={five.slice(0, n)} />);
    expect(r.container.querySelectorAll('.t-tag')).toHaveLength(3);
    r.unmount();
  }
  const r = render(
    <>
      <TaskTags tags={five} />
      <HoverTipLayer />
    </>,
  );
  fireEvent.mouseEnter(r.container.querySelector('.t-tags') as HTMLElement);
  const card = await waitFor(() => {
    const el = document.querySelector('.t-tip');
    if (!el) throw new Error('no card yet');
    return el;
  }, { timeout: 2000 });
  expect([...card.querySelectorAll('.t-tip-name')].map((e) => e.textContent)).toEqual(['Repairs', 'Phone Call', 'Garden', 'Errands', 'Paperwork']);
});
