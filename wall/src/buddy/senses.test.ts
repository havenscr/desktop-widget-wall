import { describe, expect, it } from 'vitest';
import type { Lane } from '../agents/model';
import type { WeatherReading } from '../weather/model';
import { cloverDue, cloverTimes, dayTopic, finishedBetween, senseWeather, weatherTopics, workingIds, WEATHER_FRESH_MS } from './senses';

const reading = (icon: string, temp: number, fetchedAt: number): WeatherReading =>
  ({ temp, look: { label: icon, icon }, high: temp, low: temp, hours: [], fetchedAt }) as unknown as WeatherReading;
const lane = (id: string, over: Partial<Lane> = {}): Lane => ({ id, title: id, stage: 'build', state: 'working', line: '', elapsedS: 0, waiting: false, pr: null, ...over });

describe('what she senses', () => {
  it('reads rain, sun, cold from a fresh reading and nothing from a stale or missing one', () => {
    const now = 1_000_000_000;
    expect(weatherTopics(senseWeather(reading('rain', 38, now), now))).toEqual(['rain', 'cold']);
    expect(senseWeather(reading('sun', 70, now), now).clear).toBe(true);
    expect(senseWeather(reading('moon', 70, now), now).clear).toBe(false);
    expect(weatherTopics(senseWeather(reading('rain', 38, now - WEATHER_FRESH_MS - 1), now))).toEqual([]);
    expect(weatherTopics(senseWeather(null, now))).toEqual([]);
  });
  it('names the part of the day', () => {
    expect([7, 12, 15, 19, 21].map(dayTopic)).toEqual(['morning', 'midday', 'afternoon', 'evening', 'evening']);
  });
  it('counts agents that finished by the summary: at a pull request, or gone with a done span; not dismissed or waiting', () => {
    const before = workingIds([lane('a'), lane('b'), lane('c'), lane('d', { waiting: true })]);
    expect([...before]).toEqual(['a', 'b', 'c']);
    // b reached a pull request; c left the list as done: two. c leaving with no done span: one.
    const done = [{ lane: 'c', start: '2026-11-11T10:00:00Z', end: '2026-11-11T10:30:00Z', kind: 'done' as const }];
    expect(finishedBetween(before, [lane('a'), lane('b', { stage: 'pr', state: 'review' }), lane('d', { waiting: true })], done)).toBe(2);
    expect(finishedBetween(before, [lane('a'), lane('b', { stage: 'pr', state: 'review' })])).toBe(1);
    const runLast = [...done, { lane: 'c', start: '2026-11-11T10:40:00Z', end: null, kind: 'run' as const }];
    expect(finishedBetween(before, [lane('a'), lane('b')], runLast)).toBe(0);
    expect(finishedBetween(before, [lane('a'), lane('b'), lane('c', { waiting: true })])).toBe(0);
  });
  it('grows two clovers a day at times that change with the date', () => {
    const [a, b] = cloverTimes('2026-11-11');
    expect(a).toBeGreaterThanOrEqual(600);
    expect(a).toBeLessThan(720);
    expect(b).toBeGreaterThanOrEqual(900);
    expect(b).toBeLessThan(990);
    expect(cloverTimes('2026-11-12')).not.toEqual([a, b]);
    expect(cloverDue('2026-11-11', a - 1, 0)).toBeNull();
    expect(cloverDue('2026-11-11', a, 0)).toBe(1);
    expect(cloverDue('2026-11-11', b - 1, 1)).toBeNull();
    expect(cloverDue('2026-11-11', b, 1)).toBe(2);
    // Starting late: one clover only.
    expect(cloverDue('2026-11-11', b + 10, 0)).toBe(2);
    expect(cloverDue('2026-11-11', b + 20, 2)).toBeNull();
  });
});
