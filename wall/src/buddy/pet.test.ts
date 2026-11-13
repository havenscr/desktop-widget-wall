import { describe, expect, it } from 'vitest';
import { MAX_COUNT, MAX_DAYS, MAX_RAW, bump, dayKey, defaultPet, moodOf, parsePet, rollDay, todayLines, unlocked, emptyToday, type MoodInput, type PetData } from './pet';

const at = (d: number, h = 12) => new Date(2026, 10, d, h).getTime();

describe('her stored life', () => {
  it('starts sometimes chatty, nothing worn, and reads back what was stored; junk falls back', () => {
    const d = defaultPet(at(11));
    expect(d).toMatchObject({ chatty: 'sometimes', cosmetic: 'none', days: 0 });
    expect(parsePet(JSON.stringify({ ...d, chatty: 'off', cosmetic: 'star', days: 4 }), at(11))).toMatchObject({ chatty: 'off', cosmetic: 'star', days: 4 });
    expect(parsePet('not json', at(11))).toEqual(d);
    expect(parsePet(JSON.stringify({ chatty: 'loud', cosmetic: 'crown', days: -3, today: { date: '2026-11-11', pets: 'x' } }), at(11))).toMatchObject({
      chatty: 'sometimes',
      cosmetic: 'none',
      days: 0,
      today: { date: '2026-11-11', pets: 0 },
    });
  });
  it('counts a day together once per date and starts today afresh on a new date', () => {
    let d = rollDay(defaultPet(at(11)), at(11, 9));
    expect(d.days).toBe(1);
    d = rollDay(bump(d, 'pets', at(11, 10)), at(11, 20));
    expect(d.days).toBe(1);
    expect(d.today.pets).toBe(1);
    d = rollDay(d, at(12, 8));
    expect(d.days).toBe(2);
    expect(d.today).toEqual(emptyToday(dayKey(at(12))));
  });
  it('a clock step back and forward again adds no days, unlocks nothing early and keeps today', () => {
    let d = rollDay(defaultPet(at(11)), at(11, 9));
    d = bump(bump(d, 'pets', at(11, 10)), 'songs', at(11, 10));
    // Back two days (a wrong clock), then forward to the real date again.
    const back = rollDay(d, at(9, 10));
    expect(back).toBe(d);
    const bumped = bump(back, 'pets', at(9, 11));
    expect(bumped.days).toBe(1);
    expect(bumped.today).toMatchObject({ date: dayKey(at(11)), pets: 2, songs: 1 });
    expect(rollDay(bumped, at(11, 12))).toBe(bumped);
    expect(rollDay(bumped, at(12, 8)).days).toBe(2);
  });
  it('a time zone change to an earlier date and back counts once', () => {
    // 00:30 on the 12th, then a zone change shows 23:30 on the 11th, then back to the 12th.
    let d = rollDay(defaultPet(at(11)), at(11, 20));
    d = rollDay(d, at(12, 0));
    expect(d.days).toBe(2);
    d = rollDay(d, at(11, 23));
    d = rollDay(d, at(12, 1));
    expect(d.days).toBe(2);
  });
  it('a stored date later than today is reset to today and the days are kept', () => {
    const later = JSON.stringify({ days: 7, lastDay: '2099-01-01', today: { date: '2099-01-01', pets: 3 } });
    const p = parsePet(later, at(11));
    expect(p.days).toBe(7);
    expect(p.lastDay).toBe(p.today.date);
    expect(p.today.date).toBe(defaultPet(at(11)).today.date);
    expect(p.today.pets).toBe(0);
    // The count then moves on normally the next day.
    expect(rollDay(p, at(11) + 24 * 3600_000).days).toBe(8);
  });

  it('rejects oversized, corrupted and out of range values; takes off a cosmetic not yet unlocked', () => {
    const base = defaultPet(at(11));
    expect(parsePet('x'.repeat(MAX_RAW + 1), at(11))).toEqual(base);
    expect(parsePet('null', at(11))).toEqual(base);
    expect(parsePet('[1,2]', at(11)).days).toBe(0);
    const big: Partial<PetData> = { days: 1e9, cosmetic: 'cape', lastDay: 'yesterday', today: { date: '2026-11-11', pets: 1e12, songs: -4, naps: 2.7, clovers: NaN, focus: 1, agents: 0, grown: 0 } };
    const p = parsePet(JSON.stringify(big), at(11));
    expect(p.days).toBe(MAX_DAYS);
    expect(p.cosmetic).toBe('cape');
    expect(p.lastDay).toBeNull();
    expect(p.today).toMatchObject({ pets: MAX_COUNT, songs: 0, naps: 2, clovers: 0 });
    expect(parsePet(JSON.stringify({ days: 2, cosmetic: 'cape' }), at(11)).cosmetic).toBe('none');
    expect(parsePet(JSON.stringify({ today: { date: '11/11/2026', pets: 3 } }), at(11)).today.pets).toBe(0);
  });
  it('unlocks the bow on day one, the star on day three, the cape on day seven', () => {
    expect([unlocked('bow', 1), unlocked('star', 2), unlocked('star', 3), unlocked('cape', 6), unlocked('cape', 7), unlocked('none', 0)]).toEqual([true, false, true, false, true, true]);
  });
});

