import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { useVisible } from '../ui/useVisible';

/** What `wall2_meet_checklist` answers: the parsed items, never the file's own text. */
export interface ChecklistRead {
  state: 'ok' | 'missing' | 'refused';
  items: string[];
  reason: string | null;
}

export const CHECKLIST_POLL_MS = 60_000;
/** After Open file writes a starter, the file is read again this long after, once. */
export const CHECKLIST_REOPEN_MS = 3000;

const NONE: ChecklistRead = { state: 'missing', items: [], reason: null };

/** A native answer that is the shape above, or null. */
export function asChecklist(v: unknown): ChecklistRead | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (r.state !== 'ok' && r.state !== 'missing' && r.state !== 'refused') return null;
  const items = Array.isArray(r.items) ? r.items.filter((x): x is string => typeof x === 'string').slice(0, 8) : [];
  return { state: r.state, items, reason: typeof r.reason === 'string' ? r.reason : null };
}

/**
 * The first-meeting checklist: read when Meet shows, again when the window gets the focus back (after editing the
 * file) and every minute while visible. Nothing runs while the page is hidden, a read that was asked for earlier never
 * lands after a later one, and nothing sets state after the screen has gone. `reloadSoon` is the one read after Open file,
 * on a timer the hook owns and clears.
 */
export function useChecklist(): { read: ChecklistRead; reload: () => void; reloadSoon: () => void } {
  const [read, setRead] = useState<ChecklistRead>(NONE);
  const visible = useVisible();
  const seq = useRef(0);
  const alive = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const reload = useCallback(() => {
    if (!alive.current || !visibleRef.current) return;
    const mine = ++seq.current;
    invoke<unknown>('wall2_meet_checklist').then(
      (v) => {
        const r = asChecklist(v);
        if (r && alive.current && mine === seq.current) setRead(r);
      },
      () => undefined,
    );
  }, []);
  const reloadSoon = useCallback(() => {
    clearTimeout(timer.current);
    if (!visibleRef.current) return;
    timer.current = setTimeout(reload, CHECKLIST_REOPEN_MS);
  }, [reload]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    if (!visible) {
      clearTimeout(timer.current);
      return;
    }
    reload();
    const id = setInterval(reload, CHECKLIST_POLL_MS);
    window.addEventListener('focus', reload);
    return () => {
      clearInterval(id);
      clearTimeout(timer.current);
      window.removeEventListener('focus', reload);
    };
  }, [visible, reload]);
  return { read, reload, reloadSoon };
}
