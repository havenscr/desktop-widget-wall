import { mocks } from '../tauri';

/** The network tile and the Home moods. */
export function registerHomeMocks(): void {
  mocks.set('wall2_home_security', () => ({
    reachable: true,
    stale: false,
    lastScan: new Date(Date.now() - 4 * 60_000).toISOString(),
    alerts: 4,
    firewalla: { api: 'up', boxOnline: true, checkedAt: new Date().toISOString(), alarms24h: 3 },
    portalUrl: 'https://my.firewalla.net/',
    topAlerts: [
      { text: 'New device joined the guest network', severity: 'high', atMs: Date.now() - 12 * 60_000 },
      { text: 'Large upload from the office PC', severity: 'medium', atMs: Date.now() - 3 * 3_600_000 },
      { text: 'Port scan blocked', severity: 'low', atMs: Date.now() - 20 * 3_600_000 },
    ],
    // The home app does not send these yet (PR 24 reads them); here so the dev view shows the full card.
    devices: 31,
    blocked: 412,
    boxTemp: 61,
  }));
  mocks.set('wall2_links', () => ({ security: true, portal: true }));
  mocks.set('wall2_open_link', () => undefined);
  mocks.set('wall2_moods', () => [
    { id: 'day', label: 'Day' },
    { id: 'evening', label: 'Evening' },
    { id: 'lateNight', label: 'Late Night' },
  ]);
  mocks.set('wall2_apply_mood', async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
}
