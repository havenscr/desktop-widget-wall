import { expect, it } from 'vitest';
import type { Moods } from './home';
import { OFFICE_OFF, TEXT } from './homeStore';
import { CHIP_FIXED, chipTip, fitMoodRow, LABEL_MARGIN, moodFailText, moodLine, NAME_MIN, ROW_GAP, ROW_MAX, rowModel, swatchFor } from './moodRow';

const NEUTRAL = ['#b7afd6', '#5b5480'];

it('swatchFor matches plain words inside the lower-cased id, first row wins', () => {
  expect(swatchFor('partyMusic')).toEqual(['#35e6ea', '#8b5cf6', '#ff4fa3']);
  expect(swatchFor('disco')).toEqual(['#35e6ea', '#8b5cf6', '#ff4fa3']);
  expect(swatchFor('cameraReady')).toEqual(['#ffffff', '#ffe9cf']);
  expect(swatchFor('videoCall')).toEqual(['#ffffff', '#ffe9cf']);
  expect(swatchFor('stream')).toEqual(['#ffffff', '#ffe9cf']);
  expect(swatchFor('softScreen')).toEqual(['#e9e4da', '#bcd0f0']);
  expect(swatchFor('brightDesk')).toEqual(['#f3f5ff', '#cfe0ff']);
  expect(swatchFor('readLamp')).toEqual(['#f3f5ff', '#cfe0ff']);
  expect(swatchFor('windDown')).toEqual(['#ffb975', '#ff8a4d']);
  expect(swatchFor('calmMorning')).toEqual(['#ffb975', '#ff8a4d']);
  expect(swatchFor('workDay')).toEqual(['#ffd7a3', '#ff4fa3']);
  expect(swatchFor('gaming')).toEqual(['#8b5cf6', '#35e6ea']);
  expect(swatchFor('tidyUp')).toEqual(NEUTRAL);
  expect(swatchFor('x')).toEqual(NEUTRAL);
  // Rows in table order: music beats video, screen beats focus-like words.
  expect(swatchFor('musicVideo')).toEqual(['#35e6ea', '#8b5cf6', '#ff4fa3']);
  expect(swatchFor('screenBright')).toEqual(['#e9e4da', '#bcd0f0']);
  // "work" comes after "wind down" words but before the neutral row; "day" alone is work.
  expect(swatchFor('dayShift')).toEqual(['#ffd7a3', '#ff4fa3']);
});

const chipsWidth = (widths: number[], off = 0, label = 0) => {
  const items = widths.map((w) => CHIP_FIXED + Math.ceil(w));
  if (off) items.push(off);
  return items.reduce((a, b) => a + b, 0) + (items.length - 1 + (label ? 1 : 0)) * ROW_GAP + (label ? label + LABEL_MARGIN : 0);
};

it('fitMoodRow: as is when it fits, the label goes first, then long names shrink, never under the minimum', () => {
  const label = 150;
  const off = 80;
  // Fits: as is.
  expect(fitMoodRow([60, 70, 80], label, off)).toEqual({ label: true, cap: null });
  // Six names that overflow only with the label: the label drops, no name is cut.
  const six = [150, 140, 130, 125, 120, 115];
  expect(chipsWidth(six, off, label)).toBeGreaterThan(ROW_MAX);
  expect(chipsWidth(six, off)).toBeLessThanOrEqual(ROW_MAX);
  expect(fitMoodRow(six, label, off)).toEqual({ label: false, cap: null });
  // Overflow without the label: every name is cut at the largest shared width that fits (long ones first).
  const long = [300, 260, 200, 150, 90, 60, 40, 330];
  const fit = fitMoodRow(long, label, off);
  expect(fit.label).toBe(false);
  expect(fit.cap).not.toBeNull();
  const cap = fit.cap as number;
  expect(chipsWidth(long.map((w) => Math.min(w, cap)), off)).toBeLessThanOrEqual(ROW_MAX);
  expect(chipsWidth(long.map((w) => Math.min(w, cap + 1)), off)).toBeGreaterThan(ROW_MAX);
  // A name shorter than the cap keeps its whole width.
  expect(cap).toBeLessThan(260);
  expect(cap).toBeGreaterThan(NAME_MIN);
});

