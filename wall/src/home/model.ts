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
  return fw.boxOnline === true ? 'Up, box online' : 'Up';
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
