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
/** The card's Show all button opens the drawer (the card itself is no longer one button). */
const showAll = () => fireEvent.click(screen.getByRole('button', { name: /^Show all \d+/ }));
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
  expect(screen.getByText('12m ago. 1 high, 1 low.')).toBeTruthy();
  // The Security door is the only address the wall has: its button shows, Firewalla's does not.
  expect(screen.getByRole('button', { name: 'Security' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Firewalla' })).toBeNull();
  showAll();
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
  expect(screen.getByText('31 devices, 412 blocked')).toBeTruthy();
  expect(screen.getByText(/^Scan \d{1,2}:\d{2} (AM|PM)$/)).toBeTruthy();
  // The names of the doors and what each opens.
  expect(screen.getByText('Home app alarms')).toBeTruthy();
  expect(screen.getByText('Its own portal')).toBeTruthy();
  expect(arcs(container)).toBe(0);
  expect(container.querySelector('.shield-ring path[stroke="var(--mint)"]')).toBeTruthy();
  fireEvent.click(screen.getByText('Firewalla'));
  fireEvent.click(screen.getByText('Security'));
  await flush();
  expect(opened).toEqual([{ kind: 'portal' }, { kind: 'security' }]);
  // A quiet card has two doors and nothing else to click.
  expect(container.querySelectorAll('.panel.network button')).toHaveLength(2);
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
  showAll();
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
  render(<NetworkTile />);
  await flush();
  showAll();
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
  showAll();
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
  showAll();
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
  render(<NetworkTile />);
  await flush();
  showAll();
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
  showAll();
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
  render(<NetworkTile />);
  await flush();
  showAll();
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
  render(<NetworkTile />);
  await flush();
  showAll();
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

const quietRead = (over: Record<string, unknown> = {}) => ({ ...summary, alerts: 0, topAlerts: [], ...over });

it('quiet with the numbers the owner\'s home app sends today: the scan and the alarms, no device line', async () => {
  mocks.set('wall2_home_security', () => quietRead({ devices: undefined, blocked: undefined, firewalla: { api: 'up', boxOnline: true, checkedAt: null, alarms24h: 3 } }));
  mocks.set('wall2_desk_security', () => Promise.reject(new Error('absent')));
  mocks.set('wall2_links', () => ({ security: true, portal: true }));
  render(<NetworkTile />);
  await flush();
  expect(screen.getByText('3 alarms in 24 h')).toBeTruthy();
  expect(screen.getByText(/^Scan /)).toBeTruthy();
  expect(screen.queryByText(/devices/)).toBeNull();
  expect(screen.queryByText(/blocked/)).toBeNull();
});

it('quiet with nothing sent: no fact lines, no invented number, the doors still show', async () => {
  mocks.set('wall2_home_security', () => quietRead({ devices: undefined, blocked: undefined, lastScan: null, firewalla: null }));
  mocks.set('wall2_desk_security', () => Promise.reject(new Error('absent')));
  mocks.set('wall2_links', () => ({ security: true, portal: true }));
  const { container } = render(<NetworkTile />);
  await flush();
  expect(screen.getByText('Nothing is open.')).toBeTruthy();
  expect(container.querySelector('.shield-facts')).toBeNull();
  expect(container.querySelector('.panel.network')?.textContent).not.toMatch(/\d/);
  expect(container.querySelectorAll('.shield-door')).toHaveLength(2);
});

it('one door: only that button, and it opens its own address', async () => {
  const opened: unknown[] = [];
  mocks.set('wall2_home_security', () => quietRead());
  mocks.set('wall2_desk_security', () => Promise.reject(new Error('absent')));
  mocks.set('wall2_links', () => ({ security: false, portal: true }));
  mocks.set('wall2_open_link', (a) => void opened.push(a));
  const { container } = render(<NetworkTile />);
  await flush();
  expect(container.querySelectorAll('.shield-door')).toHaveLength(1);
  expect(screen.queryByText('Home app alarms')).toBeNull();
  fireEvent.click(screen.getByText('Its own portal'));
  await flush();
  expect(opened).toEqual([{ kind: 'portal' }]);
});

it('no door: the facts take the right side as a box, one row each, and the text widens', async () => {
  mocks.set('wall2_home_security', () => quietRead());
  mocks.set('wall2_desk_security', () => Promise.reject(new Error('absent')));
  mocks.set('wall2_links', () => ({ security: false, portal: false }));
  const { container } = render(<NetworkTile />);
  await flush();
  expect(container.querySelector('.shield-doors')).toBeNull();
  const rows = [...container.querySelectorAll('.shield-aside .shield-fact')].map((e) => e.textContent);
  expect(rows).toEqual([expect.stringMatching(/^Scan /), '31 devices', '412 blocked', '0 alarms in 24 h']);
  expect(container.querySelector('.shield-facts')).toBeNull();
  expect(container.querySelector('.panel.network.noside')).toBeNull();
});

it('no door and no fact: the text takes the whole width', async () => {
  mocks.set('wall2_home_security', () => quietRead({ devices: undefined, blocked: undefined, lastScan: null, firewalla: null }));
  mocks.set('wall2_desk_security', () => Promise.reject(new Error('absent')));
  mocks.set('wall2_links', () => ({ security: false, portal: false }));
  const { container } = render(<NetworkTile />);
  await flush();
  expect(container.querySelector('.panel.network.noside')).toBeTruthy();
  expect(container.querySelector('.shield-aside')).toBeNull();
});

it('alerts open: Show all (filled), Security and Firewalla in a row; the doors open their pages', async () => {
  const opened: unknown[] = [];
  mocks.set('wall2_home_security', () => summary);
  mocks.set('wall2_desk_security', () => desk(3));
  mocks.set('wall2_links', () => ({ security: true, portal: true }));
  mocks.set('wall2_open_link', (a) => void opened.push(a));
  const { container } = render(<NetworkTile />);
  await flush();
  expect([...container.querySelectorAll('.shield-btns .shield-btn')].map((b) => b.textContent)).toEqual(['Show all 3', 'Security', 'Firewalla']);
  expect(container.querySelector('.shield-btn.fill')?.textContent).toBe('Show all 3');
  expect(screen.getByText('3 alerts open, 27 devices at home')).toBeTruthy();
  // The newest alert on one line, its age and the counts by severity.
  expect(screen.getByText('10m ago. 1 high, 2 medium.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Firewalla' }));
  fireEvent.click(screen.getByRole('button', { name: 'Security' }));
  await flush();
  expect(opened).toEqual([{ kind: 'portal' }, { kind: 'security' }]);
  // The newest alert's line opens the same drawer as Show all.
  fireEvent.click(container.querySelector('.shield-new') as HTMLElement);
  await flush();
  expect(screen.getByRole('dialog', { name: 'Open alerts' })).toBeTruthy();
});

it('alerts open with no address for either door: Show all stands alone', async () => {
  mocks.set('wall2_home_security', () => summary);
  mocks.set('wall2_desk_security', () => desk(2));
  mocks.set('wall2_links', () => ({ security: false, portal: false }));
  const { container } = render(<NetworkTile />);
  await flush();
  expect([...container.querySelectorAll('.shield-btns .shield-btn')].map((b) => b.textContent)).toEqual(['Show all 2']);
});

it('not live and quiet: "Nothing was open.", the facts as of their time, never as if current', async () => {
  mocks.set('wall2_home_security', () => quietRead());
  mocks.set('wall2_desk_security', () => desk(0, { stale: true, observedAt: '2026-11-11T11:13:00Z' }));
  mocks.set('wall2_links', () => ({ security: true, portal: true }));
  const { container } = render(<NetworkTile />);
  await flush();
  expect(screen.getByText('Nothing was open.')).toBeTruthy();
  expect(screen.queryByText('Nothing is open.')).toBeNull();
  expect(container.querySelector('.net-head .xs')?.textContent).toMatch(/^as of /);
  expect(container.querySelector('.panel.network.stale .shield-facts')).toBeTruthy();
});