describe('her mood', () => {
  const base: MoodInput = { hour: 14, minute: 0, today: emptyToday('2026-11-11'), playing: false, goodWeather: false, novelty: false };
  it('is content by default and never lower, however long she is ignored', () => {
    expect(moodOf(base)).toBe('content');
  });
  it('music, pets, finished focus and good weather lift it to happy', () => {
    expect(moodOf({ ...base, playing: true, goodWeather: true, today: { ...base.today, pets: 1 } })).toBe('happy');
    expect(moodOf({ ...base, today: { ...base.today, focus: 2, pets: 1 } })).toBe('happy');
  });
  it('late evening and early morning make her sleepy; something new makes her curious', () => {
    expect(moodOf({ ...base, hour: 20, minute: 30 })).toBe('sleepy');
    expect(moodOf({ ...base, hour: 6, minute: 45 })).toBe('sleepy');
    expect(moodOf({ ...base, novelty: true })).toBe('curious');
  });
});

describe('today on her card', () => {
  it('gives two honest lines from the counts that are not zero', () => {
    expect(todayLines({ ...emptyToday('d'), naps: 2, songs: 9 })).toEqual(['Danced to nine songs.', 'Napped twice.']);
    expect(todayLines({ ...emptyToday('d'), pets: 1 })).toEqual(['Petted once.']);
    expect(todayLines(emptyToday('d'))).toEqual(['Quiet day so far.']);
  });
});

describe('his Stay, stored', () => {
  const key = dayKey(at(11));
  const withStay = (stay: unknown) => JSON.stringify({ ...defaultPet(at(11)), stay });
  it('reads a whole Stay back', () => {
    expect(parsePet(withStay({ place: 'unwind', x: 450, date: key }), at(11)).stay).toEqual({ place: 'unwind', x: 450, date: key });
    expect(defaultPet(at(11)).stay).toBeNull();
  });
  it('drops anything that is not whole: wrong types, an unknown place, an x off the stage, a date that is not today, extra junk', () => {
    for (const bad of [
      'unwind',
      7,
      [],
      { place: 'zen', x: 450, date: key },
      { place: 'work', x: '450', date: key },
      { place: 'work', x: Number.NaN, date: key },
      { place: 'work', x: -1, date: key },
      { place: 'work', x: 2561, date: key },
      { place: 'work', x: 1e308, date: key },
      { place: 'work', x: 450, date: '2026-11-10' },
      { place: 'work', x: 450, date: 'x'.repeat(100) },
      { place: 'work', x: 450 },
      { x: 450, date: key },
    ]) {
      expect(parsePet(withStay(bad), at(11)).stay, JSON.stringify(bad)).toBeNull();
    }
    // Only the three fields are kept.
    expect(Object.keys(parsePet(withStay({ place: 'work', x: 450, date: key, extra: 'z' }), at(11)).stay!).sort()).toEqual(['date', 'place', 'x']);
  });
  it('an oversized stored value is ignored whole', () => {
    expect(parsePet(withStay({ place: 'work', x: 450, date: key, junk: 'j'.repeat(MAX_RAW) }), at(11))).toEqual(defaultPet(at(11)));
  });
  it('rolling into a new day clears a Stay from the day before, and keeps one from today', () => {
    const d = parsePet(withStay({ place: 'home', x: 1600, date: key }), at(11));
    expect(rollDay(d, at(11, 23)).stay).not.toBeNull();
    expect(rollDay(d, at(12, 0)).stay).toBeNull();
  });
  it('survives counting a pet and rolling within the same day', () => {
    let d = parsePet(withStay({ place: 'home', x: 1600, date: key }), at(11));
    d = bump(rollDay(d, at(11, 13)), 'pets', at(11, 14));
    expect(d.stay).toEqual({ place: 'home', x: 1600, date: key });
  });
});
