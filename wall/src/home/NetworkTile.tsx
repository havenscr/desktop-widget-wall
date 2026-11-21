import { IconBan, IconBell, IconChevronRight, IconClock, IconDevices, IconShield, IconWorld } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { tip } from '../ui/HoverTip';
import { useRemeasure } from '../ui/useRemeasure';
import { useLinks, useOpenLink } from './netLinks';
import { ShieldDrawer, SevShape } from './ShieldDrawer';
import { MAX_ARCS, alertHint, ringCount, severityCounts, PORTAL_REST, securityDoorLine, shieldFacts, shieldFrom, shieldSub, type FactKind, type Shield } from './shieldModel';
import { useClearedNote, useDeskSecurity } from './useDesk';
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
          // A severity the wall was not told (a listed alert with none, or one past the listed three) is neutral, never amber.
          const colour = grey ? 'var(--faint)' : sev ? SEV_COLOUR[sev] : 'var(--faint)';
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

const FACT_ICON: Record<FactKind, typeof IconClock> = { scan: IconClock, devices: IconDevices, blocked: IconBan, alarms: IconBell };

/** What the ring says when hovered: the state in words, never more than the wall was sent. */
function ringTip(s: Shield): string {
  if (s.kind === 'off') return 'The home app is not set up on this wall';
  if (s.kind === 'loading') return 'Reading the home app';
  if (s.kind === 'down') return 'The home app could not be reached. Checks again every 5 minutes';
  const asOf = s.stale && s.asOf ? ` (${s.asOf})` : '';
  if (s.open <= 0) return s.stale ? `Nothing was open${s.asOf ? `, ${s.asOf}` : ''}. This is not a live read` : 'Nothing is open. The ring is whole and green';
  const by = severityCounts(s);
  return `${s.open} open ${s.open === 1 ? 'alert' : 'alerts'}${by ? `: ${by}` : ''}${asOf}`;
}

/**
 * Network and security as a shield you can read from across the room. Quiet: the ring,
 * the title, a line saying nothing is open, two fact lines (only numbers the home app
 * sent), and at the right two doors, Security (the home app's alarms) and Firewalla (its
 * portal), each only when the wall has its address. With open alerts the card is taller:
 * the ring with one lit arc per alert, the newest alert in one line with its age and the
 * counts by severity, and a row of buttons, Show all (the drawer with every alert, Open on
 * each, and Clear all once the desk route and token exist), Security and Firewalla.
 */
