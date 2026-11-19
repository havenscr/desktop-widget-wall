import { expect, it } from 'vitest';
import { HIDDEN_NAMED, MIN_CHIP_PX, MORE_GAP, MORE_MIN_PX, hiddenNames, allDayChips, allDayText, allDayWidth, chipLayout, chips, focusBars, isAllDay, isLate, needleTip, hourLabels, hourText, labelBox, handleX, HANDLE_W, needle, RIBBON_WIDTH, RX, shortTime, skyGradient, sunLabels, sunMarkerBox, RIBBON_LABEL_TOP, SUN_MARKER_W, ticks, wallHour } from './model';
import { sunTimes } from './sun';
import { useFixedClock, usePacificTime } from './testZone';

usePacificTime();
// The wall clock never matters here; pin it anyway so nothing can lean on it.
useFixedClock(Date.parse('2026-11-11T10:24:00-08:00'));

const t = (hm: string, day = '11') => Date.parse(`2026-11-${day}T${hm}:00-08:00`);
const iso = (hm: string, day = '11') => new Date(t(hm, day)).toISOString();

it('maps 6 AM to x 72 and midnight to x 2376 inside a 2416 px ribbon', () => {
  expect(RX(6)).toBe(72);
  expect(RX(24)).toBe(2376);
  expect(RX(24)).toBeLessThan(RIBBON_WIDTH);
  expect(ticks()).toHaveLength(19);
});

it('reads wall-clock hours on the needle day only', () => {
  expect(wallHour(t('10:24'), t('10:24'))).toBeCloseTo(10.4);
  expect(wallHour(t('23:00', '10'), t('10:24'))).toBe(-1);
  expect(wallHour(t('01:00', '12'), t('10:24'))).toBe(25);
});

it('writes times as the concept does', () => {
  expect(shortTime(t('10:24'))).toBe('10:24');
  expect(shortTime(t('16:40'))).toBe('4:40');
  expect(shortTime(t('00:05'))).toBe('12:05');
  expect([6, 12, 18, 24].map(hourText)).toEqual(['6 AM', '12 PM', '6 PM', '12 AM']);
});

it('marks an event before now past and one spanning now as now', () => {
  const now = t('10:24');
  const out = chips(
    [
      { key: 'a', title: 'AE sync', start: iso('09:00'), end: iso('09:45') },
      { key: 'b', title: 'Design review', start: iso('10:00'), end: iso('11:00') },
      { key: 'c', title: 'Livestream: Fabric Apps', start: iso('18:30'), end: iso('20:30'), isLive: true },
    ],
    now,
  );
  expect(out.map((c) => [c.key, c.state, c.live])).toEqual([
    ['a', 'past', false],
    ['b', 'now', false],
    ['c', 'next', true],
  ]);
  expect(out[0].x).toBe(RX(9));
  expect(out[0].width).toBe(RX(9.75) - RX(9));
});

it('clips events to 6 AM to 12 AM and drops the rest', () => {
  const now = t('10:24');
  const out = chips(
    [
      { key: 'early', title: 'Early', start: iso('05:00'), end: iso('06:30') },
      { key: 'night', title: 'Before 6', start: iso('04:00'), end: iso('05:00') },
      { key: 'late', title: 'Late', start: iso('23:30'), end: iso('00:30', '12') },
      { key: 'tomorrow', title: 'Tomorrow', start: iso('09:30', '12'), end: iso('10:00', '12') },
      { key: 'bad', title: 'Bad', start: 'nope', end: iso('10:00') },
    ],
    now,
  );
  expect(out.map((c) => [c.key, c.x, c.x + c.width])).toEqual([
    ['early', RX(6), RX(6.5)],
    ['late', RX(23.5), RX(24)],
  ]);
});

it('hides hour labels within 70 px of the needle', () => {
  const n = needle(t('10:24')).x; // RX(10.4) = 635.2
  const hours = hourLabels(n).map((l) => l.text);
  expect(hours).not.toContain('10 AM'); // 51 px away
  expect(hours).toContain('8 AM');
  expect(hours).toContain('12 PM'); // 154 px away
  expect(hours).toHaveLength(9);
  expect(hourLabels(needle(t('16:36')).x).map((l) => l.text)).toContain('4 PM'); // 77 px away, shown as in f_home
});

