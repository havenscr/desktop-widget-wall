import { useFocusStore } from '../../focus/store';
import { usePlaceStore } from '../../state/places';
import { reviewNow } from '../../ui/reviewClock';
import { mocks, type CommandArgs, type MockHandler } from '../tauri';
import { knob } from './long';

/**
 * Dev only: the extra URL knobs the state gallery (`scripts/gallery.mjs`) uses to put each
 * screen in a sparse, heavy or broken state through the real code paths. Each knob wraps
 * or replaces one mock; with no knob in the URL nothing here changes anything.
 *
 *   ?screen=meet|zen|dream   open that place (Meet, Zen, Zen straight into Dream)
 *   ?tasks=none|few|heavy|off|down
 *   ?meet=none|one|heavy|off|bothok|failing|signedout|partial   (`down` and `mixed` are in meet.ts: both accounts
 *                              failing, one failing; `failing` here makes the read itself error)
 *   ?home=quiet|many|off|down   (the network card; `?net=1|2|3` shows that many numbers, the alarm count first)
 *   ?day=empty                (the helper's day timeline has no runs)
 *   ?moods=six|nine|none|down
 *   ?media=none|paused|long|off
 *   ?box=max|stale|none|down   (machine numbers; `?pc=down` for the PC side)
 *   ?usage=high|none          (the two usage meters)
 *   ?weather=ok|stale|down|cold   (stands in for the weather fetch)
 *   ?clock=review           (Date.now starts at the `?at=` moment and then runs, so screens that read it agree)
 *   ?focus=long               (a focus session running under a long title)
 *   ?wattspot=<x>             (Watt was set down at that x on every place: his stored spot, before he loads)
 */

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
  const startHour = Math.floor(now() / 3_600_000) * 3_600_000 - 3_600_000;
  // Back to back, one hour each from the hour before the review's moment, long titles, plus an
  // all-day event; the first is under way and the rest follow.
  const heavyDay = () => [
    { key: 'allday', accountId: 'work', title: 'Company offsite, travel day for the west coast team', start: iso(hour(0)), end: iso(hour(24)), canJoin: false, isLive: false },
    ...Array.from({ length: 10 }, (_, i) => ({
      key: `h${i}`,
      accountId: 'work',
      title: LONG_MEETINGS[i % LONG_MEETINGS.length],
      start: iso(startHour + i * 3_600_000),
      end: iso(startHour + (i + 1) * 3_600_000),
      canJoin: true,
      isLive: false,
    })),
  ];
  // One meeting starting about 25 minutes after the review's moment.
  const one = () => [{ key: 'one', accountId: 'work', title: 'Design review with the platform team', start: iso(now() + 25 * 60_000), end: iso(now() + 55 * 60_000), canJoin: true, isLive: false }];
  const upcoming = () => heavyDay().filter((e) => e.key !== 'allday');
  wrap('wall2_meet_next', async (_a, prev) => {
    if (mode === 'bothok') return { ...((await prev?.()) as object), accounts: accounts('ok') };
    if (mode === 'off') throw new Error(NOT_SET_UP);
    if (mode === 'failing') throw new Error('failed');
    if (mode === 'none') return { accounts: accounts('ok'), meetings: [] };
    if (mode === 'signedout') return { accounts: accounts('signed-out'), meetings: [] };
    if (mode === 'heavy') return { accounts: accounts('ok'), meetings: upcoming().filter((m) => Date.parse(m.end) > now()) };
    if (mode === 'one') return { accounts: accounts('ok'), meetings: one() };
    if (mode === 'partial') return { accounts: accounts('ok'), meetings: one(), stale: true };
    return undefined;
  });
  wrap('wall2_meet_day', async (_a, prev) => {
    if (mode === 'bothok') return { ...((await prev?.()) as object), accounts: accounts('ok') };
    if (mode === 'off') throw new Error(NOT_SET_UP);
    if (mode === 'failing') throw new Error('failed');
    if (mode === 'none') return { accounts: accounts('ok'), events: [] };
    if (mode === 'signedout') return { accounts: accounts('signed-out'), events: [] };
    if (mode === 'heavy') return { accounts: accounts('ok'), events: heavyDay() };
    if (mode === 'one') return { accounts: accounts('ok'), events: one() };
    if (mode === 'partial') return { accounts: accounts('ok'), events: one(), stale: true };
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
      // `net` numbers in all: the alarm count is always one, then devices, blocked, box temperature.
      const keep = ['devices', 'blocked', 'boxTemp'].slice(0, Math.max(0, net - 1));
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
    if (mode === 'nine') {
      return ['Day', 'Deep Focus', 'Evening Wind Down', 'Movie Night', 'Late Night Reading', 'Away For The Weekend', 'Morning Routine', 'Dinner With Friends', 'Everything Off Tonight'].map(
        (label, i) => ({ id: `mood${i + 1}`, label }),
      );
    }
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
    if (mode === 'watchown') return { ...base, title: 'Night drive mix', artist: '', source_app: 'msedgewebview2', source_app_id: 'msedgewebview2.exe', playback_status: 'playing' };
    if (mode === 'watchstopped') return { ...base, title: 'Night drive mix', artist: '', source_app: 'msedgewebview2', source_app_id: 'msedgewebview2.exe', playback_status: 'stopped' };
    if (mode === 'webview') return { ...base, title: 'Mail alert', artist: '', source_app: 'msedgewebview2', source_app_id: 'msedgewebview2.exe', playback_status: 'stopped' };
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
    if (box === 'max') return { pc: { cpuPct: 100, gpuPct: 100, ramPct: 100, tempC: 96 }, box: { cpuPct: 100, gpuPct: 100, ramPct: 100, tempC: 104 }, boxStale: false };
    if (box === 'stale') return { ...base, boxStale: true };
    if (box === 'none') return { ...base, box: null };
    if (box === 'down') throw new Error('failed');
    return undefined;
  });
}

