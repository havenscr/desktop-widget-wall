import { REFRESH_MS, ageText, statusLine, tone, type SecuritySummary } from './model';
import { maxAge, type DeskSecurity, type FeedState } from './useDesk';
import type { SecurityState } from './useSecurity';

/** At most this many arcs on the ring; more alerts read "12+" inside it. */
export const MAX_ARCS = 12;

export interface ShieldAlert {
  key: string;
  severity: 'high' | 'medium' | 'low' | null;
  text: string;
  /** "12m", "3h"; null when the time is unknown. */
  age: string | null;
  /** Whole minutes since it was raised (0 when under a minute); null when the time is unknown. */
  ageMins: number | null;
  /** When it was raised, epoch ms, for the tooltip; null when unknown. */
  atMs: number | null;
}

export interface Shield {
  /** `off` not set up, `loading`, `down` never read, `ready` a read to show. */
  kind: 'off' | 'loading' | 'down' | 'ready';
  /** Where the alerts came from: the desk route (with ids and Clear all) or today's read. */
  source: 'desk' | 'legacy';
  /** Open alerts: the ring's lit arcs and the number inside it. */
  open: number;
  /** Every alert the read listed, newest first (today's read lists at most three). */
  alerts: ShieldAlert[];
  /** Not live: a failed refresh, a stale scan, or a read past its age. Never mint then. */
  stale: boolean;
  /** "as of 3:12 PM" while stale with a known time. */
  asOf: string | null;
  title: string;
  devices: number | null;
  blocked: number | null;
  /** Clear all can run (desk route and a token on this PC). */
  canClear: boolean;
  /** The desk route is live but no token is set: Clear all says so instead of acting. */
  clearNotSetUp: boolean;
  /** A token is set, but the read is not live: Clear all waits for a fresh read (it would
   * clear alerts the wall cannot show as current). */
  clearWaits: boolean;
  /** A token is set, but the home app's address is plain http on the local network. */
  clearInsecure: boolean;
  /** The extra numbers for the hover on the summary line. */
  detail: string[];
  /** The last scan's time of day ("10:24 AM"); null when the home app sent none. */
  scan: string | null;
  /** Alarms in the last 24 hours, when the home app sent the number. */
  alarms: number | null;
  /** The firewall is down or its box offline (today's read says so). */
  bad: boolean;
}

const num = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null);

