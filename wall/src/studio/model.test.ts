import { describe, expect, it } from 'vitest';
import { isLight, readingOf, wordOf, type Light, type Reading } from './keyLights';
import { anyOn, chipWord, downWord, kelvinColour, mismatched, noneTitle, summaryLine, viewOf, withOn, working, type Snapshot } from './model';

const L = (on: boolean, brightness: number, kelvin: number): Light => ({ on, brightness, kelvin });
const snap = (left: Reading | null, right: Reading | null, status: Snapshot['status'] = { left: true, right: true }): Snapshot => ({ status, left, right });
const both = snap(L(true, 60, 4400), L(true, 60, 4400));

describe('what the page makes of the two lights', () => {
  it('names the view from the saved sides and the answers', () => {
    expect(viewOf({ status: null, left: null, right: null })).toBe('checking');
    expect(viewOf({ status: 'failed', left: null, right: null })).toBe('unavailable');
    expect(viewOf(snap(null, null, { left: false, right: false }))).toBe('unset');
    expect(viewOf(snap(null, null))).toBe('checking');
    expect(viewOf(both)).toBe('live');
    expect(viewOf(snap(L(true, 60, 4400), 'no-answer'))).toBe('one');
    expect(viewOf(snap('timeout', 'no-answer'))).toBe('none');
    // One saved light that answers is the only one there is: the other reads as not set up.
    expect(viewOf(snap(L(true, 60, 4400), null, { left: true, right: false }))).toBe('one');
    expect(downWord(snap(L(true, 60, 4400), null, { left: true, right: false }), 'right')).toBe('not-set-up');
  });

  it('reads the switch, the mismatch and the shown light from the lights that answer', () => {
    expect(anyOn(both)).toBe(true);
    expect(anyOn(snap(L(false, 60, 4400), L(false, 60, 4400)))).toBe(false);
    expect(anyOn(snap(L(false, 60, 4400), L(true, 60, 4400)))).toBe(true);
    expect(mismatched(both)).toBe(false);
    expect(mismatched(snap(L(true, 60, 4400), L(true, 45, 4400)))).toBe(true);
    expect(mismatched(snap(L(true, 60, 4400), L(true, 60, 4700)))).toBe(true);
    expect(mismatched(snap(L(true, 60, 4400), 'no-answer'))).toBe(false);
    expect(working(snap('failed', L(true, 50, 5000))).map((w) => w.side)).toEqual(['right']);
  });

  it('colours the knob by warmth', () => {
    expect(kelvinColour(2900)).toBe('#ffc98a');
    expect(kelvinColour(3599)).toBe('#ffc98a');
    expect(kelvinColour(3600)).toBe('#ffe7c7');
    expect(kelvinColour(5199)).toBe('#ffe7c7');
    expect(kelvinColour(5200)).toBe('#e2ecff');
    expect(kelvinColour(7000)).toBe('#e2ecff');
  });

  it('says one honest line for every state', () => {
    expect(summaryLine(both)).toEqual({ text: 'Key lights 60%, 4400 K', tone: 'plain' });
    expect(summaryLine(snap(L(false, 60, 4400), L(false, 60, 4400))).text).toBe('Key lights are off');
    expect(summaryLine(snap(L(true, 60, 4400), L(true, 45, 4700))).text).toBe('Left 60%, 4400 K. Right 45%, 4700 K');
    expect(summaryLine(snap(L(true, 60, 4400), 'no-answer'))).toEqual({ text: 'The right key light is not answering. The other one works.', tone: 'amber' });
    expect(summaryLine(snap('timeout', L(true, 60, 4400))).text).toBe('The left key light is too slow to answer. The other one works.');
    expect(summaryLine(snap('no-answer', 'no-answer'))).toEqual({ text: 'Neither light answered. Check they are on and on this network.', tone: 'amber' });
    expect(summaryLine(snap('other-model', 'other-model')).text).toBe('Both lights answered, but not in a way the wall knows.');
    expect(noneTitle(snap('other-model', 'other-model'))).toBe('Key lights answer differently than expected');
    expect(summaryLine(snap(null, null, { left: false, right: false })).text).toBe('Key lights: type their addresses in Tools');
    expect(summaryLine({ status: null, left: null, right: null }).text).toBe('Asking the key lights');
    expect(summaryLine({ status: 'failed', left: null, right: null }).text).toBe('Key lights are not available in this build');
    expect(noneTitle(snap('no-answer', 'other-model'))).toBe('Key lights are not answering');
  });

  it('words the Work chip, and hides it when the lights are not set up', () => {
    expect(chipWord(both)).toBe('Lights: key lights 60%');
    expect(chipWord(snap(L(true, 60, 4400), L(true, 45, 4400)))).toBe('Lights: key lights on');
    expect(chipWord(snap(L(true, 60, 4400), 'no-answer'))).toBe('Lights: key lights on');
    expect(chipWord(snap(L(false, 60, 4400), L(false, 60, 4400)))).toBe('Lights: key lights off');
    expect(chipWord(snap('no-answer', 'no-answer'))).toBe('Lights: key lights not answering');
    expect(chipWord(snap(null, null, { left: false, right: false }))).toBeNull();
    expect(chipWord({ status: null, left: null, right: null })).toBeNull();
    expect(chipWord({ status: 'failed', left: null, right: null })).toBeNull();
  });

  it('turns an off light on with a slider move, and leaves an on light alone', () => {
    expect(withOn({ brightness: 50 }, [{ light: L(false, 3, 4400) }])).toEqual({ brightness: 50, on: true });
    expect(withOn({ kelvin: 4000 }, [{ light: L(true, 60, 4400) }, { light: L(false, 60, 4400) }])).toEqual({ kelvin: 4000, on: true });
    expect(withOn({ brightness: 50 }, [{ light: L(true, 60, 4400) }])).toEqual({ brightness: 50 });
  });
});

describe('what the native side sends is checked before it is shown', () => {
  it('takes a light, a known word, or failed', () => {
    expect(readingOf({ on: true, brightness: 60.4, kelvin: 4400 })).toEqual(L(true, 60, 4400));
    expect(readingOf('no-answer')).toBe('no-answer');
    expect(readingOf('something else')).toBe('failed');
    expect(readingOf({ on: 1, brightness: 60, kelvin: 4400 })).toBe('failed');
    expect(readingOf({ on: true, brightness: Number.NaN, kelvin: 4400 })).toBe('failed');
    expect(readingOf(42)).toBe('failed');
    expect(readingOf(null)).toBeNull();
    expect(isLight(readingOf({ on: false, brightness: 3, kelvin: 2900 }))).toBe(true);
    expect(isLight('failed')).toBe(false);
  });

  it('reads the word out of a rejected command', () => {
    expect(wordOf('timeout')).toBe('timeout');
    expect(wordOf(new Error('other-model'))).toBe('other-model');
    expect(wordOf('weird')).toBe('failed');
    expect(wordOf(undefined)).toBe('failed');
  });
});
