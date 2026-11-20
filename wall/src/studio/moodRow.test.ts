import { expect, it } from 'vitest';
import type { Moods } from './home';
import { OFFICE_OFF, TEXT } from './homeStore';
// @ts-ignore node's own file calls; this test reads the stylesheet as text.
import { readFileSync } from 'node:fs';
import { BACK_FIXED, CHIP_FIXED, ICON_CHIP, chipTip, fitMoodRow, LABEL_MARGIN, MOOD_MAX, moodFailText, moodLine, NAME_MIN, OFF_FIXED, ROW_GAP, ROW_MAX, rowModel, swatchFor } from './moodRow';

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
  expect(swatchFor('eveningLamp')).toEqual(['#ffb975', '#ff8a4d']);
  expect(swatchFor('calmMorning')).toEqual(['#ffb975', '#ff8a4d']);
  expect(swatchFor('workDay')).toEqual(['#ffd7a3', '#ff4fa3']);
  expect(swatchFor('gaming')).toEqual(['#8b5cf6', '#35e6ea']);
  expect(swatchFor('tidyUp')).toEqual(NEUTRAL);
  expect(swatchFor('x')).toEqual(NEUTRAL);
  // Rows in table order: music beats video, screen beats focus-like words.
  expect(swatchFor('musicVideo')).toEqual(['#35e6ea', '#8b5cf6', '#ff4fa3']);
  expect(swatchFor('screenBright')).toEqual(['#e9e4da', '#bcd0f0']);
  // "work" comes after "evening" words but before the neutral row; "day" alone is work.
  expect(swatchFor('dayShift')).toEqual(['#ffd7a3', '#ff4fa3']);
});

const chipsWidth = (widths: number[], off = 0, label = 0, back = 0) => {
  const items = widths.map((w) => CHIP_FIXED + Math.ceil(w));
  if (off) items.push(off);
  if (back) items.push(back);
  return items.reduce((a, b) => a + b, 0) + (items.length - 1 + (label ? 1 : 0)) * ROW_GAP + (label ? label + LABEL_MARGIN : 0);
};

