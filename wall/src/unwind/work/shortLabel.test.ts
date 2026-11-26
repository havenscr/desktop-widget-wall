import { describe, expect, it } from 'vitest';
import { labelCandidates, pickLabel, shortLabel, shortLabels } from './shortLabel';

it('uses a known short form, else the first word', () => {
  expect(shortLabel('Record 16:9')).toBe('Record');
  expect(shortLabel('Hide screen')).toBe('Hide');
  expect(shortLabel('Thirds')).toBe('Thirds');
  expect(shortLabel('Copy path')).toBe('Copy');
});
it('keeps a short word where no other key shares it', () => {
  expect(shortLabels(['Record 16:9', 'Snip'])).toEqual(['Record', 'Snip']);
});

it('gives each key a word the others do not share where first words match', () => {
  expect(shortLabels(['Record 16:9', 'Record screen', 'Snip'])).toEqual(['16:9', 'Screen', 'Snip']);
  expect(shortLabels(['Copy path', 'Copy link', 'Snip'])).toEqual(['Path', 'Link', 'Snip']);
});
it('lists candidates: a name first, then the short word, then the distinguishing word', () => {
  expect(labelCandidates('Record 16:9', ['Record 16:9', 'Record screen'], 'Cam')).toEqual(['Cam', '16:9', 'Record', 'Record 16:9'].filter((x, i, a) => a.indexOf(x) === i));
  expect(labelCandidates('Snip', ['Snip', 'Record screen'])[0]).toBe('Snip');
});
describe('the measured chooser', () => {
  const m = (t: string) => t.length * 10;
  it('takes the first candidate that fits', () => {
    expect(pickLabel(['Record', '16:9'], 70, m)).toBe('Record');
    expect(pickLabel(['Record', '16:9'], 50, m)).toBe('16:9');
  });
  it('takes the shortest fitting one when the leading ones do not, else the shortest', () => {
    expect(pickLabel(['Screenshot', 'Capture', 'Cap', 'Snip', 'Go'], 30, m)).toBe('Cap');
    expect(pickLabel(['Screenshot', 'Capture'], 20, m)).toBe('Ca');
  });
  it('cuts letters from the end of one unbreakable long word until it fits', () => {
    const t = pickLabel(['Supercalifragilistic'], 55, m);
    expect(t).toBe('Super');
    expect(m(t)).toBeLessThanOrEqual(55);
  });
  it('takes the first when nothing is measured yet, and a user name leads', () => {
    expect(pickLabel(['Record'], 0, m)).toBe('Record');
    expect(pickLabel(labelCandidates('Snip', ['Snip'], 'Mine'), 100, m)).toBe('Mine');
  });
});
it('drops trailing punctuation from candidates', () => {
  expect(shortLabels(['Sonos: Mute', 'Excel: Undo'])).toEqual(['Sonos', 'Excel']);
});
