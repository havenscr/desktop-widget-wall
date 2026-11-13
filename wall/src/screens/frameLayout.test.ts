import { expect, it } from 'vitest';
import css from '../styles/frame.css?raw';
import {
  MAIN_GAP,
  MAIN_HEIGHT,
  MAIN_LEFT,
  MAIN_ROWS,
  MAIN_TOP,
  MAIN_WIDTH,
  RAIL_WIDTH,
  rowEdges,
  SHELL_GAP,
  SHELL_INSET,
  ZONE_GAP,
  ZONES,
  ZONES_CALL,
  ZONES_WIDE,
  zoneEdges,
  UNWIND_ROOM_FOOT_GAP,
  UNWIND_ROOM_HEIGHT,
  UNWIND_ROOM_TOP,
} from './frameLayout';

/** The declarations of the rule whose selector is exactly `selector`. */
function rule(selector: string): Record<string, string> {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`no rule ${selector}`);
  const out: Record<string, string> = {};
  for (const d of m[1].split(';')) {
    const i = d.indexOf(':');
    if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim().replace(/\s+/g, ' ');
  }
  return out;
}
const px = (ns: readonly number[]) => ns.map((n) => `${n}px`).join(' ');

it('frame.css uses the shared shell and main numbers', () => {
  expect(rule('.shell')).toMatchObject({ inset: `${SHELL_INSET}px`, 'grid-template-columns': `${RAIL_WIDTH}px 1fr`, gap: `${SHELL_GAP}px` });
  expect(rule('.main')).toMatchObject({ 'grid-template-rows': px(MAIN_ROWS), gap: `${MAIN_GAP}px` });
});

it('the top band has no padding, so the clock sits at stage x 124, y 20 as in the concept', () => {
  const top = rule('.top');
  expect(Object.keys(top).some((k) => k.startsWith('padding'))).toBe(false);
  expect(MAIN_LEFT).toBe(124);
  expect(MAIN_TOP).toBe(20);
});

it('the main rows put the ribbon at stage y 596 to 700 and fill the shell exactly', () => {
  const rows = rowEdges();
  expect(rows[0]).toEqual({ top: 20, bottom: 510 });
  expect(rows[2]).toEqual({ top: 596, bottom: 700 });
  expect(rows[2].bottom - MAIN_TOP).toBe(MAIN_HEIGHT);
});

it('the zones match the concept columns and end exactly at the main area\'s right edge', () => {
  expect(ZONES).toEqual([470, 1290, 596]);
  expect(ZONES_CALL).toEqual([620, 1140, 596]);
  expect(rule('.zones')).toMatchObject({ 'grid-template-columns': px(ZONES), gap: `${ZONE_GAP}px` });
  expect(rule('.zones.call')).toMatchObject({ 'grid-template-columns': px(ZONES_CALL) });
  expect(rule('.zones.wide')).toMatchObject({ 'grid-template-columns': `${ZONES_WIDE[0]}px minmax(0, 1fr) ${ZONES_WIDE[1]}px` });
  expect(MAIN_WIDTH).toBe(2416);
  expect(zoneEdges(ZONES).at(-1)!.right).toBe(MAIN_WIDTH);
  expect(zoneEdges(ZONES_CALL).at(-1)!.right).toBe(MAIN_WIDTH);
  expect(zoneEdges(ZONES).map((z) => z.left)).toEqual([0, 500, 1820]);
});

it('places the Unwind Room card from the frame constants: 120 tall, its foot 38 above the 490 band', () => {
  expect(UNWIND_ROOM_TOP).toBe(MAIN_ROWS[0] - UNWIND_ROOM_FOOT_GAP - UNWIND_ROOM_HEIGHT);
  expect(UNWIND_ROOM_TOP).toBe(332);
});
