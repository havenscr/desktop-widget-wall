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
  /** The extra numbers for the hover on the summary line. */
  detail: string[];
  /** The firewall is down or its box offline (today's read says so). */
  bad: boolean;
}

const num = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null);

function timeText(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
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
      return { key: a.id ?? `n${i}`, severity: a.severity, text: a.text, age: ageText(atMs, now), atMs };
    }),
  );
  const old = readAt === null || now - readAt > maxAge(REFRESH_MS);
  const stale = failed || d.stale || !d.available || old;
  const observed = d.observedAt ? Date.parse(d.observedAt) : NaN;
  const asOfMs = Number.isFinite(observed) ? observed : readAt;
  const open = num(d.unseen) ?? alerts.length;
  const title = !d.available ? 'No security summary yet' : legacy ? statusLine({ ...legacy, alerts: open }) : open > 0 ? 'Up' : 'All quiet';
  const detail = legacyDetail(legacy);
  return {
    kind: 'ready',
    source: 'desk',
    open,
    alerts,
    stale,
    asOf: stale && asOfMs !== null ? `as of ${timeText(asOfMs)}` : null,
    title,
    devices: num(d.devices),
    blocked: num(d.blocked),
    bad: legacy ? tone(legacy) === 'bad' : false,
    canClear: d.canClear && open > 0 && !stale,
    clearNotSetUp: !d.canClear && open > 0,
    detail,
  };
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
  const base = { source: 'legacy' as const, canClear: false, clearNotSetUp: false, devices: null, blocked: null, detail: [] as string[], bad: false };
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
      .map((r, i) => ({ key: `t${i}`, severity: r.severity, text: r.text, age: ageText(r.atMs, now), atMs: r.atMs })),
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

/** The ring's line under the title: "6 alerts open, 31 devices at home". */
export function shieldSub(s: Shield): string[] {
  const dev = s.devices !== null ? `${s.devices} ${s.devices === 1 ? 'device' : 'devices'} at home` : null;
  if (s.kind !== 'ready') return [s.kind === 'down' ? 'Checks again every 5 minutes.' : ''];
  if (s.open <= 0) {
    const tail = [dev, s.blocked !== null ? `${s.blocked} blocked` : null].filter(Boolean).join(', ');
    return s.stale ? [s.asOf ? `Nothing was open ${s.asOf}.` : 'Nothing was open.', tail ? `${tail}.` : ''] : ['Nothing is open.', tail ? `${tail}.` : ''];
  }
  const head = `${s.open} ${s.open === 1 ? 'alert' : 'alerts'} open`;
  return [[head, dev].filter(Boolean).join(', ')];
}
