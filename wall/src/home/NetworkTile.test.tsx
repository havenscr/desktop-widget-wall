import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { HoverTipLayer, TIP_DELAY_MS } from '../ui/HoverTip';
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
  expect(screen.getByText('12 min ago. 1 high, 1 low.')).toBeTruthy();
  // The Security door is the only address the wall has: its button shows, Firewalla's does not.
  expect(screen.getByRole('button', { name: 'Home security' })).toBeTruthy();
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
  expect(screen.getByText('Network alarms')).toBeTruthy();
  expect(screen.getByText('Devices and rules')).toBeTruthy();
  expect(arcs(container)).toBe(0);
  expect(container.querySelector('.shield-ring path[stroke="var(--mint)"]')).toBeTruthy();
  fireEvent.click(screen.getByText('Firewalla'));
  fireEvent.click(screen.getByText('Home security'));
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
  expect(screen.queryByText('Home security')).toBeNull();
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
  // The scan fact line and the Home security tile both say it.
  expect(screen.getAllByText('3 alarms in 24 h')).toHaveLength(2);
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
  expect(screen.queryByText('Network alarms')).toBeNull();
  fireEvent.click(screen.getByText('Devices and rules'));
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
  expect([...container.querySelectorAll('.shield-btns .shield-btn')].map((b) => b.textContent)).toEqual(['Show all 3', 'Home security', 'Firewalla']);
  expect(container.querySelector('.shield-btn.fill')?.textContent).toBe('Show all 3');
  expect(screen.getByText('3 alerts open, 27 devices at home')).toBeTruthy();
  // The newest alert on one line, its age and the counts by severity.
  expect(screen.getByText('10 min ago. 1 high, 2 medium.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Firewalla' }));
  fireEvent.click(screen.getByRole('button', { name: 'Home security' }));
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

it('not live and quiet: "Nothing was open.", the facts dimmed, "as of" with its own hover, the scan on its own clock', async () => {
  mocks.set('wall2_home_security', () => quietRead());
  mocks.set('wall2_desk_security', () => desk(0, { stale: true, observedAt: '2026-11-11T11:13:00Z' }));
  mocks.set('wall2_links', () => ({ security: true, portal: true }));
  const { container } = render(
    <>
      <NetworkTile />
      <HoverTipLayer />
    </>,
  );
  await flush();
  expect(screen.getByText('Nothing was open.')).toBeTruthy();
  expect(screen.queryByText('Nothing is open.')).toBeNull();
  const stamp = container.querySelector('.net-head .xs') as HTMLElement;
  expect(stamp.textContent).toMatch(/^as of /);
  // The card carries the stale class that dims the sub line and the facts (home.css: opacity .74 on .stale .shield-facts).
  expect(container.querySelector('.panel.network.stale .shield-facts')).toBeTruthy();
  expect(container.querySelector('.panel.network.stale')?.classList.contains('stale')).toBe(true);
  expect(container.querySelector('.shield-ring [stroke="var(--mint)"]')).toBeNull();
  const words = async (el: Element) => {
    fireEvent.mouseEnter(el);
    await flush(TIP_DELAY_MS);
    const t = screen.getByRole('tooltip').textContent;
    fireEvent.mouseLeave(el);
    await flush(10);
    return t;
  };
  expect(await words(stamp)).toMatch(/^The home app's last answer, /);
  expect(await words(container.querySelector('.shield-fact') as HTMLElement)).toMatch(/^The firewall's own last scan, /);
});

it('with alerts open a click on the card\'s face opens the drawer, and a click on a door does not', async () => {
  const opened: unknown[] = [];
  mocks.set('wall2_home_security', () => summary);
  mocks.set('wall2_desk_security', () => desk(3));
  mocks.set('wall2_links', () => ({ security: true, portal: true }));
  mocks.set('wall2_open_link', (a) => void opened.push(a));
  const { container } = render(<NetworkTile />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Home security' }));
  await flush();
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(container.querySelector('.panel.network') as HTMLElement);
  await flush();
  expect(screen.getByRole('dialog', { name: 'Open alerts' })).toBeTruthy();
  // The same click again closes it.
  fireEvent.click(container.querySelector('.panel.network') as HTMLElement);
  await flush();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(opened).toEqual([{ kind: 'security' }]);
});

it('not live with alerts open: grey arcs, dimmed text, the buttons still there, "N open as of" in the heading', async () => {
  mocks.set('wall2_home_security', () => summary);
  mocks.set('wall2_desk_security', () => desk(3, { stale: true, observedAt: '2026-11-11T11:13:00Z' }));
  mocks.set('wall2_links', () => ({ security: true, portal: true }));
  const { container } = render(<NetworkTile />);
  await flush();
  expect(container.querySelector('.panel.network.busy.stale')).toBeTruthy();
  expect([...container.querySelectorAll('.shield-ring .arc')].map((a) => a.getAttribute('stroke'))).toEqual(['var(--faint)', 'var(--faint)', 'var(--faint)']);
  expect(container.querySelector('.net-head .xs')?.textContent).toMatch(/^3 open as of /);
  expect([...container.querySelectorAll('.shield-btns .shield-btn')].map((b) => b.textContent)).toEqual(['Show all 3', 'Home security', 'Firewalla']);
});

it('an alert whose severity the wall was never told is neutral on the ring, never the colour of high', async () => {
  // Twenty open, three listed (today\'s read): the first three keep their colours, the other nine arcs are neutral.
  mocks.set('wall2_home_security', () => ({ ...summary, alerts: 20 }));
  mocks.set('wall2_desk_security', () => Promise.reject(new Error('absent')));
  const { container, unmount } = render(<NetworkTile />);
  await flush();
  const stroke = () => [...container.querySelectorAll('.shield-ring .arc')].map((a) => a.getAttribute('stroke'));
  expect(stroke()).toHaveLength(12);
  expect(stroke().slice(0, 2)).toEqual(['var(--amber)', '#b7afd6']);
  expect(stroke().slice(2)).toEqual(Array(10).fill('var(--faint)'));
  expect(stroke().filter((c) => c === 'var(--amber)')).toHaveLength(1);
  unmount();
  // A listed alert with no severity is neutral too; an explicit high stays amber.
  mocks.set('wall2_home_security', () => ({ ...summary, alerts: 2, topAlerts: [{ text: 'Unrated thing', severity: null, atMs: Date.parse('2026-11-11T11:50:00Z') }, { text: 'Rated high', severity: 'high', atMs: Date.parse('2026-11-11T11:40:00Z') }] }));
  const second = render(<NetworkTile />);
  await flush();
  expect([...second.container.querySelectorAll('.shield-ring .arc')].map((a) => a.getAttribute('stroke'))).toEqual(['var(--faint)', 'var(--amber)']);
});

it('a title that does not fit its column wraps at 22 px (class long) and always has the full title on hover', async () => {
  // jsdom has no layout: say the title is wider than its box.
  const sw = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('shield-title') && !this.classList.contains('long') ? 300 : 0;
  });
  const cw = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('shield-title') ? 204 : 0;
  });
  try {
    mocks.set('wall2_home_security', () => quietRead({ firewalla: { api: 'up', boxOnline: false, checkedAt: null, alarms24h: 3 } }));
    mocks.set('wall2_desk_security', () => Promise.reject(new Error('absent')));
    mocks.set('wall2_links', () => ({ security: true, portal: true }));
    const { container } = render(
      <>
        <NetworkTile />
        <HoverTipLayer />
      </>,
    );
    await flush();
    const title = container.querySelector('.shield-title') as HTMLElement;
    expect(title.textContent).toBe('Firewall box offline');
    expect(title.classList.contains('long')).toBe(true);
    expect(container.querySelector('.shield-txt.longtitle')).toBeTruthy();
    fireEvent.mouseEnter(title);
    await flush(TIP_DELAY_MS);
    expect(screen.getByRole('tooltip').textContent).toBe('Firewall box offline');
  } finally {
    sw.mockRestore();
    cw.mockRestore();
  }
});

