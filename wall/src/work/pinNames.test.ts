import { afterEach, describe, expect, it, vi } from 'vitest';
import { PINS_CHANGED_EVENT } from './libraryModel';
import { MAX_PIN_NAME, PIN_NAMES_KEY, cleanPinName, parsePinNames, readPinNames, resetPinNamesMemory, setPinName } from './pinNames';

afterEach(() => {
  vi.restoreAllMocks();
  resetPinNamesMemory();
  localStorage.clear();
});

describe('pin names', () => {
  it('reads nothing from a missing, broken or wrongly shaped text', () => {
    expect(parsePinNames(null)).toEqual({});
    expect(parsePinNames('{oops')).toEqual({});
    expect(parsePinNames('["lib:snip"]')).toEqual({});
    expect(parsePinNames('"lib:snip"')).toEqual({});
  });
  it('keeps only entries with a pin reference and a short, visible, plain-text name', () => {
    const raw = JSON.stringify({ 'lib:snip': '  Grab ', 'file:2': 'Two', nope: 'x', 'lib:focus': 7, 'lib:thirds': '   ', 'lib:strip-dark': 'x'.repeat(MAX_PIN_NAME + 1) });
    expect(parsePinNames(raw)).toEqual({ 'lib:snip': 'Grab', 'file:2': 'Two' });
  });
  it('drops control, zero-width and format characters and names with nothing visible, and keeps the others', () => {
    const bad = ['A\nB', 'A\tB', 'A\u0000B', 'A​B', 'A‏B', 'A⁠B', 'A﻿B', 'A‮B', '​​', '­'];
    for (const b of bad) expect(cleanPinName(b), JSON.stringify(b)).toBeNull();
    const raw = JSON.stringify({ 'lib:thirds': 'A\nB', 'lib:snip': 'A​B', 'lib:focus': 'Deep' });
    expect(parsePinNames(raw)).toEqual({ 'lib:focus': 'Deep' });
    expect(cleanPinName(' Deep work ')).toBe('Deep work');
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
  it('setPinName refuses a name with a hidden character or nothing visible, and changes nothing', () => {
    setPinName('lib:snip', 'Grab');
    setPinName('lib:snip', 'A\nB');
    setPinName('lib:snip', '​');
    expect(readPinNames()).toEqual({ 'lib:snip': 'Grab' });
  });
  it('a refused storage write keeps the names in memory for the session, and the event reads them', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    let heard: unknown = null;
    const on = () => (heard = readPinNames());
    window.addEventListener(PINS_CHANGED_EVENT, on);
    setPinName('lib:snip', 'Grab');
    expect(heard).toEqual({ 'lib:snip': 'Grab' });
    setPinName('lib:focus', 'Deep');
    expect(readPinNames()).toEqual({ 'lib:snip': 'Grab', 'lib:focus': 'Deep' });
    window.removeEventListener(PINS_CHANGED_EVENT, on);
  });
});