const mk = (rise: string | null, set: string | null, day = '11') => ({ rise: rise === null ? null : t(rise, day), set: set === null ? null : t(set, day) });

it('draws sunrise and sunset markers as short times on their own row, the needle or not', () => {
  const sun = sunTimes(t('10:24'));
  const m = sunLabels(sun, t('10:24'));
  expect(m.map((l) => [l.kind, l.text, l.tip])).toEqual([
    ['rise', '7:09', 'Sunrise 7:09 AM'],
    ['set', '4:37', 'Sunset 4:37 PM'],
  ]);
  expect(m[1]!.x).toBeCloseTo(RX(wallHour(sun.set!, t('10:24'))), 6);
  // The needle sits 3 px from the sunset marker: the marker stays (the rows differ), the hour label near it hides.
  const n = needle(t('16:37')).x;
  expect(sunLabels(sun, t('16:37')).map((l) => l.text)).toEqual(['7:09', '4:37']);
  expect(hourLabels(n).map((l) => l.text)).toContain('4 PM'); // 79 px away
  expect(hourLabels(needle(t('16:05')).x).map((l) => l.text)).not.toContain('4 PM');
  expect(sunLabels(mk('07:55', '16:05'), t('16:05')).map((l) => l.text)).toEqual(['7:55', '4:05']);
});

it('leaves out a sun time outside 6 AM to midnight', () => {
  expect(sunLabels(mk('05:10', '21:10', '01'), t('12:00', '01')).map((l) => l.kind)).toEqual(['set']);
  expect(sunLabels({ rise: null, set: null }, t('12:00'))).toEqual([]);
});

// Real boxes: every sun minute from 6:00 AM to midnight against every needle position (every 3 minutes),
// the marker's box (sunMarkerBox) against each shown hour label's box (y 10 to 25) and the needle pill's
// box (y 6 to 28), both from labelBox. Their boxes must keep an 8 px gap in at least one axis.
it('keeps every marker box 8 px clear of every shown hour label and the needle pill, at every sun and needle minute', () => {
  const GAP = 8;
  const apart = (a: { left: number; right: number; top: number; bottom: number }, b: { left: number; right: number; top: number; bottom: number }) =>
    Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom);
  const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  let pairs = 0;
  let nearest = Infinity;
  for (let sunMin = 6 * 60; sunMin < 24 * 60; sunMin++) {
    const marker = sunLabels(mk(hm(sunMin), hm(sunMin)), t('12:00'))[0]!;
    const box = sunMarkerBox(marker.x);
    expect(box.right - box.left).toBe(SUN_MARKER_W);
    for (let needleMin = 6 * 60; needleMin < 24 * 60; needleMin += 3) {
      const n = needle(t(hm(needleMin)));
      const pill = labelBox(n.x, n.text, 11);
      const boxes = [
        { left: pill.x, right: pill.x + pill.width, top: RIBBON_LABEL_TOP, bottom: 28 },
        ...hourLabels(n.x).map((l) => {
          const lb = labelBox(l.x, l.text);
          return { left: lb.x, right: lb.x + lb.width, top: 10, bottom: 25 };
        }),
      ];
      for (const o of boxes) {
        pairs++;
        nearest = Math.min(nearest, apart(box, o));
      }
    }
  }
  expect(pairs).toBeGreaterThan(100_000);
  expect(nearest).toBeGreaterThanOrEqual(GAP);
});

