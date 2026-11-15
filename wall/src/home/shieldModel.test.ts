import { describe, expect, it } from 'vitest';
import { alertAgeWords, alertHint, severityCounts, shieldFacts, shieldSub, type Shield, type ShieldAlert } from './shieldModel';

const base: Shield = {
  kind: 'ready',
  source: 'legacy',
  open: 0,
  alerts: [],
  stale: false,
  asOf: null,
  title: 'All quiet',
  devices: null,
  blocked: null,
  canClear: false,
  clearNotSetUp: false,
  clearWaits: false,
  clearInsecure: false,
  detail: [],
  bad: false,
  scan: null,
  alarms: null,
};
const shield = (over: Partial<Shield> = {}): Shield => ({ ...base, ...over });
const alert = (severity: ShieldAlert['severity'], ageMins: number | null = 12, i = 0): ShieldAlert => ({ key: `a${i}`, severity, text: `Alert ${i}`, age: null, ageMins, atMs: null });
const texts = (s: Shield) => shieldFacts(s).lines.map((f) => f.text);

describe('the quiet card\'s fact lines', () => {
  it('all numbers: the scan, then devices and blocked on one line', () => {
    const s = shield({ scan: '10:24 AM', devices: 31, blocked: 412, alarms: 3 });
    expect(texts(s)).toEqual(['Scan 10:24 AM', '31 devices, 412 blocked']);
    // The box for a card with no doors lists each fact on its own row.
    expect(shieldFacts(s).all.map((f) => f.text)).toEqual(['Scan 10:24 AM', '31 devices', '412 blocked', '3 alarms in 24 h']);
  });
  it('only the scan and the alarms (what the owner\'s home app sends today)', () => {
    expect(texts(shield({ scan: '10:24 AM', alarms: 3 }))).toEqual(['Scan 10:24 AM', '3 alarms in 24 h']);
    expect(texts(shield({ scan: '10:24 AM', alarms: 1 }))).toEqual(['Scan 10:24 AM', '1 alarm in 24 h']);
  });
  it('one of devices and blocked: that one alone, singular when it is one', () => {
    expect(texts(shield({ scan: '9:00 AM', devices: 1 }))).toEqual(['Scan 9:00 AM', '1 device']);
    expect(texts(shield({ scan: '9:00 AM', blocked: 412 }))).toEqual(['Scan 9:00 AM', '412 blocked']);
  });
  it('a number that is zero is still a fact; no number is no fact', () => {
    expect(texts(shield({ devices: 0, blocked: 0 }))).toEqual(['0 devices, 0 blocked']);
    expect(texts(shield({ alarms: 0 }))).toEqual(['0 alarms in 24 h']);
    expect(shieldFacts(shield()).lines).toEqual([]);
    expect(shieldFacts(shield()).all).toEqual([]);
  });
  it('the counts win over the alarms on the second line; the alarms stay in the box', () => {
    const s = shield({ devices: 5, alarms: 2 });
    expect(texts(s)).toEqual(['5 devices']);
    expect(shieldFacts(s).all.map((f) => f.text)).toEqual(['5 devices', '2 alarms in 24 h']);
  });
  it('no fact when the home app is not set up, loading or down', () => {
    for (const kind of ['off', 'loading', 'down'] as const) expect(shieldFacts(shield({ kind, scan: '10:24 AM', devices: 3 })).all).toEqual([]);
  });
  it('invents nothing: every digit drawn came from a number that was sent', () => {
    const s = shield({ scan: '10:24 AM', devices: 31, blocked: 412, alarms: 3 });
    const drawn = shieldFacts(s).all.map((f) => f.text).join(' ');
    expect(drawn.match(/\d+/g)).toEqual(['10', '24', '31', '412', '3', '24']);
  });
});

describe('the alerts row', () => {
  const three = shield({ open: 3, alerts: [alert('high', 12, 0), alert('medium', 180, 1), alert('medium', 300, 2)] });
  it('counts by severity when every open alert is listed and rated', () => {
    expect(severityCounts(three)).toBe('1 high, 2 medium');
    expect(alertHint(three)).toBe('12 min ago. 1 high, 2 medium.');
    expect(severityCounts(shield({ open: 1, alerts: [alert('low')] }))).toBe('1 low');
  });
  it('no counts when some open alert is not listed or has no severity (a count must be true)', () => {
    expect(severityCounts(shield({ open: 4, alerts: three.alerts }))).toBeNull();
    expect(severityCounts(shield({ open: 2, alerts: [alert('high'), alert(null, 60, 1)] }))).toBeNull();
    expect(alertHint(shield({ open: 4, alerts: three.alerts }))).toBe('12 min ago.');
  });
  it('no age and no counts: no line', () => {
    expect(alertHint(shield({ open: 2, alerts: [alert(null, null)] }))).toBe('');
    expect(alertHint(shield())).toBe('');
  });
});

describe('the alert line\'s age words', () => {
  it('just now, minutes, hours, days', () => {
    expect(alertAgeWords(0)).toBe('just now');
    expect(alertAgeWords(1)).toBe('1 min ago');
    expect(alertAgeWords(12)).toBe('12 min ago');
    expect(alertAgeWords(59)).toBe('59 min ago');
    expect(alertAgeWords(60)).toBe('1 h ago');
    expect(alertAgeWords(180)).toBe('3 h ago');
    expect(alertAgeWords(47 * 60 + 59)).toBe('47 h ago');
    expect(alertAgeWords(48 * 60)).toBe('2 days ago');
    expect(alertAgeWords(5 * 24 * 60)).toBe('5 days ago');
    expect(alertAgeWords(null)).toBeNull();
  });
  it('an alert under a minute old never reads "now ago"', () => {
    expect(alertHint(shield({ open: 1, alerts: [alert('low', 0)] }))).toBe('just now. 1 low.');
  });
});

describe('the line under the title', () => {
  it('quiet and not live words', () => {
    expect(shieldSub(shield())).toEqual(['Nothing is open.']);
    expect(shieldSub(shield({ stale: true, asOf: 'as of 9:41 AM' }))).toEqual(['Nothing was open.']);
    expect(shieldSub(shield({ stale: true }))).toEqual(['Nothing was open.']);
  });
  it('alerts open names the devices when they are known', () => {
    expect(shieldSub(shield({ open: 3, devices: 31 }))).toEqual(['3 alerts open, 31 devices at home']);
    expect(shieldSub(shield({ open: 1 }))).toEqual(['1 alert open']);
  });
  it('down says when it checks again; not set up and loading say nothing under the title', () => {
    expect(shieldSub(shield({ kind: 'down' }))).toEqual(['Checks again every 5 minutes.']);
    expect(shieldSub(shield({ kind: 'off' }))).toEqual(['']);
  });
});
