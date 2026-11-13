import { useFocusStore } from '../../focus/store';
import { usePlaceStore } from '../../state/places';
import { reviewNow } from '../../ui/reviewClock';
import { mocks, type CommandArgs, type MockHandler } from '../tauri';

/**
 * Dev only: the extra URL knobs the state gallery (`scripts/gallery.mjs`) uses to put each
 * screen in a sparse, heavy or broken state through the real code paths. Each knob wraps
 * or replaces one mock; with no knob in the URL nothing here changes anything.
 *
 *   ?screen=meet|zen|dream   open that place (Meet, Zen, Zen straight into Dream)
 *   ?tasks=none|few|heavy|off|down
 *   ?meet=none|heavy|off|down|signedout|partial
 *   ?home=quiet|many|off|down   (the network card; `?net=1|2|3` keeps that many numbers)
 *   ?moods=six|none|down
 *   ?media=none|paused|long|off
 *   ?box=max|stale|none|down   (machine numbers; `?pc=down` for the PC side)
 *   ?usage=high|none          (the two usage meters)
 *   ?weather=ok|stale|down|cold   (stands in for the weather fetch)
 *   ?clock=review           (Date.now starts at the `?at=` moment and then runs, so screens that read it agree)
 *   ?focus=long               (a focus session running under a long title)
 */
const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
const knob = (name: string): string | null => q.get(name);

const now = () => (reviewNow ? reviewNow() : Date.now());
const iso = (ms: number) => new Date(Math.round(ms / 60_000) * 60_000).toISOString().replace('.000Z', 'Z');
const NOT_SET_UP = 'not-configured';

/** Replace a mock's answer only when `pick` returns something other than `undefined`. */
function wrap(command: string, pick: (args: CommandArgs | undefined, prev: MockHandler | undefined) => unknown | Promise<unknown>): void {
  const prev = mocks.get(command);
  mocks.set(command, async (args) => {
    const r = await pick(args, prev);
    return r === undefined && prev ? prev(args) : r;
  });
}

const LONG_TASKS = [
  'Send the project proposal with the revised budget, the new timeline and the updated staffing plan',
  'Write the workshop outline for the spring conference and circulate it to the whole planning group',
  'Reconcile the quarterly expense report against the card statements and flag every missing receipt',
];

function tasks(mode: string): void {
  const item = (id: string, title: string, due: number) => ({
    id,
    title,
    due_at: new Date(now() + due * 86_400_000).toISOString().slice(0, 10),
    due_is_all_day: true,
    quadrant: null,
    est: '60plus',
  });
  wrap('wall2_tasks_summary', () => {
    if (mode === 'off') throw new Error(NOT_SET_UP);
    if (mode === 'down') throw new Error('failed');
    if (mode === 'none') return { next: [], remaining: 0, dueTomorrow: { count: 0, estMinutes: 0 } };
    if (mode === 'few') return { next: [item('g1', 'Review the dashboard draft', 1)], remaining: 0, dueTomorrow: { count: 1, estMinutes: 30 } };
    if (mode === 'heavy') return { next: LONG_TASKS.map((t, i) => item(`g${i}`, t, i)), remaining: 115, dueTomorrow: { count: 12, estMinutes: 720 } };
    return undefined;
  });
  wrap('wall2_tasks_next', () => {
    if (mode === 'off') throw new Error(NOT_SET_UP);
    if (mode === 'down') throw new Error('failed');
    if (mode === 'none') return [];
    if (mode === 'few') return [item('g1', 'Review the dashboard draft', 1)];
    if (mode === 'heavy') return LONG_TASKS.map((t, i) => item(`g${i}`, t, i));
    return undefined;
  });
}

const LONG_MEETINGS = [
  'Quarterly planning and roadmap review with the whole platform and design organisation',
  'Customer escalation review: onboarding delays, billing questions and the support backlog',
  'Architecture working session on the shared data platform migration and rollout order',
  'Budget alignment with finance, procurement and the regional leads for next year',
];