it('keeps the drawer handle off the hour labels and the needle pill, and does not move for a sun marker', () => {
  const centre = Math.round(RIBBON_WIDTH / 2 - HANDLE_W / 2);
  const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const blocksAt = (needleMin: number) => {
    const n = needle(t(hm(needleMin)));
    return [...hourLabels(n.x).map((l) => labelBox(l.x, l.text)), labelBox(n.x, n.text, 11)];
  };
  for (let needleMin = 6 * 60; needleMin < 24 * 60; needleMin += 7) {
    const blocks = blocksAt(needleMin);
    const x = handleX(blocks);
    for (const b of blocks) expect(x < b.x + b.width + 4 && b.x - 4 < x + HANDLE_W).toBe(false);
  }
  // A sun marker standing right over the handle's centre (a 2:36 PM sunset) does not move it: the marker is in another row.
  const m = sunLabels(mk('07:55', '14:36'), t('12:00'));
  const over = sunMarkerBox(m[1]!.x);
  expect(over.left < centre + HANDLE_W && centre < over.right).toBe(true);
  expect(handleX(blocksAt(22 * 60))).toBe(centre);
});

it('keeps sunrise and sunset markers at least 8 hours apart on the worst dates', () => {
  for (const [rise, set] of [['07:55', '16:28'], ['07:57', '16:16'], ['05:15', '21:10'], ['07:55', '16:05']] as const) {
    const m = sunLabels(mk(rise, set), t('12:00'));
    if (m.length === 2) expect(m[1]!.x - m[0]!.x).toBeGreaterThanOrEqual(8 * 128 - 1);
    for (const l of m) expect(l.text).toMatch(/^\d{1,2}:\d{2}$/);
  }
  expect(sunLabels(mk('07:55', '16:05'), t('12:00')).map((l) => l.tip)).toEqual(['Sunrise 7:55 AM', 'Sunset 4:05 PM']);
  expect(sunLabels(mk(null, '21:10'), t('12:00')).map((l) => l.tip)).toEqual(['Sunset 9:10 PM']);
});

it('clamps the needle before 6 AM and still shows the real time', () => {
  expect(needle(t('05:12'))).toEqual({ x: 72, text: '5:12' });
  expect(needle(t('00:30'))).toEqual({ x: 72, text: '12:30' });
  expect(needle(t('23:59')).x).toBeCloseTo(RX(23 + 59 / 60));
});

it('draws focus bars up to now, today only', () => {
  const now = t('10:24');
  const bars = focusBars(
    [
      { start: t('15:00', '10'), end: t('15:25', '10') },
      { start: t('10:00'), end: t('10:45') },
      { start: t('12:45'), end: t('14:00') },
    ],
    now,
  );
  expect(bars).toEqual([{ x: RX(10), width: RX(10.4) - RX(10) }]);
});

it('places the sky stops on the real sunrise and sunset', () => {
  const sun = sunTimes(t('10:24'));
  const g = skyGradient(sun, t('10:24'));
  const rise = +((RX(wallHour(sun.rise!, t('10:24'))) / RIBBON_WIDTH) * 100).toFixed(2);
  expect(g.startsWith('linear-gradient(90deg,#0d0a2c 0%')).toBe(true);
  expect(g).toContain(`#e08f7a ${rise}%`);
  expect(skyGradient({ rise: null, set: null }, t('10:24'))).toContain('#e08f7a 9%');
});

it('draws the part of a focus session after midnight, from the ribbon start', () => {
  // A session from 11:50 PM to 6:30 AM shows on the next day's ribbon from 6:00 (its start).
  const bars = focusBars([{ start: t('23:50', '10'), end: t('06:30') }], t('10:24'));
  expect(bars).toEqual([{ x: RX(6), width: RX(6.5) - RX(6) }]);
  const late = focusBars([{ start: t('23:30'), end: t('00:30', '12') }], t('23:59'));
  expect(late[0].x).toBe(RX(23.5));
  expect(late[0].x + late[0].width).toBeCloseTo(RX(23 + 59 / 60));
});