it('fitMoodRow: twelve 40 character names, with Off, stay within 1250 and never under the minimum text', () => {
  const names = Array.from({ length: 12 }, () => 330);
  const fit = fitMoodRow(names, 170, 80);
  expect(fit.label).toBe(false);
  expect(fit.cap).toBeGreaterThanOrEqual(NAME_MIN);
  const total = chipsWidth(names.map((w) => Math.min(w, fit.cap as number)), 80);
  expect(total).toBeLessThanOrEqual(ROW_MAX);
  // Off is counted: with a very wide Off chip the cap is smaller.
  const wide = fitMoodRow(names, 170, 300);
  expect(wide.cap as number).toBeLessThan(fit.cap as number);
  // The least a chip can be is the 88 px a click needs.
  expect(CHIP_FIXED + NAME_MIN).toBeGreaterThanOrEqual(88);
  // Twelve at the minimum with Off and gaps never pass 1250.
  expect(chipsWidth(Array(12).fill(NAME_MIN), 80)).toBeLessThanOrEqual(ROW_MAX);
  // Too wide even at the minimum is clamped to the minimum.
  expect(fitMoodRow(Array(12).fill(500), 170, 600).cap).toBe(NAME_MIN);
});

const moods = (over: Partial<Moods> = {}): Moods => ({
  stale: false,
  moods: [
    { id: 'brightDesk', label: 'Bright desk', line: 'Room 70%, neon 20%', active: false },
    { id: 'windDown', label: 'Wind down', line: null, active: false },
  ],
  off: null,
  canWrite: true,
  writeBlock: null,
  ...over,
});
const s0 = { applying: null, moodFail: null, sticky: null } as const;

it('the line follows its priority: sticky, 5 s failure, write block, in flight, mood, Off, nothing', () => {
  const lit = moods({ moods: [{ id: 'brightDesk', label: 'Bright desk', line: 'Room 70%', active: true }, { id: 'windDown', label: 'Wind down', line: null, active: false }], off: { active: false } });
  const text = (l: ReturnType<typeof moodLine>) => `${l.lead ?? ''}${l.rest}`;
  expect(moodLine(moods(), s0)).toEqual({ lead: null, rest: 'No mood on.', warn: false });
  expect(moodLine(moods({ off: { active: true } }), s0)).toEqual({ lead: null, rest: 'Office lights are off.', warn: false });
  expect(moodLine(moods({ off: { active: false } }), s0).rest).toBe('No mood on.');
  expect(text(moodLine(lit, s0))).toBe('Bright desk: Room 70%');
  const noLine = moods({ moods: [{ id: 'windDown', label: 'Wind down', line: null, active: true }] });
  expect(text(moodLine(noLine, s0))).toBe('Wind down is on.');
  // In flight beats the mood that is on; the clicked name leads.
  expect(text(moodLine(lit, { ...s0, applying: 'windDown' }))).toBe('Wind down: asking the home app');
  expect(text(moodLine(lit, { ...s0, applying: OFFICE_OFF }))).toBe('Off: asking the home app');
  // The write block beats in flight, a failure beats the block, sticky beats the failure.
  const blocked = { ...lit, canWrite: false, writeBlock: 'not-set-up' as const };
  expect(moodLine(blocked, { ...s0, applying: 'windDown' })).toEqual({ lead: null, rest: TEXT.notSetUp, warn: true });
  expect(moodLine({ ...blocked, writeBlock: 'needs-private-address' }, s0).rest).toBe(TEXT.needsPrivate);
  expect(moodLine(blocked, { ...s0, moodFail: { id: 'windDown', word: 'busy' } })).toEqual({ lead: null, rest: TEXT.busy, warn: true });
  expect(moodLine(blocked, { ...s0, moodFail: { id: 'windDown', word: 'busy' }, sticky: 'forbidden' })).toEqual({ lead: null, rest: TEXT.forbidden, warn: true });
  expect(moodLine(lit, { ...s0, sticky: 'home-not-set-up' })).toEqual({ lead: null, rest: TEXT.homeNotSetUp, warn: true });
});

it('a stale read ends its calm lines with (not fresh), never the amber ones', () => {
  const stale = (m: Partial<Moods> = {}) => moods({ stale: true, ...m });
  const lit = stale({ moods: [{ id: 'brightDesk', label: 'Bright desk', line: 'Room 70%', active: true }] });
  expect(moodLine(lit, s0).rest).toBe(' Room 70% (not fresh)');
  expect(moodLine(stale({ moods: [{ id: 'windDown', label: 'Wind down', line: null, active: true }] }), s0).rest).toBe(' is on. (not fresh)');
  expect(moodLine(stale(), s0).rest).toBe('No mood on. (not fresh)');
  expect(moodLine(stale({ off: { active: true } }), s0).rest).toBe('Office lights are off. (not fresh)');
  expect(moodLine(stale(), { ...s0, moodFail: { id: 'x', word: 'failed' } }).rest).toBe(TEXT.failed);
});