function meet(mode: string): void {
  const accounts = (state: string) => [
    { id: 'work', label: 'Work', state },
    { id: 'second', label: 'Second', state: mode === 'partial' ? 'unavailable' : state },
  ];
  const midnight = () => {
    const d = new Date(now());
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const hour = (h: number) => midnight() + h * 3_600_000;
  // Back to back from 8:00 to 18:00, one hour each, long titles, plus an all-day event.
  const heavyDay = () => [
    { key: 'allday', accountId: 'work', title: 'Company offsite, travel day for the west coast team', start: iso(hour(0)), end: iso(hour(24)), canJoin: false, isLive: false },
    ...Array.from({ length: 10 }, (_, i) => ({
      key: `h${i}`,
      accountId: 'work',
      title: LONG_MEETINGS[i % LONG_MEETINGS.length],
      start: iso(hour(8 + i)),
      end: iso(hour(9 + i)),
      canJoin: true,
      isLive: false,
    })),
  ];
  const upcoming = () => heavyDay().filter((e) => e.key !== 'allday');
  wrap('wall2_meet_next', () => {
    if (mode === 'off') throw new Error(NOT_SET_UP);
    if (mode === 'down') throw new Error('failed');
    if (mode === 'none') return { accounts: accounts('ok'), meetings: [] };
    if (mode === 'signedout') return { accounts: accounts('signed-out'), meetings: [] };
    if (mode === 'heavy') return { accounts: accounts('ok'), meetings: upcoming().filter((m) => Date.parse(m.end) > now()) };
    if (mode === 'partial') return { accounts: accounts('ok'), meetings: upcoming().slice(0, 2), stale: true };
    return undefined;
  });
  wrap('wall2_meet_day', () => {
    if (mode === 'off') throw new Error(NOT_SET_UP);
    if (mode === 'down') throw new Error('failed');
    if (mode === 'none') return { accounts: accounts('ok'), events: [] };
    if (mode === 'signedout') return { accounts: accounts('signed-out'), events: [] };
    if (mode === 'heavy') return { accounts: accounts('ok'), events: heavyDay() };
    if (mode === 'partial') return { accounts: accounts('ok'), events: heavyDay().slice(0, 3), stale: true };
    return undefined;
  });
}

function home(mode: string, net: number | null): void {
  wrap('wall2_home_security', async (_args, prev) => {
    if (mode === 'off') throw new Error(NOT_SET_UP);
    if (mode === 'down') throw new Error('failed');
    const base = (await prev?.()) as Record<string, unknown> & { topAlerts: unknown[] };
    const t = now();
    let out = base;
    if (mode === 'quiet') {
      out = { ...base, alerts: 0, topAlerts: [], firewalla: { ...(base.firewalla as object), alarms24h: 0 } };
    } else if (mode === 'many') {
      const long = (text: string, severity: string, ago: number) => ({ text, severity, atMs: t - ago });
      out = {
        ...base,
        alerts: 38,
        devices: 214,
        blocked: 48_213,
        boxTemp: 88,
        topAlerts: [
          long('New device joined the guest network and started a large outbound transfer to an unknown host', 'high', 4 * 60_000),
          long('Repeated sign-in failures against the remote access service from several addresses', 'high', 50 * 60_000),
          long('Unusual DNS lookups from the living room media streamer to a newly registered domain', 'medium', 6 * 3_600_000),
        ],
      };
    }
    if (net !== null) {
      // One, two or three numbers: keep that many of devices, blocked and box temperature.
      const keep = ['devices', 'blocked', 'boxTemp'].slice(0, net);
      out = { ...out };
      for (const k of ['devices', 'blocked', 'boxTemp']) if (!keep.includes(k)) delete out[k];
    }
    return out;
  });
}

function moods(mode: string): void {
  wrap('wall2_moods', () => {
    if (mode === 'none') return [];
    if (mode === 'down') throw new Error('failed');
    if (mode === 'six') {
      return [
        { id: 'day', label: 'Day' },
        { id: 'focus', label: 'Deep Focus' },
        { id: 'evening', label: 'Evening' },
        { id: 'movie', label: 'Movie Night' },
        { id: 'lateNight', label: 'Late Night' },
        { id: 'away', label: 'Away For The Weekend' },
      ];
    }
    return undefined;
  });
}

function media(mode: string): void {
  wrap('get_now_playing', async (_args, prev) => {
    if (mode === 'off') throw new Error('unavailable');
    if (mode === 'none') return null;
    const base = (await prev?.()) as Record<string, unknown>;
    if (mode === 'paused') return { ...base, playback_status: 'paused' };
    if (mode === 'long') {
      return {
        ...base,
        title: 'An Extremely Long Song Title That Goes On And On Forever (Extended Remix)',
        artist: 'A Very Long Artist Name Featuring Several Other Artists And A Choir',
        album: 'The Complete Collected Live Sessions, Remastered Deluxe Edition',
      };
    }
    return undefined;
  });
}

function machines(box: string | null, pc: string | null): void {
  wrap('wall2_machines', async (_args, prev) => {
    if (pc === 'down') throw new Error('failed');
    const base = (await prev?.()) as { pc: object; box: Record<string, unknown> | null; boxStale: boolean };
    if (box === 'max') return { pc: { cpuPct: 100, gpuPct: 100, ramPct: 100 }, box: { cpuPct: 100, gpuPct: 100, ramPct: 100, tempC: 104 }, boxStale: false };
    if (box === 'stale') return { ...base, boxStale: true };
    if (box === 'none') return { ...base, box: null };
    if (box === 'down') throw new Error('failed');
    return undefined;
  });
}

function usage(mode: string): void {
  wrap('wall2_omni_summary', async (_args, prev) => {
    const base = (await prev?.()) as Record<string, unknown>;
    if (mode === 'high') return { ...base, usage: { claudeWeekPct: 94, claude5hPct: 97, weekResetsAt: iso(now() + 3_000 * 60_000) } };
    if (mode === 'none') return { ...base, usage: { claudeWeekPct: null, claude5hPct: null, weekResetsAt: null } };
    return undefined;
  });
}

/** Stand in for the weather fetch (the app calls `fetch` on the forecast service). */
function weather(mode: string): void {
  const real = window.fetch.bind(window);
  const pad = (n: number) => String(n).padStart(2, '0');
  const local = (ms: number) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
  };
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes('open-meteo')) return real(input, init);
    if (mode === 'down') throw new TypeError('network down');
    if (mode === 'stale') {
      // Answer after the hook's mount-time clock reads (StrictMode runs them twice), then
      // let the reading be stamped with the time the answer is parsed: 45 minutes ago.
      await new Promise((r) => setTimeout(r, 300));
      const realNow = Date.now.bind(Date);
      Date.now = () => realNow() - 45 * 60_000;
      setTimeout(() => {
        Date.now = realNow;
      }, 150);
    }
    const t = now();
    const hours = Array.from({ length: 30 }, (_, i) => t + (i - 3) * 3_600_000);
    const temp = mode === 'cold' ? 24 : 58;
    const body = {
      current: { time: local(t), temperature_2m: temp, weather_code: mode === 'cold' ? 73 : 2, is_day: 1 },
      hourly: {
        time: hours.map(local),
        temperature_2m: hours.map((_, i) => temp + Math.round(6 * Math.sin(i / 4))),
        weather_code: hours.map((_, i) => (i % 5 === 0 ? 61 : 2)),
        is_day: hours.map((ms) => (new Date(ms).getHours() >= 7 && new Date(ms).getHours() < 18 ? 1 : 0)),
      },
      daily: { temperature_2m_max: [temp + 6, temp + 4], temperature_2m_min: [temp - 8, temp - 6] },
    };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

