import { expect, it } from 'vitest';
import { chipLayout, chips, focusBars, needleTip, hourLabels, hourText, needle, RIBBON_WIDTH, RX, shortTime, skyGradient, sunLabels, ticks, wallHour } from './model';
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

it('puts each overlapping event in the first free lane, and a third concurrent one into a "+N" chip', () => {
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
  expect(shown.map((c) => [c.key, c.lane])).toEqual([
    ['a', 0],
    ['b', 1],
    ['e', 1],
    ['c', 0],
  ]);
  expect(more).toEqual([]);
});

const overlapFree = (shown: { x: number; width: number; lane: number }[], more: { x: number; width: number; lane: number }[]) => {
  const boxes = [...shown, ...more];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const p = boxes[i];
      const q = boxes[j];
      if (p.lane === q.lane) expect(p.x + p.width <= q.x || q.x + q.width <= p.x).toBe(true);
    }
};

it('three events at the same time: two lanes and a "+1" chip that lists the third', () => {
  const now = t('08:00');
  const all = chips(
    [
      { key: 'a', title: 'One', start: iso('10:00'), end: iso('11:00') },
      { key: 'b', title: 'Two', start: iso('10:00'), end: iso('11:00') },
      { key: 'c', title: 'Three', start: iso('10:00'), end: iso('11:00') },
    ],
    now,
  );
  const { shown, more } = chipLayout(all);
  // The "+N" chip sits in the second lane, so the second-lane chip under it joins its list.
  expect(shown.map((c) => c.key)).toEqual(['a']);
  expect(more).toHaveLength(1);
  expect(more[0].items.map((c) => c.key).sort()).toEqual(['b', 'c']);
  overlapFree(shown, more);
});

it('five events at once fold into one "+N" chip, and later ones lay out normally', () => {
  const now = t('08:00');
  const all = chips(
    [
      ...['a', 'b', 'c', 'd', 'e'].map((k, i) => ({ key: k, title: `Meeting ${k}`, start: iso(`14:0${i}`), end: iso('15:00') })),
      { key: 'f', title: 'Later', start: iso('17:00'), end: iso('17:30') },
    ],
    now,
  );
  const { shown, more } = chipLayout(all);
  expect(shown.map((c) => c.key)).toEqual(['a', 'f']);
  expect(more).toHaveLength(1);
  expect(more[0].items).toHaveLength(4);
  overlapFree(shown, more);
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
