import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { NetworkTile } from './NetworkTile';

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-11T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
});

const summary = {
  reachable: true,
  stale: false,
  lastScan: '2026-11-11T11:56:00Z',
  alerts: 2,
  firewalla: { api: 'up', boxOnline: true, checkedAt: null, alarms24h: 0 },
  portalUrl: null,
};

it('shows the dot, the alert count and the scan age', async () => {
  mocks.set('wall2_home_security', () => summary);
  const { container } = render(<NetworkTile />);
  await flush();
  expect(screen.getByText('Up, box online')).toBeTruthy();
  expect(screen.getByText('2 open alerts')).toBeTruthy();
  expect(screen.getByText('last scan 4 min ago')).toBeTruthy();
  expect(container.querySelector('.net-icon.ok')).toBeTruthy();
});

it('shows Not set up when feeds.json has no address', async () => {
  mocks.set('wall2_home_security', () => Promise.reject(new Error('not-configured')));
  render(<NetworkTile />);
  await flush();
  expect(screen.getByText('Not set up')).toBeTruthy();
});

it('goes amber when the home app stops answering after a good read', async () => {
  let fail = false;
  mocks.set('wall2_home_security', () => (fail ? Promise.reject(new Error('Could not reach the service')) : summary));
  const { container } = render(<NetworkTile />);
  await flush();
  fail = true;
  await flush(300_000);
  expect(container.querySelector('.net-icon.warn')).toBeTruthy();
  expect(screen.getByText('Home app not reachable')).toBeTruthy();
});

const withLinks = (links: { security: boolean; portal: boolean }, open?: (a?: Record<string, unknown>) => unknown) => {
  mocks.set('wall2_home_security', () => ({ ...summary, portalUrl: links.portal ? 'https://my.firewalla.net/x' : null }));
  mocks.set('wall2_links', () => links);
  mocks.set('wall2_open_link', open ?? (() => undefined));
};

it('shows no link buttons when none are available', async () => {
  withLinks({ security: false, portal: false });
  render(<NetworkTile />);
  await flush();
  expect(screen.queryByRole('button')).toBeNull();
});

