import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LINES, LINES_KEY, resetLinesStore, useLinesStore, validateLines } from './linesSettings';

describe('line settings', () => {
  beforeEach(() => { localStorage.clear(); resetLinesStore(); });

  it('uses the exact current drawing choices by default', () => {
    expect(useLinesStore.getState()).toMatchObject(DEFAULT_LINES);
  });

  it('validates every stored field and bounds numbers', () => {
    expect(validateLines({ type: 'noise', lively: -8, smooth: 999, height: 400, colours: 'bad', reflection: 'yes', rest: 'old' })).toEqual({
      ...DEFAULT_LINES, lively: 0, smooth: 100, height: 220,
    });
  });

  it('keeps changes and reset in local storage', () => {
    useLinesStore.getState().setLines({ type: 'sparks', lively: 88, reflection: false });
    expect(JSON.parse(localStorage.getItem(LINES_KEY)!)).toMatchObject({ type: 'sparks', lively: 88, reflection: false });
    useLinesStore.getState().reset();
    expect(JSON.parse(localStorage.getItem(LINES_KEY)!)).toEqual(DEFAULT_LINES);
  });
});
