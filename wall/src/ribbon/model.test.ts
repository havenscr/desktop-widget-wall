import { expect, it } from 'vitest';
import { chips, focusBars, hourLabels, hourText, needle, RIBBON_WIDTH, RX, shortTime, skyGradient, sunLabels, ticks, wallHour } from './model';
import { sunTimes } from './sun';
import { usePacificTime } from './testZone';

usePacificTime();

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
