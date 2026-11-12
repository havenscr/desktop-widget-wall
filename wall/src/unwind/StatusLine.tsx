import { useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { useFocusStore } from '../focus/store';
import { useVisible } from '../ui/useVisible';
import { statusLine, type FocusSeen, type StatusSummary } from './model';

export const STATUS_POLL_MS = 60_000;

/**
 * "Work is put away. 2 agents still running. Nothing needs you." The first sentence waits
 * for the focus store to load; the agent part comes from the helper summary and is left
 * out when the helper is not set up, fails, or says its data is stale.
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
        setSummary(ok ? { stale: s.stale === true, lanes: s.lanes, yourMove: s.yourMove } : null);
      } catch {
        if (mounted.current) setSummary(null);
      }
    };
    void read();
    const id = setInterval(() => void read(), STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [visible]);
  const text = statusLine(focus, summary);
  if (!text) return null;
  return <div className="u-line">{text}</div>;
}
