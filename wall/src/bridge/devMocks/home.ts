import { reviewNow } from '../../ui/reviewClock';
import { mocks } from '../tauri';
import { knob } from './long';

/** Times follow the review still's clock (`?hz=&at=`), so ages read the same as on the wall. */
const now = () => (reviewNow ? reviewNow() : Date.now());

/** The network tile and the Home moods. */
export function registerHomeMocks(): void {
  mocks.set('wall2_home_security', () => {
    // `?home=loading` is a first read that never answers (the card reads "Loading").
    if (knob('home') === 'loading') return new Promise(() => undefined);
    const t = now();
    const net = knob('net');
    // `?fw=offline|unknown|unreachable` gives the card the long status titles ("Firewall box offline", "Firewall status unknown",
    // "Home app not reachable") while its doors are shown.
    const fw = knob('fw');
    // `?net=calmbare` is quiet and the home app sent neither a scan time nor any number.
    const bare = net === 'calmbare';
    return {
      reachable: fw !== 'unreachable',
      stale: false,
      lastScan: bare ? null : new Date(t - 4 * 60_000).toISOString(),
      // `?alarmcount=N` sets the open alarm count (default 4; `?net=calm` is 0).
      alerts: net === 'calm' || bare ? 0 : /^\d{1,3}$/.test(knob('alarmcount') ?? '') ? Number(knob('alarmcount')) : 4,
      firewalla: { api: fw === 'unknown' ? 'unknown' : 'up', boxOnline: fw === 'offline' ? false : true, checkedAt: new Date(t).toISOString(), alarms24h: bare ? null : 3 },
      portalUrl: 'https://my.firewalla.net/',
      topAlerts: [
        { text: 'New device joined the guest network', severity: 'high', atMs: t - 12 * 60_000 },
        { text: 'Large upload from the office PC', severity: 'medium', atMs: t - 3 * 3_600_000 },
        { text: 'Port scan blocked', severity: 'low', atMs: t - 20 * 3_600_000 },
      ],
      // The home app does not send these yet (PR 24 reads them); here so the dev view shows
      // the full card. `?net=alarms` leaves them out, as the home app answers today.
      ...(net === 'alarms' || bare ? {} : { devices: 31, blocked: 412, boxTemp: 61 }),
    };
  });
  registerDeskMocks();
  // `?links=security|portal|none` leaves out a door (the wall has no address for it); the default has both.
  mocks.set('wall2_links', () => {
    const k = knob('links');
    return { security: k !== 'portal' && k !== 'none', portal: k !== 'security' && k !== 'none' };
  });
  mocks.set('wall2_open_link', () => undefined);
  // `?camcheck=missing` makes the Camera check key answer `failed`.
  mocks.set('wall2_open_camera', () => (knob('camcheck') === 'missing' ? Promise.reject(new Error('failed')) : undefined));
  // Still Working comes first, as the home app sends it. `?moods=five` gives five, `?moods=many`
  // nine (More card), `?moods=none` an empty list, `?moods=off` not set up, `?moods=down` not
  // reachable, `?moods=unsaved` the four with Still Working not saved yet; with a review time,
  // Evening is "In 4 min" in five.
  mocks.set('wall2_moods', () => {
    const k = knob('moods');
    if (k === 'off') return Promise.reject(new Error('not-configured'));
    if (k === 'down') return Promise.reject(new Error('Could not reach the service'));
    if (k === 'none') return [];
    // `?moods=3|7|12`: that many moods (Home shows four large and a More card past four).
    if (k === '3' || k === '7' || k === '12') {
      const names = ['Still Working', 'Day', 'Evening', 'Late Night', 'Movie', 'Goodnight', 'Reading', 'Dinner', 'Focus Time', 'Party Night', 'Wake Up', 'Rainy Day', 'Away'];
      return names.slice(0, Number(k)).map((label) => ({ id: label.replace(/ (.)/g, (_, c: string) => c.toUpperCase()).replace(/^./, (c) => c.toLowerCase()), label }));
    }
    const four = [
      { id: 'stillWorking', label: 'Still Working', ...(k === 'unsaved' ? { saved: false } : {}) },
      { id: 'day', label: 'Day' },
      { id: 'evening', label: 'Evening', ...(k === 'five' ? { nextAtMs: now() + 4 * 60_000 } : {}) },
      { id: 'lateNight', label: 'Late Night' },
    ];
    if (k === 'five' || k === 'many') {
      const five = [...four, { id: 'movie', label: 'Movie' }];
      if (k === 'five') return five;
      return [...five, { id: 'goodnight', label: 'Goodnight' }, { id: 'reading', label: 'Reading' }, { id: 'dinner', label: 'Dinner' }, { id: 'focusTime', label: 'Focus Time' }, { id: 'partyNight', label: 'Party Night' }];
    }
    return four;
  });
  mocks.set('wall2_apply_mood', async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
}

/** Invented alerts, newest first, for the desk security mock. */
const ALERTS = [
  { severity: 'medium', text: 'New device on the guest network', mins: 12 },
  { severity: 'medium', text: 'Large upload from the office PC', mins: 180 },
  { severity: 'low', text: 'Port scan blocked', mins: 300 },
  { severity: 'medium', text: 'Smart plug went offline', mins: 360 },
  { severity: 'low', text: 'The box opened a new address', mins: 540 },
  { severity: 'low', text: 'Printer asked for an update', mins: 1200 },
];

/**
 * The home app's desk routes. `?desk=absent` (the default: the home app's change is not
 * live, every route answers `absent`), `typical`, `stale` (old data, flagged stale) or
 * `down` (the routes fail). `?alerts=0|1|6|20` open alerts, `?rooms=0|1|2|4|7|8|12` rooms (two lit
 * in four, all lit in seven, every third lit in twelve), `?desktoken=none` no desk token on this PC (Clear all says not set up),
 * `?desktoken=lan` a token but a plain http home address on the network (Clear all says why). `?lights=none|fail` rooms carry no light list.
 */
function registerDeskMocks(): void {
  const mode = () => knob('desk') ?? 'absent';
  const gate = () => {
    const m = mode();
    if (m === 'absent') return Promise.reject(new Error('absent'));
    if (m === 'down') return Promise.reject(new Error('failed'));
    return null;
  };
  const stale = () => mode() === 'stale';
  const observed = () => new Date(now() - (stale() ? 47 * 60_000 : 30_000)).toISOString();
  let cleared = false;
  mocks.set('wall2_desk_security', () => {
    const g = gate();
    if (g) return g;
    const n = cleared ? 0 : Number(knob('alerts') ?? 6);
    const t = now();
    const alerts = Array.from({ length: n }, (_, i) => {
      const a = ALERTS[i % ALERTS.length];
      const mins = a.mins + Math.floor(i / ALERTS.length) * 1440;
      const severity = i === 0 ? 'high' : a.severity;
      return { id: `alert:${(i + 1).toString(16).padStart(16, '0')}`, severity, text: a.text, at: new Date(t - mins * 60_000).toISOString(), ageSeconds: mins * 60 };
    });
    return { available: true, stale: stale(), observedAt: observed(), devices: 31, blocked: 412, unseen: n, alerts, canClear: !['none', 'lan'].includes(knob('desktoken') ?? ''), clearInsecure: knob('desktoken') === 'lan' };
  });
  mocks.set('wall2_desk_clear_alerts', async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (knob('desktoken') === 'none') throw new Error('not-set-up');
    if (knob('desktoken') === 'lan') throw new Error('needs-private-address');
    const n = cleared ? 0 : Number(knob('alerts') ?? 6);
    if (n === 0) throw new Error('nothing-to-clear');
    cleared = true;
    return n;
  });
  const ROOMS = ['Office', 'Living room', 'Kitchen', 'Bedroom', 'Den', 'Hall', 'Guest room', 'Porch', 'Garage', 'Bathroom', 'Laundry', 'Attic'];
  // Lights per room for the hover card: Office 3, Living room 8 (one plug), others 2. `?lights=none` (older home app) and
  // `?lights=fail` (its lights read failed) leave the field out of every room.
  const roomLights = (name: string, on: boolean) => {
    const set: [string, number | null][] =
      name === 'Office' ? [['Desk lamp', 80], ['Ceiling', 100], ['Bookshelf strip', 45]]
      : name === 'Living room' ? [['Ceiling 1', 70], ['Ceiling 2', 70], ['Ceiling 3', 70], ['Floor lamp', 55], ['Reading lamp', 90], ['Salt lamp', null], ['Sofa lamp', 60], ['TV gradient strip', 35]]
      : [['Ceiling', 60], ['Lamp', 40]];
    return set.map(([n, bri], i) => ({ id: `${name}-${i}`.replace(/[^A-Za-z0-9_-]/g, ''), name: n, on, brightness: on ? bri : null, reachable: true }));
  };
  const roomCount = () => Number(knob('rooms') ?? 4);
  const lit = (i: number, count: number) => count === 7 || (count === 12 ? i % 3 === 0 : count >= 4 ? i < 2 : i < 1) || (count === 8 && i === 5);
  mocks.set('wall2_desk_rooms', () => {
    const g = gate();
    if (g) return g;
    const count = roomCount();
    const withLights = knob('lights') !== 'none' && knob('lights') !== 'fail';
    return { rooms: ROOMS.slice(0, count).map((name, i) => ({ id: String(i + 1), name, on: lit(i, count), ...(withLights ? { lights: roomLights(name, lit(i, count)) } : {}) })), stale: stale() };
  });
  mocks.set('wall2_desk_house', () => {
    const g = gate();
    if (g) return g;
    const count = roomCount();
    const on = ROOMS.slice(0, count).filter((_, i) => lit(i, count)).length;
    return { observedAt: observed(), insideF: knob('inside') === 'none' ? null : 68, litRooms: on, rooms: count, stale: stale() };
  });
}
