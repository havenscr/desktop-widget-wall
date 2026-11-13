import { IconChevronRight } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { tip } from '../ui/HoverTip';
import { useLinks, useOpenLink } from './netLinks';
import { ShieldDrawer, SevShape } from './ShieldDrawer';
import { MAX_ARCS, ringCount, shieldFrom, shieldSub, type Shield } from './shieldModel';
import { useDeskSecurity } from './useDesk';
import { useSecurity } from './useSecurity';

/** The card's shared read of both security sources (the rail and Chores read it too). */
export function useShield(): Shield {
  const sec = useSecurity();
  const desk = useDeskSecurity();
  return shieldFrom(desk, sec);
}

const R = 82;
const C = 2 * Math.PI * R;
const SEV_COLOUR = { high: 'var(--amber)', medium: 'var(--violet, #9a7bff)', low: '#b7afd6' } as const;

/**
 * The shield in its ring: one lit arc per open alert (at most twelve), the count inside;
 * quiet is one whole mint ring with a check; stale or not live is a grey ring, never mint.
 */
export function ShieldRing({ s }: { s: Shield }) {
  const grey = s.kind !== 'ready' || s.stale;
  const n = Math.min(s.open, MAX_ARCS);
  const quiet = s.kind === 'ready' && s.open <= 0;
  const seg = n > 0 ? C / n : C;
  const gap = n > 1 ? Math.min(16, seg * 0.3) : 0;
  const line = grey ? 'var(--faint)' : s.bad ? 'var(--amber)' : 'var(--mint)';
  return (
    <svg className="shield-ring" viewBox="0 0 190 190" aria-hidden="true">
      {n === 0 && <circle cx="95" cy="95" r={R} fill="none" stroke={line} strokeOpacity={grey ? 0.5 : 0.55} strokeWidth="5" />}
      {n > 0 &&
        Array.from({ length: n }, (_, i) => {
          const sev = s.alerts[i]?.severity;
          const colour = grey ? 'var(--faint)' : sev ? SEV_COLOUR[sev] : 'var(--amber)';
          return (
            <circle
              key={i}
              className="arc"
              cx="95"
              cy="95"
              r={R}
              fill="none"
              stroke={colour}
              strokeWidth="7"
              strokeLinecap={n > 1 ? 'round' : 'butt'}
              strokeDasharray={`${seg - gap} ${C - seg + gap}`}
              strokeDashoffset={-(i * seg + gap / 2)}
              transform="rotate(-90 95 95)"
            />
          );
        })}
      <path d="M95 44 L133 58 V92 C133 118 116 137 95 146 C74 137 57 118 57 92 V58 Z" fill={grey ? 'rgba(255,255,255,.04)' : 'rgba(93,242,182,.07)'} stroke={line} strokeWidth="3.5" strokeLinejoin="round" />
      {quiet && !grey && <path d="M78 95 L90 107 L113 81" fill="none" stroke="var(--mint)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />}
      {s.open > 0 && (
        <text x="95" y={s.open > MAX_ARCS ? 107 : 111} textAnchor="middle" className="shield-n" fontSize={s.open > MAX_ARCS ? 34 : 46}>
          {ringCount(s.open)}
        </text>
      )}
    </svg>
  );
}

/**
 * Network and security as a shield you can read from across the room: the ring with one
 * lit arc per open alert and the count inside, the newest alert in one line, and a click
 * that opens the drawer with all of them (Open on each, and Clear all once the home app's
 * desk route and the desk token exist). Quiet, it is a whole mint ring, "All quiet", the
 * device and blocked numbers, and the Security and Firewalla links.
 */
export function NetworkTile() {
  const s = useShield();
  const { attempts } = useSecurity();
  const [open, setOpen] = useState(false);
  const busy = s.kind === 'ready' && s.open > 0;
  // Nothing to list any more (cleared, or the read went away): the drawer closes itself.
  useEffect(() => {
    if (!busy) setOpen(false);
  }, [busy]);
  const newest = s.alerts[0] ?? null;
  const sub = shieldSub(s);
  const cls = ['panel', 'network', 'shield', busy ? 'busy' : 'calm', s.stale ? 'stale' : ''].filter(Boolean).join(' ');
  const detail = [...sub, ...s.detail].filter(Boolean).join('. ');
  const side = busy ? `${s.open} open` : s.asOf;
  const body = (
    <>
      <span className="shield-art">
        <ShieldRing s={s} />
      </span>
      <span className="shield-txt">
        <span className="shield-title">{s.title}</span>
        <span className="shield-sub" {...tip(detail || s.title)}>
          {sub.map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </span>
        {busy && newest && (
          <span className="shield-new">
            <SevShape sev={newest.severity} size={20} />
            <b>{newest.text}</b>
          </span>
        )}
        {busy && (
          <span className="shield-hint">
            {[newest?.age ? `${newest.age} ago` : null, `Click for all ${s.open}`].filter(Boolean).join('. ')}
            <IconChevronRight size={16} stroke={2} aria-hidden="true" />
          </span>
        )}
        {!busy && s.kind === 'ready' && (
          <span className="shield-links">
            <Links refresh={attempts} />
          </span>
        )}
      </span>
    </>
  );
  return (
    <section className="network-block" aria-label="Network and security">
      <div className="net-head">
        <span className="k">Network and security</span>
        {side && <span className={s.stale ? 'xs stale' : 'xs'}>{side}</span>}
      </div>
      {busy ? (
        <button type="button" className={cls} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)} {...tip(`Show all ${s.open} open alerts`)}>
          {body}
        </button>
      ) : (
        <div className={cls}>{body}</div>
      )}
      {open && busy && <ShieldDrawer s={s} refresh={attempts} onClose={() => setOpen(false)} />}
    </section>
  );
}

/** The Security and Firewalla buttons, each only when Rust has its address. */
function Links({ refresh }: { refresh: number }) {
  const avail = useLinks(refresh);
  const { open, failed } = useOpenLink();
  if (!avail.security && !avail.portal) return null;
  return (
    <span className="net-links">
      {avail.security && (
        <button type="button" className="net-link" onClick={() => open('security')} {...tip('Open the network alarms in the home app')}>
          Security
        </button>
      )}
      {avail.portal && (
        <button type="button" className="net-link" onClick={() => open('portal')} {...tip('Open the Firewalla portal in the browser')}>
          Firewalla
        </button>
      )}
      {failed && (
        <span className="s" role="status">
          Could not open
        </span>
      )}
    </span>
  );
}
