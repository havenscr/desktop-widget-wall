import { afterEach, describe, expect, it, vi } from 'vitest';
import { PINS_CHANGED_EVENT } from './libraryModel';
import { MAX_PIN_NAME, PIN_NAMES_KEY, parsePinNames, readPinNames, setPinName } from './pinNames';

afterEach(() => localStorage.clear());

describe('pin names', () => {
  it('reads nothing from a missing, broken or wrongly shaped text', () => {
    expect(parsePinNames(null)).toEqual({});
    expect(parsePinNames('{oops')).toEqual({});
    expect(parsePinNames('["lib:snip"]')).toEqual({});
    expect(parsePinNames('"lib:snip"')).toEqual({});
  });
  it('keeps only entries with a pin reference and a short, non-empty text name', () => {
    const raw = JSON.stringify({ 'lib:snip': '  Grab ', 'file:2': 'Two', 'nope': 'x', 'lib:focus': 7, 'lib:thirds': '   ', 'lib:strip-dark': 'x'.repeat(MAX_PIN_NAME + 1) });
    expect(parsePinNames(raw)).toEqual({ 'lib:snip': 'Grab', 'file:2': 'Two' });
  });
  it('setPinName stores the name, tells the rows, and an empty name clears it', () => {
    const seen = vi.fn();
    window.addEventListener(PINS_CHANGED_EVENT, seen);
    setPinName('lib:snip', ' Grab ');
    expect(readPinNames()).toEqual({ 'lib:snip': 'Grab' });
    expect(seen).toHaveBeenCalledTimes(1);
    setPinName('lib:focus', 'Deep');
    setPinName('lib:snip', '');
    expect(readPinNames()).toEqual({ 'lib:focus': 'Deep' });
    setPinName('lib:focus', '');
    expect(localStorage.getItem(PIN_NAMES_KEY)).toBeNull();
    expect(seen).toHaveBeenCalledTimes(4);
    window.removeEventListener(PINS_CHANGED_EVENT, seen);
  });
});
