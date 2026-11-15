import { useCallback, useEffect, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { useVisible } from '../ui/useVisible';

/** What `wall2_meet_checklist` answers: the parsed items, never the file's own text. */
export interface ChecklistRead {
  state: 'ok' | 'missing' | 'refused';
  items: string[];
  reason: string | null;
}

export const CHECKLIST_POLL_MS = 60_000;

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
 * The first-meeting checklist: read when Meet shows, again when the window gets the focus back (after
 * editing the file) and every minute while visible. A failed read keeps the last answer.
 */
export function useChecklist(): { read: ChecklistRead; reload: () => void } {
  const [read, setRead] = useState<ChecklistRead>(NONE);
  const visible = useVisible();
  const reload = useCallback(() => {
    invoke<unknown>('wall2_meet_checklist').then(
      (v) => {
        const r = asChecklist(v);
        if (r) setRead(r);
      },
      () => undefined,
    );
  }, []);
  useEffect(() => {
    if (!visible) return;
    reload();
    const id = setInterval(reload, CHECKLIST_POLL_MS);
    window.addEventListener('focus', reload);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', reload);
    };
  }, [visible, reload]);
  return { read, reload };
}
