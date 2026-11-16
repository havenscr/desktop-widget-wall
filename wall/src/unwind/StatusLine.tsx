import { IconBriefcaseOff, IconFocus2 } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { useSnoozed } from '../agents/snooze';
import type { OmniSummary } from '../agents/model';
import { invoke } from '../bridge/tauri';
import { useFocusStore } from '../focus/store';
import { AlarmChip } from '../home/AlarmChip';
import { useOpenAlarms } from '../home/useSecurity';
import { usePlaceStore } from '../state/places';
import { tip } from '../ui/HoverTip';
import { useVisible } from '../ui/useVisible';
import { needsCard, STATUS_MAX_DOTS, statusCard, statusMarks, type FocusSeen, type StatusSummary } from './model';

export const STATUS_POLL_MS = 60_000;

/** Asks Rust to open the chat (Rust checks the id); a refusal changes nothing on the wall. */
function openSession(id: string): void {
  invoke('wall2_open_session', { id }).catch(() => undefined);
}

/** A read that failed with one of these means the helper is not set up here (no ring, nothing to warn about). */
const NOT_SET_UP = ['not-configured', 'invalid-config'];

/**
 * The bottom left of Unwind as quiet marks: a capsule with the "work is put away" mark (Tabler
 * `focus-2` in cyan while a focus session is on), one soft dot per running agent (six, then "+N"), and
 * the network alerts as a shield and a count; and, when something needs the owner, a separate amber pill
 * in words. The capsule's left part switches to Work; the alerts go to Home; the amber pill opens the first
 * waiting chat (or Work when links are not available). Its hover card carries the sentences the line used
 * to say. A helper that is not current (failing or stale) shows one hollow grey ring in place of the dots,
 * never an all-clear. Counting is `statusMarks` (top-level sessions only), the same as the old sentence.
 */
export function StatusLine() {
  const visible = useVisible();
  const focus = useFocusStore((s): FocusSeen => (!s.loaded ? 'unknown' : s.state.status === 'running' || s.state.status === 'paused' ? 'on' : 'off'));
  const [summary, setSummary] = useState<StatusSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!visible) return;
    // Back on screen: what was kept is old until the first new read returns.
    setSummary((prev) => (prev ? { ...prev, stale: true } : prev));
    const read = async () => {
      try {
        const s = await invoke<StatusSummary>('wall2_omni_summary');
        if (!mounted.current) return;
        const ok = s && Array.isArray(s.lanes) && s.yourMove && typeof s.yourMove === 'object';
        setSummary(ok ? { stale: s.stale === true, now: s.now, lanes: s.lanes, sessionsList: Array.isArray(s.sessionsList) ? s.sessionsList : null, yourMove: s.yourMove, linksAvailable: s.linksAvailable === true } : null);
        setFailed(!ok);
      } catch (e) {
        if (!mounted.current) return;
        setSummary(null);
        setFailed(!NOT_SET_UP.includes(e instanceof Error ? e.message : String(e)));
      }
    };
    void read();
    const id = setInterval(() => void read(), STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [visible]);
  // "Later" on Work: the same snooze store, so a snoozed chat raises no pill here either.
  const snoozed = useSnoozed(summary as unknown as OmniSummary | null);
  const m = statusMarks(focus, summary, snoozed.ids, failed);
  const alarms = useOpenAlarms();
  const ring = m.agents === 'stale' || m.agents === 'failed';
  const needs = m.needs ?? 0;
  // Nothing to say and no alarm: nothing is drawn (the focus store has not loaded and the agents have nothing to add).
  if (m.focus === 'unknown' && m.running <= 0 && !ring && needs <= 0 && alarms <= 0) return null;
  const card = statusCard(m);
  const dots = Math.min(m.running, STATUS_MAX_DOTS);
  const more = m.running - dots;
  const open = m.open;
  const toWork = () => usePlaceStore.getState().setActive('work');
  const Mark = m.focus === 'on' ? IconFocus2 : IconBriefcaseOff;
  return (
    <div className="u-line">
      <div className={`u-cap${alarms > 0 ? ' has-net' : ''}`}>
        <button
          type="button"
          className="u-cap-work"
          aria-label={[card.title, card.detail, 'Show the agents on Work'].filter(Boolean).join('. ').replace(/\.\./g, '.')}
          onClick={toWork}
          {...tip(
            <>
              <span className="tip-t">{card.title}</span>
              {card.detail ? <span className="tip-s">{card.detail}</span> : null}
              <span className="tip-k">{card.hint}</span>
            </>,
          )}
        >
          <Mark className={`u-mark${m.focus === 'on' ? ' focus' : ''}`} size={22} stroke={1.7} aria-hidden="true" />
          {ring || dots > 0 ? (
            <span className="u-dots" aria-hidden="true">
              {ring ? <i className="u-ring" /> : Array.from({ length: dots }, (_, i) => <i key={i} className="u-dot" />)}
              {!ring && more > 0 ? <span className="u-more">+{more}</span> : null}
            </span>
          ) : null}
        </button>
        {alarms > 0 ? <AlarmChip className="u-cap-net" mark /> : null}
      </div>
      {needs > 0 ? (
        <button
          type="button"
          className="u-need"
          onClick={() => (open ? openSession(open) : toWork())}
          {...tip(
            <>
              <span className="tip-t">{needsCard(needs, !!open).title}</span>
              <span className="tip-k">{needsCard(needs, !!open).hint}</span>
            </>,
          )}
        >
          <i className="u-dot amber" aria-hidden="true" />
          {needs === 1 ? 'One thing needs you' : `${needs} things need you`}
        </button>
      ) : null}
    </div>
  );
}