it('puts each overlapping event in the first free lane of its group, stacked', () => {
  const now = t('08:00');
  const { shown, more } = chipLayout(
    chips(
      [
        { key: 'a', title: 'Workshop', start: iso('09:00'), end: iso('11:00') },
        { key: 'b', title: 'Call', start: iso('10:00'), end: iso('10:30') },
        { key: 'c', title: 'Lunch', start: iso('11:00'), end: iso('12:00') },
        { key: 'e', title: 'Late call', start: iso('10:40'), end: iso('10:55') },
      ],
      now,
    ),
  );
  expect(shown.map((c) => [c.key, c.lane, c.lanes])).toEqual([
    ['a', 0, 2],
    ['b', 1, 2],
    ['e', 1, 2],
    // Lunch starts exactly when the workshop ends: its own group, the full row.
    ['c', 0, 1],
  ]);
  expect(more).toEqual([]);
});

/** Lane boxes as the ribbon draws them: a "+N" chip and a single lane take the full row. */
const rowBox = (c: { x: number; lane?: number; lanes?: number }) => {
  const lanes = c.lanes ?? 1;
  if (lanes <= 1) return { top: 33, bottom: 63 };
  const h = (34 - (lanes - 1) * 2) / lanes;
  const top = 31 + (c.lane ?? 0) * (h + 2);
  return { top, bottom: top + h };
};

const overlapFree = (shown: { x: number; width: number; lane: number; lanes: number }[], more: { x: number; width: number }[]) => {
  const boxes = [...shown, ...more].map((b) => ({ ...rowBox(b), x: b.x, w: b.width }));
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const p = boxes[i];
      const q = boxes[j];
      const apartX = p.x + p.w <= q.x || q.x + q.w <= p.x;
      const apartY = p.bottom <= q.top || q.bottom <= p.top;
      expect(apartX || apartY).toBe(true);
    }
};

it('a partial overlap stacks the two in lanes of reduced height, never one over the other', () => {
  const now = t('08:00');
  const { shown, more } = chipLayout(
    chips(
      [
        { key: 'a', title: 'Haircut', start: iso('12:45'), end: iso('13:45') },
        { key: 'b', title: 'Gym session', start: iso('13:30'), end: iso('15:30') },
        { key: 'c', title: 'Reserved time', start: iso('15:30'), end: iso('17:00') },
      ],
      now,
    ),
  );
  expect(shown.map((c) => [c.key, c.lane, c.lanes, c.narrow])).toEqual([
    ['a', 0, 2, false],
    ['b', 1, 2, false],
    ['c', 0, 1, false],
  ]);
  expect(more).toEqual([]);
  overlapFree(shown, more);
});

it('three at once stack in three thin lanes with the titles in the hover', () => {
  const now = t('08:00');
  const all = chips(
    [
      { key: 'a', title: 'One', start: iso('10:00'), end: iso('11:00') },
      { key: 'b', title: 'Two', start: iso('10:00'), end: iso('11:00') },
      { key: 'c', title: 'Three', start: iso('10:30'), end: iso('11:30') },
    ],
    now,
  );
  const { shown, more } = chipLayout(all);
  expect(shown.map((c) => [c.key, c.lane, c.lanes, c.narrow])).toEqual([
    ['a', 0, 3, true],
    ['b', 1, 3, true],
    ['c', 2, 3, true],
  ]);
  expect(more).toEqual([]);
  overlapFree(shown, more);
});

it('an event that ends exactly when the next begins does not overlap it', () => {
  const now = t('08:00');
  const { shown } = chipLayout(
    chips(
      [
        { key: 'a', title: 'First', start: iso('09:00'), end: iso('10:00') },
        { key: 'b', title: 'Second', start: iso('10:00'), end: iso('11:00') },
      ],
      now,
    ),
  );
  expect(shown.map((c) => [c.key, c.lane, c.lanes])).toEqual([
    ['a', 0, 1],
    ['b', 0, 1],
  ]);
});

