import { expect, it } from 'vitest';
import { alertsLine, lastScanText, statusLine, tone, type SecuritySummary } from './model';

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
  expect(statusLine(base())).toBe('Up, box online');
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