it('fitMoodRow: as is when it fits, the label goes first, then long names shrink, never under the minimum', () => {
  const label = 150;
  const off = 80;
  // Fits: as is.
  expect(fitMoodRow([60, 70, 80], label, off)).toMatchObject({ label: true, cap: null, backIcon: false, offIcon: false, clip: false });
  // Six names that overflow only with the label: the label drops, no name is cut.
  const six = [120, 110, 100, 95, 90, 85];
  expect(chipsWidth(six, off, label)).toBeGreaterThan(ROW_MAX);
  expect(chipsWidth(six, off)).toBeLessThanOrEqual(ROW_MAX);
  expect(fitMoodRow(six, label, off)).toMatchObject({ label: false, cap: null, backIcon: false, offIcon: false, clip: false });
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

it('fitMoodRow: twelve 40 character names, with Off, stay within 1124 and never under the minimum text', () => {
  const names = Array.from({ length: 12 }, () => 330);
  const fit = fitMoodRow(names, 170, 80);
  expect(fit.label).toBe(false);
  expect(fit.cap).toBeGreaterThanOrEqual(NAME_MIN);
  const total = chipsWidth(names.map((w) => Math.min(w, fit.cap as number)), 80);
  expect(total).toBeLessThanOrEqual(ROW_MAX);
  // Off is counted: with a very wide Off chip the cap is smaller.
  const wide = fitMoodRow(names, 170, 300);
  expect(wide.cap as number).toBeLessThan(fit.cap as number);
  // The true boundary: at the floor, the most moods the home app lists (12) plus the busiest Off chip fit ROW_MAX; one more chip would not.
  const busyOff = OFF_FIXED + 22 + 27;
  expect(chipsWidth(Array(MOOD_MAX).fill(NAME_MIN), busyOff)).toBeLessThanOrEqual(ROW_MAX);
  expect(chipsWidth(Array(MOOD_MAX + 1).fill(NAME_MIN), busyOff)).toBeGreaterThan(ROW_MAX);
  // Too wide even at the minimum is clamped to the minimum.
  expect(fitMoodRow(Array(12).fill(500), 170, 600).cap).toBe(NAME_MIN);
});

it('fitMoodRow: twelve moods with Off and As before stay inside ROW_MAX: Back to the arrow first, then Off, then a clip', () => {
  const names = (n: number) => Array.from({ length: n }, () => 330);
  const floor = (n: number) => Array(n).fill(NAME_MIN) as number[];
  const off = OFF_FIXED + 22 + 27;
  const back = BACK_FIXED + 125;
  // Eleven moods: at the floor the words do not fit, Back as the arrow does, so only Back changes.
  expect(chipsWidth(floor(11), off, 0, back)).toBeGreaterThan(ROW_MAX);
  expect(chipsWidth(floor(11), off, 0, ICON_CHIP)).toBeLessThanOrEqual(ROW_MAX);
  expect(fitMoodRow(names(11), 170, off, back)).toEqual({ label: false, cap: NAME_MIN, backIcon: true, offIcon: false, clip: false });
  // Twelve (the home app's most): the arrow is not enough, Off becomes its icon too, and the row fits.
  expect(chipsWidth(floor(MOOD_MAX), off, 0, ICON_CHIP)).toBeGreaterThan(ROW_MAX);
  expect(chipsWidth(floor(MOOD_MAX), ICON_CHIP, 0, ICON_CHIP)).toBeLessThanOrEqual(ROW_MAX);
  expect(fitMoodRow(names(MOOD_MAX), 170, off, back)).toEqual({ label: false, cap: NAME_MIN, backIcon: true, offIcon: true, clip: false });
  // Names are cut before any icon step: nine names still use the cap alone.
  expect(fitMoodRow(names(9), 170, off, back)).toMatchObject({ backIcon: false, offIcon: false, clip: false });
  // Last resort: more chips than the box holds even as icons clip the slot (mood chips keep their 76 px).
  expect(fitMoodRow(names(14), 170, off, back)).toEqual({ label: false, cap: NAME_MIN, backIcon: true, offIcon: true, clip: true });
  // Without Back or Off nothing becomes an icon.
  expect(fitMoodRow(names(MOOD_MAX), 170, 0, 0)).toMatchObject({ backIcon: false, offIcon: false, clip: false });
});

const moods = (over: Partial<Moods> = {}): Moods => ({
  stale: false,
  moods: [
    { id: 'brightDesk', label: 'Bright desk', line: 'Room 70%, neon 20%', active: false },
    { id: 'eveningLamp', label: 'Evening lamp', line: null, active: false },
  ],
  off: null,
  nudge: null,
  canWrite: true,
  writeBlock: null,
  ...over,
});
const s0 = { applying: null, moodFail: null, sticky: null } as const;

it('the line follows its priority: sticky, 5 s failure, write block, in flight, mood, Off, nothing', () => {
  const lit = moods({ moods: [{ id: 'brightDesk', label: 'Bright desk', line: 'Room 70%', active: true }, { id: 'eveningLamp', label: 'Evening lamp', line: null, active: false }], off: { active: false } });
  const text = (l: ReturnType<typeof moodLine>) => `${l.lead ?? ''}${l.rest}`;
  expect(moodLine(moods(), s0)).toEqual({ lead: null, rest: 'No mood on.', warn: false });
  expect(moodLine(moods({ off: { active: true } }), s0)).toEqual({ lead: null, rest: 'Office lights are off.', warn: false });
  expect(moodLine(moods({ off: { active: false } }), s0).rest).toBe('No mood on.');
  expect(text(moodLine(lit, s0))).toBe('Bright desk: Room 70%');
  const noLine = moods({ moods: [{ id: 'eveningLamp', label: 'Evening lamp', line: null, active: true }] });
  expect(text(moodLine(noLine, s0))).toBe('Evening lamp is on.');
  // In flight beats the mood that is on; the clicked name leads.
  expect(text(moodLine(lit, { ...s0, applying: 'eveningLamp' }))).toBe('Evening lamp: asking the home app');
  expect(text(moodLine(lit, { ...s0, applying: OFFICE_OFF }))).toBe('Off: asking the home app');
  // The write block beats in flight, a failure beats the block, sticky beats the failure.
  const blocked = { ...lit, canWrite: false, writeBlock: 'not-set-up' as const };
  expect(moodLine(blocked, { ...s0, applying: 'eveningLamp' })).toEqual({ lead: null, rest: TEXT.notSetUp, warn: true });
  expect(moodLine({ ...blocked, writeBlock: 'needs-private-address' }, s0).rest).toBe(TEXT.needsPrivate);
  expect(moodLine(blocked, { ...s0, moodFail: { id: 'eveningLamp', word: 'busy' } })).toEqual({ lead: null, rest: TEXT.busy, warn: true });
  expect(moodLine(blocked, { ...s0, moodFail: { id: 'eveningLamp', word: 'busy' }, sticky: 'forbidden' })).toEqual({ lead: null, rest: TEXT.forbidden, warn: true });
  expect(moodLine(lit, { ...s0, sticky: 'home-not-set-up' })).toEqual({ lead: null, rest: TEXT.homeNotSetUp, warn: true });
});

it('a stale read ends its calm lines with (not fresh), never the amber ones', () => {
  const stale = (m: Partial<Moods> = {}) => moods({ stale: true, ...m });
  const lit = stale({ moods: [{ id: 'brightDesk', label: 'Bright desk', line: 'Room 70%', active: true }] });
  expect(moodLine(lit, s0).rest).toBe(' Room 70% (not fresh)');
  expect(moodLine(stale({ moods: [{ id: 'eveningLamp', label: 'Evening lamp', line: null, active: true }] }), s0).rest).toBe(' is on. (not fresh)');
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
  expect(plain.chips.map((c) => c.id)).toEqual(['brightDesk', 'eveningLamp']);
  const withOff = rowModel({ ...base, moods: moods({ off: { active: true } }), moodsWord: null })!;
  expect(withOff.chips.map((c) => c.id)).toEqual(['brightDesk', 'eveningLamp', null]);
  expect(withOff.chips[2]).toMatchObject({ label: 'Off', lit: true, swatch: null });
  const both = rowModel({ ...base, moods: moods({ off: { active: true }, moods: [{ id: 'eveningLamp', label: 'Evening lamp', line: null, active: true }] }), moodsWord: null })!;
  expect(both.chips[1].lit).toBe(false);
  expect(both.chips[0].lit).toBe(true);
  const busy = rowModel({ ...base, applying: OFFICE_OFF, moods: moods({ off: { active: false } }), moodsWord: null })!;
  expect(busy.waiting).toBe(true);
  expect(busy.chips[2].busy).toBe(true);
  const failed = rowModel({ ...base, moodFail: { id: 'eveningLamp', word: 'busy' }, moods: moods(), moodsWord: null })!;
  expect(failed.chips[1].failed).toBe(true);
  expect(failed.warnText).toBe(TEXT.busy);
});

it('chipTip: name and line, a second line for a block, a failure or a write in flight, Off its own words', () => {
  const base = { applying: null, moodFail: null, sticky: null, moodsWord: null };
  const lit = rowModel({ ...base, moods: moods({ off: { active: false }, moods: [{ id: 'brightDesk', label: 'Bright desk', line: 'Room 70%, neon 20%', active: true }, { id: 'eveningLamp', label: 'Evening lamp', line: null, active: false }] }) })!;
  expect(chipTip(lit, lit.chips[0])).toEqual({ first: 'Bright desk: Room 70%, neon 20%', second: null, warn: false });
  expect(chipTip(lit, lit.chips[1]).first).toBe('Evening lamp');
  expect(chipTip(lit, lit.chips[2]).first).toBe('Turns the office lights off. No other room changes.');
  const off = rowModel({ ...base, moods: moods({ off: { active: true } }) })!;
  expect(chipTip(off, off.chips[2]).first).toBe('Office lights are off.');
  const waiting = rowModel({ ...base, applying: 'eveningLamp', moods: moods() })!;
  expect(chipTip(waiting, waiting.chips[0])).toMatchObject({ second: 'Asking the home app', warn: false });
  const blocked = rowModel({ ...base, moods: moods({ canWrite: false, writeBlock: 'not-set-up' }) })!;
  expect(chipTip(blocked, blocked.chips[0])).toMatchObject({ second: TEXT.notSetUp, warn: true });
  const failed = rowModel({ ...base, moodFail: { id: 'eveningLamp', word: 'on-air' }, moods: moods() })!;
  expect(chipTip(failed, failed.chips[0]).second).toBe(TEXT.onAir);
});

it('ROW_MAX, the floor and the row\'s right edge match the stylesheet, so the two cannot drift', () => {
  const css: string = readFileSync('src/styles/unwind.css', 'utf8');
  const block = (sel: string): string => {
    const at = css.indexOf(`\n${sel} {`);
    expect(at).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf('}', at));
  };
  const slot = block('.u-office-slot');
  expect(slot).toContain(`max-width: ${ROW_MAX}px;`);
  // Right edge: the slot's container ends at wall x 2540, so 176 px is wall x 2364, and the left limit is x 1240.
  expect(2540 - 176 - ROW_MAX).toBe(1240);
  expect(slot).toContain('right: 176px;');
  expect(block('.u-mood')).toContain(`min-width: ${CHIP_FIXED + NAME_MIN}px;`);
  expect(block('.u-mood.icon-only')).toContain(`min-width: ${ICON_CHIP}px;`);
  expect(css).toContain("[data-clip='true']");
});

it('the nudge words each have their own text, and no other word reuses them', () => {
  expect(moodFailText('no-mood')).toBe(TEXT.noMood);
  expect(moodFailText('at-floor')).toBe(TEXT.atFloor);
  expect(moodFailText('at-max')).toBe(TEXT.atMax);
  expect(new Set([TEXT.noMood, TEXT.atFloor, TEXT.atMax, TEXT.failed]).size).toBe(4);
});
