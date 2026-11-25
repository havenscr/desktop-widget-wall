import { useFocusStore } from '../../focus/store';
import { usePlaceStore } from '../../state/places';
import { reviewNow } from '../../ui/reviewClock';
import { WX_KINDS, nwsBody, openMeteoBody } from './weather';
import { mocks, type CommandArgs, type MockHandler } from '../tauri';
import { knob } from './long';
import { MOCK_DETAILS } from './meet';

/**
 * Dev only: the extra URL knobs the state gallery (`scripts/gallery.mjs`) uses to put each
 * screen in a sparse, heavy or broken state through the real code paths. Each knob wraps
 * or replaces one mock; with no knob in the URL nothing here changes anything.
 *
 *   ?screen=meet|zen|shelf|dream   open that place (Meet, Zen, Zen straight into Dream)
 *   ?tasks=none|few|heavy|off|down
 *   ?meet=none|one|heavy|off|bothok|failing|signedout|partial   (`down` and `mixed` are in meet.ts: both accounts
 *                              failing, one failing; `failing` here makes the read itself error)
 *   ?home=quiet|many|off|down   (the network card; `?net=1|2|3` shows that many numbers, the alarm count first)
 *   ?day=empty                (the helper's day timeline has no runs)
 *   ?moods=six|nine|none|down|scenes
 *   ?media=none|paused|long|off
 *   ?box=max|stale|none|down   (machine numbers; `?pc=down` for the PC side)
 *   ?usage=high|none|old      (the usage meters; old: fresh, idle and reset-week meters)
 *   ?weather=ok|stale|down|cold|dns|refused|second   (stands in for the native weather read)
 *   ?reduced=1               (the page reads prefers-reduced-motion as set; the gallery otherwise always emulates no preference)
 *   ?weather=rain|heavy|rainwind|wind|heavywind   (rain, heavy rain, rain with wind, dry wind, heavy rain with wind: weather code and wind in both sources)
 *   ?clock=review           (Date.now starts at the `?at=` moment and then runs, so screens that read it agree)
 *   ?focus=long               (a focus session running under a long title); `?focus=run` a session on, `?focus=done` finished
 *   ?summit=<percent>&lights=<n>   (a focus session that far through, with n finished sessions today, for Zen's Summit stills)
 *   ?alarmcount=N             (the home app's open alarm count, 0 to 999; the default is 4, `?net=calm` is 0)
 *   ?wattspot=<x>             (Watt was set down at that x on every place, On Air included: his stored spot, before he loads)
 *   ?wattwear=star|bow|cape|bolt|flower|backpack|wings   (Watt has been a friend for 30 days and wears that, before he loads)
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
    if (mode === 'heavy') return { accounts: accounts('ok'), meetings: upcoming().filter((m) => Date.parse(m.end) > now()).map((m, i) => (i === 0 ? { ...m, details: MOCK_DETAILS.heavy } : m)) };
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
    if (mode === 'ended') {
      // A session that says it plays but has ended: the native side reports it paused and ended.
      return {
        ...base,
        title: 'Evening Radio Mix',
        artist: 'Example Host',
        album: '',
        source_app: 'Video App',
        source_app_id: 'Example.VideoApp_abc123!App',
        session_key: 'Example.VideoApp_abc123!App#0',
        art_key: 'Evening Radio Mix|Example Host||Video App',
        // The review break `mediabreak=live` shows the same session as live, so a check can prove it notices.
        playback_status: knob('mediabreak') === 'live' ? 'playing' : 'paused',
        ended: knob('mediabreak') !== 'live',
        position_seconds: 146,
        duration_seconds: 146,
      };
    }
    if (mode === 'watchown') return { ...base, title: 'Night drive mix', artist: '', source_app: 'msedgewebview2', source_app_id: 'msedgewebview2.exe', playback_status: 'playing' };
    // A browser playing the saved video by its exact name, and Spotify playing a song that only shares a saved video's name.
    if (mode === 'ytvideo') return { ...base, title: 'Night drive mix - YouTube', artist: 'Some Channel', source_app: 'Edge', source_app_id: 'msedge.exe', playback_status: 'playing' };
    if (mode === 'spotifysame') return { ...base, title: 'Night drive mix', artist: 'Example Artist', source_app: 'Spotify', source_app_id: 'Spotify.exe', playback_status: 'playing' };
    if (mode === 'watchstopped') return { ...base, title: 'Night drive mix', artist: '', source_app: 'msedgewebview2', source_app_id: 'msedgewebview2.exe', playback_status: 'stopped' };
    // A browser-installed web app: its session id is a raw id, never a name to show (invented id).
    if (mode === 'webapp') return { ...base, title: 'Harbor Radio', artist: 'Example Host', source_app: 'com-example-radio7f3a2', source_app_id: 'com-example-radio7f3a2', playback_status: 'playing' };
    if (mode === 'webappstopped') return { ...base, title: 'Harbor Radio', artist: 'Example Host', source_app: 'com-example-radio7f3a2', source_app_id: 'com-example-radio7f3a2', playback_status: 'stopped' };
    // After a restart Windows still lists the web view's stopped session with the item's title (the saved item's label).
    if (mode === 'restartsession') return { ...base, title: 'Night drive mix - YouTube', artist: 'Some Channel', source_app: 'msedgewebview2', source_app_id: 'msedgewebview2.exe', playback_status: 'stopped' };
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
    if (mode === 'old') {
      // One fresh account, one idle account (old reading, week not yet reset), one whose week reset since its last reading.
      const h = 3_600_000;
      return {
        ...base,
        usage: {
          claudeWeekPct: 41,
          claude5hPct: null,
          weekResetsAt: iso(now() + 3_000 * 60_000),
          accounts: [
            { provider: 'claude', label: 'Claude 1', weekPct: 41, fiveHourPct: 12, weekResetsAt: iso(now() + 3_000 * 60_000), weekAsOf: iso(now()), weekOld: false },
            { provider: 'claude', label: 'Claude 2', weekPct: 90, fiveHourPct: null, weekResetsAt: iso(now() + 4_000 * 60_000), weekAsOf: iso(now() - 20 * h), weekOld: true },
            { provider: 'codex', label: 'Codex', weekPct: 0, fiveHourPct: null, weekResetsAt: null, weekAsOf: iso(now() - 30 * h), weekOld: true, weekReset: true },
          ],
        },
      };
    }
    return undefined;
  });
}

/** The page reads the reduced motion preference as set (before the first render reads it). */
function reducedMotion(): void {
  const real = window.matchMedia.bind(window);
  window.matchMedia = (query: string): MediaQueryList => {
    if (!query.includes('prefers-reduced-motion')) return real(query);
    return { matches: true, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false };
  };
}

