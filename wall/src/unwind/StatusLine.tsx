import { useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { useFocusStore } from '../focus/store';
import { usePlaceStore } from '../state/places';
import { useVisible } from '../ui/useVisible';
import { statusParts, type FocusSeen, type StatusSummary } from './model';

export const STATUS_POLL_MS = 60_000;

/** Asks Rust to open the chat (Rust checks the id); a refusal changes nothing on the wall. */
function openSession(id: string): void {
  invoke('wall2_open_session', { id }).catch(() => undefined);
}

/**
 * "Work is put away. 2 agents still running. Nothing needs you." The words stay, but the
 * parts that carry an action act like it: "N agents still running" is a quiet chip that
 * switches to Work, and "N things need you" an amber chip that opens the first waiting
 * chat (plain text when links are not available). The first sentence waits for the focus
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
  if (parts.length === 0) return null;
  return (
    <div className="u-line">
      {parts.map((p, i) => (
        <span key={p.kind + i} className="u-part">
          {i > 0 ? ' ' : null}
          {p.kind === 'running' ? (
            <button type="button" className="u-act" title="Show the agents on Work" onClick={() => usePlaceStore.getState().setActive('work')}>
              {p.text}
            </button>
          ) : p.kind === 'needs' && p.open ? (
            <button type="button" className="u-act amber" title="Open the chat that is waiting for you" onClick={() => openSession(p.open!)}>
              {p.text}
            </button>
          ) : (
            p.text
          )}
        </span>
      ))}
    </div>
  );
}
