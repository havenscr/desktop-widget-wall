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
  expect(container.querySelector('.net-dot.ok')).toBeTruthy();
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
  expect(container.querySelector('.net-dot.warn')).toBeTruthy();
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
  withLinks({ security: true, portal: false }, (a) => void opened.push(a?.kind));
  render(<NetworkTile />);
  await flush();
  expect(screen.queryByRole('button', { name: 'Firewalla' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Security' }));
  await flush();
  expect(opened).toEqual(['security']);
});

it('opens the portal link, and a failure shows Could not open for 3 seconds', async () => {
  withLinks({ security: true, portal: true }, () => Promise.reject(new Error('nope')));
  render(<NetworkTile />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Firewalla' }));
  await flush();
  expect(screen.getByText('Could not open')).toBeTruthy();
  await flush(3100);
  expect(screen.queryByText('Could not open')).toBeNull();
});