it('shows only the available links and asks Rust to open them by kind', async () => {
  const opened: unknown[] = [];
  withLinks({ security: true, portal: false }, (a) => void opened.push(a));
  render(<NetworkTile />);
  await flush();
  expect(screen.queryByRole('button', { name: 'Firewalla' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Security' }));
  await flush();
  expect(opened).toEqual([{ kind: 'security' }]);
});

it('opens the portal link by kind, and a failure shows Could not open for 3 seconds', async () => {
  const opened: unknown[] = [];
  withLinks({ security: true, portal: true }, (a) => {
    opened.push(a);
    return Promise.reject(new Error('nope'));
  });
  render(<NetworkTile />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Firewalla' }));
  await flush();
  expect(opened).toEqual([{ kind: 'portal' }]);
  expect(screen.getByText('Could not open')).toBeTruthy();
  await flush(3100);
  expect(screen.queryByText('Could not open')).toBeNull();
});

it('keeps the Security button when the security read fails or is not set up', async () => {
  mocks.set('wall2_home_security', () => Promise.reject(new Error('not-configured')));
  mocks.set('wall2_links', () => ({ security: true, portal: false }));
  render(<NetworkTile />);
  await flush();
  expect(screen.getByText('Not set up')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Security' })).toBeTruthy();
});

it('refreshes link availability after every attempt, even with the same portal', async () => {
  let security = true;
  mocks.set('wall2_home_security', () => ({ ...summary, portalUrl: 'https://my.firewalla.net/x' }));
  mocks.set('wall2_links', () => ({ security, portal: true }));
  render(<NetworkTile />);
  await flush();
  expect(screen.getByRole('button', { name: 'Security' })).toBeTruthy();
  security = false;
  await flush(300_000);
  expect(screen.queryByRole('button', { name: 'Security' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Firewalla' })).toBeTruthy();
});

it('fills the card: numbers the feed has, up to three alert rows and the rest as a number', async () => {
  mocks.set('wall2_home_security', () => ({
    ...summary,
    alerts: 5,
    devices: 31,
    firewalla: { ...summary.firewalla, alarms24h: 3 },
    topAlerts: [
      { text: 'New device joined', severity: 'high', atMs: Date.parse('2026-11-11T11:48:00Z') },
      { text: 'Port scan blocked', severity: 'low', atMs: Date.parse('2026-11-11T09:00:00Z') },
      { text: 'Odd upload', severity: null, atMs: null },
    ],
  }));
  const { container } = render(<NetworkTile />);
  await flush();
  // Two numbers do not fill a row: they go on the status line's right.
  expect(container.querySelector('.net-nums')).toBeNull();
  expect(container.querySelector('.net-aside')?.textContent).toBe('31 devices, 3 alarms in 24 h');
  const rows = [...container.querySelectorAll('.net-alert')].map((r) => r.textContent);
  expect(rows).toEqual(['New device joined12m', 'Port scan blocked3h', 'Odd upload']);
  expect(container.querySelector('.sev.high')).toBeTruthy();
  expect(screen.getByText('2 more open')).toBeTruthy();
  expect(container.querySelector('.net-head')?.textContent).toBe('Network and security2 more open');
  expect(screen.queryByText('5 open alerts')).toBeNull();
});

it('puts a lone alarm count on the status line, the scan age beside the heading, and the heading above the card', async () => {
  mocks.set('wall2_home_security', () => ({ ...summary, alerts: 0, firewalla: { ...summary.firewalla, alarms24h: 7 } }));
  const { container } = render(<NetworkTile />);
  await flush();
  expect(container.querySelector('.net-status')?.textContent).toBe('All quiet7 alarms in 24 h');
  expect(container.querySelector('.net-nums')).toBeNull();
  expect(container.querySelector('.net-head')?.textContent).toBe('Network and securitylast scan 4 min ago');
  // The heading sits outside the card, above it.
  expect(container.querySelector('.panel.network .net-head')).toBeNull();
  expect(container.querySelector('.network-block > .net-head + .panel.network')).not.toBeNull();
});

it('dims the numbers on the status line when the feed goes stale, as it dims the rest', async () => {
  let fail = false;
  mocks.set('wall2_home_security', () => {
    if (fail) throw new Error('failed');
    return { ...summary, alerts: 0, firewalla: { ...summary.firewalla, alarms24h: 7 } };
  });
  const { container } = render(<NetworkTile />);
  await flush();
  expect(container.querySelector('.net-aside')!.className).not.toContain('stale');
  fail = true;
  await flush(300_000);
  expect(container.querySelector('.net-aside')!.textContent).toBe('7 alarms in 24 h');
  expect(container.querySelector('.net-aside')!.className).toContain('stale');
});

it('shows the numbers row once three numbers exist', async () => {
  mocks.set('wall2_home_security', () => ({ ...summary, devices: 31, blocked: 412, firewalla: { ...summary.firewalla, alarms24h: 7 } }));
  const { container } = render(<NetworkTile />);
  await flush();
  expect([...container.querySelectorAll('.st3')].map((n) => n.textContent)).toEqual(['31devices', '7alarms, 24h', '412blocked']);
  expect(container.querySelector('.net-aside')?.textContent).toBe('last scan 4 min ago');
});

it('says All quiet with no open alerts, and shows no numbers row when the feed has none', async () => {
  mocks.set('wall2_home_security', () => ({ ...summary, alerts: 0, firewalla: { ...summary.firewalla, alarms24h: null } }));
  const { container } = render(<NetworkTile />);
  await flush();
  expect(screen.getByText('All quiet')).toBeTruthy();
  expect(container.querySelector('.net-nums')).toBeNull();
  expect(container.querySelector('.net-alerts')).toBeNull();
});
