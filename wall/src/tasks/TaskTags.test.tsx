import { render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { encodeIcon, encodeSet } from '../../vite-plugin-tabler-icons.mjs';
import { TaskTags } from './TaskTags';
import { decodeIcon, ICON_NAME, setIconDataForTests } from './tagIcons';
import { chipWidth, CHIP_MAX_PX, MIN_TITLE_PX, TAG_HUES, tagHue, tagLayout } from './tagStyle';

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

it('every hue and the no-colour grey is 4.5 or more as 16 px text on its own 14 percent wash, on every background a row has', () => {
  const hues = [...new Set(Object.values(TAG_HUES)), NO_COLOUR];
  expect(hues.length).toBe(9);
  for (const bg of BACKGROUNDS) {
    for (const hex of hues) {
      // The wash is the tag's colour at 14 percent over the background, under the text and the glyph.
      const wash = mix(hex, bg, 0.14);
      const ratio = (lum(hex) + 0.05) / (lum(wash) + 0.05);
      expect(ratio, `${hex} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

it('the contrast check can fail: a dim colour on a light background is under 4.5', () => {
  const ratio = (lum('#7f779f') + 0.05) / (lum(mix('#7f779f', '#1a1440', 0.14)) + 0.05);
  expect(ratio).toBeLessThan(4.5);
});

it('the first tag is a chip with its name, the rest are dots, and each carries its name for the hover card', () => {
  const r = render(<TaskTags tags={tags} room={430} />);
  const chip = r.container.querySelectorAll('.t-chip');
  const dots = r.container.querySelectorAll('.t-dot');
  expect(chip.length).toBe(1);
  expect(chip[0]!.textContent).toBe('Repairs');
  expect([...dots].map((d) => d.getAttribute('aria-label'))).toEqual(['Phone Call', 'Garden']);
});

it('with three tags and little room every tag is a dot; with none there is nothing', () => {
  const long = [{ label: 'An Unusually Long Tag Name Here' }, { label: 'Finance' }, { label: 'Work' }];
  const r = render(<TaskTags tags={long} room={300} />);
  expect(r.container.querySelectorAll('.t-chip').length).toBe(0);
  expect(r.container.querySelectorAll('.t-dot').length).toBe(3);
  expect(render(<TaskTags tags={[]} room={430} />).container.innerHTML).toBe('');
  expect(render(<TaskTags room={430} />).container.innerHTML).toBe('');
});

it('the chip rule leaves the title at least 180 px', () => {
  expect(chipWidth('Errands')).toBeLessThan(CHIP_MAX_PX);
  expect(chipWidth('x'.repeat(60))).toBe(CHIP_MAX_PX);
  // Home: one chip and two dots on a 442 px title column.
  expect(tagLayout([{ label: 'Repairs' }, { label: 'a' }, { label: 'b' }], 442)).toBe('chip');
  // Work (442), the widest chip and two dots, leaves 192: more than 180, so the chip stays.
  expect(442 - (12 + CHIP_MAX_PX + 68)).toBeGreaterThanOrEqual(MIN_TITLE_PX);
  expect(tagLayout([{ label: 'x'.repeat(40) }, { label: 'a' }, { label: 'b' }], 442)).toBe('chip');
  // Exactly 180 left is enough; 179 is not.
  expect(tagLayout([{ label: 'x'.repeat(40) }, { label: 'a' }, { label: 'b' }], 12 + CHIP_MAX_PX + 68 + 180)).toBe('chip');
  expect(tagLayout([{ label: 'x'.repeat(40) }, { label: 'a' }, { label: 'b' }], 12 + CHIP_MAX_PX + 68 + 179)).toBe('dots');
  expect(tagLayout([], 430)).toBe('dots');
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
  const r = render(<TaskTags tags={[{ label: 'Calls', icon: 'phone', color: 'blue' }, { label: 'Odd', icon: 'not-a-real-icon', color: 'blue' }]} room={430} />);
  const chipSvg = r.container.querySelector('.t-chip svg')!;
  expect(chipSvg.getAttribute('data-icon')).toBe('phone');
  expect(chipSvg.getAttribute('viewBox')).toBe('0 0 24 24');
  expect(chipSvg.getAttribute('stroke')).toBe('currentColor');
  expect(chipSvg.getAttribute('stroke-width')).toBe('2');
  expect(chipSvg.getAttribute('stroke-linecap')).toBe('round');
  expect(chipSvg.getAttribute('fill')).toBe('none');
  expect(chipSvg.querySelectorAll('path').length).toBe(1);
  // The unknown name falls back to the plain tag glyph (Tabler's own tag icon).
  expect(r.container.querySelector('.t-dot svg')?.getAttribute('data-icon')).toBeNull();
  expect(r.container.querySelector('.t-dot svg')?.getAttribute('class')).toContain('tabler-icon-tag');
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