function timeText(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function ageMinutes(atMs: number | null, now: number): number | null {
  return typeof atMs === 'number' && Number.isFinite(atMs) ? Math.max(0, Math.floor((now - atMs) / 60_000)) : null;
}

/** An alert's age as the card's line says it: "just now", "12 min ago", "3 h ago", "2 days ago". */
export function alertAgeWords(mins: number | null): string | null {
  if (mins === null) return null;
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

/** Newest first; unknown times last, in the source's order. */
function newestFirst(list: ShieldAlert[]): ShieldAlert[] {
  return list.map((a, i) => ({ a, i })).sort((x, y) => (y.a.atMs ?? -Infinity) - (x.a.atMs ?? -Infinity) || x.i - y.i).map((x) => x.a);
}

function fromDesk(d: DeskSecurity, readAt: number | null, failed: boolean, now: number, legacy: SecuritySummary | null): Shield {
  const alerts = newestFirst(
    d.alerts.map((a, i) => {
      const at = a.at ? Date.parse(a.at) : NaN;
      const atMs = Number.isFinite(at) ? at : typeof a.ageSeconds === 'number' && readAt !== null ? readAt - a.ageSeconds * 1000 : null;
      return { key: a.id ?? `n${i}`, severity: a.severity, text: a.text, age: ageText(atMs, now), ageMins: ageMinutes(atMs, now), atMs };
    }),
  );
  const old = readAt === null || now - readAt > maxAge(REFRESH_MS);
  const stale = failed || d.stale || !d.available || old;
  const observed = d.observedAt ? Date.parse(d.observedAt) : NaN;
  const asOfMs = Number.isFinite(observed) ? observed : readAt;
  const open = num(d.unseen) ?? alerts.length;
  const title = !d.available ? 'No security summary yet' : legacy ? statusLine({ ...legacy, alerts: open }) : open > 0 ? 'Up' : 'All quiet';
  const detail = legacyDetail(legacy);
  const { scan, alarms } = legacyFacts(legacy);
  return {
    kind: 'ready',
    source: 'desk',
    scan,
    alarms,
    open,
    alerts,
    stale,
    asOf: stale && asOfMs !== null ? `as of ${timeText(asOfMs)}` : null,
    title,
    devices: num(d.devices),
    blocked: num(d.blocked),
    bad: legacy ? tone(legacy) === 'bad' : false,
    canClear: d.canClear && open > 0 && !stale,
    clearNotSetUp: !d.canClear && !d.clearInsecure && open > 0,
    clearWaits: d.canClear && open > 0 && stale,
    clearInsecure: !!d.clearInsecure && open > 0,
    detail,
  };
}

/** The two facts the card prints from today's read: the scan's time of day and the 24 hour alarm count. */
function legacyFacts(s: SecuritySummary | null): { scan: string | null; alarms: number | null } {
  if (!s) return { scan: null, alarms: null };
  const at = s.lastScan ? Date.parse(s.lastScan) : NaN;
  return { scan: Number.isFinite(at) ? timeText(at) : null, alarms: num(s.firewalla?.alarms24h) };
}

function legacyDetail(s: SecuritySummary | null): string[] {
  if (!s) return [];
  const out: string[] = [];
  const alarms = num(s.firewalla?.alarms24h);
  if (alarms !== null) out.push(`${alarms} ${alarms === 1 ? 'alarm' : 'alarms'} in 24 h`);
  const box = num(s.boxTemp);
  if (box !== null) out.push(`box at ${box}°`);
  if (s.lastScan) {
    const at = Date.parse(s.lastScan);
    if (Number.isFinite(at)) out.push(`last scan ${timeText(at)}`);
  }
  return out;
}

function fromLegacy(sec: Pick<SecurityState, 'status' | 'summary' | 'now' | 'readAt'>): Shield {
  const base = { source: 'legacy' as const, canClear: false, clearNotSetUp: false, clearWaits: false, clearInsecure: false, devices: null, blocked: null, detail: [] as string[], bad: false, scan: null, alarms: null };
  if (sec.status === 'unconfigured') return { ...base, kind: 'off', open: 0, alerts: [], stale: true, asOf: null, title: 'Not set up' };
  if (sec.status === 'loading' && !sec.summary) return { ...base, kind: 'loading', open: 0, alerts: [], stale: true, asOf: null, title: 'Loading' };
  const s = sec.summary;
  if (!s) return { ...base, kind: 'down', open: 0, alerts: [], stale: true, asOf: null, title: 'Home app not reachable' };
  const now = sec.now;
  const old = sec.readAt === null || now - sec.readAt > maxAge(REFRESH_MS);
  const failed = sec.status === 'error';
  const stale = failed || old || !s.reachable || s.stale;
  const alerts = newestFirst(
    (Array.isArray(s.topAlerts) ? s.topAlerts : [])
      .filter((r) => r && typeof r.text === 'string' && r.text.trim() !== '')
      .map((r, i) => ({ key: `t${i}`, severity: r.severity, text: r.text, age: ageText(r.atMs, now), ageMins: ageMinutes(r.atMs, now), atMs: r.atMs })),
  );
  const scan = s.lastScan ? Date.parse(s.lastScan) : NaN;
  const asOfMs = Number.isFinite(scan) ? scan : sec.readAt;
  return {
    ...base,
    kind: 'ready',
    open: Math.max(0, num(s.alerts) ?? 0),
    alerts,
    stale,
    asOf: stale && asOfMs !== null ? `as of ${timeText(asOfMs)}` : null,
    title: failed ? 'Home app not reachable' : statusLine(s),
    devices: num(s.devices),
    blocked: num(s.blocked),
    detail: legacyDetail(s),
    ...legacyFacts(s),
    bad: tone(s) === 'bad',
  };
}

/**
 * What the shield card shows. The desk route wins when it has answered; while it is
 * absent (the home app's change is not live), not set up, loading or has never read,
 * today's security read fills the card and Clear all stays hidden.
 */
export function shieldFrom(desk: FeedState<DeskSecurity>, sec: Pick<SecurityState, 'status' | 'summary' | 'now' | 'readAt'>): Shield {
  if (desk.data && (desk.status === 'ready' || desk.status === 'error')) {
    return fromDesk(desk.data, desk.readAt, desk.status === 'error', Math.max(desk.now, sec.now), sec.summary);
  }
  return fromLegacy(sec);
}

/** Open alerts that shorten Home's chores: only from a live read. */
export function alertsOpen(s: Shield): boolean {
  return s.kind === 'ready' && s.open > 0;
}

/** "6", or "12+" past the ring's twelve arcs. */
export function ringCount(open: number): string {
  return open > MAX_ARCS ? `${MAX_ARCS}+` : String(open);
}

/** The ring's line under the title: "6 alerts open, 31 devices at home", or "Nothing is open." when quiet. */
export function shieldSub(s: Shield): string[] {
  const dev = s.devices !== null ? `${s.devices} ${s.devices === 1 ? 'device' : 'devices'} at home` : null;
  if (s.kind !== 'ready') return [s.kind === 'down' ? 'Checks again every 5 minutes.' : ''];
  // The numbers of a quiet card are its fact lines; "as of" is in the heading and the hovers.
  if (s.open <= 0) return [s.stale ? 'Nothing was open.' : 'Nothing is open.'];
  const head = `${s.open} ${s.open === 1 ? 'alert' : 'alerts'} open`;
  return [[head, dev].filter(Boolean).join(', ')];
}

export type FactKind = 'scan' | 'devices' | 'blocked' | 'alarms';

export interface Fact {
  kind: FactKind;
  text: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The quiet card's fact lines, only from numbers the home app sent. Line one is the scan
 * ("Scan 10:24 AM"). Line two is the device and blocked counts ("31 devices, 412 blocked");
 * when the home app sent neither, it is the alarms in 24 hours; when it sent nothing at
 * all, there is no second line. A fact with no number is never drawn.
 */
export function shieldFacts(s: Shield): { lines: Fact[]; all: Fact[] } {
  if (s.kind !== 'ready') return { lines: [], all: [] };
  const scan: Fact | null = s.scan ? { kind: 'scan', text: `Scan ${s.scan}` } : null;
  const dev: Fact | null = s.devices !== null ? { kind: 'devices', text: plural(s.devices, 'device', 'devices') } : null;
  const blocked: Fact | null = s.blocked !== null ? { kind: 'blocked', text: `${s.blocked} blocked` } : null;
  const alarms: Fact | null = s.alarms !== null ? { kind: 'alarms', text: `${plural(s.alarms, 'alarm', 'alarms')} in 24 h` } : null;
  const counts: Fact | null = dev || blocked ? { kind: dev ? 'devices' : 'blocked', text: [dev?.text, blocked?.text].filter(Boolean).join(', ') } : null;
  const second = counts ?? alarms;
  return {
    lines: [scan, second].filter((f): f is Fact => f !== null),
    // Every fact on its own row, for the card that has no doors to fill its right side.
    all: [scan, dev, blocked, alarms].filter((f): f is Fact => f !== null),
  };
}

/** "1 high, 2 medium": the open alerts by severity, only when every open alert is listed and rated. */
export function severityCounts(s: Shield): string | null {
  if (s.alerts.length === 0 || s.alerts.length !== s.open) return null;
  const n = { high: 0, medium: 0, low: 0 };
  for (const a of s.alerts) {
    if (!a.severity) return null;
    n[a.severity] += 1;
  }
  const parts = (['high', 'medium', 'low'] as const).filter((k) => n[k] > 0).map((k) => `${n[k]} ${k}`);
  return parts.length ? parts.join(', ') : null;
}

/** The line under the newest alert: "12 min ago. 1 high, 2 medium."; empty when neither is known. */
export function alertHint(s: Shield): string {
  const newest = s.alerts[0];
  const parts = [alertAgeWords(newest?.ageMins ?? null), severityCounts(s)].filter(Boolean);
  return parts.length ? `${parts.join('. ')}.` : '';
}
