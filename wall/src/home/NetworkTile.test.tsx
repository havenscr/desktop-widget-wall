import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { NetworkTile } from './NetworkTile';
import { CLEARED_NOTE_MS, deskSecurity, useClearedNote } from './useDesk';

// One test steps fake timers through five minutes: a busy machine gets 20 seconds per test.
vi.setConfig({ testTimeout: 20_000 });

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
  useClearedNote.setState({ text: null });
});

const summary = {
  reachable: true,
  stale: false,
  lastScan: '2026-11-11T11:56:00Z',
  alerts: 2,
  firewalla: { api: 'up', boxOnline: true, checkedAt: null, alarms24h: 0 },
  portalUrl: null,
  topAlerts: [
    { text: 'Port scan blocked', severity: 'low', atMs: Date.parse('2026-11-11T07:00:00Z') },
    { text: 'New device on the guest network', severity: 'high', atMs: Date.parse('2026-11-11T11:48:00Z') },
  ],
  devices: 31,
  blocked: 412,
};

const alert = (i: number, severity = 'medium') => ({ id: `alert:${i}`, severity, text: `Alert number ${i}`, at: new Date(Date.parse('2026-11-11T12:00:00Z') - (i + 1) * 600_000).toISOString(), ageSeconds: (i + 1) * 600 });
const desk = (n: number, over: Record<string, unknown> = {}) => ({
  available: true,
  stale: false,
  observedAt: '2026-11-11T11:59:00Z',
  devices: 27,
  blocked: 3,
  unseen: n,
  alerts: Array.from({ length: n }, (_, i) => alert(i, i === 0 ? 'high' : 'medium')),
  canClear: true,
  ...over,
});
const arcs = (c: HTMLElement) => c.querySelectorAll('.shield-ring .arc').length;

it('with the desk route absent, shows today\'s read: the ring, the count and the newest alert, and no Clear all', async () => {
  mocks.set('wall2_home_security', () => summary);
  mocks.set('wall2_desk_security', () => Promise.reject(new Error('absent')));
  mocks.set('wall2_links', () => ({ security: true, portal: false }));
  const { container } = render(<NetworkTile />);
  await flush();
  expect(screen.getByText('Up, box online')).toBeTruthy();
  expect(screen.getByText('2 alerts open, 31 devices at home')).toBeTruthy();
  expect(arcs(container)).toBe(2);
  expect(container.querySelector('.shield-n')?.textContent).toBe('2');
  // Newest first, whatever the order the read gave.
  expect(container.querySelector('.shield-new b')?.textContent).toBe('New device on the guest network');
  expect(screen.getByText(/12m ago\. Click for all 2/)).toBeTruthy();
  fireEvent.click(container.querySelector('.panel.network') as HTMLElement);
  await flush();
  expect(screen.getByRole('dialog', { name: 'Open alerts' })).toBeTruthy();
  expect([...container.querySelectorAll('.sd-row b')].map((b) => b.textContent)).toEqual(['New device on the guest network', 'Port scan blocked']);
  expect(screen.queryByText('Clear all')).toBeNull();
  expect(screen.getAllByText('Open')).toHaveLength(2);
});

it('quiet: a whole mint ring, All quiet, the device and blocked numbers, and the two links', async () => {
  const opened: unknown[] = [];
  mocks.set('wall2_home_security', () => ({ ...summary, alerts: 0, topAlerts: [] }));
  mocks.set('wall2_desk_security', () => Promise.reject(new Error('absent')));
  mocks.set('wall2_links', () => ({ security: true, portal: true }));
  mocks.set('wall2_open_link', (a) => void opened.push(a));
  const { container } = render(<NetworkTile />);
  await flush();
  expect(screen.getByText('All quiet')).toBeTruthy();
  expect(screen.getByText('Nothing is open.')).toBeTruthy();
  expect(screen.getByText('31 devices at home, 412 blocked.')).toBeTruthy();
  expect(arcs(container)).toBe(0);
  expect(container.querySelector('.shield-ring path[stroke="var(--mint)"]')).toBeTruthy();
  fireEvent.click(screen.getByText('Firewalla'));
  fireEvent.click(screen.getByText('Security'));
  await flush();
  expect(opened).toEqual([{ kind: 'portal' }, { kind: 'security' }]);
  // A quiet card is not a button: nothing to open.
  expect(container.querySelector('button.panel.network')).toBeNull();
});

