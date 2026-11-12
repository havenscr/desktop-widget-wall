/**
 * The agent lanes helper's summary, as `wall2_omni_summary` returns it (the Rust types in
 * `src-tauri/src/wall2_omni.rs`), and the pure rules the Work centre, the ribbon's agent
 * row and the status hooks draw from.
 */

export type Stage = 'plan' | 'build' | 'review' | 'pr' | 'live';
export type LaneState = 'working' | 'blocked' | 'review';

export interface LanePr {
  number: number;
  ci: 'passing' | 'failing' | 'pending' | 'none';
  ready: boolean;
}

export interface Lane {
  id: string;
  title: string;
  stage: Stage;
  state: LaneState;
  line: string;
  elapsedS: number;
  waiting: boolean;
  pr: LanePr | null;
}

export interface YourMove {
  total: number;
  /** `question` is always empty in this helper version, and picture options never arrive. */
  first: { sessionId: string; title: string; kind: string; since: string | null; question: string } | null;
}

export interface Usage {
  claudeWeekPct: number;
  /** Null when the helper has no five hour figure. */
  claude5hPct: number | null;
  weekResetsAt: string | null;
}

export interface DaySpan {
  lane: string;
  start: string;
  end: string | null;
  kind: 'run' | 'wait' | 'done';
}

export interface OmniSummary {
  now: string;
  tz: string;
  stale: boolean;
  slots: { used: number; limit: number };
  lanes: Lane[];
  parked: number;
  yourMove: YourMove;
  usage: Usage | null;
  day: DaySpan[];
  linksAvailable: boolean;
}

/** Poll period while the page is visible. Nothing is read while it is hidden. */
export const POLL_MS = 15_000;
/** A read that takes longer than this counts as failed. */
export const CALL_TIMEOUT_MS = 10_000;
/** After failed reads the last answer stays, marked stale, for this long; then it is dropped. */
export const KEEP_STALE_MS = 30 * 60_000;
/** "Hold to merge" opens the chat after a hold this long (PR 30 adds the real merge). */
export const HOLD_MS = 600;
/** How long the "Hold" hint shows after a short tap on that button. */
export const HOLD_HINT_MS = 1500;
/** A hold is cancelled when the finger moves further than this from where it went down. */
export const HOLD_MOVE_PX = 12;

export const STAGES: readonly Stage[] = ['plan', 'build', 'review', 'pr', 'live'];
const STATES: readonly LaneState[] = ['working', 'blocked', 'review'];
const CI: readonly string[] = ['passing', 'failing', 'pending', 'none'];
const SPAN_KINDS: readonly string[] = ['run', 'wait', 'done'];

/** A lane with every field the UI reads, of the right type. */
export function validLane(v: unknown): v is Lane {
  const l = v as Lane | null;
  if (!l || typeof l !== 'object') return false;
  const prOk =
    l.pr === null ||
    (typeof l.pr === 'object' && typeof l.pr.number === 'number' && CI.includes(l.pr.ci) && typeof l.pr.ready === 'boolean');
  return (
    typeof l.id === 'string' &&
    typeof l.title === 'string' &&
    typeof l.line === 'string' &&
    STAGES.includes(l.stage) &&
    STATES.includes(l.state) &&
    typeof l.elapsedS === 'number' &&
    Number.isFinite(l.elapsedS) &&
    typeof l.waiting === 'boolean' &&
    prOk
  );
}

/** A day span with string times and a known kind. */
export function validSpan(v: unknown): v is DaySpan {
  const d = v as DaySpan | null;
  return (
    !!d &&
    typeof d === 'object' &&
    typeof d.lane === 'string' &&
    typeof d.start === 'string' &&
    (d.end === null || typeof d.end === 'string') &&
    SPAN_KINDS.includes(d.kind)
  );
}

/**
 * The summary with any malformed lane or day span dropped, or null when the answer is not a
 * summary at all (no lane list, slots, your move or day list, or no time).
 */
export function normalizeSummary(v: unknown): OmniSummary | null {
  const s = v as OmniSummary | null;
  if (!s || typeof s !== 'object' || typeof s.now !== 'string') return null;
  if (!Array.isArray(s.lanes) || !Array.isArray(s.day) || !s.yourMove || typeof s.yourMove.total !== 'number') return null;
  if (!s.slots || typeof s.slots.used !== 'number' || typeof s.slots.limit !== 'number') return null;
  return { ...s, lanes: s.lanes.filter(validLane), day: s.day.filter(validSpan) };
}
export const STAGE_NAMES: Record<Stage, string> = { plan: 'Plan', build: 'Build', review: 'Review', pr: 'PR', live: 'Live' };

/** A lane that wants an answer: the helper flags it waiting, or it is blocked. */
export function laneWaits(l: Lane): boolean {
  return l.waiting || l.state === 'blocked';
}

/** A ready pull request with nothing failing or still running: the lane shows "Hold to merge". */
export function mergeReady(l: Lane): boolean {
  return l.stage === 'pr' && l.pr !== null && l.pr.ready && (l.pr.ci === 'passing' || l.pr.ci === 'none');
}

/** How many things want an answer: the helper's your-move total, or the waiting lanes if more. */
export function needsYouCount(s: OmniSummary): number {
  return Math.max(s.yourMove.total, s.lanes.filter(laneWaits).length);
}

export type Tone = 'cyan' | 'amber' | 'mint';