it('a title that fits stays at 27 px on one line', async () => {
  mocks.set('wall2_home_security', () => quietRead());
  mocks.set('wall2_desk_security', () => Promise.reject(new Error('absent')));
  const { container } = render(<NetworkTile />);
  await flush();
  expect(container.querySelector('.shield-title.long')).toBeNull();
  expect(container.querySelector('.shield-txt.longtitle')).toBeNull();
});

it('the newest alert line is a real button (its 40 px hit area is measured by the fit check)', async () => {
  mocks.set('wall2_home_security', () => summary);
  mocks.set('wall2_desk_security', () => desk(3));
  const { container } = render(<NetworkTile />);
  await flush();
  expect(container.querySelector('button.shield-new')).toBeTruthy();
});

it('the tiles: quiet words, a live alarm count, and plain words again when the read is not live', async () => {
  mocks.set('wall2_desk_security', () => Promise.reject(new Error('absent')));
  mocks.set('wall2_links', () => ({ security: true, portal: true }));
  const quiet = (alarms24h: number, over: Record<string, unknown> = {}) => ({ ...summary, alerts: 0, topAlerts: [], firewalla: { ...summary.firewalla, alarms24h }, ...over });
  const lines = (c: HTMLElement) => [...c.querySelectorAll('.shield-door')].map((d) => [...d.querySelectorAll('.shield-door-txt > *')].map((e) => e.textContent));
  mocks.set('wall2_home_security', () => quiet(0));
  const a = render(<NetworkTile />);
  await flush();
  expect(lines(a.container)).toEqual([['Home security', 'Network alarms'], ['Firewalla', 'Devices and rules']]);
  a.unmount();
  mocks.set('wall2_home_security', () => quiet(2));
  const b = render(<NetworkTile />);
  await flush();
  expect(lines(b.container)).toEqual([['Home security', '2 alarms in 24 h'], ['Firewalla', 'Devices and rules']]);
  b.unmount();
  mocks.set('wall2_home_security', () => quiet(2, { reachable: false }));
  const c = render(<NetworkTile />);
  await flush();
  expect(lines(c.container)).toEqual([['Home security', 'Network alarms'], ['Firewalla', 'Devices and rules']]);
  // The title cannot run into the tile's padding: it ends in an ellipsis when too long.
  expect(c.container.querySelector('.shield-door-txt b')?.textContent).toBe('Home security');
});
