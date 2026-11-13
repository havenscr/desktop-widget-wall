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

export type Provider = 'claude' | 'codex' | 'other';

export interface Lane {
  id: string;
  title: string;
  stage: Stage;
  state: LaneState;
  line: string;
  elapsedS: number;
  waiting: boolean;
  pr: LanePr | null;
  // From helper 1.1.0 on; an older helper sends none of these, so every one is optional.
  /** `working` while it runs, `idle` while it sits. */
  live?: 'working' | 'idle' | null;
  /** Seconds since it last did something (only for an idle session that waits on the owner). */
  idleS?: number | null;
  /** A parent's helpers: how many, and how many are working. */
  kids?: { total: number; working: number } | null;
  /** Seconds it has waited on the owner, when known. */
  waitingSinceS?: number | null;
  /** The session's own next step, short. */
  next?: string | null;
  /** Which assistant runs it. */
  harness?: Provider | null;
  failed?: boolean;
}

export interface YourMove {
  total: number;
  /** `question` is always empty in this helper version, and picture options never arrive. */
  first: { sessionId: string; title: string; kind: string; since: string | null; question: string } | null;
  /** Up to five waiting session ids in the helper's order (helper 1.1.0 on). */
  ids?: string[];
}

/** One subscription's usage (helper 1.1.0 on). A null value means no recent reading. */
export interface UsageAccount {
  provider: Provider;
  label: string;
  weekPct: number | null;
  fiveHourPct: number | null;
  weekResetsAt: string | null;
}

export interface Usage {
  /** Null when no Claude account has a recent weekly reading (the accounts may still have some). */
  claudeWeekPct: number | null;
  /** Null when the helper has no five hour figure. */
  claude5hPct: number | null;
  weekResetsAt: string | null;
  accounts?: UsageAccount[];
}

/** A session's name for the day log, so a bar of a session with no card can be named. */
export interface SessionName {
  title: string;
  stage: Stage | null;
  state: LaneState | null;
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
  /**
   * The server's own numbers (`used` can pass `limit`), and from helper 1.1.0 on: open
   * parents and standalone sessions, how many of them work, and helpers in all.
   */
  slots: { used: number; limit: number; sessions?: number | null; working?: number | null; helpers?: number | null };
  lanes: Lane[];
  /** Every open parent or standalone session, up to 12 (helper 1.1.0 on); null from an older helper. */
  sessionsList?: Lane[] | null;
  /** Names for the ids in the day log and the waiting list (helper 1.1.0 on). */
  sessions?: Record<string, SessionName>;
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

const PROVIDERS: readonly string[] = ['claude', 'codex', 'other'];
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const pct = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : null);

/** A valid lane with its optional fields of the right type (a wrong one becomes null). */
function cleanLane(l: Lane): Lane {
  const k = l.kids as { total?: unknown; working?: unknown } | null | undefined;
  const kt = k && typeof k === 'object' ? num(k.total) : null;
  const kw = k && typeof k === 'object' ? num(k.working) : null;
  return {
    ...l,
    live: l.live === 'working' || l.live === 'idle' ? l.live : null,
    idleS: num(l.idleS),
    kids: kt !== null && kw !== null ? { total: kt, working: Math.min(kw, kt) } : null,
    waitingSinceS: num(l.waitingSinceS),
    next: typeof l.next === 'string' && l.next.trim() ? l.next : null,
    harness: typeof l.harness === 'string' && PROVIDERS.includes(l.harness) ? l.harness : null,
    failed: l.failed === true,
  };
}

