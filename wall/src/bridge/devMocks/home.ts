import { mocks } from '../tauri';

/** The network tile and the Home moods. */
export function registerHomeMocks(): void {
  mocks.set('wall2_home_security', () => ({
    reachable: true,
    stale: false,
    lastScan: new Date(Date.now() - 4 * 60_000).toISOString(),
    alerts: 2,
    firewalla: { api: 'up', boxOnline: true, checkedAt: new Date().toISOString(), alarms24h: 3 },
    portalUrl: null,
  }));
  mocks.set('wall2_moods', () => [
    { id: 'day', label: 'Day' },
    { id: 'evening', label: 'Evening' },
    { id: 'lateNight', label: 'Late Night' },
  ]);
  mocks.set('wall2_apply_mood', async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
}
