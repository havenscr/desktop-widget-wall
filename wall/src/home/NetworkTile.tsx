import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
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
      <Links refreshKey={summary.portalUrl ?? ''} />
    </>
  );
}

const FAIL_MS = 3000;

interface LinkAvailability {
  security: boolean;
  portal: boolean;
}

/** Quiet text buttons that open the home app's Security page or the Firewalla portal (Rust opens them). */
function Links({ refreshKey }: { refreshKey: string }) {
  const [avail, setAvail] = useState<LinkAvailability>({ security: false, portal: false });
  const [failed, setFailed] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let live = true;
    invoke<LinkAvailability>('wall2_links')
      .then((a) => live && setAvail(a))
      .catch(() => live && setAvail({ security: false, portal: false }));
    return () => {
      live = false;
    };
  }, [refreshKey]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const open = useCallback((kind: 'security' | 'portal') => {
    invoke('wall2_open_link', { kind }).catch(() => {
      setFailed(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setFailed(false), FAIL_MS);
    });
  }, []);

  if (!avail.security && !avail.portal) return null;
  return (
    <div className="net-links">
      {avail.security && (
        <button type="button" className="net-link" onClick={() => open('security')}>
          Security
        </button>
      )}
      {avail.portal && (
        <button type="button" className="net-link" onClick={() => open('portal')}>
          Firewalla
        </button>
      )}
      {failed && (
        <span className="s" role="status">
          Could not open
        </span>
      )}
    </div>
  );
}