export function NetworkTile() {
  const s = useShield();
  const { attempts } = useSecurity();
  const avail = useLinks(attempts);
  const { open: openLink, failed } = useOpenLink();
  const [open, setOpen] = useState(false);
  const busy = s.kind === 'ready' && s.open > 0;
  // Nothing to list any more (cleared, or the read went away): the drawer closes itself.
  useEffect(() => {
    if (!busy) setOpen(false);
  }, [busy]);
  const newest = s.alerts[0] ?? null;
  const sub = shieldSub(s).filter(Boolean);
  const facts = shieldFacts(s);
  const doors = s.kind === 'ready' && (avail.security || avail.portal);
  const cls = ['panel', 'network', 'shield', busy ? 'busy' : 'calm', s.stale ? 'stale' : '', !busy && !doors && !(s.kind === 'ready' && facts.all.length > 0) ? 'noside' : ''].filter(Boolean).join(' ');
  const detail = [...sub, ...s.detail].filter(Boolean).join('. ');
  // Not live: the count says when it was read ("6 open as of 3:12 PM"), never as if current.
  const side = busy ? [`${s.open} open`, s.stale ? s.asOf : null].filter(Boolean).join(' ') : s.asOf;
  // After Clear all the drawer closes; the card says what was cleared for a few seconds.
  const cleared = useClearedNote((n) => n.text);
  const hint = busy ? alertHint(s) : '';
  const asOfTip = s.stale && s.asOf ? `Not live, ${s.asOf}. ` : '';
  const factRow = (f: { kind: FactKind; text: string }) => {
    const Icon = FACT_ICON[f.kind];
    // The scan time is the firewall's own clock, not the home app's: the heading's "as of" is a different one.
    const hover = f.kind === 'scan' && s.scan ? `The firewall's own last scan, ${s.scan}` : `${asOfTip}${f.text}`;
    return (
      <span key={f.kind} className="shield-fact" {...tip(hover)}>
        <Icon size={17} stroke={1.8} aria-hidden="true" />
        <span>{f.text}</span>
      </span>
    );
  };
  const door = (kind: 'security' | 'portal', icon: ReactNode, name: string, what: string, tipText: string) => (
    <button type="button" className="shield-door" onClick={() => openLink(kind)} {...tip(tipText)}>
      {icon}
      <span className="shield-door-txt">
        <b>{name}</b>
        <span>{what}</span>
      </span>
    </button>
  );
  const SECURITY_TIP = 'Open the network alarms in the home app';
  const PORTAL_TIP = 'Open the Firewalla portal in the browser';
  // Quiet and with no door to open, the facts take the right side as one box, each on its own row.
  const factsAside = !busy && s.kind === 'ready' && !doors && facts.all.length > 0;
  // The title is the card's most important line: one line at 27 px when it fits its column, else two lines at 22 px.
  const titleRef = useRef<HTMLSpanElement>(null);
  const [longTitle, setLongTitle] = useState(false);
  const measureTitle = () => {
    const el = titleRef.current;
    if (!el) return;
    el.classList.remove('long');
    const over = el.scrollWidth > el.clientWidth + 0.5;
    el.classList.toggle('long', over);
    setLongTitle(over);
  };
  useLayoutEffect(measureTitle, [s.title, busy, doors, factsAside]);
  // Measured again when the column changes width or the display font arrives after the first paint.
  useRemeasure(titleRef, measureTitle);
  return (
    <section className={open && busy ? 'network-block drawer-open' : 'network-block'} aria-label="Network and security">
      <div className="net-head">
        <span className="k">Network and security</span>
        {failed ? (
          <span className="xs net-failed" role="status">
            Could not open
          </span>
        ) : cleared ? (
          <span className="xs net-cleared" role="status">
            {cleared}
          </span>
        ) : (
          side && (
            <span className={s.stale ? 'xs stale' : 'xs'} {...(s.asOf ? tip(`The home app's last answer, ${s.asOf.replace(/^as of /, '')}`) : {})}>
              {side}
            </span>
          )
        )}
      </div>
      <div
        className={cls}
        // With alerts open a click on the card's own face opens the drawer, as the whole card did before; its buttons act for themselves.
        onClick={(e) => {
          if (busy && !(e.target as Element).closest('button')) setOpen((o) => !o);
        }}
      >
        <span className="shield-art" {...tip(ringTip(s))}>
          <ShieldRing s={s} />
        </span>
        <span className={longTitle ? 'shield-txt longtitle' : 'shield-txt'}>
          <span ref={titleRef} className={longTitle ? 'shield-title long' : 'shield-title'} {...tip(s.title)}>
            {s.title}
          </span>
          <span className="shield-sub" {...tip(detail || s.title)}>
            {sub.map((l, i) => (
              <span key={i}>{l}</span>
            ))}
          </span>
          {busy && newest && (
            <button type="button" className="shield-new" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog" {...tip(`${newest.text}. Show all ${s.open} open alerts`)}>
              <SevShape sev={newest.severity} size={18} />
              <b>{newest.text}</b>
            </button>
          )}
          {busy && hint && <span className="shield-hint">{hint}</span>}
          {!busy && facts.lines.length > 0 && !factsAside && <span className="shield-facts">{facts.lines.map(factRow)}</span>}
        </span>
        {!busy && doors && (
          <span className="shield-doors">
            {avail.security && door('security', <IconShield size={24} stroke={1.7} aria-hidden="true" />, 'Home Security', securityDoorLine(s), SECURITY_TIP)}
            {avail.portal && door('portal', <IconWorld size={24} stroke={1.7} aria-hidden="true" />, 'Firewalla', PORTAL_REST, PORTAL_TIP)}
          </span>
        )}
        {factsAside && <span className="shield-aside">{facts.all.map(factRow)}</span>}
        {busy && (
          <span className="shield-btns">
            <button type="button" className="shield-btn fill" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog" {...tip(`Show all ${s.open} open alerts`)}>
              Show all {s.open}
              <IconChevronRight size={18} stroke={2} aria-hidden="true" />
            </button>
            {avail.security && (
              <button type="button" className="shield-btn" onClick={() => openLink('security')} {...tip(SECURITY_TIP)}>
                <IconShield size={20} stroke={1.8} aria-hidden="true" />
                Home Security
              </button>
            )}
            {avail.portal && (
              <button type="button" className="shield-btn" onClick={() => openLink('portal')} {...tip(PORTAL_TIP)}>
                <IconWorld size={20} stroke={1.8} aria-hidden="true" />
                Firewalla
              </button>
            )}
          </span>
        )}
      </div>
      {open && busy && <ShieldDrawer s={s} refresh={attempts} onClose={() => setOpen(false)} />}
    </section>
  );
}