function cleanUsage(u: unknown): Usage | null {
  const v = u as Usage | null;
  if (!v || typeof v !== 'object') return null;
  const accounts = (Array.isArray(v.accounts) ? v.accounts : [])
    .filter((a) => a && typeof a === 'object' && typeof a.label === 'string' && PROVIDERS.includes(a.provider))
    .slice(0, 6)
    .map((a) => ({
      provider: a.provider,
      label: a.label,
      weekPct: pct(a.weekPct),
      fiveHourPct: pct(a.fiveHourPct),
      weekResetsAt: typeof a.weekResetsAt === 'string' ? a.weekResetsAt : null,
    }));
  const week = pct(v.claudeWeekPct);
  if (week === null && accounts.length === 0) return null;
  return {
    claudeWeekPct: week,
    claude5hPct: pct(v.claude5hPct),
    weekResetsAt: typeof v.weekResetsAt === 'string' ? v.weekResetsAt : null,
    accounts,
  };
}

function cleanNames(v: unknown): Record<string, SessionName> {
  const out: Record<string, SessionName> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [id, n] of Object.entries(v as Record<string, SessionName>)) {
    if (!n || typeof n !== 'object' || typeof n.title !== 'string') continue;
    out[id] = { title: n.title, stage: STAGES.includes(n.stage as Stage) ? n.stage : null, state: STATES.includes(n.state as LaneState) ? n.state : null };
  }
  return out;
}

/**
 * The summary with any malformed lane or day span dropped, or null when the answer is not a
 * summary at all (no lane list, slots, your move or day list, or no time). The fields a
 * newer helper adds are checked the same way, and are absent or empty from an older one.
 */
