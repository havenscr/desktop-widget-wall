import { useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { useFocusStore } from '../focus/store';
import { useVisible } from '../ui/useVisible';
import { statusLine, type StatusSummary } from './model';

export const STATUS_POLL_MS = 60_000;

/** "Work is put away. 2 agents still running. Nothing needs you." The agent part comes from the helper summary when it is set up. */
export function StatusLine() {
  const visible = useVisible();
  const focusOn = useFocusStore((s) => s.state.status === 'running' || s.state.status === 'paused');
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
        if (mounted.current) setSummary(s && Array.isArray(s.lanes) && s.yourMove ? s : null);
      } catch {
        if (mounted.current) setSummary(null);
      }
    };
    void read();
    const id = setInterval(() => void read(), STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [visible]);
  return <div className="u-line">{statusLine(focusOn, summary)}</div>;
}