/** Colour means something: amber needs you, mint is done or ready, cyan is moving. */
export function laneTone(l: Lane): Tone {
  if (laneWaits(l)) return 'amber';
  if (mergeReady(l) || l.stage === 'live') return 'mint';
  return 'cyan';
}

/** How far along the ring is: by stage, full once live. */
export function ringFraction(l: Lane): number {
  return [0.15, 0.4, 0.6, 0.8, 1][STAGES.indexOf(l.stage)] ?? 0;
}

/** "42 min", "2 h", "2 h 5 m". */
export function elapsedText(seconds: number): string {
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return mins % 60 === 0 ? `${h} h` : `${h} h ${mins % 60} m`;
}

/** The helper's line, or a plain word for the state when it sent none. */
export function laneLine(l: Lane): string {
  if (l.line) return l.line;
  if (laneWaits(l)) return 'Waiting for you';
  return l.state === 'review' ? 'In review' : 'Working';
}

/** "PR 553, checks passing", for a lane with room for a third line. Empty without a PR. */
export function prText(l: Lane): string {
  if (!l.pr) return '';
  const ci = { passing: 'checks passing', failing: 'checks failing', pending: 'checks running', none: 'no checks' }[l.pr.ci];
  return `PR ${l.pr.number}, ${ci}${l.pr.ready ? '' : ', draft'}`;
}

/** "3 of 3 slots", with the real numbers even when more are used than the limit. */
export function slotsText(s: OmniSummary): string {
  return `${s.slots.used} of ${s.slots.limit} slot${s.slots.limit === 1 ? '' : 's'}`;
}

/** The header's right side: "Nothing needs you", or "One thing for you" with "then N more". */
export function headerAsk(s: OmniSummary): { text: string; more: string | null; tone: 'cyan' | 'amber' } {
  const n = needsYouCount(s);
  if (n === 0) return { text: 'Nothing needs you', more: null, tone: 'cyan' };
  return { text: 'One thing for you', more: n > 1 ? `then ${n - 1} more` : null, tone: 'amber' };
}

/** Empty rows under the lanes: up to three rows in all, never more than the limit allows. */
export function freeSlots(s: OmniSummary): number {
  return Math.max(0, Math.min(3, s.slots.limit) - s.lanes.length);
}

/** The text of the single slim row shown when no lane is open. */
export function allFreeText(s: OmniSummary): string {
  return s.slots.limit === 3 ? 'All three slots free' : 'All slots free';
}

/** "updated 4 min ago", or "may be out of date" when no fresh answer has been seen. */
export function ageText(freshAt: number | null, now: number): string {
  if (freshAt === null) return 'may be out of date';
  return `updated ${Math.max(1, Math.round((now - freshAt) / 60_000))} min ago`;
}

const WORDS = ['No', 'One', 'Two', 'Three'];
const word = (n: number) => WORDS[n] ?? String(n);

/**
 * One line for the places that only glance at the agents (Unwind, Dream): "2 agents still
 * working, nothing needs you", "One agent still working, one thing for you".
 */
export function statusLine(s: OmniSummary): string {
  const working = s.lanes.filter((l) => !laneWaits(l) && l.state === 'working').length;
  const asks = needsYouCount(s);
  const first = working === 0 ? 'No agents working' : `${word(working)} agent${working === 1 ? '' : 's'} still working`;
  const second = asks === 0 ? 'nothing needs you' : asks === 1 ? 'one thing for you' : `${word(asks).toLowerCase()} things for you`;
  return `${first}, ${second}`;
}

export interface AgentSegment {
  key: string;
  /** 0, 1 or 2: the ribbon draws three thin rows. */
  row: number;
  x: number;
  width: number;
  kind: 'run' | 'wait' | 'past' | 'done';
}

/**
 * The ribbon's agent row: one thin segment per span from the helper's day log, up to now.
 * Rows follow the lane order (the summary's lanes first, then any other chat in the order
 * it first ran). An open run is `run` (cyan), a wait is `wait` (amber), a finished run is
 * `past` (grey) and a span the helper marks done is `done` (grey with a mint cap).
 * `hourAt` maps a time to the ribbon's x; spans outside the ribbon are skipped. `until`
 * (the last good answer's time, for a stale answer) ends open spans there instead of now.
 */
export function agentSegments(
  s: Pick<OmniSummary, 'lanes' | 'day'>,
  nowMs: number,
  hourAt: (ms: number) => number | null,
  until: number | null = null,
): AgentSegment[] {
  const now = until === null ? nowMs : Math.min(nowMs, until);
  const order: string[] = s.lanes.map((l) => l.id);
  const sorted = [...s.day].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  for (const d of sorted) if (!order.includes(d.lane)) order.push(d.lane);
  const out: AgentSegment[] = [];
  for (const d of sorted) {
    const start = Date.parse(d.start);
    const endRaw = d.end === null ? now : Date.parse(d.end);
    if (!Number.isFinite(start) || !Number.isFinite(endRaw) || start >= now) continue;
    const end = Math.min(endRaw, now);
    if (end < start) continue;
    const x0 = hourAt(start);
    const x1 = hourAt(end);
    if (x0 === null || x1 === null || x1 < x0) continue;
    const open = d.end === null || endRaw > now;
    const kind = d.kind === 'wait' ? 'wait' : d.kind === 'done' ? 'done' : open ? 'run' : 'past';
    out.push({ key: `${d.lane}-${d.start}`, row: order.indexOf(d.lane) % 3, x: x0, width: Math.max(5, x1 - x0), kind });
  }
  return out;
}
