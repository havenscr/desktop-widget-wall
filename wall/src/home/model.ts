export interface SecuritySummary {
  reachable: boolean;
  stale: boolean;
  lastScan: string | null;
  alerts: number;
  firewalla: {
    api: 'up' | 'down' | 'unknown';
    boxOnline: boolean | null;
    checkedAt: string | null;
    alarms24h: number | null;
  } | null;
  portalUrl: string | null;
  /** Up to three open alerts as one-line rows (Rust `top_alerts`). */
  topAlerts?: AlertRow[];
  /** Numbers the home app does not send yet (PR 24 adds them); shown only when present. */
  devices?: number | null;
  blocked?: number | null;
  /** Firewall box temperature, degrees as the home app reports them. */
  boxTemp?: number | null;
}

export interface AlertRow {
  text: string;
  severity: 'high' | 'medium' | 'low' | null;
  atMs: number | null;
}

export const REFRESH_MS = 300_000;

export type Tone = 'ok' | 'warn' | 'bad';

/**
 * Status dot colour. Red only when the firewall API is down or the box is offline.
 * Amber when the home app is unreachable, stale, or the API state is unknown (or
 * there is no firewall reading at all). Green otherwise.
 */
export function tone(s: SecuritySummary): Tone {
  const fw = s.firewalla;
  if (fw && (fw.api === 'down' || fw.boxOnline === false)) return 'bad';
  if (!s.reachable || s.stale || !fw || fw.api === 'unknown') return 'warn';
  return 'ok';
}

/** The line next to the dot. */
export function statusLine(s: SecuritySummary): string {
  if (!s.reachable) return 'Home app not reachable';
  const fw = s.firewalla;
  if (fw && fw.api === 'down') return 'Firewall down';
  if (fw && fw.boxOnline === false) return 'Firewall box offline';
  if (s.stale) return 'Scan is stale';
  if (!fw || fw.api === 'unknown') return 'Firewall status unknown';
  if (s.alerts <= 0) return 'All quiet';
  return fw.boxOnline === true ? 'Up, box online' : 'Up';
}

export interface NetNumber {
  key: string;
  value: string;
  label: string;
}

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** The numbers row: devices, alarms in 24 hours, blocked, box temperature, only those present. */
export function netNumbers(s: SecuritySummary): NetNumber[] {
  const out: NetNumber[] = [];
  if (isNum(s.devices)) out.push({ key: 'devices', value: String(Math.round(s.devices)), label: 'devices' });
  const alarms = s.firewalla?.alarms24h;
  if (isNum(alarms)) out.push({ key: 'alarms', value: String(alarms), label: 'alarms, 24h' });
  if (isNum(s.blocked)) out.push({ key: 'blocked', value: String(Math.round(s.blocked)), label: 'blocked' });
  if (isNum(s.boxTemp)) out.push({ key: 'box', value: `${Math.round(s.boxTemp)}°`, label: 'box' });
  return out;
}

/** Alert rows to show: at most three, each with text. */
export function alertRows(s: SecuritySummary): AlertRow[] {
  const rows = Array.isArray(s.topAlerts) ? s.topAlerts : [];
  return rows.filter((r) => r && typeof r.text === 'string' && r.text.trim() !== '').slice(0, 3);
}

/** Short age for an alert row: "now", "12m", "3h", "2d"; null when the time is unknown. */
export function ageText(atMs: number | null, now: number): string | null {
  if (!isNum(atMs)) return null;
  const mins = Math.max(0, Math.floor((now - atMs) / 60_000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export function alertsLine(n: number): string {
  if (n <= 0) return 'No open alerts';
  return n === 1 ? '1 open alert' : `${n} open alerts`;
}

/** "last scan 4 min ago", or null when there is no readable scan time. */
export function lastScanText(lastScan: string | null, now: number): string | null {
  if (!lastScan) return null;
  const at = Date.parse(lastScan);
  if (Number.isNaN(at)) return null;
  const mins = Math.max(0, Math.floor((now - at) / 60_000));
  if (mins < 1) return 'last scan just now';
  if (mins < 60) return `last scan ${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `last scan ${hrs} ${hrs === 1 ? 'hour' : 'hours'} ago`;
  return `last scan ${Math.floor(hrs / 24)} days ago`;
}