function emptyDay(): void {
  wrap('wall2_omni_summary', async (_args, prev) => ({ ...((await prev?.()) as Record<string, unknown>), day: [] }));
}

function usage(mode: string): void {
  wrap('wall2_omni_summary', async (_args, prev) => {
    const base = (await prev?.()) as Record<string, unknown>;
    if (mode === 'high') return { ...base, usage: { claudeWeekPct: 94, claude5hPct: 97, weekResetsAt: iso(now() + 3_000 * 60_000) } };
    if (mode === 'none') return { ...base, usage: { claudeWeekPct: null, claude5hPct: null, weekResetsAt: null } };
    return undefined;
  });
}

/**
 * Stand in for the weather fetch (the app calls `fetch` on the forecast service), so no
 * state ever depends on the network. `stale`: answers are good until, shortly after the first
 * one lands, the clock jumps 45 minutes, every later fetch fails, and the page is told it became
 * visible again, which makes the hook check its age and retry, exactly as it does after the
 * window was hidden for a while. The reading then shows its stale hint.
 */
function weather(mode: string): void {
  const real = window.fetch.bind(window);
  const pad = (n: number) => String(n).padStart(2, '0');
  const local = (ms: number) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
  };
  let answered = false;
  let skew = 0;
  if (mode === 'stale') {
    const realNow = Date.now.bind(Date);
    Date.now = () => realNow() + skew;
  }
  const goStale = () => {
    skew = 45 * 60_000;
    let hidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    document.dispatchEvent(new Event('visibilitychange'));
    // Separate renders: two events in one tick would batch to "still visible" and do nothing.
    setTimeout(() => {
      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
    }, 200);
  };
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes('open-meteo')) return real(input, init);
    // Stale: every fetch before the clock jump is answered. The dev build mounts the weather
    // user twice (the first mount's answer is dropped), so "first fetch only" left no reading.
    if (mode === 'down' || (mode === 'stale' && skew > 0)) throw new TypeError('network down');
    if (mode === 'stale' && !answered) setTimeout(goStale, 800);
    answered = true;
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
  const spot = Number(knob('wattspot'));
  if (knob('wattspot') && Number.isFinite(spot)) {
    try {
      window.localStorage.setItem('wall2.watt', JSON.stringify({ spots: { work: spot, home: spot, meet: spot, unwind: spot } }));
    } catch {
      /* storage blocked: he stands where he always does */
    }
  }
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
  if (knob('day') === 'empty') emptyDay();
  const w = knob('weather');
  if (w) weather(w);
  if (knob('focus') === 'done') setTimeout(() => useFocusStore.setState({ state: { status: 'finished', minutes: 25 } }), 400);
  if (knob('focus') === 'run') setTimeout(() => useFocusStore.getState().startLabeled('Review the draft'), 400);
  if (knob('focus') === 'long') setTimeout(() => useFocusStore.getState().startLabeled(LONG_FOCUS), 400);
  const screen = knob('screen');
  // After main.tsx and the horizon canvas have opened the place `?hz=` names (the canvas does so on mount).
  if (screen === 'meet' || screen === 'zen') setTimeout(() => usePlaceStore.getState().setActive(screen), 300);
  if (screen === 'dream') setTimeout(() => usePlaceStore.getState().openDream(), 300);
}
