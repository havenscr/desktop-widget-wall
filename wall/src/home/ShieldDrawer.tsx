import { IconX } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { tip } from '../ui/HoverTip';
import { useLinks, useOpenLink } from './netLinks';
import type { Shield } from './shieldModel';
import { NOT_SET_UP, clearAllAlerts } from './useDesk';

/** Severity as a shape and a colour: amber triangle high, violet diamond medium, open ring low. */
export function SevShape({ sev, size = 18 }: { sev: 'high' | 'medium' | 'low' | null; size?: number }) {
  const label = sev === 'high' ? 'High' : sev === 'medium' ? 'Medium' : sev === 'low' ? 'Low' : 'Unrated';
  return (
    <svg className={`sev-shape ${sev ?? 'none'}`} width={size} height={size} viewBox="0 0 20 20" role="img" aria-label={label}>
      {sev === 'high' && (
        <>
          <path d="M10 2.2 L18.6 17.2 H1.4 Z" fill="var(--amber)" stroke="var(--amber)" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M10 8v4.4M10 14.6v.2" stroke="#1a1030" strokeWidth="2" strokeLinecap="round" />
        </>
      )}
      {sev === 'medium' && <path d="M10 2 L18 10 L10 18 L2 10 Z" fill="var(--violet)" stroke="var(--violet)" strokeWidth="1.4" strokeLinejoin="round" />}
      {(sev === 'low' || sev === null) && <circle cx="10" cy="10" r="6.6" fill="none" stroke={sev === 'low' ? 'var(--dim)' : 'var(--faint)'} strokeWidth="2.2" />}
    </svg>
  );
}

const CLEAR_WORDS: Record<string, string> = {
  [NOT_SET_UP]: 'Clear all is not set up',
  'nothing-to-clear': 'Nothing to clear',
  forbidden: 'The home app refused the clear',
  absent: 'The home app cannot clear yet',
  'needs-private-address': 'Clear all needs a private or https address',
};

const NOTE_MS = 5000;

/**
 * Every open alert over the network card, as drawn: its shape, its text, its age, and Open
 * (the home app's Security page, or the Firewalla portal). Clear all marks them all seen in
 * the home app; the home app has no clear for one alert, so there is no per-alert Clear.
 * Without a desk token on this PC, Clear all says "not set up" and does nothing else.
 * Escape, the close button or a click outside closes it.
 */
export function ShieldDrawer({ s, refresh, onClose }: { s: Shield; refresh: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const links = useLinks(refresh);
  const { open, failed } = useOpenLink();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const down = (e: PointerEvent) => {
      const el = ref.current;
      const t = e.target as Node | null;
      if (!el || !t || el.contains(t)) return;
      // The card's own button toggles the drawer; leave that click to it.
      if ((t as Element).closest?.('.network-block .panel.network')) return;
      onClose();
    };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', down);
    return () => {
      mounted.current = false;
      document.removeEventListener('keydown', key);
      document.removeEventListener('pointerdown', down);
      window.clearTimeout(timer.current);
    };
  }, [onClose]);

  const say = useCallback((text: string) => {
    setNote(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => mounted.current && setNote(null), NOTE_MS);
  }, []);

  const clear = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      // On success the list empties and the drawer closes; the card shows "Cleared N alerts".
      await clearAllAlerts();
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      if (mounted.current) say(CLEAR_WORDS[text] ?? 'Could not clear');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [busy, say]);

  const target: 'security' | 'portal' | null = links.security ? 'security' : links.portal ? 'portal' : null;
  const shownMore = s.open - s.alerts.length;
  const count = s.alerts.length > 0 && s.open !== s.alerts.length && s.source === 'desk' ? `${s.open} new of ${s.alerts.length}` : `${s.open} open ${s.open === 1 ? 'alert' : 'alerts'}`;
  // Not live: the list is what the last good read said, and the title says when that was.
  const title = s.stale && s.asOf ? `${count} ${s.asOf}` : count;
  return (
    <div ref={ref} className="shield-drawer" role="dialog" aria-label="Open alerts">
      <div className="sd-head">
        <b>{title}</b>
        {note && (
          <span className="s sd-note" role="status">
            {note}
          </span>
        )}
        {failed && !note && (
          <span className="s sd-note" role="status">
            Could not open
          </span>
        )}
        {s.canClear && (
          <button type="button" className="sd-txt" disabled={busy} onClick={() => void clear()} {...tip('Mark every open alert seen in the home app')}>
            {busy ? 'Clearing' : 'Clear all'}
          </button>
        )}
        {s.clearWaits && (
          <span className="sd-txt off" {...tip('The last read is not live, so Clear all would clear alerts this list may not show. It comes back with the next good read.')}>
            Clear all waits for a fresh read
          </span>
        )}
        {s.clearInsecure && (
          <span className="sd-txt off" {...tip('The home app address in feeds.json is plain http on the local network, so the wall does not send its desk token there. Use https, a loopback or a tailnet address.')}>
            Clear all needs a private or https address
          </span>
        )}
        {s.clearNotSetUp && (
          <span className="sd-txt off" {...tip('Clear all needs homeDeskToken in feeds.json on this PC (and the same token in the home app).')}>
            Clear all: not set up
          </span>
        )}
        <button type="button" className="sd-x" aria-label="Close" onClick={onClose} {...tip('Close')}>
          <IconX size={16} stroke={2.2} aria-hidden="true" />
        </button>
      </div>
      <div className="sd-list">
        {s.alerts.map((a) => (
          <div key={a.key} className="sd-row">
            <SevShape sev={a.severity} size={16} />
            <b {...tip(a.atMs !== null ? `${a.text}. ${new Date(a.atMs).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : a.text)}>{a.text}</b>
            {a.age && <span className="age">{a.age}</span>}
            {target && (
              <button type="button" className="sd-txt" onClick={() => open(target)} {...tip(target === 'security' ? 'Open the alarms in the home app' : 'Open the Firewalla portal')}>
                Open
              </button>
            )}
          </div>
        ))}
        {shownMore > 0 && <div className="sd-more s">{shownMore} more in the home app</div>}
      </div>
    </div>
  );
}
