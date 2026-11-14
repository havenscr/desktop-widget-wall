import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LINES, LINES_KEY, LINE_PRESETS, activePreset, resetLinesStore, useLinesStore, validateLines } from './linesSettings';
import { registerLinesMocks } from '../bridge/devMocks/lines';

describe('line settings', () => {
  beforeEach(() => {
    localStorage.clear();
    resetLinesStore();
  });

  it('defaults to the wall as it is today', () => {
    expect(DEFAULT_LINES).toEqual({ type: 'mountains', lively: 50, smooth: 50, height: 104, colours: 'look', reflection: true, rest: 'ridgelevels' });
    expect(useLinesStore.getState()).toMatchObject(DEFAULT_LINES);
  });

  it('validates every stored field and bounds numbers', () => {
    expect(validateLines({ type: 'noise', lively: -8, smooth: 999, height: 400, colours: 'bad', reflection: 'yes', rest: 'old' })).toEqual({
      ...DEFAULT_LINES, lively: 0, smooth: 100, height: 220,
    });
    expect(validateLines({ lively: Number.NaN, smooth: Infinity, height: 3 })).toEqual({ ...DEFAULT_LINES, height: 20 });
    expect(validateLines(null)).toEqual(DEFAULT_LINES);
    expect(validateLines('bars')).toEqual(DEFAULT_LINES);
  });

  it('an older or broken stored value falls back field by field', () => {
    localStorage.setItem(LINES_KEY, '{not json');
    resetLinesStore();
    expect(useLinesStore.getState()).toMatchObject(DEFAULT_LINES);
    // An older shape with only some fields (and one it no longer knows).
    localStorage.setItem(LINES_KEY, JSON.stringify({ type: 'sparks', speed: 3 }));
    resetLinesStore();
    expect(useLinesStore.getState()).toMatchObject({ ...DEFAULT_LINES, type: 'sparks' });
  });

  it('keeps changes and reset in local storage', () => {
    useLinesStore.getState().setLines({ type: 'sparks', lively: 88, reflection: false });
    expect(JSON.parse(localStorage.getItem(LINES_KEY)!)).toMatchObject({ type: 'sparks', lively: 88, reflection: false });
    useLinesStore.getState().reset();
    expect(JSON.parse(localStorage.getItem(LINES_KEY)!)).toEqual(DEFAULT_LINES);
  });

  it('the presets: Calm 22, 72, 60 px; Dancing is the usual 50, 50, 104 px; Wild 88, 28, 180 px', () => {
    expect(LINE_PRESETS).toEqual({ calm: { lively: 22, smooth: 72, height: 60 }, dancing: { lively: 50, smooth: 50, height: 104 }, wild: { lively: 88, smooth: 28, height: 180 } });
    expect(activePreset(DEFAULT_LINES)).toBe('dancing');
    expect(activePreset({ lively: 88, smooth: 28, height: 180 })).toBe('wild');
    expect(activePreset({ lively: 88, smooth: 29, height: 180 })).toBeNull();
  });

  it('the review knobs live in the dev mocks and set the page only, saving nothing', () => {
    registerLinesMocks('?lines=skyline&lively=88&smooth=28&lheight=180&lcol=mint&lrest=flat&lrefl=0');
    expect(useLinesStore.getState()).toMatchObject({ type: 'skyline', lively: 88, smooth: 28, height: 180, colours: 'mint', rest: 'flat', reflection: false });
    expect(localStorage.getItem(LINES_KEY)).toBeNull();
    resetLinesStore();
    registerLinesMocks('?lines=junk');
    expect(useLinesStore.getState().type).toBe('mountains');
  });
});
