import { describe, expect, it } from 'vitest';
import { lengthLine, marksLine, parseLast, whenLine } from './lastOnAir';

describe('the last time on air record', () => {
  it('reads a good record and refuses anything else', () => {
    expect(parseLast(JSON.stringify({ endedAt: 5, mode: 'live', lengthMs: 3_492_000, marks: 4 }))).toEqual({ endedAt: 5, mode: 'live', lengthMs: 3_492_000, marks: 4 });
    for (const bad of [null, '', 'x', '[]', '{}', JSON.stringify({ endedAt: 5, mode: 'none', lengthMs: 1, marks: 1 }), JSON.stringify({ endedAt: -1, mode: 'rec', lengthMs: 1, marks: 1 }), JSON.stringify({ endedAt: 5, mode: 'rec', lengthMs: 'a', marks: 1 })]) {
      expect(parseLast(bad)).toBeNull();
    }
  });
  it('says the length and the marks in words', () => {
    expect(lengthLine({ endedAt: 0, mode: 'live', lengthMs: 3_492_000, marks: 4 })).toBe('Live for 58:12');
    expect(lengthLine({ endedAt: 0, mode: 'meet', lengthMs: 60_000, marks: 0 })).toBe('Presenting for 01:00');
    expect([0, 1, 4].map(marksLine)).toEqual(['No marks saved', '1 mark saved', '4 marks saved']);
  });
  it('says today and yesterday', () => {
    const now = new Date(2026, 10, 12, 15, 0).getTime();
    expect(whenLine(new Date(2026, 10, 12, 9, 12).getTime(), now)).toMatch(/^Today, /);
    expect(whenLine(new Date(2026, 10, 11, 9, 12).getTime(), now)).toMatch(/^Yesterday, /);
    expect(whenLine(new Date(2026, 10, 1, 9, 12).getTime(), now)).not.toMatch(/Today|Yesterday/);
  });
});