it('moodFailText reuses the write texts, plus on air; an unlisted word is the plain failure', () => {
  expect(moodFailText('on-air')).toBe(TEXT.onAir);
  expect(moodFailText('room-dark')).toBe(TEXT.roomDark);
  expect(moodFailText('not-answering')).toBe(TEXT.notAnswering);
  expect(moodFailText('unreachable')).toBe(TEXT.unreachable);
  expect(moodFailText('unknown')).toBe(TEXT.unknown);
  expect(moodFailText('refused')).toBe(TEXT.refused);
  expect(moodFailText('nothing-to-undo')).toBe(TEXT.nothingToUndo);
  expect(moodFailText('absent')).toBe(TEXT.failed);
  expect(moodFailText('failed')).toBe(TEXT.failed);
});

it('rowModel: hidden unless a good read lists a mood; Off only with off; Off lit only when no mood is', () => {
  const base = { applying: null, moodFail: null, sticky: null };
  expect(rowModel({ ...base, moods: null, moodsWord: null })).toBeNull();
  expect(rowModel({ ...base, moods: moods(), moodsWord: 'unreachable' })).toBeNull();
  expect(rowModel({ ...base, moods: moods({ moods: [] }), moodsWord: null })).toBeNull();
  const plain = rowModel({ ...base, moods: moods(), moodsWord: null })!;
  expect(plain.chips.map((c) => c.id)).toEqual(['brightDesk', 'windDown']);
  const withOff = rowModel({ ...base, moods: moods({ off: { active: true } }), moodsWord: null })!;
  expect(withOff.chips.map((c) => c.id)).toEqual(['brightDesk', 'windDown', null]);
  expect(withOff.chips[2]).toMatchObject({ label: 'Off', lit: true, swatch: null });
  const both = rowModel({ ...base, moods: moods({ off: { active: true }, moods: [{ id: 'windDown', label: 'Wind down', line: null, active: true }] }), moodsWord: null })!;
  expect(both.chips[1].lit).toBe(false);
  expect(both.chips[0].lit).toBe(true);
  const busy = rowModel({ ...base, applying: OFFICE_OFF, moods: moods({ off: { active: false } }), moodsWord: null })!;
  expect(busy.waiting).toBe(true);
  expect(busy.chips[2].busy).toBe(true);
  const failed = rowModel({ ...base, moodFail: { id: 'windDown', word: 'busy' }, moods: moods(), moodsWord: null })!;
  expect(failed.chips[1].failed).toBe(true);
  expect(failed.warnText).toBe(TEXT.busy);
});

it('chipTip: name and line, a second line for a block, a failure or a write in flight, Off its own words', () => {
  const base = { applying: null, moodFail: null, sticky: null, moodsWord: null };
  const lit = rowModel({ ...base, moods: moods({ off: { active: false }, moods: [{ id: 'brightDesk', label: 'Bright desk', line: 'Room 70%, neon 20%', active: true }, { id: 'windDown', label: 'Wind down', line: null, active: false }] }) })!;
  expect(chipTip(lit, lit.chips[0])).toEqual({ first: 'Bright desk: Room 70%, neon 20%', second: null, warn: false });
  expect(chipTip(lit, lit.chips[1]).first).toBe('Wind down');
  expect(chipTip(lit, lit.chips[2]).first).toBe('Turns the office lights off. No other room changes.');
  const off = rowModel({ ...base, moods: moods({ off: { active: true } }) })!;
  expect(chipTip(off, off.chips[2]).first).toBe('Office lights are off.');
  const waiting = rowModel({ ...base, applying: 'windDown', moods: moods() })!;
  expect(chipTip(waiting, waiting.chips[0])).toMatchObject({ second: 'Asking the home app', warn: false });
  const blocked = rowModel({ ...base, moods: moods({ canWrite: false, writeBlock: 'not-set-up' }) })!;
  expect(chipTip(blocked, blocked.chips[0])).toMatchObject({ second: TEXT.notSetUp, warn: true });
  const failed = rowModel({ ...base, moodFail: { id: 'windDown', word: 'on-air' }, moods: moods() })!;
  expect(chipTip(failed, failed.chips[0]).second).toBe(TEXT.onAir);
});
