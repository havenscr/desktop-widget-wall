import { create } from 'zustand';
import { invoke } from '../bridge/tauri';
import type { OmniSummary, Stage } from '../agents/model';

/**
 * The helper's saved record of past days (`wall2_omni_days`, `wall2_omni_day` in
 * `src-tauri/src/wall2_omni.rs`), and the pure rules the "Agents today" panel draws from.
 * Waiting time is only in the live summary: a past day has no wait spans and no wait total.
 */

export interface DayCount {
  date: string;
  sessions: number;
}

export interface DayStageSpan {
  stage: Stage;
  start: string;
  end: string | null;
}

export interface DaySession {
  id: string;
  title: string;
  spans: DayStageSpan[];
  pr: { number: number; state: 'open' | 'closed' | 'merged' } | null;
}

export interface DayRecord {
  date: string;
  tz: string;
  sessions: DaySession[];
}

/**
 * `absent`: the helper answered 404 for the day list (an older helper with no record), so the
 * day picker hides. `failed`: a passing failure with no good list held yet. After a good list,
 * a failed refresh keeps it (status stays `ok`) and stamps `listFailedAt`.
 */
export type DaysStatus = 'idle' | 'loading' | 'ok' | 'failed' | 'absent' | 'unconfigured';

export interface RecordRead {
  /** Null when the helper has no record of that day. */
  record: DayRecord | null;
  /** When it was read (this PC's clock). */
  at: number;
  /** The last read of this day failed; `record` (if any) is the last good one. */
  failed: boolean;
}

interface DaysState {
  status: DaysStatus;
  days: DayCount[];
  /** When the list was last read well (this PC's clock), or null. */
  listAt: number | null;
  /** Set when the latest list read failed after a good one: the list shown is as of `listAt`. */
  listFailedAt: number | null;
  records: Record<string, RecordRead | undefined>;
  loading: Record<string, boolean>;
}

const initial = (): DaysState => ({ status: 'idle', days: [], listAt: null, listFailedAt: null, records: {}, loading: {} });
export const useDaysStore = create<DaysState>(() => initial());

/**
 * Read the list of recorded days. With a good list held the read runs in the background (no
 * loading state, so the picker never flickers). `absent` (the helper answered 404) hides the
 * picker; any other failure keeps the last good list, stamped with when it failed.
 */
export async function loadDays(): Promise<void> {
  if (useDaysStore.getState().status !== 'ok') useDaysStore.setState({ status: 'loading' });
  try {
    const days = await invoke<DayCount[]>('wall2_omni_days');
    useDaysStore.setState({ status: 'ok', days: Array.isArray(days) ? days : [], listAt: Date.now(), listFailedAt: null });
  } catch (e) {
    const text = String(e);
    if (text.includes('not-configured')) useDaysStore.setState({ status: 'unconfigured', days: [], listFailedAt: null });
    else if (text.includes('absent')) useDaysStore.setState({ status: 'absent', days: [], listFailedAt: null });
    else useDaysStore.setState((st) => (st.days.length > 0 ? { status: 'ok', listFailedAt: Date.now() } : { status: 'failed', listFailedAt: Date.now() }));
  }
}

/** Read one day's record; a failed read keeps the last good one, marked failed. */
export async function loadDay(date: string): Promise<void> {
  if (useDaysStore.getState().loading[date]) return;
  useDaysStore.setState((s) => ({ loading: { ...s.loading, [date]: true } }));
  try {
    const record = await invoke<DayRecord | null>('wall2_omni_day', { date });
    useDaysStore.setState((s) => ({ records: { ...s.records, [date]: { record: record ?? null, at: Date.now(), failed: false } }, loading: { ...s.loading, [date]: false } }));
    if (again.delete(date)) void loadDay(date);
  } catch {
    useDaysStore.setState((s) => {
      const old = s.records[date];
      return { records: { ...s.records, [date]: { record: old?.record ?? null, at: old?.at ?? 0, failed: true } }, loading: { ...s.loading, [date]: false } };
    });
    again.delete(date);
  }
}

/** Days whose read must run once more because a session closed while the last read was in flight. */
const again = new Set<string>();

/** Read one day's record now; when a read of it is already in flight, read once more when it ends. */
export async function reloadDay(date: string): Promise<void> {
  if (useDaysStore.getState().loading[date]) again.add(date);
  else await loadDay(date);
}

/** Tests only. */
export function resetDays(): void {
  useDaysStore.setState(initial(), true);
}