it('five events at once: two lanes of real chips and one "+N" chip for the other three; later ones lay out normally', () => {
  const now = t('08:00');
  const all = chips(
    [
      ...['a', 'b', 'c', 'd', 'e'].map((k, i) => ({ key: k, title: `Meeting ${k}`, start: iso(`14:0${i}`), end: iso('15:00') })),
      { key: 'f', title: 'Later', start: iso('17:00'), end: iso('17:30') },
    ],
    now,
  );
  const { shown, more } = chipLayout(all);
  expect(shown.map((c) => [c.key, c.lane, c.lanes])).toEqual([
    ['a', 0, 2],
    ['b', 1, 2],
    ['f', 0, 1],
  ]);
  expect(more).toHaveLength(1);
  expect(more[0].items.map((c) => c.key)).toEqual(['c', 'd', 'e']);
  // Inside the group's span, at its end.
  expect(more[0].x + more[0].width).toBeCloseTo(RX(15));
  overlapFree(shown, more);
});

it('meetings that start together keep two real chips beside the "+N" (never a lone "+N")', () => {
  const now = t('07:00');
  const all = chips(
    [
      { key: 'a', title: 'One', start: iso('08:00'), end: iso('10:00') },
      { key: 'b', title: 'Two', start: iso('08:00'), end: iso('10:00') },
      { key: 'c', title: 'Three', start: iso('08:00'), end: iso('10:00') },
      { key: 'd', title: 'Four', start: iso('09:54'), end: iso('10:00') },
      { key: 'e', title: 'Next', start: iso('10:00'), end: iso('11:00') },
    ],
    now,
  );
  const { shown, more } = chipLayout(all);
  expect(shown.map((c) => c.key)).toEqual(['a', 'b', 'e']);
  expect(more).toHaveLength(1);
  expect(more[0].items.map((c) => c.key)).toEqual(['c', 'd']);
  expect(more[0].x + more[0].width).toBeLessThanOrEqual(RX(10));
  overlapFree(shown, more);
});

it('a short group of four puts its "+N" just after it, narrower if the next meeting is close', () => {
  const now = t('07:00');
  const all = chips(
    [
      ...['a', 'b', 'c', 'd'].map((k) => ({ key: k, title: `Quick ${k}`, start: iso('09:00'), end: iso('09:10') })),
      { key: 'e', title: 'Next', start: iso('09:30'), end: iso('10:00') },
    ],
    now,
  );
  const { shown, more } = chipLayout(all);
  expect(shown.map((c) => c.key)).toEqual(['a', 'b', 'e']);
  expect(more).toHaveLength(1);
  expect(more[0].items.map((c) => c.key)).toEqual(['c', 'd']);
  expect(more[0].x).toBeGreaterThanOrEqual(RX(9) + MIN_CHIP_PX);
  expect(more[0].x + more[0].width).toBeLessThanOrEqual(RX(9.5));
  overlapFree(shown, more);
});

it('the "+N" after a short group takes the room left, not a fixed 24 px that runs into the next group', () => {
  const now = t('07:00');
  const all = chips(
    [
      ...['a', 'b', 'c', 'd'].map((k) => ({ key: k, title: `Quick ${k}`, start: iso('09:00'), end: iso('09:10') })),
      { key: 'e', title: 'Next', start: iso('09:24'), end: iso('10:00') },
    ],
    now,
  );
  const { shown, more } = chipLayout(all);
  const nextX = shown.find((c) => c.key === 'e')!.x;
  expect(more).toHaveLength(1);
  const room = nextX - MORE_GAP - more[0].x;
  // A gap of roughly 30 px before the next group: the old floor of 24 px was wider than the 22 px of room.
  expect(room).toBeGreaterThanOrEqual(MORE_MIN_PX);
  expect(room).toBeLessThan(24);
  expect(more[0].x + more[0].width).toBeLessThanOrEqual(nextX - MORE_GAP);
  overlapFree(shown, more);
});

