import { IconShield, IconShieldCheck, IconShieldExclamation, IconShieldX } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { ageText, alertRows, alertsLine, lastScanText, netNumbers, numbersOnLine, statusLine, tone, type SecuritySummary, type Tone } from './model';
import { useSecurity } from './useSecurity';

const SHIELD = { ok: IconShieldCheck, warn: IconShieldExclamation, bad: IconShieldX } as const;

function Status({ t, text, aside }: { t: Tone | 'off'; text: string; aside?: string | null }) {
  const Glyph = t === 'off' ? IconShield : SHIELD[t];
  return (
    <div className="net-status">
      <Glyph className={`net-icon ${t}`} size={30} stroke={1.8} aria-hidden="true" />
      <span className="t2 net-line">{text}</span>
      {aside && <span className="xs net-aside">{aside}</span>}
    </div>
  );
}

/**
 * Network and security, as the concept draws it: the heading above the card (like "Around
 * the house"), then the card with the status line and its shield, the numbers the feed
 * has, up to three open alerts as one-line rows, and the Security and Firewalla links as
 * full-width buttons along the bottom. The numbers row shows only with three or more
 * numbers; one or two sit on the status line's right ("Up, box online", "25 alarms in
 * 24 h"), and the scan age then moves up beside the heading. The card is as tall as what
 * it holds.
 */
export function NetworkTile() {
  const { status, summary, now, attempts } = useSecurity();
  const ready = summary && status !== 'unconfigured' && status !== 'loading';
  const onLine = ready ? numbersOnLine(netNumbers(summary)) : null;
  const scan = ready ? lastScanText(summary.lastScan, now) : null;
  let body;
  if (status === 'unconfigured') {
    body = <Status t="off" text="Not set up" />;
  } else if (status === 'loading') {
    body = <Status t="off" text="Loading" />;
  } else if (!summary) {
    body = (
      <>
        <Status t="warn" text="Home app not reachable" />
        <div className="s">Checks again every 5 minutes.</div>
      </>
    );
  } else {
    body = <Ready summary={summary} now={now} stale={status === 'error'} aside={onLine ?? scan} />;
  }
  // Lists stop at three and the rest is a number, beside the heading to keep the card short.
  const more = ready ? summary.alerts - alertRows(summary).length : 0;
  const shown = summary ? alertRows(summary).length : 0;
  const side = shown > 0 && more > 0 ? `${more} more open` : onLine ? scan : null;
  return (
    <section className="network-block" aria-label="Network and security">
      <div className="net-head">
        <span className="k">Network and security</span>
        {side && <span className="xs">{side}</span>}
      </div>
      <div className="panel network">
        {body}
        <Links refresh={attempts} />
      </div>
    </section>
  );
}

function Ready({ summary, now, stale, aside }: { summary: SecuritySummary; now: number; stale: boolean; aside: string | null }) {
  const t = stale ? 'warn' : tone(summary);
  const nums = netNumbers(summary);
  const rows = alertRows(summary);
  return (
    <>
      <Status t={t} text={stale ? 'Home app not reachable' : statusLine(summary)} aside={aside} />
      {nums.length >= 3 && (
        <div className={stale ? 'net-nums stale' : 'net-nums'} style={{ gridTemplateColumns: `repeat(${nums.length}, minmax(0, 1fr))` }}>
          {nums.map((n) => (
            <div key={n.key} className="st3">
              <b>{n.value}</b>
              <span>{n.label}</span>
            </div>
          ))}
        </div>
      )}
      {rows.length > 0 ? (
        <ul className={stale ? 'net-alerts stale' : 'net-alerts'} aria-label="Open alerts">
          {rows.map((r, i) => {
            const age = ageText(r.atMs, now);
            return (
              <li key={i} className="net-alert">
                <i className={`sev ${r.severity ?? 'none'}`} aria-hidden="true" />
                <span className="net-alert-text">{r.text}</span>
                {age && <span className="xs">{age}</span>}
              </li>
            );
          })}
        </ul>
      ) : (
        summary.alerts > 0 && <div className="b6">{alertsLine(summary.alerts)}</div>
      )}
    </>
  );
}

const FAIL_MS = 3000;

interface LinkAvailability {
  security: boolean;
  portal: boolean;
}

/** Full-width buttons that open the home app's Security page or the Firewalla portal (Rust opens them). */
function Links({ refresh }: { refresh: number }) {
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
  }, [refresh]);
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