/** `YYYY-MM-DD` of a time on this PC's clock. */
export function isoDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local midnight of a `YYYY-MM-DD` date. */
export function dayStart(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** "Thursday, November 12". */
export function longDate(date: string): string {
  return new Date(dayStart(date)).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

/** The date one day before `date`. */
export function dayBefore(date: string): string {
  const t = new Date(dayStart(date));
  t.setDate(t.getDate() - 1);
  return isoDay(t.getTime());
}

/** The day picker's neighbours of `shown` in the record (newest first), with today at the newest end. */
export function neighbours(days: readonly DayCount[], shown: string, today: string): { prev: string | null; next: string | null } {
  const dates = [...new Set([today, ...days.map((d) => d.date)])].filter((d) => d <= today).sort().reverse();
  const i = dates.indexOf(shown);
  if (i < 0) return { prev: dates.find((d) => d < shown) ?? null, next: [...dates].reverse().find((d) => d > shown) ?? null };
  return { prev: dates[i + 1] ?? null, next: i > 0 ? dates[i - 1] : null };
}

export type SpanKind = Stage | 'run' | 'wait' | 'done';

/** One drawn span of a panel row, in local hours of the day shown (0 to 24). */
export interface PanelSpan {
  kind: SpanKind;
  from: number;
  to: number;
  open: boolean;
}

export type EndWord = 'merged' | 'pull request open' | 'pull request closed' | 'carried over' | 'waiting on you' | 'in review' | 'working' | 'idle' | 'finished';

export interface PanelRow {
  id: string;
  /** The card number on today's Work, or the row's place on a past day. */
  num: number;
  /**
   * The date of the saved record the row comes from, for `wall2_focus_day_session`; null for a
   * row of an open session (`wall2_focus_omnigent`).
   */
  openDate: string | null;
  title: string;
  spans: PanelSpan[];
  pr: number | null;
  /** Where the pull request mark sits (hour), or null. */
  prAt: number | null;
  end: EndWord;
  /** Agent work (stage or run spans), in ms. */
  workMs: number;
  /** Time waiting on the owner (today only), in ms. */
  waitMs: number;
}

const hourOf = (ms: number, midnight: number) => Math.min(24, Math.max(0, (ms - midnight) / 3_600_000));

/** The UTC offset of zone `tz` at `ms`, in ms (what to add to UTC to get the zone's wall clock). */
function zoneOffset(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
  const g = (t: string) => Number(parts.find((x) => x.type === t)?.value ?? 0);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) - Math.floor(ms / 1000) * 1000;
}

/** `YYYY-MM-DD` one calendar day after `date`. */
function nextDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Midnight at the start of `date` in zone `tz` (the record's own zone); this PC's zone when it has none or an unknown one. */
export function zoneMidnight(date: string, tz: string): number {
  if (!tz) return dayStart(date);
  try {
    const [y, m, d] = date.split('-').map(Number);
    const guess = Date.UTC(y, m - 1, d);
    const first = guess - zoneOffset(guess, tz);
    return guess - zoneOffset(first, tz);
  } catch {
    return dayStart(date);
  }
}

/** "carried over": a session whose last span has no end at the end of a past day. */
function carried(spans: readonly DayStageSpan[]): boolean {
  const last = [...spans].sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).pop();
  return last !== undefined && last.end === null;
}

/** Rows for a past day from its saved record: stage spans, pull request marks, end words. */
export function recordRows(r: DayRecord, now: number): PanelRow[] {
  // The day's bounds in the record's own zone (the helper names it), so a day recorded in
  // another zone than this PC's still runs midnight to midnight.
  const midnight = zoneMidnight(r.date, r.tz);
  const next = zoneMidnight(nextDate(r.date), r.tz);
  const dayEnd = Math.min(now, next);
  return r.sessions.map((s, i) => {
    let workMs = 0;
    const spans: PanelSpan[] = [];
    for (const sp of [...s.spans].sort((a, b) => Date.parse(a.start) - Date.parse(b.start))) {
      const a = Date.parse(sp.start);
      const b = sp.end === null ? dayEnd : Math.min(Date.parse(sp.end), dayEnd);
      if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a || a >= next || b <= midnight) continue;
      workMs += b - Math.max(a, midnight);
      spans.push({ kind: sp.stage, from: hourOf(a, midnight), to: hourOf(b, midnight), open: sp.end === null });
    }
    const prSpan = spans.find((x) => x.kind === 'pr');
    const end: EndWord =
      s.pr?.state === 'merged' ? 'merged' : carried(s.spans) ? 'carried over' : s.pr?.state === 'open' ? 'pull request open' : s.pr?.state === 'closed' ? 'pull request closed' : 'finished';
    return {
      id: s.id,
      num: i + 1,
      openDate: r.date,
      title: s.title,
      spans,
      pr: s.pr?.number ?? null,
      prAt: s.pr ? (prSpan?.from ?? spans[spans.length - 1]?.to ?? null) : null,
      end,
      workMs,
      waitMs: 0,
    };
  });
}

