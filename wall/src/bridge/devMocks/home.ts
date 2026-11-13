import { reviewNow } from '../../ui/reviewClock';
import { mocks } from '../tauri';
import { knob } from './long';

/** Times follow the review still's clock (`?hz=&at=`), so ages read the same as on the wall. */
const now = () => (reviewNow ? reviewNow() : Date.now());

/** The network tile and the Home moods. */
export function registerHomeMocks(): void {
  mocks.set('wall2_home_security', () => {
    const t = now();
    return {
      reachable: true,
      stale: false,
      lastScan: new Date(t - 4 * 60_000).toISOString(),
      alerts: 4,
      firewalla: { api: 'up', boxOnline: true, checkedAt: new Date(t).toISOString(), alarms24h: 3 },
      portalUrl: 'https://my.firewalla.net/',
      topAlerts: [
        { text: 'New device joined the guest network', severity: 'high', atMs: t - 12 * 60_000 },
        { text: 'Large upload from the office PC', severity: 'medium', atMs: t - 3 * 3_600_000 },
        { text: 'Port scan blocked', severity: 'low', atMs: t - 20 * 3_600_000 },
      ],
      // The home app does not send these yet (PR 24 reads them); here so the dev view shows
      // the full card. `?net=alarms` leaves them out, as the home app answers today.
      ...(knob('net') === 'alarms' ? {} : { devices: 31, blocked: 412, boxTemp: 61 }),
    };
  });
  mocks.set('wall2_links', () => ({ security: true, portal: true }));
  mocks.set('wall2_open_link', () => undefined);
  // `?moods=five` gives the concept's five, `?moods=many` nine (the row scrolls), `?moods=none`
  // an empty list, `?moods=off` not set up; with a review time, Evening is "In 4 min" in five.
  mocks.set('wall2_moods', () => {
    const k = knob('moods');
    if (k === 'off') return Promise.reject(new Error('not-configured'));
    if (k === 'none') return [];
    const three = [
      { id: 'day', label: 'Day' },
      { id: 'evening', label: 'Evening', ...(k === 'five' ? { nextAtMs: now() + 4 * 60_000 } : {}) },
      { id: 'lateNight', label: 'Late Night' },
    ];
    if (k === 'five' || k === 'many') {
      const five = [...three, { id: 'movie', label: 'Movie' }, { id: 'goodnight', label: 'Goodnight' }];
      if (k === 'five') return five;
      return [...five, { id: 'reading', label: 'Reading' }, { id: 'dinner', label: 'Dinner' }, { id: 'focusTime', label: 'Focus Time' }, { id: 'partyNight', label: 'Party Night' }];
    }
    return three;
  });
  mocks.set('wall2_apply_mood', async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
}
