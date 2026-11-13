import { describe, expect, it } from 'vitest';
import { bump, dayKey, defaultPet, moodOf, parsePet, rollDay, todayLines, unlocked, emptyToday, type MoodInput } from './pet';

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