/** The answer's mock text for a focus session under a long title. */
const LONG_FOCUS = 'Draft the workshop outline for the spring conference and circulate it to the planning group';

/** Registered last, after every other mock, so a knob wins. A no-op without knobs. */
export function registerGalleryMocks(): void {
  if (knob('clock') === 'review' && reviewNow) {
    const realNow = Date.now.bind(Date);
    const offset = reviewNow() - realNow();
    Date.now = () => realNow() + offset;
  }
  const t = knob('tasks');
  if (t) tasks(t);
  const m = knob('meet');
  if (m) meet(m);
  const h = knob('home');
  const n = knob('net');
  if (h || n) home(h ?? '', n ? Number(n) : null);
  const mo = knob('moods');
  if (mo) moods(mo);
  const me = knob('media');
  if (me) media(me);
  const box = knob('box');
  const pc = knob('pc');
  if (box || pc) machines(box, pc);
  const u = knob('usage');
  if (u) usage(u);
  const w = knob('weather');
  if (w) weather(w);
  if (knob('focus') === 'long') setTimeout(() => useFocusStore.getState().startLabeled(LONG_FOCUS), 400);
  const screen = knob('screen');
  // After main.tsx and the horizon canvas have opened the place `?hz=` names (the canvas does so on mount).
  if (screen === 'meet' || screen === 'zen') setTimeout(() => usePlaceStore.getState().setActive(screen), 300);
  if (screen === 'dream') setTimeout(() => usePlaceStore.getState().openDream(), 300);
}