/**
 * Rows for today. A row is only ever a session from the helper's live `sessionsList` (its
 * parents and standalone sessions, in that order; `lanes` from an older helper without one) or from today's saved record, which holds
 * only parents and standalone sessions (the helper's contract from 1.2.2 on). An id found
 * only in the live day log or the names map (a child, a side chat) never becomes a row.
 * Stage colours come from the saved record when it has the session; the waits always come
 * from the live log; a session the record does not know draws its live runs in cyan. A
 * record-only row opens through its record's date. `until` ends open spans (now, or the
 * stale cut). `ends` says where a session whose card stopped working with a run still open
 * stopped (`settleOpenRuns`); the record's open stage span of that session ends there too, so
 * the row, the strip and the sums read one span.
 */
export function todayRows(s: OmniSummary, record: DayRecord | null, now: number, until: number = now, skewMs = 0, ends: ReadonlyMap<string, number> = new Map()): PanelRow[] {
  const midnight = dayStart(isoDay(now));
  // An older helper sends no `sessionsList`: its `lanes` are then the cards Work shows.
  const cardList = s.sessionsList ?? s.lanes;
  const order: string[] = cardList.map((l) => l.id);
  for (const x of record?.sessions ?? []) if (!order.includes(x.id)) order.push(x.id);
  const sorted = [...s.day].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const rec = new Map((record?.sessions ?? []).map((x) => [x.id, x]));
  const rows: PanelRow[] = [];
  for (const id of order) {
    const mine = sorted.filter((d) => d.lane === id);
    const fromRec = rec.get(id);
    if (mine.length === 0 && !fromRec) continue;
    const spans: PanelSpan[] = [];
    let workMs = 0;
    let waitMs = 0;
    const clip = (a: number, b: number) => [Math.max(a, midnight), Math.min(b, until)] as const;
    for (const d of mine) {
      const [a, b] = clip(Date.parse(d.start) - skewMs, d.end === null ? until : Date.parse(d.end) - skewMs);
      if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
      if (d.kind === 'wait') waitMs += b - a;
      else if (!fromRec) workMs += b - a;
      if (d.kind === 'wait' || !fromRec) spans.push({ kind: d.kind, from: hourOf(a, midnight), to: hourOf(b, midnight), open: d.end === null });
    }
    if (fromRec) {
      for (const sp of fromRec.spans) {
        const [a, b] = clip(Date.parse(sp.start), sp.end === null ? Math.min(until, ends.get(id) ?? until) : Date.parse(sp.end));
        if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
        workMs += b - a;
        spans.push({ kind: sp.stage, from: hourOf(a, midnight), to: hourOf(b, midnight), open: sp.end === null });
      }
    }
    spans.sort((x, y) => x.from - y.from);
    const card = cardList.find((l) => l.id === id);
    const waits = card ? card.waiting || card.state === 'blocked' : false;
    const pr = card?.pr?.number ?? fromRec?.pr?.number ?? null;
    const merged = fromRec?.pr?.state === 'merged';
    const end: EndWord = merged ? 'merged' : waits ? 'waiting on you' : card ? (card.state === 'review' ? 'in review' : card.live === 'idle' ? 'idle' : 'working') : pr !== null ? 'pull request open' : 'finished';
    const prSpan = spans.find((x) => x.kind === 'pr');
    rows.push({
      id,
      num: order.indexOf(id) + 1,
      openDate: card ? null : (record?.date ?? null),
      title: card?.title ?? fromRec?.title ?? 'An earlier session',
      spans,
      pr,
      prAt: pr !== null ? (prSpan?.from ?? spans[spans.length - 1]?.to ?? null) : null,
      end,
      workMs,
      waitMs,
    });
  }
  return rows;
}

/** "31 h 47 m of agent work across 8 sessions", plus the wait for today only. */
export function totalsText(rows: readonly PanelRow[], today: boolean): string {
  const work = rows.reduce((t, r) => t + r.workMs, 0);
  const wait = rows.reduce((t, r) => t + r.waitMs, 0);
  const fmt = (ms: number) => {
    const m = Math.max(0, Math.round(ms / 60_000));
    return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m`;
  };
  const head = `${fmt(work)} of agent work across ${rows.length} session${rows.length === 1 ? '' : 's'}`;
  return today ? `${head}, ${fmt(wait)} waiting on you` : head;
}

/** The hour axis: from 6 AM (earlier when a span starts earlier) to midnight, or to just past now today. */
export function axisRange(rows: readonly PanelRow[], today: boolean, nowHour: number): { lo: number; hi: number; step: number } {
  const first = Math.min(6, ...rows.flatMap((r) => r.spans.map((s) => Math.floor(s.from))));
  const lo = Math.max(0, first % 2 === 0 ? first : first - 1);
  const hi = today ? Math.min(24, Math.max(lo + 4, Math.ceil(nowHour + 0.6))) : 24;
  return { lo, hi, step: hi - lo > 12 ? 2 : 1 };
}

