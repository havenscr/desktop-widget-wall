import { expect, it } from 'vitest';
import { allDayChips, allDayText, allDayWidth, chipLayout, chips, focusBars, isAllDay, isLate, needleTip, hourLabels, hourText, needle, RIBBON_WIDTH, RX, shortTime, skyGradient, sunLabels, ticks, wallHour } from './model';
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

it('hides hour labels within 70 px of the needle and sun labels within 90 px', () => {
  const n = needle(t('10:24')).x; // RX(10.4) = 635.2
  const hours = hourLabels(n).map((l) => l.text);
  expect(hours).not.toContain('10 AM'); // 51 px away
  expect(hours).toContain('8 AM');
  expect(hours).toContain('12 PM'); // 154 px away
  expect(hours).toHaveLength(9);
  const sun = sunTimes(t('10:24'));
  expect(sunLabels(sun, t('10:24'), n).map((l) => l.text)).toEqual(['sunrise 7:09', 'sunset 4:37']);
  // At 4:36 the sunset label (8 px from the needle) hides and sunrise stays.
  const n2 = needle(t('16:36')).x;
  expect(sunLabels(sun, t('16:36'), n2).map((l) => l.text)).toEqual(['sunrise 7:09']);
  expect(hourLabels(n2).map((l) => l.text)).toContain('4 PM'); // 77 px away, shown as in f_home
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

it('five events at once fold into one full-height "+N" chip, and later ones lay out normally', () => {
  const now = t('08:00');
  const all = chips(
    [
      ...['a', 'b', 'c', 'd', 'e'].map((k, i) => ({ key: k, title: `Meeting ${k}`, start: iso(`14:0${i}`), end: iso('15:00') })),
      { key: 'f', title: 'Later', start: iso('17:00'), end: iso('17:30') },
    ],
    now,
  );
  const { shown, more } = chipLayout(all);
  expect(shown.map((c) => c.key)).toEqual(['f']);
  expect(more).toHaveLength(1);
  expect(more[0].items.map((c) => c.key)).toEqual(['a', 'b', 'c', 'd', 'e']);
  overlapFree(shown, more);
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