/**
 * Stand in for the native weather read (`wall2_weather`), so no state ever depends on the network.
 * `stale`: answers are good until, shortly after the first one lands, the clock jumps 45 minutes,
 * every later read fails, and the page is told it became visible again, which makes the hook check
 * its age and retry, exactly as it does after the window was hidden for a while. The reading then
 * shows its stale hint. `refused`: Open-Meteo answers 429 and the Weather Service cannot be reached
 * (a place outside its area answers 404), so the card says why. `second`: Open-Meteo answers 429 and
 * the Weather Service answers with a reading. `dns`: nothing can be looked up.
 */
function weather(mode: string): void {
  const wx = WX_KINDS[mode];
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
  mocks.set('wall2_weather', (args) => {
    const nws = args?.source === 'nws';
    // Stale: every read before the clock jump is answered. The dev build mounts the weather
    // user twice (the first mount's answer is dropped), so "first read only" left no reading.
    if (mode === 'down' || (mode === 'stale' && skew > 0)) throw 'network';
    if (mode === 'dns') throw 'dns';
    if (mode === 'refused') throw nws ? 'http 404' : 'http 429';
    if (mode === 'second') {
      if (!nws) throw 'http 429';
      return nwsBody();
    }
    if (nws) return nwsBody(wx);
    if (mode === 'stale' && !answered) setTimeout(goStale, 800);
    answered = true;
    return openMeteoBody(mode === 'cold', wx);
  });
}

/** The answer's mock text for a focus session under a long title. */
const LONG_FOCUS = 'Draft the workshop outline for the spring conference and circulate it to the planning group';

/** A 25 minute focus session `pct` percent through, with `lights` finished 25 minute sessions earlier today. */
function summitSeed(pct: number, lights: number): void {
  const t = now();
  const min = 60_000;
  const len = 25 * min;
  const d = new Date(t);
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const sessions = Array.from({ length: Math.min(8, lights) }, (_, i) => {
    const start = Math.max(midnight, t - (i + 2) * 3_600_000);
    return { start, end: start + len };
  });
  const start = t - (pct / 100) * len;
  useFocusStore.setState({ state: { status: 'running', minutes: 25, endAt: start + len, label: 'Summit' }, sessions: [...sessions, { start, end: start + len }] });
}

/** Registered last, after every other mock, so a knob wins. A no-op without knobs. */
export function registerGalleryMocks(): void {
  const spot = Number(knob('wattspot'));
  const wear = knob('wattwear');
  const worn = wear && (['star', 'bow', 'cape', 'bolt', 'flower', 'backpack', 'wings'] as const).includes(wear as 'star') ? wear : null;
  if ((knob('wattspot') && Number.isFinite(spot)) || worn) {
    const stored: Record<string, unknown> = {};
    if (knob('wattspot') && Number.isFinite(spot)) stored.spots = { work: spot, home: spot, meet: spot, onair: spot, unwind: spot };
    if (worn) Object.assign(stored, { cosmetic: worn, days: 30 });
    try {
      window.localStorage.setItem('wall2.watt', JSON.stringify(stored));
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
  if (knob('reduced') === '1') reducedMotion();
  const summit = Number(knob('summit'));
  if (knob('summit') && Number.isFinite(summit)) setTimeout(() => summitSeed(summit, Number(knob('lights')) || 0), 400);
  if (knob('focus') === 'done') setTimeout(() => useFocusStore.setState({ state: { status: 'finished', minutes: 25 } }), 400);
  if (knob('focus') === 'run') setTimeout(() => useFocusStore.getState().startLabeled('Review the draft'), 400);
  if (knob('focus') === 'long') setTimeout(() => useFocusStore.getState().startLabeled(LONG_FOCUS), 400);
  // The Shelf's list names come from the saved settings; this seeds them, e.g. `?shelflists=Tasks (To-Do);House, garden`.
  const shelfLists = knob('shelflists');
  if (shelfLists) {
    try {
      localStorage.setItem('wall2-settings', JSON.stringify({ shelfLists: shelfLists.split(';') }));
    } catch {
      /* storage can be blocked */
    }
  }
  const screen = knob('screen');
  // After main.tsx and the horizon canvas have opened the place `?hz=` names (the canvas does so on mount).
  if (screen === 'meet' || screen === 'zen' || screen === 'shelf') setTimeout(() => usePlaceStore.getState().setActive(screen), 300);
  if (screen === 'dream') setTimeout(() => usePlaceStore.getState().openDream(), 300);
}