it('a failed open says Could not open for 3 seconds', async () => {
  mocks.set('wall2_home_security', () => ({ ...summary, alerts: 0, topAlerts: [] }));
  mocks.set('wall2_desk_security', () => Promise.reject(new Error('absent')));
  mocks.set('wall2_links', () => ({ security: false, portal: true }));
  mocks.set('wall2_open_link', () => Promise.reject(new Error('no')));
  render(<NetworkTile />);
  await flush();
  expect(screen.queryByText('Security')).toBeNull();
  fireEvent.click(screen.getByText('Firewalla'));
  await flush();
  expect(screen.getByText('Could not open')).toBeTruthy();
  await flush(3000);
  expect(screen.queryByText('Could not open')).toBeNull();
});

it('the desk route: one arc per alert up to twelve, "12+" past that, and the drawer lists them all', async () => {
  mocks.set('wall2_home_security', () => summary);
  mocks.set('wall2_desk_security', () => desk(20));
  mocks.set('wall2_links', () => ({ security: true, portal: true }));
  const { container } = render(<NetworkTile />);
  await flush();
  expect(arcs(container)).toBe(12);
  expect(container.querySelector('.shield-n')?.textContent).toBe('12+');
  expect(screen.getByText('20 alerts open, 27 devices at home')).toBeTruthy();
  fireEvent.click(container.querySelector('.panel.network') as HTMLElement);
  await flush();
  expect(container.querySelectorAll('.sd-row')).toHaveLength(20);
  expect(screen.getByText('20 open alerts')).toBeTruthy();
  // Escape closes it.
  fireEvent.keyDown(document, { key: 'Escape' });
  await flush();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('Clear all calls the home app once, says how many, and the card goes quiet on the next read', async () => {
  let cleared = false;
  const calls: unknown[] = [];
  mocks.set('wall2_home_security', () => summary);
  mocks.set('wall2_desk_security', () => (cleared ? desk(0) : desk(6)));
  mocks.set('wall2_desk_clear_alerts', (a) => {
    calls.push(a);
    cleared = true;
    return 6;
  });
  mocks.set('wall2_links', () => ({ security: true, portal: false }));
  const { container } = render(<NetworkTile />);
  await flush();
  fireEvent.click(container.querySelector('.panel.network') as HTMLElement);
  await flush();
  fireEvent.click(screen.getByText('Clear all'));
  await flush();
  expect(calls).toHaveLength(1);
  // The drawer closes once nothing is open; the card is quiet and says what was cleared.
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByText('Nothing is open.')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('Cleared 6 alerts');
  await flush(CLEARED_NOTE_MS + 100);
  expect(screen.queryByText('Cleared 6 alerts')).toBeNull();
});

it('Clear all during a read already out: that read is dropped and a fresh one follows', async () => {
  let cleared = false;
  let reads = 0;
  mocks.set('wall2_home_security', () => summary);
  mocks.set('wall2_desk_security', () => {
    reads += 1;
    // The second read is slow and was asked before the clear: it still lists all six.
    if (reads === 2) return new Promise((done) => setTimeout(() => done(desk(6)), 2000));
    return cleared ? desk(0) : desk(6);
  });
  mocks.set('wall2_desk_clear_alerts', () => {
    cleared = true;
    return 6;
  });
  mocks.set('wall2_links', () => ({ security: true, portal: false }));
  const { container } = render(<NetworkTile />);
  await flush();
  fireEvent.click(container.querySelector('.panel.network') as HTMLElement);
  await flush();
  act(() => {
    void deskSecurity.refresh();
  });
  fireEvent.click(screen.getByText('Clear all'));
  await flush(3000);
  expect(reads).toBe(3);
  expect(arcs(container)).toBe(0);
  expect(screen.getByText('Nothing is open.')).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('a stale read: the drawer title says when, and Clear all waits for a fresh read', async () => {
  const calls: unknown[] = [];
  mocks.set('wall2_home_security', () => summary);
  mocks.set('wall2_desk_security', () => desk(3, { stale: true, observedAt: '2026-11-11T11:13:00Z' }));
  mocks.set('wall2_desk_clear_alerts', (a) => void calls.push(a));
  mocks.set('wall2_links', () => ({ security: true, portal: false }));
  const { container } = render(<NetworkTile />);
  await flush();
  fireEvent.click(container.querySelector('.panel.network') as HTMLElement);
  await flush();
  expect(container.querySelector('.sd-head b')?.textContent).toMatch(/^3 open alerts as of /);
  expect(screen.getByText('Clear all waits for a fresh read')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();
  expect(calls).toEqual([]);
});

it('a plain http home address on the network: Clear all says it needs a private or https address', async () => {
  mocks.set('wall2_home_security', () => summary);
  mocks.set('wall2_desk_security', () => desk(2, { canClear: false, clearInsecure: true }));
  mocks.set('wall2_links', () => ({ security: true, portal: false }));
  const { container } = render(<NetworkTile />);
  await flush();
  fireEvent.click(container.querySelector('.panel.network') as HTMLElement);
  await flush();
  expect(screen.getByText('Clear all needs a private or https address')).toBeTruthy();
  expect(screen.queryByText('Clear all: not set up')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();
});

it('a click outside the drawer closes it; a click inside does not', async () => {
  mocks.set('wall2_home_security', () => summary);
  mocks.set('wall2_desk_security', () => desk(2));
  mocks.set('wall2_links', () => ({ security: true, portal: false }));
  const { container } = render(<NetworkTile />);
  await flush();
  fireEvent.click(container.querySelector('.panel.network') as HTMLElement);
  await flush();
  fireEvent.pointerDown(container.querySelector('.sd-row') as HTMLElement);
  await flush();
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.pointerDown(document.body);
  await flush();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('without a desk token, Clear all says not set up and never calls the home app', async () => {
  const calls: unknown[] = [];
  mocks.set('wall2_home_security', () => summary);
  mocks.set('wall2_desk_security', () => desk(2, { canClear: false }));
  mocks.set('wall2_desk_clear_alerts', (a) => void calls.push(a));
  mocks.set('wall2_links', () => ({ security: true, portal: false }));
  const { container } = render(<NetworkTile />);
  await flush();
  fireEvent.click(container.querySelector('.panel.network') as HTMLElement);
  await flush();
  expect(screen.getByText('Clear all: not set up')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();
  expect(calls).toEqual([]);
});

it('a refused clear says so and keeps the drawer open', async () => {
  mocks.set('wall2_home_security', () => summary);
  mocks.set('wall2_desk_security', () => desk(2));
  mocks.set('wall2_desk_clear_alerts', () => Promise.reject(new Error('forbidden')));
  mocks.set('wall2_links', () => ({ security: true, portal: false }));
  const { container } = render(<NetworkTile />);
  await flush();
  fireEvent.click(container.querySelector('.panel.network') as HTMLElement);
  await flush();
  fireEvent.click(screen.getByText('Clear all'));
  await flush();
  expect(screen.getByText('The home app refused the clear')).toBeTruthy();
  expect(screen.getByRole('dialog')).toBeTruthy();
});

it('stale data is a grey ring with "as of", never mint, and no Clear all', async () => {
  mocks.set('wall2_home_security', () => summary);
  mocks.set('wall2_desk_security', () => desk(0, { stale: true, observedAt: '2026-11-11T11:13:00Z' }));
  const { container } = render(<NetworkTile />);
  await flush();
  expect(container.querySelector('.panel.network.stale')).toBeTruthy();
  expect(container.querySelector('.shield-ring [stroke="var(--mint)"]')).toBeNull();
  expect(screen.getAllByText(/as of/).length).toBeGreaterThan(0);
});

it('a failed desk refresh after a good read keeps the alerts but greys the ring', async () => {
  let fail = false;
  mocks.set('wall2_home_security', () => summary);
  mocks.set('wall2_desk_security', () => (fail ? Promise.reject(new Error('failed')) : desk(3)));
  const { container } = render(<NetworkTile />);
  await flush();
  expect(container.querySelector('.panel.network.stale')).toBeNull();
  fail = true;
  await flush(300_000);
  expect(container.querySelector('.panel.network.stale')).toBeTruthy();
  expect(arcs(container)).toBe(3);
  expect(container.querySelector('.shield-ring .arc')?.getAttribute('stroke')).toBe('var(--faint)');
  // The count in the head says when it was read, never as if live.
  expect(container.querySelector('.net-head .xs')?.textContent).toMatch(/^3 open as of /);
});

it('shows Not set up, and Home app not reachable with no read', async () => {
  mocks.set('wall2_home_security', () => Promise.reject(new Error('not-configured')));
  mocks.set('wall2_desk_security', () => Promise.reject(new Error('not-configured')));
  const off = render(<NetworkTile />);
  await flush();
  expect(screen.getByText('Not set up')).toBeTruthy();
  off.unmount();
  mocks.set('wall2_home_security', () => Promise.reject(new Error('Could not reach the service')));
  mocks.set('wall2_desk_security', () => Promise.reject(new Error('absent')));
  render(<NetworkTile />);
  await flush();
  expect(screen.getByText('Home app not reachable')).toBeTruthy();
  expect(screen.getByText('Checks again every 5 minutes.')).toBeTruthy();
});
