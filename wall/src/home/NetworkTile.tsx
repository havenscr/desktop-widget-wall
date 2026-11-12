import { alertsLine, lastScanText, statusLine, tone, type SecuritySummary } from './model';
import { useSecurity } from './useSecurity';

/** Network and security: a status dot and line, the open-alert count and the last scan age. */
export function NetworkTile() {
  const { status, summary, now } = useSecurity();
  let body;
  if (status === 'unconfigured') {
    body = <div className="s">Not set up</div>;
  } else if (status === 'loading') {
    body = <div className="s">Loading</div>;
  } else if (!summary) {
    body = (
      <div className="net-status">
        <span className="net-dot warn" aria-hidden="true" />
        <span className="t2">Home app not reachable</span>
      </div>
    );
  } else {
    body = <Ready summary={summary} now={now} stale={status === 'error'} />;
  }
  return (
    <section className="panel network" aria-label="Network and security">
      <span className="k">Network and security</span>
      {body}
    </section>
  );
}

function Ready({ summary, now, stale }: { summary: SecuritySummary; now: number; stale: boolean }) {
  const t = stale ? 'warn' : tone(summary);
  const scan = lastScanText(summary.lastScan, now);
  return (
    <>
      <div className="net-status">
        <span className={`net-dot ${t}`} aria-hidden="true" />
        <span className="t2">{stale ? 'Home app not reachable' : statusLine(summary)}</span>
      </div>
      <div className="b6">{alertsLine(summary.alerts)}</div>
      {scan && <div className="s">{scan}</div>}
    </>
  );
}
