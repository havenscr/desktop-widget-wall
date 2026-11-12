import { expect, it } from 'vitest';
import { ageText, alertRows, alertsLine, lastScanText, netNumbers, statusLine, tone, type SecuritySummary } from './model';

const base = (over: Partial<SecuritySummary> = {}, fw: Partial<NonNullable<SecuritySummary['firewalla']>> | null = {}): SecuritySummary => ({
  reachable: true,
  stale: false,
  lastScan: null,
  alerts: 0,
  firewalla: fw === null ? null : { api: 'up', boxOnline: true, checkedAt: null, alarms24h: 0, ...fw },
  portalUrl: null,
  ...over,
});

it('green only when up, box online, fresh and reachable', () => {
  expect(tone(base())).toBe('ok');
  expect(statusLine(base())).toBe('All quiet');
  expect(statusLine(base({ alerts: 2 }))).toBe('Up, box online');
  expect(statusLine(base({ alerts: 2 }, { boxOnline: null }))).toBe('Up');
});

it('amber when stale, unknown, unreachable or without a firewall reading', () => {
  expect(tone(base({ stale: true }))).toBe('warn');
  expect(statusLine(base({ stale: true }))).toBe('Scan is stale');
  expect(tone(base({}, { api: 'unknown', boxOnline: null }))).toBe('warn');
  expect(statusLine(base({}, { api: 'unknown', boxOnline: null }))).toBe('Firewall status unknown');
  expect(tone(base({ reachable: false }, null))).toBe('warn');
  expect(statusLine(base({ reachable: false }, null))).toBe('Home app not reachable');
  expect(tone(base({}, null))).toBe('warn');
});

it('a box state that is simply not known does not turn the dot red', () => {
  expect(tone(base({}, { boxOnline: null }))).toBe('ok');
});

it('red only when the API is down or the box is offline', () => {
  expect(tone(base({}, { api: 'down' }))).toBe('bad');
  expect(statusLine(base({}, { api: 'down' }))).toBe('Firewall down');
  expect(tone(base({}, { boxOnline: false }))).toBe('bad');
  expect(statusLine(base({}, { boxOnline: false }))).toBe('Firewall box offline');
  // Red wins over stale.
  expect(tone(base({ stale: true }, { boxOnline: false }))).toBe('bad');
});

it('alert and scan lines', () => {
  expect(alertsLine(0)).toBe('No open alerts');
  expect(alertsLine(1)).toBe('1 open alert');
  expect(alertsLine(2)).toBe('2 open alerts');
  const now = Date.parse('2026-11-11T12:00:00Z');
  expect(lastScanText(null, now)).toBeNull();
  expect(lastScanText('garbage', now)).toBeNull();
  expect(lastScanText('2026-11-11T11:56:00Z', now)).toBe('last scan 4 min ago');
  expect(lastScanText('2026-11-11T12:00:00Z', now)).toBe('last scan just now');
  expect(lastScanText('2026-11-11T09:00:00Z', now)).toBe('last scan 3 hours ago');
});

it('numbers row shows only the numbers the feed has, in the concept order', () => {
  expect(netNumbers(base({}, { alarms24h: 3 })).map((n) => [n.key, n.value])).toEqual([['alarms', '3']]);
  expect(netNumbers(base({}, { alarms24h: null })).length).toBe(0);
  expect(netNumbers(base({}, null)).length).toBe(0);
  const full = netNumbers(base({ devices: 31, blocked: 412, boxTemp: 61.4 }, { alarms24h: 0 }));
  expect(full.map((n) => [n.key, n.value])).toEqual([
    ['devices', '31'],
    ['alarms', '0'],
    ['blocked', '412'],
    ['box', '61°'],
  ]);
  expect(netNumbers(base({ devices: Number.NaN }, { alarms24h: null })).length).toBe(0);
});

it('alert rows stop at three and skip rows without text; ages are short', () => {
  const row = (text: string) => ({ text, severity: null, atMs: null });
  expect(alertRows(base())).toEqual([]);
  expect(alertRows(base({ topAlerts: [row('a'), row(' '), row('b'), row('c'), row('d')] })).map((r) => r.text)).toEqual(['a', 'b', 'c']);
  const now = Date.parse('2026-11-11T12:00:00Z');
  expect(ageText(null, now)).toBeNull();
  expect(ageText(now - 20_000, now)).toBe('now');
  expect(ageText(now - 12 * 60_000, now)).toBe('12m');
  expect(ageText(now - 3 * 3_600_000, now)).toBe('3h');
  expect(ageText(now - 50 * 3_600_000, now)).toBe('2d');
});