export function normalizeSummary(v: unknown): OmniSummary | null {
  const s = v as OmniSummary | null;
  if (!s || typeof s !== 'object' || typeof s.now !== 'string') return null;
  if (!Array.isArray(s.lanes) || !Array.isArray(s.day) || !s.yourMove || typeof s.yourMove.total !== 'number') return null;
  if (!s.slots || typeof s.slots.used !== 'number' || typeof s.slots.limit !== 'number') return null;
  const list = Array.isArray(s.sessionsList) ? s.sessionsList.filter(validLane).map(cleanLane) : null;
  const ids = Array.isArray(s.yourMove.ids) ? s.yourMove.ids.filter((x): x is string => typeof x === 'string').slice(0, 5) : [];
  return {
    ...s,
    slots: { used: s.slots.used, limit: s.slots.limit, sessions: num(s.slots.sessions), working: num(s.slots.working), helpers: num(s.slots.helpers) },
    lanes: s.lanes.filter(validLane).map(cleanLane),
    sessionsList: list,
    sessions: cleanNames(s.sessions),
    yourMove: { ...s.yourMove, ids },
    usage: cleanUsage(s.usage),
    day: s.day.filter(validSpan),
  };
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

/**
 * The sessions the cards show: the helper's full list of parents and standalone sessions
 * when it sends one (helper 1.1.0 on), else its three lanes.
 */
export function cards(s: Pick<OmniSummary, 'lanes' | 'sessionsList'>): Lane[] {
  return s.sessionsList ?? s.lanes;
}

/** How many things want an answer: the helper's your-move total, or the waiting cards if more. */
export function needsYouCount(s: OmniSummary): number {
  return Math.max(s.yourMove.total, waitingIds(s).length);
}

/**
 * The ids of the sessions that wait on the owner, in order: the helper's waiting list (or
 * its first entry from an older helper), then any waiting card not already listed.
 */
export function waitingIds(s: OmniSummary): string[] {
  const out: string[] = [...(s.yourMove.ids ?? [])];
  if (out.length === 0 && s.yourMove.first) out.push(s.yourMove.first.sessionId);
  for (const l of cards(s)) if (laneWaits(l) && !out.includes(l.id)) out.push(l.id);
  return out;
}

/** A session's title from anything the summary knows about it, or null. */
export function sessionTitle(s: OmniSummary, id: string): string | null {
  const card = cards(s).find((l) => l.id === id) ?? s.lanes.find((l) => l.id === id);
  if (card) return card.title;
  if (s.yourMove.first?.sessionId === id && s.yourMove.first.title) return s.yourMove.first.title;
  return s.sessions?.[id]?.title ?? null;
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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The slot wording, which never reads as a bug when more run than the limit: "4 working,
 * 6 open, 4 slots" from a newer helper, "9 running, 4 slots" from an older one.
 */
export function slotsText(s: OmniSummary): string {
  const { working, sessions, limit, used } = s.slots;
  if (typeof working === 'number' && typeof sessions === 'number') return `${working} working, ${sessions} open, ${plural(limit, 'slot')}`;
  return `${used} running, ${plural(limit, 'slot')}`;
}

/** Most pips the slot meter draws; past this the limit shows as a number only. */
export const MAX_PIPS = 6;

/**
 * The slot meter: one pip per slot (up to six), filled for each working session (or each
 * used slot from an older helper), and how many more work than there are pips.
 */
export function slotMeter(s: OmniSummary): { pips: boolean[]; over: number } {
  const filled = typeof s.slots.working === 'number' ? s.slots.working : s.slots.used;
  const n = Math.max(1, Math.min(MAX_PIPS, s.slots.limit));
  return { pips: Array.from({ length: n }, (_, i) => i < filled), over: Math.max(0, filled - n) };
}

/** The slot meter's tooltip: the breakdown, and what a click does. */
export function slotsTip(s: OmniSummary): string {
  const { working, sessions, helpers, limit, used } = s.slots;
  const parts: string[] = [];
  if (typeof working === 'number') parts.push(`${working} working`);
  if (typeof sessions === 'number') parts.push(`${sessions} open`);
  if (typeof helpers === 'number') parts.push(plural(helpers, 'helper'));
  if (parts.length === 0) parts.push(`${used} running`);
  parts.push(`${plural(limit, 'slot')} on the server (more may run than there are slots)`);
  return `${parts.join(', ')}. Click to bring OmniGent forward.`;
}

/**
 * The header's right side: "Nothing needs you", or "One thing for you" with the waiting
 * session's title and "then N more". `step` picks which waiting session it names (0 is
 * the first; it wraps). `id` is the session the button opens.
 */
export function headerAsk(
  s: OmniSummary,
  step = 0,
): { text: string; title: string | null; id: string | null; more: string | null; canStep: boolean; tone: 'cyan' | 'amber' } {
  const n = needsYouCount(s);
  if (n === 0) return { text: 'Nothing needs you', title: null, id: null, more: null, canStep: false, tone: 'cyan' };
  const ids = waitingIds(s);
  // Nothing to name or open: say so plainly; the button only brings OmniGent forward.
  if (ids.length === 0) return { text: 'Something needs you', title: null, id: null, more: n > 1 ? `${n} things in all` : null, canStep: false, tone: 'amber' };
  const k = step % ids.length;
  const id = ids[k];
  const title = sessionTitle(s, id) ?? 'a session';
  // Count only what the button can step through (at most five ids); the rest are "and more".
  const rest = ids.length - 1 - k;
  const beyond = n > ids.length;
  const more = rest > 0 ? `then ${rest} more${beyond ? ', and more' : ''}` : ids.length > 1 ? 'back to the first' : beyond ? 'and more' : null;
  return { text: k === 0 ? 'One thing for you' : 'Also for you', title, id, more, canStep: ids.length > 1, tone: 'amber' };
}

/** Empty rows under the cards: up to three rows in all, never more than the limit allows. */
export function freeSlots(s: OmniSummary): number {
  return Math.max(0, Math.min(3, s.slots.limit) - cards(s).length);
}

/** The card's second line and its colour: what is most useful to know first. */
export function cardLine(l: Lane): { text: string; tone: '' | 'amber' | 'red' } {
  if (laneWaits(l)) {
    const t = l.waitingSinceS != null ? `Waiting on you for ${elapsedText(l.waitingSinceS)}` : 'Waiting on you';
    // "Waiting on a thumbnail choice" adds "a thumbnail choice"; the bare status words add nothing.
    // A line that only says it waits on the owner adds nothing.
    const said = l.line && !BARE.includes(l.line.toLowerCase()) && !/^waiting (on|for) you\b/i.test(l.line) ? l.line : '';
    const what = said.replace(/^waiting (on|for)\s+/i, '');
    return { text: what ? `${t}: ${what}` : t, tone: 'amber' };
  }
  if (l.failed) return { text: l.line && !BARE.includes(l.line.toLowerCase()) ? `Failed: ${l.line}` : 'Failed, needs a look', tone: 'red' };
  const said = l.line && !BARE.includes(l.line.toLowerCase()) ? l.line : '';
  if (l.live === 'working' && said) return { text: said, tone: '' };
  if (l.next) return { text: `Next: ${l.next}`, tone: '' };
  if (said) return { text: said, tone: '' };
  if (l.live === 'working') return { text: 'Working now', tone: '' };
  if (l.live === 'idle') return { text: l.idleS != null ? `Idle for ${elapsedText(l.idleS)}` : 'Idle', tone: '' };
  return { text: laneLine(l), tone: '' };
}
/** Status words the helper sends as a line; the card says them better itself. */
const BARE = ['running', 'idle', 'working', 'blocked'];

const HARNESS: Record<Provider, string> = { claude: 'Claude', codex: 'Codex', other: 'Other assistant' };

/** The quiet facts after the second line: helpers, which assistant, the PR and its checks. */
export function cardMeta(l: Lane): string[] {
  const out: string[] = [];
  if (l.kids && l.kids.total > 0) out.push(`${plural(l.kids.total, 'helper')}, ${l.kids.working === 0 ? 'none working' : `${l.kids.working} working`}`);
  if (l.harness) out.push(HARNESS[l.harness]);
  if (l.pr) out.push(prText(l));
  return out;
}

/** "3 of 7" for the card list's count, or null when every card is in view. */
export function countText(total: number, inView = 3): string | null {
  return total > inView ? `${inView} of ${total}` : null;
}

/** One meter per subscription for the shelf; the fullest above 90 percent is amber. */
export interface UsageMeter {
  label: string;
  pct: number | null;
  fiveHour: number | null;
  resets: string | null;
  /** The figure the meter shows is the fullest and above 90 percent: amber. */
  warn: boolean;
  /** The five hour figure is not shown inline (three or more meters) and is above 90: a small mark. */
  hotHidden: boolean;
}

/**
 * One meter per subscription for the shelf. `showFiveHour` says whether the five hour
 * figure is shown inline (two or fewer meters). Amber goes only to a figure the meter
 * shows: the fullest shown figure, when above 90. A hidden five hour figure above 90 gets
 * a small mark instead (its number is in the hover).
 */
export function usageMeters(u: Usage | null, showFiveHour?: boolean): UsageMeter[] {
  if (!u) return [];
  if (u.accounts && u.accounts.length > 0) {
    const inline = showFiveHour ?? u.accounts.length <= 2;
    const shownOf = (a: UsageAccount) => Math.max(a.weekPct ?? 0, inline ? (a.fiveHourPct ?? 0) : 0);
    const top = Math.max(...u.accounts.map(shownOf));
    let marked = false;
    return u.accounts.map((a) => {
      const warn = !marked && top > 90 && shownOf(a) === top;
      if (warn) marked = true;
      return { label: a.label, pct: a.weekPct, fiveHour: a.fiveHourPct, resets: a.weekResetsAt, warn, hotHidden: !inline && (a.fiveHourPct ?? 0) > 90 };
    });
  }
  if (u.claudeWeekPct === null) return [];
  return [{ label: 'Claude this week', pct: u.claudeWeekPct, fiveHour: u.claude5hPct, resets: u.weekResetsAt, warn: u.claudeWeekPct > 90, hotHidden: false }];
}

/** A short local day and time, "Tue 6:00 PM". */
export function dayTime(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const day = d.toLocaleDateString('en-US', { weekday: 'short' });
  const h = d.getHours();
  return `${day} ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** The tooltip for one usage meter. */
export function usageTip(m: UsageMeter): string {
  const parts = [m.pct === null ? `${m.label}: no recent weekly reading` : `${m.label}: ${Math.round(m.pct)}% of this week used`];
  if (m.fiveHour !== null) parts.push(`${Math.round(m.fiveHour)}% of the five hour window`);
  const r = dayTime(m.resets);
  if (r) parts.push(`the week resets ${r}`);
  return parts.join(', ');
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
  const working = cards(s).filter((l) => !laneWaits(l) && l.state === 'working').length;
  const asks = needsYouCount(s);
  const first = working === 0 ? 'No agents working' : `${word(working)} agent${working === 1 ? '' : 's'} still working`;
  const second = asks === 0 ? 'nothing needs you' : asks === 1 ? 'one thing for you' : `${word(asks).toLowerCase()} things for you`;
  return `${first}, ${second}`;
}

export interface AgentSegment {
  key: string;
  /** The session this span belongs to. */
  lane: string;
  /** The session's sub-row, from 0: one per session, in the cards' order. */
  row: number;
  x: number;
  width: number;
  kind: 'run' | 'wait' | 'past' | 'done';
  /** Start and end on this PC's clock (the end is now, or the stale cut, for an open span). */
  start: number;
  end: number;
  open: boolean;
}

/** The band row 2 gives the agent bars, in ribbon pixels (under the task marks, above the focus bar). */
export const AGENT_BAND = { top: 68, height: 24 };
/**
 * Every sub-row is at least this tall, so a mouse can hit it (the bar inside is thinner).
 * The band holds three such rows.
 */
export const AGENT_PITCH = 8;
export const AGENT_BAR = 5;
export const AGENT_ROWS = Math.floor(AGENT_BAND.height / AGENT_PITCH);

/** The agent row's layout: drawn spans, and the sessions folded into the "+N more" row. */
export interface AgentLayout {
  segs: AgentSegment[];
  /** Sessions with spans today that have no row of their own, in sub-row order. */
  hidden: string[];
  /** The row the "+N more" label takes, or null when every session has its own row. */
  moreRow: number | null;
  /** Rows in use, the "+N more" row included. */
  rows: number;
}

/**
 * The ribbon's agent row: one thin segment per span from the helper's day log, up to now,
 * on one sub-row per session, each sub-row 8 px tall so a mouse can hit it. Rows follow the
 * cards' order (the helper's session list, or its lanes from an older helper), then every
 * other session in the order it first ran; only sessions with a span today take a row. As
 * many sessions as fit the band get a row; when there are more, the last row becomes "+N
 * more" for the rest (their spans are not drawn), so no two sessions ever share pixels.
 * An open run is `run` (cyan), a wait is `wait` (amber), a finished run is `past` (grey)
 * and a span the helper marks done is `done` (grey with a mint cap). `hourAt` maps a time
 * to the ribbon's x; spans outside the ribbon are skipped. `until` (the last good answer's
 * time, for a stale answer) ends open spans there instead of now. `skewMs` (the helper's
 * clock minus this PC's) is taken off every helper time first, so the row lands where it
 * would with both clocks agreeing.
 */
export function agentLayout(
  s: Pick<OmniSummary, 'lanes' | 'day'> & Partial<Pick<OmniSummary, 'sessionsList'>>,
  nowMs: number,
  hourAt: (ms: number) => number | null,
  until: number | null = null,
  skewMs = 0,
  maxRows = AGENT_ROWS,
): AgentLayout {
  const now = until === null ? nowMs : Math.min(nowMs, until);
  const sorted = [...s.day].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const raw: AgentSegment[] = [];
  for (const d of sorted) {
    const start = Date.parse(d.start) - skewMs;
    const endRaw = d.end === null ? now : Date.parse(d.end) - skewMs;
    if (!Number.isFinite(start) || !Number.isFinite(endRaw) || start >= now) continue;
    const end = Math.min(endRaw, now);
    if (end < start) continue;
    const x0 = hourAt(start);
    const x1 = hourAt(end);
    if (x0 === null || x1 === null || x1 < x0) continue;
    const open = d.end === null || endRaw > now;
    const kind = d.kind === 'wait' ? 'wait' : d.kind === 'done' ? 'done' : open ? 'run' : 'past';
    raw.push({ key: `${d.lane}-${d.start}`, lane: d.lane, row: 0, x: x0, width: Math.max(5, x1 - x0), kind, start, end, open });
  }
  const withSpans = new Set(raw.map((g) => g.lane));
  const order = agentOrder(s).filter((id) => withSpans.has(id));
  const fold = order.length > maxRows;
  const shown = fold ? order.slice(0, maxRows - 1) : order;
  const hidden = fold ? order.slice(maxRows - 1) : [];
  const segs = raw.filter((g) => shown.includes(g.lane)).map((g) => ({ ...g, row: shown.indexOf(g.lane) }));
  return { segs, hidden, moreRow: fold ? maxRows - 1 : null, rows: fold ? maxRows : shown.length };
}

/** The drawn spans alone (see `agentLayout`). */
export function agentSegments(
  s: Pick<OmniSummary, 'lanes' | 'day'> & Partial<Pick<OmniSummary, 'sessionsList'>>,
  nowMs: number,
  hourAt: (ms: number) => number | null,
  until: number | null = null,
  skewMs = 0,
): AgentSegment[] {
  return agentLayout(s, nowMs, hourAt, until, skewMs).segs;
}

/** Session ids in sub-row order: the cards, then the rest of the day log by first start. */
export function agentOrder(s: Pick<OmniSummary, 'lanes' | 'day'> & Partial<Pick<OmniSummary, 'sessionsList'>>): string[] {
  const order: string[] = cards({ lanes: s.lanes, sessionsList: s.sessionsList ?? null }).map((l) => l.id);
  const sorted = [...s.day].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  for (const d of sorted) if (!order.includes(d.lane)) order.push(d.lane);
  return order;
}

/** `h:mm` with no AM or PM. */
function clock(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** One span in plain words: "working 2:10 to 3:40", "waiting on you since 3:40". */
export function spanWords(g: Pick<AgentSegment, 'kind' | 'start' | 'end' | 'open'>): string {
  const what = g.kind === 'wait' ? 'waiting on you' : g.kind === 'done' ? 'in review' : 'working';
  return g.open ? `${what} since ${clock(g.start)}` : `${what} ${clock(g.start)} to ${clock(g.end)}`;
}

/** Every span of one session in plain words, oldest first, at most `max` (then "and N more"). */
export function sessionSpans(segs: readonly AgentSegment[], lane: string, max = 4): string {
  const mine = segs.filter((g) => g.lane === lane).sort((a, b) => a.start - b.start);
  // The most recent spans matter most: keep the last `max`.
  const shown = mine.slice(-max).map(spanWords);
  const hidden = mine.length - shown.length;
  return `${hidden > 0 ? `${hidden} earlier, then ` : ''}${shown.join(', ')}`;
}

/**
 * The day in one line for the agent row's icon: "Today: 5 h 10 m of agent work across 4
 * sessions, 40 min waiting on you". Work is every run (open or finished); waiting is every
 * wait; time in review is not counted. Overlapping sessions add up.
 */
export function dayTotals(segs: readonly AgentSegment[]): string {
  let work = 0;
  let wait = 0;
  for (const g of segs) {
    if (g.kind === 'wait') wait += g.end - g.start;
    else if (g.kind === 'run' || g.kind === 'past') work += g.end - g.start;
  }
  const sessions = new Set(segs.map((g) => g.lane)).size;
  const parts = [`${work >= 30_000 ? elapsedText(work / 1000) : 'no time'} of agent work across ${sessions} session${sessions === 1 ? '' : 's'}`];
  parts.push(wait >= 30_000 ? `${elapsedText(wait / 1000)} waiting on you` : 'no waiting on you');
  return `Today: ${parts.join(', ')}`;
}