it.each([
  ['back to back', '09:10'],
  ['about 11 px', '09:15'],
  ['about 19 px', '09:19'],
  ['about 30 px', '09:24'],
])('a short group of four with the next meeting %s after it: the "+N" never touches the next group and is never under 16 px, and nothing is lost', (_name, nextStart) => {
  const now = t('07:00');
  const all = chips(
    [
      ...['a', 'b', 'c', 'd'].map((k) => ({ key: k, title: `Quick ${k}`, start: iso('09:00'), end: iso('09:10') })),
      { key: 'e', title: 'Next', start: iso(nextStart), end: iso('10:00') },
    ],
    now,
  );
  const { shown, more } = chipLayout(all);
  const nextX = shown.find((c) => c.key === 'e')!.x;
  for (const m of more) {
    expect(m.width).toBeGreaterThanOrEqual(MORE_MIN_PX);
    expect(m.x + m.width).toBeLessThanOrEqual(nextX - MORE_GAP);
  }
  overlapFree(shown, more);
  // Every event is drawn, in a "+N" chip, or named in the hover of the last item shown in its group.
  const named = [
    ...shown.map((c) => c.key),
    ...more.flatMap((m) => m.items.map((c) => c.key)),
    ...shown.flatMap((c) => (c.hidden ?? []).map((h) => h.key)),
  ].sort();
  expect(named).toEqual(['a', 'b', 'c', 'd', 'e']);
  // A "+N" chip, or a hover that holds the hidden ones: one of the two, never neither.
  expect(more.length > 0 || shown.some((c) => (c.hidden ?? []).length > 0)).toBe(true);
});

it('with no room at all for a "+N" chip, one item fewer is drawn, and when even that leaves none the hover names the hidden ones', () => {
  const now = t('07:00');
  const group = ['a', 'b', 'c', 'd'].map((k) => ({ key: k, title: `Quick ${k}`, start: iso('09:00'), end: iso('09:10') }));
  const lay = chipLayout(chips([...group, { key: 'e', title: 'Next', start: iso('09:10'), end: iso('10:00') }], now));
  const hiddenTotal = lay.more.reduce((n, m) => n + m.items.length, 0) + lay.shown.reduce((n, c) => n + (c.hidden?.length ?? 0), 0);
  // The group is two lanes of real chips and two hidden; with no room the extra one is not drawn: at most two of the group show.
  expect(lay.shown.filter((c) => c.key !== 'e').length).toBeLessThanOrEqual(2);
  expect(hiddenTotal).toBeGreaterThanOrEqual(2);
  const holder = lay.shown.find((c) => (c.hidden ?? []).length > 0);
  if (holder) expect(holder.hidden!.every((h) => h.title.startsWith('Quick'))).toBe(true);
});

it('a staggered group whose chip stands inside it ends the chip MORE_GAP before the next group; with no next group the chip still ends at the group end', () => {
  const now = t('07:00');
  const group = [
    { key: 'a', title: 'A', start: iso('09:00'), end: iso('09:30') },
    { key: 'b', title: 'B', start: iso('09:00'), end: iso('09:40') },
    { key: 'c', title: 'C', start: iso('09:00'), end: iso('09:50') },
    { key: 'd', title: 'D', start: iso('09:00'), end: iso('10:00') },
  ];
  const withNext = chipLayout(chips([...group, { key: 'e', title: 'Next', start: iso('10:00'), end: iso('10:30') }], now));
  const nextX = withNext.shown.find((c) => c.key === 'e')!.x;
  expect(withNext.more).toHaveLength(1);
  expect(withNext.more[0].width).toBeGreaterThanOrEqual(MORE_MIN_PX);
  expect(withNext.more[0].x + withNext.more[0].width).toBeLessThanOrEqual(nextX - MORE_GAP);
  overlapFree(withNext.shown, withNext.more);
  const alone = chipLayout(chips(group, now));
  expect(alone.more).toHaveLength(1);
  expect(alone.more[0].x + alone.more[0].width).toBeCloseTo(RX(10));
  overlapFree(alone.shown, alone.more);
});

