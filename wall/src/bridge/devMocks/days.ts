import { reviewNow } from '../../ui/reviewClock';
import { knob, longOr } from './long';
import { mocks } from '../tauri';

/**
 * Dev only: the helper's saved day record (`wall2_omni_days`, `wall2_omni_day`), shaped like
 * the Rust answers. `?days=typical` (default: 14 recorded days with 3 to 9 sessions each),
 * `empty` (yesterday recorded with no session), `one`, `heavy` (forty sessions), `down` (the
 * day reads fail), `absent` (an older helper with no record routes). Invented titles only.
 */
const TITLES = ['Release notes draft', 'Docs tidy pass', 'Settings helper text', 'Spend card refresh', 'Share sheet fix', 'Timeline label fix', 'Search index rebuild', 'Backup script fix', 'Photo export batch', 'Weekly report'];
const LONG = 'Release notes draft for the next public cut with screenshots and the full upgrade section';
const STAGES = ['plan', 'build', 'review', 'pr', 'live'];

const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const midnightOf = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};

/** How many sessions the mock records on the day `back` days ago. */
function countFor(back: number, mode: string): number {
  if (mode === 'empty' && back === 1) return 0;
  if (mode === 'one') return 1;
  if (mode === 'heavy') return 40;
  return 3 + ((back * 5) % 7);
}

function sessionsFor(date: string, n: number, today: boolean, now: number): Record<string, unknown> {
  const m0 = midnightOf(date);
  const out: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) {
    const startH = 6.5 + ((i * 1.7) % 14);
    const spans: { stage: string; start: string; end: string | null }[] = [];
    let t = startH;
    const steps = 2 + (i % 4);
    for (let k = 0; k < steps; k++) {
      const len = k === 1 ? 1.2 + (i % 3) * 0.5 : 0.3 + (k % 2) * 0.2;
      const a = m0 + t * 3_600_000;
      const b = m0 + (t + len) * 3_600_000;
      if (today && a >= now) break;
      const last = k === steps - 1;
      const open = (last && i % 4 === 0 && startH > 15) || (today && b > now);
      spans.push({ stage: STAGES[Math.min(k, 4)], start: iso(a), end: open ? null : iso(Math.min(b, m0 + 86_399_000)) });
      if (open) break;
      t += len + 0.05;
    }
    if (spans.length === 0) continue;
    const id = `d0d0${date.replace(/-/g, '').slice(2)}-${String(i + 1).padStart(4, '0')}`;
    const merged = steps >= 4 && i % 4 !== 0;
    out[id] = {
      title: i === 0 ? longOr(TITLES[0], LONG).slice(0, 60) : TITLES[i % TITLES.length],
      spans,
      ...(steps >= 4 ? { pr: { number: 600 + ((i * 7 + date.length * 3) % 90), state: merged ? 'merged' : 'open' } } : {}),
    };
  }
  return out;
}

export function registerDaysMocks(): void {
  const mode = () => knob('days') ?? 'typical';
  const now = () => (reviewNow ? reviewNow() : Date.now());
  mocks.set('wall2_omni_days', () => {
    if (knob('agents') === 'off') throw new Error('not-configured');
    if (mode() === 'absent' || mode() === 'down' || knob('agents') === 'down') throw new Error('failed');
    const days = [];
    for (let back = 0; back < 14; back++) days.push({ date: dayKey(now() - back * 86_400_000), sessions: countFor(back, mode()) });
    return days;
  });
  mocks.set('wall2_omni_day', (args) => {
    const date = String(args?.date ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('invalid-date');
    if (knob('agents') === 'off') throw new Error('not-configured');
    if (mode() === 'absent') return null;
    if (mode() === 'down' || knob('agents') === 'down') throw new Error('failed');
    const back = Math.round((midnightOf(dayKey(now())) - midnightOf(date)) / 86_400_000);
    if (back < 0 || back >= 14) return null;
    if (back === 0) return todayRecord(date);
    // The live mock sessions are a different set; today's record names its own.
    return { date, tz: 'America/Los_Angeles', sessions: Object.entries(sessionsFor(date, countFor(back, mode()), back === 0, now())).map(([id, s]) => ({ id, ...(s as object) })) };
  });
}

/** Today's record names the live mock sessions: each non-wait span of the live day in its session's stage. */
function todayRecord(date: string): unknown {
  type Live = { lanes?: { id: string; title: string; stage: string }[]; sessionsList?: { id: string; title: string; stage: string }[] | null; day?: { lane: string; start: string; end: string | null; kind: string }[] };
  let answer: Live | null = null;
  try {
    answer = (mocks.get('wall2_omni_summary')?.() ?? null) as Live | null;
  } catch {
    return null;
  }
  if (!answer) return null;
  const live: Live = answer;
  const list = live.sessionsList ?? live.lanes ?? [];
  const sessions = list
    .map((l, i) => ({
      id: l.id,
      title: l.title.slice(0, 60),
      spans: (live.day ?? []).filter((d) => d.lane === l.id && d.kind !== 'wait').map((d) => ({ stage: l.stage, start: d.start, end: d.end })),
      ...(i === 6 ? { pr: { number: 640, state: 'merged' } } : {}),
    }))
    .filter((x) => x.spans.length > 0);
  return { date, tz: 'America/Los_Angeles', sessions };
}
