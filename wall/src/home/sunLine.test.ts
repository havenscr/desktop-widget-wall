import { expect, it } from 'vitest';
import { usePacificTime } from '../ribbon/testZone';
import { sunTimes } from '../ribbon/sun';
import { clockText, sunHeadline, sunLine } from './sunLine';

usePacificTime();

const at = (t: string) => Date.parse(`2026-11-11T${t}-08:00`);

it('says Sunset in N min, in amber, within 90 minutes before sunset', () => {
  const set = Math.round(sunTimes(at('12:00:00')).set! / 60_000) * 60_000;
  const line = sunLine(set - 4 * 60_000)!;
  expect(line).toEqual({ key: 'Sunset in 4 min', text: `The sun goes down at ${clockText(set)}`, soon: true });
  expect(sunLine(set - 90 * 60_000)!.soon).toBe(true);
  expect(sunLine(set - 91 * 60_000)!.soon).toBe(false);
});

it('earlier in the day gives the sunset time and the daylight left', () => {
  const line = sunLine(at('10:24:00'))!;
  expect(line.soon).toBe(false);
  expect(line.key).toMatch(/^Sunset at 4:3\d PM$/);
  expect(line.text).toMatch(/^6 h \d+ min of daylight left$/);
});

it('before sunrise gives the sunrise time; after sunset, tomorrow sunrise', () => {
  expect(sunLine(at('05:30:00'))!.key).toMatch(/^Sunrise at 7:0\d AM$/);
  const night = sunLine(at('21:00:00'))!;
  expect(night.key).toMatch(/^Sunset, 4:3\d PM$/);
  expect(night.text).toMatch(/^Sunrise at 7:\d\d AM tomorrow$/);
});

it('formats clock times with minutes', () => {
  expect(clockText(at('16:05:00'))).toBe('4:05 PM');
  expect(clockText(at('00:30:00'))).toBe('12:30 AM');
});

it('headline: daylight left by day, Sunset in N min in amber inside 90 minutes, tomorrow sunrise after sunset', () => {
  const set = Math.round(sunTimes(at('12:00:00')).set! / 60_000) * 60_000;
  expect(sunHeadline(at('10:28:00'))).toEqual({ text: expect.stringMatching(/^6 h \d+ min of daylight left$/), soon: false });
  expect(sunHeadline(set - 53 * 60_000)).toEqual({ text: 'Sunset in 53 min', soon: true });
  expect(sunHeadline(at('21:10:00'))).toEqual({ text: expect.stringMatching(/^Sunrise at 7:\d\d AM tomorrow$/), soon: false });
});

it('headline: the 90 minute rule flips at exactly 90 and 91 minutes', () => {
  const set = Math.round(sunTimes(at('12:00:00')).set! / 60_000) * 60_000;
  expect(sunHeadline(set - 90 * 60_000)!.soon).toBe(true);
  expect(sunHeadline(set - 91 * 60_000)!.soon).toBe(false);
  expect(sunHeadline(set - 91 * 60_000)!.text).toMatch(/of daylight left$/);
});

it('headline: before sunrise is the short sunrise line, not the long sentence', () => {
  expect(sunHeadline(at('05:30:00'))).toEqual({ text: expect.stringMatching(/^Sunrise at 7:0\d AM$/), soon: false });
});