it('with no room, only the items that cannot fit are not drawn: eight at once keep more than one on the row, and the hover names just the hidden', () => {
  const now = t('07:00');
  const lay = chipLayout(
    chips(
      [
        { key: 'a', title: 'Long', start: iso('09:00'), end: iso('10:05') },
        { key: 'b', title: 'Early', start: iso('09:00'), end: iso('09:20') },
        { key: 'c', title: 'Late', start: iso('09:40'), end: iso('10:00') },
        ...['d', 'e', 'f', 'g', 'h'].map((k) => ({ key: k, title: `Short ${k}`, start: iso('09:05'), end: iso('09:08') })),
        { key: 'z', title: 'Next', start: iso('10:05'), end: iso('10:30') },
      ],
      now,
    ),
  );
  const group = lay.shown.filter((c) => c.key !== 'z');
  expect(group.length).toBeGreaterThan(1);
  // The one that cannot fit before the chip joins the hidden ones in a chip of its own place.
  expect(lay.more).toHaveLength(1);
  expect(lay.more[0].items.map((c) => c.key)).toContain('c');
  const nextX = lay.shown.find((c) => c.key === 'z')!.x;
  for (const m of lay.more) expect(m.x + m.width).toBeLessThanOrEqual(nextX - MORE_GAP);
  overlapFree(lay.shown, lay.more);
  const hidden = [...lay.more.flatMap((m) => m.items.map((c) => c.key)), ...lay.shown.flatMap((c) => (c.hidden ?? []).map((h) => h.key))];
  expect([...group.map((c) => c.key), ...hidden].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
});

it('the hover that names hidden meetings names at most six, each cut at 60 characters, then how many more', () => {
  const long = 'A very long meeting title that goes on and on and on past sixty characters for sure';
  const lay = chipLayout(
    chips(
      [
        ...Array.from({ length: 14 }, (_, i) => ({ key: `m${String(i).padStart(2, '0')}`, title: `${long} ${i}`, start: iso('09:00'), end: iso('09:10') })),
        { key: 'z', title: 'Next', start: iso('09:10'), end: iso('10:00') },
      ],
      t('07:00'),
    ),
  );
  const holder = lay.shown.find((c) => (c.hidden ?? []).length > 0);
  expect(holder).toBeTruthy();
  expect(holder!.hidden!.length).toBeGreaterThanOrEqual(12);
  const names = hiddenNames(holder!.hidden!);
  expect(names.titles).toHaveLength(HIDDEN_NAMED);
  expect(names.titles.every((x) => x.length <= 60 && x.endsWith('\u2026'))).toBe(true);
  expect(names.more).toBe(holder!.hidden!.length - HIDDEN_NAMED);
  expect(hiddenNames([]).titles).toEqual([]);
});

it('a group of one has no "+N" chip and nothing hidden', () => {
  const lay = chipLayout(chips([{ key: 'a', title: 'Solo', start: iso('09:00'), end: iso('09:30') }, { key: 'b', title: 'Later', start: iso('09:31'), end: iso('10:00') }], t('07:00')));
  expect(lay.more).toEqual([]);
  expect(lay.shown.map((c) => c.key)).toEqual(['a', 'b']);
  expect(lay.shown.every((c) => !c.hidden)).toBe(true);
});

it('four at once: the "+N" chip takes the ones that do not fit and any chip under it', () => {
  const now = t('08:00');
  const all = chips(
    [
      { key: 'a', title: 'Long workshop', start: iso('09:00'), end: iso('13:00') },
      { key: 'b', title: 'Call', start: iso('10:00'), end: iso('12:00') },
      { key: 'c', title: 'Review', start: iso('11:00'), end: iso('12:30') },
      { key: 'd', title: 'Sync', start: iso('11:30'), end: iso('12:00') },
    ],
    now,
  );
  const { shown, more } = chipLayout(all);
  overlapFree(shown, more);
  const listed = [...shown.map((c) => c.key), ...more.flatMap((m) => m.items.map((c) => c.key))].sort();
  expect(listed).toEqual(['a', 'b', 'c', 'd']);
  expect(more.length).toBeGreaterThan(0);
  expect(shown.every((c) => c.lanes <= 2)).toBe(true);
});

it('folds all-day events into one chip at the row start and frees the lane for timed events', () => {
  const now = t('22:30');
  const events = [
    { key: 'all', title: 'Company offsite', start: new Date(2026, 10, 11, 0, 0).toISOString(), end: new Date(2026, 10, 12, 0, 0).toISOString() },
    { key: 'a', title: 'Quarterly planning', start: iso('19:00'), end: iso('20:00') },
  ];
  expect(chips(events, now).map((c) => c.key)).toEqual(['a']);
  expect(allDayChips(events, now).map((c) => c.key)).toEqual(['all']);
  expect(allDayText(1)).toBe('1 all day');
  const { shown, allDay } = chipLayout(chips(events, now), allDayWidth(1));
  expect(allDay).toEqual({ x: RX(6), width: allDayWidth(1), lane: 0, lanes: 1 });
  expect(shown.map((c) => [c.key, c.lane, c.lanes])).toEqual([['a', 0, 1]]);
  // A multi-day event counts as all day too; yesterday's does not show.
  expect(isAllDay(Date.parse(iso('09:00')), Date.parse(iso('09:00')) + 3 * 86_400_000)).toBe(true);
  expect(allDayChips([{ key: 'y', title: 'Yesterday', start: new Date(2026, 10, 10).toISOString(), end: new Date(2026, 10, 11).toISOString() }], now)).toEqual([]);
});

it('a meeting at 6 AM shares the all-day chip group in a stacked lane', () => {
  const now = t('08:00');
  const { shown, allDay } = chipLayout(chips([{ key: 'early', title: 'Early call', start: iso('06:00'), end: iso('07:00') }], now), allDayWidth(1));
  expect(allDay).toEqual({ x: RX(6), width: allDayWidth(1), lane: 0, lanes: 2 });
  expect(shown.map((c) => [c.key, c.lane, c.lanes])).toEqual([['early', 1, 2]]);
});

it('writes a narrow chip title beside it when there is room, else leaves it to the hover', () => {
  const now = t('08:00');
  const roomy = chipLayout(
    chips(
      [
        { key: 's', title: 'Standup', start: iso('09:00'), end: iso('09:15') },
        { key: 'r', title: 'Design review', start: iso('10:00'), end: iso('11:00') },
      ],
      now,
    ),
  );
  const s = roomy.shown.find((c) => c.key === 's')!;
  expect(s.narrow).toBe(true);
  expect(s.beside).toBeGreaterThan(60);
  expect(s.x + s.width + 6 + s.beside!).toBeLessThanOrEqual(RX(10));
  const tight = chipLayout(
    chips(
      [
        { key: 's', title: 'Standup', start: iso('09:00'), end: iso('09:15') },
        { key: 'r', title: 'Design review', start: iso('09:20'), end: iso('11:00') },
      ],
      now,
    ),
  );
  expect(tight.shown.find((c) => c.key === 's')!.beside).toBeNull();
});

it('draws the agent bars and focus line dimmed only after 9 PM', () => {
  expect(isLate(t('20:59'))).toBe(false);
  expect(isLate(t('21:00'))).toBe(true);
  expect(isLate(t('23:30'))).toBe(true);
  expect(isLate(t('08:00'))).toBe(false);
});

it('the needle counts down to the next meeting, names one in progress, or says none are left', () => {
  const now = t('10:24');
  const all = chips(
    [
      { key: 'a', title: 'Design review', start: iso('10:00'), end: iso('11:00') },
      { key: 'b', title: 'Planning', start: iso('12:00'), end: iso('12:30') },
    ],
    now,
  );
  expect(needleTip(all, now, true)).toBe('10:24. Next meeting in 1 h 36 m: Planning');
  expect(needleTip(all.slice(0, 1), now, true)).toBe('10:24. In Design review until 11:00, nothing after it today');
  expect(needleTip([], now, true)).toBe('10:24. No more meetings today');
  expect(needleTip([], now, false)).toBe('10:24');
});

it('marks a chip narrower than 44 px as narrow', () => {
  const out = chips(
    [
      { key: 'short', title: 'Standup', start: iso('09:00'), end: iso('09:15') }, // 32 px
      { key: 'long', title: 'Review', start: iso('10:00'), end: iso('10:30') }, // 64 px
    ],
    t('08:00'),
  );
  expect(out.map((c) => [c.key, c.narrow])).toEqual([
    ['short', true],
    ['long', false],
  ]);
});
