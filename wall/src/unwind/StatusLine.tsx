import { useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { useFocusStore } from '../focus/store';
import { AlarmChip } from '../home/AlarmChip';
import { useOpenAlarms } from '../home/useSecurity';
import { usePlaceStore } from '../state/places';
import { useVisible } from '../ui/useVisible';
import { statusParts, type FocusSeen, type StatusSummary } from './model';

export const STATUS_POLL_MS = 60_000;

/** Asks Rust to open the chat (Rust checks the id); a refusal changes nothing on the wall. */
function openSession(id: string): void {
  invoke('wall2_open_session', { id }).catch(() => undefined);
}

/**
 * "Work is put away. 2 agents still running. No agent needs you." The words stay, but the
 * parts that carry an action act like it: "N agents still running" is a quiet chip that
 * switches to Work, and "N things need you" an amber chip that opens the first waiting
 * chat (or, when links are not available, switches to Work). The first sentence waits for the focus
 * store to load; the agent parts come from the helper summary and are left out when the
 * helper is not set up, fails, or says its data is stale.
 */
export function StatusLine() {
  const visible = useVisible();
  const focus = useFocusStore((s): FocusSeen => (!s.loaded ? 'unknown' : s.state.status === 'running' || s.state.status === 'paused' ? 'on' : 'off'));
  const [summary, setSummary] = useState<StatusSummary | null>(null);
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
        setSummary(ok ? { stale: s.stale === true, lanes: s.lanes, yourMove: s.yourMove, linksAvailable: s.linksAvailable === true } : null);
      } catch {
        if (mounted.current) setSummary(null);
      }
    };
    void read();
    const id = setInterval(() => void read(), STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [visible]);
  const parts = statusParts(focus, summary);
  const alarms = useOpenAlarms();
  if (parts.length === 0 && alarms <= 0) return null;
  // The network alarm chip goes after the agents running chip, else after the first sentence.
  const lastRunning = parts.map((p) => p.kind).lastIndexOf('running');
  const alarmAt = lastRunning >= 0 ? lastRunning + 1 : focus === 'unknown' ? 0 : Math.min(1, parts.length);
  return (
    <div className="u-line">
      {parts.map((p, i) => (
        <span key={p.kind + i} className="u-part">
          {i === alarmAt && alarms > 0 && (
            <>
              {i > 0 ? ' ' : null}
              <AlarmChip className="u-act" period />
            </>
          )}
          {i > 0 || (i === alarmAt && alarms > 0) ? ' ' : null}
          {p.kind === 'running' ? (
            <button type="button" className="u-act" title="Show the agents on Work" onClick={() => usePlaceStore.getState().setActive('work')}>
              {p.text}
            </button>
          ) : p.kind === 'needs' ? (
            <button
              type="button"
              className="u-act amber"
              title={p.open ? 'Open the chat that is waiting for you' : 'Show the agents on Work'}
              onClick={() => (p.open ? openSession(p.open) : usePlaceStore.getState().setActive('work'))}
            >
              {p.text}
            </button>
          ) : (
            p.text
          )}
        </span>
      ))}
      {alarmAt >= parts.length && alarms > 0 && (
        <span className="u-part">
          {parts.length > 0 ? ' ' : null}
          <AlarmChip className="u-act" period />
        </span>
      )}
    </div>
  );
}
