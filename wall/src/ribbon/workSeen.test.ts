import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { dayStart } from './days';
import { clearWorkSeen, noteWorking, resetWorkSeenMemory, seenWorking } from './workSeen';
import { usePacificTime } from './testZone';

usePacificTime();

const D = '2026-11-11';
const at = (hm: string, day = D) => Date.parse(`${day}T${hm}:00-08:00`);
const stored = () => JSON.parse(window.localStorage.getItem('wall2.workSeen') ?? 'null');

beforeEach(() => clearWorkSeen());
afterEach(() => {
  clearWorkSeen();
  vi.restoreAllMocks();
});

it('keeps ids and times only, keyed by day, and survives a reload', () => {
  noteWorking(['a', 'b'], at('10:00'));
  noteWorking(['a'], at('10:30'));
  expect(stored()).toEqual({ day: D, seen: { a: at('10:30'), b: at('10:00') } });
  resetWorkSeenMemory();
  expect([...seenWorking(at('11:00'))]).toEqual([['a', at('10:30')], ['b', at('10:00')]]);
});

it('a time never moves backwards', () => {
  noteWorking(['a'], at('10:30'));
  noteWorking(['a'], at('10:00'));
  expect(seenWorking(at('11:00')).get('a')).toBe(at('10:30'));
});

it('another day drops the earlier day\'s record', () => {
  noteWorking(['a'], at('10:00', '2026-11-10'));
  noteWorking(['b'], at('10:00'));
  expect(stored()).toEqual({ day: D, seen: { b: at('10:00') } });
  expect(seenWorking(at('11:00')).has('a')).toBe(false);
});

it('is bounded: only the newest 200 ids are kept', () => {
  noteWorking(Array.from({ length: 260 }, (_, i) => `s${i}`), at('10:00'));
  for (let i = 0; i < 10; i++) noteWorking([`late${i}`], at('10:00') + 1000 * (i + 1));
  expect(Object.keys(stored().seen).length).toBeLessThanOrEqual(200);
  expect(Object.keys(stored().seen)).toContain('late9');
});

it('what is read back is checked: junk, another day, odd times and long ids are ignored', () => {
  const put = (v: unknown) => window.localStorage.setItem('wall2.workSeen', typeof v === 'string' ? v : JSON.stringify(v));
  for (const bad of ['not json', '[]', { day: D }, { day: '2026-11-10', seen: { a: at('10:00') } }, { day: D, seen: [1] }]) {
    put(bad);
    resetWorkSeenMemory();
    expect(seenWorking(at('11:00')).size).toBe(0);
  }
  put({ day: D, seen: { ok: at('10:00'), early: dayStart(D) - 1, late: at('10:00') + 30 * 3_600_000, text: 'x', nan: null, ['y'.repeat(200)]: at('10:00') } });
  resetWorkSeenMemory();
  expect([...seenWorking(at('11:00')).keys()]).toEqual(['ok']);
});

it('a blocked or full store never throws and the memory still serves', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('full');
  });
  resetWorkSeenMemory();
  expect(() => noteWorking(['a'], at('10:00'))).not.toThrow();
  expect(seenWorking(at('11:00')).get('a')).toBe(at('10:00'));
});
